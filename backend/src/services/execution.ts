import OpenAI from 'openai';
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
      const generatedPrompt = await this.getAgentPrompt(agentId, taskId, input, context);
      const baseMessages = generatedPrompt.messages;

      const selectedSkillIds = Array.isArray(context.selectedSkillIds)
        ? context.selectedSkillIds.filter((value): value is string => typeof value === 'string' && value.length > 0)
        : [];

      let consecutiveReadCount = 0;
      const maxConsecutiveReads = 3;

      while (currentReActRound < this.maxReActRounds) {
        const result = await this.executeReActRoundWithHistory(
          taskId,
          baseMessages,
          context,
          selectedSkillIds,
          currentReActRound
        );

        console.log(`[Execution] Round ${currentReActRound}: action=${result.action}, reasoning=${result.reasoning?.slice(0, 100)}`);

        if (result.action === 'finish') {
          let finishResult = result.observation || result.reasoning || '';
          if (!finishResult && result.actionInput) {
            finishResult = typeof result.actionInput === 'string' 
              ? result.actionInput 
              : result.actionInput?.result || result.actionInput?.text || JSON.stringify(result.actionInput);
          }
          if (!finishResult) {
            finishResult = '任务已完成';
          }
          finalOutput = finishResult;
          reasoningSummary = result.reasoning;
          console.log(`[Execution] Finish: "${finalOutput?.slice(0, 100)}"`);
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

            baseMessages.push(
              { role: 'assistant' as const, content: result.reasoning + `\n\n[Tool: ${result.action}(${JSON.stringify(result.actionInput)})]` },
              { role: 'user' as const, content: `\n\n观察结果：${activationMsg}。当前已激活技能: ${activeSkillIds.join(', ') || '无'}` }
            );
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

          console.log(`[Execution] Tool ${result.action} result length: ${toolResult.length}, preview: ${toolResult.slice(0, 200)}`);

          toolCalls.push({
            action: result.action,
            input: result.actionInput,
            result: toolResult,
            round: currentReActRound
          });

          const maxObservationLength = 3000;
          let truncatedResult = toolResult;
          if (toolResult.length > maxObservationLength) {
            truncatedResult = toolResult.substring(0, maxObservationLength) + `\n\n[文件内容过长，已截断，剩余 ${toolResult.length - maxObservationLength} 字符未显示]`;
          }

          baseMessages.push(
            { role: 'assistant' as const, content: result.reasoning + `\n\n[Tool: ${result.action}(${JSON.stringify(result.actionInput)})]` },
            { role: 'user' as const, content: `\n\n观察结果：${truncatedResult}` }
          );

          if (result.action === 'read_file') {
            consecutiveReadCount++;
            if (consecutiveReadCount >= maxConsecutiveReads) {
              console.log(`[Execution] Forcing analysis after ${consecutiveReadCount} consecutive reads`);
              
              const analysisResult = await this.analyzeCollectedContent(baseMessages);
              if (analysisResult) {
                finalOutput = analysisResult;
                break;
              }
            }
          } else {
            consecutiveReadCount = 0;
          }

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

  private async getAgentPrompt(
    agentId: string,
    taskId: string,
    input: string,
    context: any
  ): Promise<{ messages: Array<{ role: string; content: string }>; requiresTruncation: boolean }> {
    const normalizedContext = {
      taskId,
      input,
      attachments: (context.attachments || []).map((att: any) => ({
        fileName: att.fileName || att.name || 'unknown',
        parseSummary: att.parseSummary || ''
      })),
      memory: context.memory || [],
      knowledge: context.knowledge || [],
      previousSteps: context.previousSteps || [],
      agentHistory: [],
      taskName: '执行任务',
      taskDescription: input || '根据用户需求执行相应操作'
    };

    const generated = await promptService.generatePrompt(agentId, normalizedContext);
    return {
      messages: generated.messages,
      requiresTruncation: generated.requiresTruncation
    };
  }

  private async executeReActRoundWithHistory(
    taskId: string,
    baseMessages: Array<{ role: string; content: string }>,
    context: any,
    selectedSkillIds: string[],
    round: number
  ): Promise<ReActStep> {
    const tools = await this.buildAvailableTools(taskId, selectedSkillIds);

    const reactInstruction = `你是一个任务执行助手。请严格按照以下规则执行：

**核心任务**：读取并分析用户上传的文件，然后给出总结或回答。

**执行规则**：
1. 读取文件（使用 read_file 工具）
2. 分析文件内容
3. 调用 finish 工具返回分析结果

**重要**：
- 读取文件后必须分析内容并 finish，不要无限循环读取文件
- 最多读取 2-3 次文件，如果文件太长，使用 startLine/lineCount 分批读取
- 如果已经获取到文件的主要内容，应立即分析并 finish`;

    const messages: OpenAI.ChatCompletionMessageParam[] = [];

    messages.push({ role: 'system', content: reactInstruction });

    for (const m of baseMessages) {
      if (m.role === 'system') {
        messages.push({ role: 'system', content: m.content });
      } else if (m.role === 'user') {
        messages.push({ role: 'user', content: m.content });
      } else if (m.role === 'assistant') {
        messages.push({ role: 'assistant', content: m.content });
      }
    }

    if (round > 0) {
      const readCount = round;
      const prompt = readCount === 1
        ? `你已读取到文件内容（上面显示）。请分析这些内容，直接调用 finish 工具返回你的分析总结。不要再调用 read_file。`
        : `你已读取了更多文件内容（上面显示）。请综合所有内容，调用 finish 工具返回完整分析。文件内容已经足够，不需要继续读取。`;
      messages.push({ role: 'user', content: prompt });
    }

    try {
      const response = await llmAdapter.chat({
        messages,
        tools
      });

      console.log(`[ReAct] Round ${round}: LLM response content length=${(response.content || '').length}, content preview: "${(response.content || '').slice(0, 100)}", toolCalls=${response.toolCalls?.length || 0}`);
      if (response.toolCalls && response.toolCalls.length > 0) {
        const toolCall = response.toolCalls[0];
        console.log(`[ReAct] Round ${round}: toolCall=${toolCall.function.name}, args="${toolCall.function.arguments?.slice(0, 100)}"`);
        let actionInput;
        try {
          actionInput = JSON.parse(toolCall.function.arguments || '{}');
        } catch (e) {
          console.log(`[ReAct] Round ${round}: Failed to parse tool args: "${toolCall.function.arguments}"`);
          if (toolCall.function.name === 'finish') {
            return {
              reasoning: response.content || '',
              action: 'finish',
              actionInput: { result: response.content || '任务完成' },
              observation: response.content || ''
            };
          }
          return {
            reasoning: response.content || '',
            action: 'finish',
            actionInput: { result: `工具参数解析失败: ${toolCall.function.arguments}` },
            observation: `参数解析错误: ${e}`
          };
        }
        return {
          reasoning: response.content || '',
          action: toolCall.function.name,
          actionInput,
          observation: ''
        };
      }

      const content = response.content || '';
      
      const toolCallMatch = content.match(/\[Tool:\s*(\w+)\s*\(\s*(\{[^}]+\})\s*\)\]/);
      if (toolCallMatch) {
        const toolName = toolCallMatch[1];
        const toolArgs = toolCallMatch[2];
        try {
          const parsedArgs = JSON.parse(toolArgs);
          console.log(`[ReAct] Round ${round}: Detected tool call in text: ${toolName}`);
          return {
            reasoning: content.replace(/\[Tool:\s*\w+\s*\([^)]+\)\]/g, '').trim() || '从文本中检测到工具调用',
            action: toolName,
            actionInput: parsedArgs,
            observation: ''
          };
        } catch (e) {
          console.log(`[ReAct] Round ${round}: Failed to parse tool args from text: ${e}`);
        }
      }

      if (content.includes('finish') && content.length < 200) {
        return {
          reasoning: content,
          action: 'finish',
          actionInput: { result: content },
          observation: content
        };
      }

      return {
        reasoning: content,
        action: 'finish',
        actionInput: { result: content || '任务完成' },
        observation: content
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
    if (toolName === 'finish') {
      return parameters.result || '任务完成';
    }

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

  private async analyzeCollectedContent(baseMessages: Array<{ role: string; content: string }>): Promise<string | null> {
    const observations: string[] = [];
    
    for (const msg of baseMessages) {
      if (msg.role === 'user' && msg.content.includes('观察结果')) {
        const match = msg.content.match(/观察结果[：:]\s*([\s\S]+?)(?=\n\n\[|$)/);
        if (match) {
          observations.push(match[1]);
        }
      }
    }

    if (observations.length === 0) {
      return null;
    }

    const combinedContent = observations.join('\n\n');
    const analysisPrompt = `你已经读取了文件的多个部分，以下是已获取的内容：

${combinedContent.slice(0, 8000)}

请根据以上内容，给出完整的总结和分析。直接输出你的分析结果，不要再调用任何工具。`;

    try {
      const response = await llmAdapter.chat({
        messages: [{ role: 'user', content: analysisPrompt }],
        tools: []
      });
      
      return response.content || '已读取文件内容但未能生成分析';
    } catch (error: any) {
      console.error('[Execution] Analysis failed:', error);
      return combinedContent.slice(0, 500) + '\n\n[内容已截断]';
    }
  }
}

export const agentExecutionService = new AgentExecutionService();
