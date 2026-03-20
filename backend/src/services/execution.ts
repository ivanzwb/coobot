import { taskService } from './task.js';
import { llmAdapter } from './llm.js';
import { promptService } from './prompt.js';
import { permissionService } from './permission.js';
import { TaskStatus, StepStatus, PermissionAction } from '../types/index.js';
import { skillToolRoutingService } from './skill-routing.js';

export interface ReActStep {
  reasoning: string;
  action: string;
  actionInput: any;
  observation: string;
}

export interface AgentExecutionRequest {
  taskId: string;
  stepId: string;
  agentId: string;
  input: string;
  context: {
    attachments?: any[];
    memory?: any[];
    knowledge?: any[];
    previousSteps?: any[];
    selectedSkillIds?: string[];
  };
}

export interface AgentExecutionResult {
  success: boolean;
  finalOutput?: string;
  reasoningSummary?: string;
  toolCalls?: any[];
  error?: string;
  failureCode?: string;
  failureRound?: number;
  failedTool?: string;
  requiresConfirmation?: boolean;
  permissionRequestId?: string;
  pendingTarget?: string;
}

class PermissionPendingError extends Error {
  requestId?: string;
  target?: string;

  constructor(message: string, requestId?: string, target?: string) {
    super(message);
    this.name = 'PermissionPendingError';
    this.requestId = requestId;
    this.target = target;
  }
}

export class AgentExecutionService {
  private maxReActRounds = 10;

  async execute(request: AgentExecutionRequest): Promise<AgentExecutionResult> {
    const { taskId, stepId, agentId, input, context } = request;

    let currentReActRound = 0;
    let finalOutput = '';
    let reasoningSummary = '';
    let lastAction = '';
    const toolCalls: any[] = [];

    await taskService.updateStep(stepId, {
      status: StepStatus.RUNNING,
      startedAt: new Date()
    });

    try {
      const systemPrompt = await this.getAgentPrompt(agentId, taskId);
      let userPrompt = this.buildUserPrompt(input, context);

      const selectedSkillIds = Array.isArray(context.selectedSkillIds)
        ? context.selectedSkillIds.filter((value): value is string => typeof value === 'string' && value.length > 0)
        : [];

      while (currentReActRound < this.maxReActRounds) {
        const result = await this.executeReActRound(
          taskId,
          systemPrompt,
          userPrompt,
          context,
          selectedSkillIds,
          currentReActRound
        );

        if (result.action === 'finish') {
          finalOutput = result.observation || result.actionInput;
          reasoningSummary = result.reasoning;
          break;
        }

        if (result.action && result.actionInput) {
          lastAction = result.action;

          if (result.action === 'use_skill') {
            const skillId = typeof result.actionInput.skillId === 'string' ? result.actionInput.skillId : '';
            if (!skillId) {
              throw new Error('use_skill requires skillId');
            }

            await skillToolRoutingService.activateSkillForTask(taskId, skillId, selectedSkillIds);
            const activeSkillIds = skillToolRoutingService.getActiveSkillIds(taskId);
            const activationMsg = `Skill ${skillId} activated`;

            toolCalls.push({
              action: result.action,
              input: result.actionInput,
              result: activationMsg,
              round: currentReActRound,
              route: 'skill'
            });

            userPrompt += `\n\n观察结果：${activationMsg}。当前已激活技能: ${activeSkillIds.join(', ') || '无'}`;
            currentReActRound++;
            continue;
          }

          const toolResult = await this.executeTool(
            result.action,
            result.actionInput,
            taskId,
            selectedSkillIds,
            agentId
          );

          toolCalls.push({
            action: result.action,
            input: result.actionInput,
            result: toolResult,
            round: currentReActRound
          });

          userPrompt += `\n\n观察结果：${toolResult}`;

          await taskService.updateStep(stepId, {
            observationSummary: toolResult
          });
        }

        reasoningSummary = result.reasoning;
        currentReActRound++;
      }

      if (currentReActRound >= this.maxReActRounds) {
        finalOutput = '任务执行达到最大轮次限制';
      }

      await taskService.updateStep(stepId, {
        status: StepStatus.COMPLETED,
        completedAt: new Date(),
        duration: Date.now() - new Date().getTime(),
        reasoningSummary,
        actionSummary: finalOutput,
        observationSummary: toolCalls[toolCalls.length - 1]?.result || ''
      });

      return {
        success: true,
        finalOutput,
        reasoningSummary,
        toolCalls
      };
    } catch (error: any) {
      if (error instanceof PermissionPendingError) {
        const waitingMessage = `Permission requires confirmation (requestId=${error.requestId || 'unknown'}, target=${error.target || 'unknown'})`;
        await taskService.updateStep(stepId, {
          status: StepStatus.WAITING,
          observationSummary: waitingMessage
        });

        return {
          success: false,
          error: waitingMessage,
          toolCalls,
          reasoningSummary,
          failureCode: 'EXEC_PERMISSION_CONFIRMATION_REQUIRED',
          failureRound: currentReActRound,
          failedTool: lastAction || undefined,
          requiresConfirmation: true,
          permissionRequestId: error.requestId,
          pendingTarget: error.target
        };
      }

      const detailedMessage = `${error.message} (round=${currentReActRound}, tool=${lastAction || 'n/a'}, toolCalls=${toolCalls.length})`;
      await taskService.updateStep(stepId, {
        status: StepStatus.FAILED,
        completedAt: new Date(),
        errorMessage: detailedMessage
      });

      return {
        success: false,
        error: detailedMessage,
        toolCalls,
        reasoningSummary,
        failureCode: this.mapExecutionFailureCode(error?.message),
        failureRound: currentReActRound,
        failedTool: lastAction || undefined
      };
    }
  }

