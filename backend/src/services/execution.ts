import { taskService } from './task.js';
import { llmAdapter } from './llm.js';
import { promptService } from './prompt.js';
import { sandboxService } from './sandbox.js';
import { skillInvocationService } from './skill.js';
import { permissionService } from './permission.js';
import { TaskStatus, StepStatus, PermissionAction } from '../types/index.js';

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
  };
}

export interface AgentExecutionResult {
  success: boolean;
  finalOutput?: string;
  reasoningSummary?: string;
  toolCalls?: any[];
  error?: string;
}

export class AgentExecutionService {
  private maxReActRounds = 10;

  async execute(request: AgentExecutionRequest): Promise<AgentExecutionResult> {
    const { taskId, stepId, agentId, input, context } = request;

    await taskService.updateStep(stepId, {
      status: StepStatus.RUNNING,
      startedAt: new Date()
    });

    try {
      const systemPrompt = await this.getAgentPrompt(agentId, taskId);
      let userPrompt = this.buildUserPrompt(input, context);
      
      let currentReActRound = 0;
      let finalOutput = '';
      const toolCalls: any[] = [];
      let reasoningSummary = '';

      while (currentReActRound < this.maxReActRounds) {
        const result = await this.executeReActRound(
          systemPrompt,
          userPrompt,
          context,
          currentReActRound
        );

        if (result.action === 'finish') {
          finalOutput = result.observation || result.actionInput;
          reasoningSummary = result.reasoning;
          break;
        }

        if (result.action && result.actionInput) {
          const toolResult = await this.executeTool(
            result.action,
            result.actionInput,
            taskId
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
      await taskService.updateStep(stepId, {
        status: StepStatus.FAILED,
        completedAt: new Date(),
        errorMessage: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  private async getAgentPrompt(agentId: string, taskId: string): Promise<string> {
    return promptService.generatePrompt('domain-system', {
      taskId,
      input: '',
      attachments: []
    }, {
      taskName: '执行任务',
      taskDescription: '根据用户需求执行相应操作'
    }).messages[0]?.content || '';
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
    systemPrompt: string,
    userPrompt: string,
    context: any,
    round: number
  ): Promise<ReActStep> {
    const hasTools = context.previousSteps?.length === 0;
    
    const tools = hasTools ? [
      {
        type: 'function' as const,
        function: {
          name: 'read_file',
          description: '读取文件内容',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '文件路径' }
            },
            required: ['path']
          }
        }
      },
      {
        type: 'function' as const,
        function: {
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
        }
      },
      {
        type: 'function' as const,
        function: {
          name: 'list_directory',
          description: '列出目录内容',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '目录路径' }
            },
            required: ['path']
          }
        }
      },
      {
        type: 'function' as const,
        function: {
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
        }
      },
      {
        type: 'function' as const,
        function: {
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
      }
    ] : undefined;

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

  private async executeTool(
    toolName: string,
    parameters: any,
    taskId: string
  ): Promise<string> {
    const requiresPermission = ['write_file', 'execute_command'].includes(toolName);
    
    if (requiresPermission) {
      const action = toolName === 'write_file' ? PermissionAction.WRITE : PermissionAction.EXECUTE;
      
      const permissionResult = await permissionService.check({
        taskId,
        action,
        target: parameters.path || parameters.command
      });

      if (permissionResult.decision === 'deny') {
        throw new Error('Permission denied');
      }

      if (permissionResult.decision === 'ask') {
        throw new Error('Permission requires confirmation');
      }
    }

    const result = await sandboxService.execute({
      toolName,
      parameters
    });

    if (!result.success) {
      return `错误: ${result.error}`;
    }

    return result.output || '操作成功';
  }
}

export const agentExecutionService = new AgentExecutionService();