  private mapExecutionFailureCode(message?: string): string {
    const lower = (message || '').toLowerCase();
    if (lower.includes('permission denied')) return 'EXEC_PERMISSION_DENIED';
    if (lower.includes('requires confirmation')) return 'EXEC_PERMISSION_CONFIRMATION_REQUIRED';
    if (lower.includes('use_skill requires')) return 'EXEC_SKILL_ARGUMENT_INVALID';
    if (lower.includes('unexpected end of json') || lower.includes('json')) return 'EXEC_TOOL_ARGUMENT_INVALID';
    return 'EXEC_RUNTIME_ERROR';
  }

  private async getAgentPrompt(agentId: string, taskId: string): Promise<string> {
    try {
      const generated = await promptService.generatePrompt(agentId, {
        taskId,
        input: '',
        attachments: [],
        taskName: '执行任务',
        taskDescription: '根据用户需求执行相应操作'
      });
      return generated.messages[0]?.content || '';
    } catch {
      return '你是一个Domain Agent，负责执行任务。请遵循推理-行动-观察模式，并在完成后输出最终结果。';
    }
  }

  private buildUserPrompt(input: string, context: any): string {
    let prompt = `用户输入：${input}`;

    if (context.previousSteps?.length) {
      prompt += '\n\n已完成步骤：';
      for (const step of context.previousSteps) {
        prompt += `\n- ${step.name}: ${step.observationSummary || '已完成'}`;
      }
    }

    if (context.attachments?.length) {
      prompt += '\n\n附件信息：';
      for (const att of context.attachments) {
        prompt += `\n- ${att.fileName}: ${att.parseSummary || ''}`;
      }
    }

    prompt += '\n\n请按照推理-行动-观察的循环执行任务。如果任务完成，请调用finish工具。';

    return prompt;
  }

  private async executeReActRound(
    taskId: string,
    systemPrompt: string,
    userPrompt: string,
    context: any,
    selectedSkillIds: string[],
    round: number
  ): Promise<ReActStep> {
    const hasTools = context.previousSteps?.length === 0;

    const tools = hasTools
      ? await this.buildAvailableTools(taskId, selectedSkillIds)
      : undefined;

    const messages: any[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    try {
      const response = await llmAdapter.chat({
        messages,
        tools
      });

      if (response.toolCalls && response.toolCalls.length > 0) {
        const toolCall = response.toolCalls[0];
        return {
          reasoning: response.content || '',
          action: toolCall.function.name,
          actionInput: JSON.parse(toolCall.function.arguments),
          observation: ''
        };
      }

      return {
        reasoning: response.content || '',
        action: 'finish',
        actionInput: { result: response.content || '任务完成' },
        observation: response.content || ''
      };
    } catch (error: any) {
      return {
        reasoning: `执行错误: ${error.message}`,
        action: 'finish',
        actionInput: { result: `执行失败: ${error.message}` },
        observation: error.message
      };
    }
  }

  private async buildAvailableTools(taskId: string, selectedSkillIds: string[]) {
    if (selectedSkillIds.length === 0) {
      return [
        this.buildToolSchema('read_file'),
        this.buildToolSchema('write_file'),
        this.buildToolSchema('edit_file'),
        this.buildToolSchema('delete_file'),
        this.buildToolSchema('execute_command'),
        this.buildToolSchema('list_directory'),
        this.buildToolSchema('search_files'),
        this.buildToolSchema('finish'),
      ].filter((tool): tool is any => Boolean(tool));
    }

    const skillTools = skillToolRoutingService.getAvailableToolsForActiveSkills(taskId);
    const toolSchemas = skillTools
      .map((name) => this.buildToolSchema(name))
      .filter((tool): tool is any => Boolean(tool));

    return [
      {
        type: 'function' as const,
        function: {
          name: 'use_skill',
          description: '激活一个已绑定技能，使该技能下工具变为可调用',
          parameters: {
            type: 'object',
            properties: {
              skillId: {
                type: 'string',
                enum: selectedSkillIds,
                description: '待激活的技能ID'
              }
            },
            required: ['skillId']
          }
        }
      },
      ...toolSchemas,
      this.buildToolSchema('finish')
    ].filter((tool): tool is { type: 'function'; function: any } => Boolean(tool));
  }

  private buildToolSchema(name: string) {
    const definitions: Record<string, any> = {
      read_file: {
        name: 'read_file',
        description: '读取文件内容',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '文件路径' },
            startLine: { type: 'number', description: '起始行号(1-based)' },
            lineCount: { type: 'number', description: '读取窗口行数' },
            startOffset: { type: 'number', description: '起始字符偏移(>=0，与startLine互斥)' },
            length: { type: 'number', description: '按偏移读取长度' }
          },
          required: ['path']
        }
      },
      write_file: {
        name: 'write_file',
        description: '写入文件内容',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '文件路径' },
            content: { type: 'string', description: '文件内容' }
          },
          required: ['path', 'content']
        }
      },
      edit_file: {
        name: 'edit_file',
        description: '按位置区间编辑文件内容',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '文件路径' },
            startLine: { type: 'number', description: '起始行号(位置编辑模式, 1-based)' },
            startColumn: { type: 'number', description: '起始列号(位置编辑模式, 1-based)' },
            endLine: { type: 'number', description: '结束行号(位置编辑模式, 1-based)' },
            endColumn: { type: 'number', description: '结束列号(位置编辑模式, 1-based)' },
            newText: { type: 'string', description: '替换文本' }
          },
          required: ['path', 'startLine', 'startColumn', 'newText']
        }
      },
      list_directory: {
        name: 'list_directory',
        description: '列出目录内容',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '目录路径' }
          },
          required: ['path']
        }
      },
      search_files: {
        name: 'search_files',
        description: '搜索文件',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '搜索目录' },
            pattern: { type: 'string', description: '搜索模式' }
          },
          required: ['path', 'pattern']
        }
      },
      execute_command: {
        name: 'execute_command',
        description: '执行命令',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: '命令内容' },
            cwd: { type: 'string', description: '工作目录' }
          },
          required: ['command']
        }
      },
      create_directory: {
        name: 'create_directory',
        description: '创建目录',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '目录路径' }
          },
          required: ['path']
        }
      },
      delete_file: {
        name: 'delete_file',
        description: '删除文件',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '文件路径' }
          },
          required: ['path']
        }
      },
      get_file_info: {
        name: 'get_file_info',
        description: '获取文件信息',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: '文件路径' }
          },
          required: ['path']
        }
      },
      finish: {
        name: 'finish',
        description: '完成任务并返回结果',
        parameters: {
          type: 'object',
          properties: {
            result: { type: 'string', description: '任务完成结果' }
          },
          required: ['result']
        }
      }
    };

    const selected = definitions[name];
    if (!selected) {
      return null;
    }

    return {
      type: 'function' as const,
      function: selected
    };
  }

  private async executeTool(
    toolName: string,
    parameters: any,
    taskId: string,
    selectedSkillIds: string[],
    agentId: string
  ): Promise<string> {
    const requiresPermission = ['write_file', 'edit_file', 'delete_file', 'execute_command'].includes(toolName);

    const skillId = skillToolRoutingService.getSkillIdByToolName(taskId, toolName);

    if (requiresPermission) {
      const action = toolName === 'execute_command' ? PermissionAction.EXECUTE : PermissionAction.WRITE;

      const permissionResult = await permissionService.check({
        taskId,
        action,
        target: parameters.path || parameters.command,
        agentId,
        skillId: skillId || undefined,
        toolName
      });

      if (permissionResult.decision === 'deny') {
        throw new Error('Permission denied');
      }

      if (permissionResult.decision === 'ask') {
        throw new PermissionPendingError(
          'Permission requires confirmation',
          permissionResult.requestId,
          parameters.path || parameters.command
        );
      }
    }

    const result = await skillToolRoutingService.executeRoutedTool({
      taskId,
      toolName,
      parameters,
      selectedSkillIds
    });

    if (!result.success) {
      return `错误: ${result.error}`;
    }

    return result.output || '操作成功';
  }
}

export const agentExecutionService = new AgentExecutionService();
