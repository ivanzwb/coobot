import { EventEmitter } from 'events';
import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import type { ModelConfig as DbModelConfig } from '../db';
import type { Task } from '../db';
import { knowledgeEngine } from './knowledgeEngine';
import { memoryEngine } from './memoryEngine';
import { toolHub } from './toolHub';
import { taskOrchestrator } from './taskOrchestrator';
import { eventBus } from './eventBus.js';
import { logger } from './logger.js';
import OpenAI from 'openai';

export interface ReActStep {
  stepIndex: number;
  stepType: 'THOUGHT' | 'ACTION' | 'OBSERVATION';
  content: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
}

export interface AgentExecutionContext {
  task: Task;
  agentConfig: AgentConfig;
  systemPrompt: string;
  history: { role: string; content: string }[];
  knowledgeContext: string;
  memoryContext: string;
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tools: { name: string; description: string }[];
}

export interface AgentConfig {
  id: string;
  name: string;
  type: 'LEADER' | 'DOMAIN';
  modelConfig: DbModelConfig;
  temperature?: number;
  rolePrompt?: string;
  behaviorRules?: string;
  capabilityBoundary?: string;
  skills: AgentSkill[];
  tools: string[];
}

export class AgentRuntime extends EventEmitter {
  private maxReActSteps: number = 15;
  private runningTasks: Map<string, { abortController: AbortController; isRunning: boolean }> = new Map();

  async executeTask(task: Task, agentConfig: AgentConfig): Promise<void> {
    logger.info('AgentRuntime', 'Starting task execution', { taskId: task.id, agentId: agentConfig.id, agentName: agentConfig.name });

    const abortController = new AbortController();
    this.runningTasks.set(task.id, { abortController, isRunning: true });

    try {
      await taskOrchestrator.updateTaskStatus(task.id, 'RUNNING');

      await db.insert(schema.taskLogs).values({
        taskId: task.id,
        stepIndex: 0,
        stepType: 'THOUGHT',
        content: `Starting task execution for agent: ${agentConfig.name}`,
        timestamp: new Date(),
      });

      const context = await this.buildContext(task, agentConfig);
      logger.debug('AgentRuntime', 'Context built', { taskId: task.id, contextLength: context.systemPrompt.length });

      const steps = await this.runReActLoop(task, agentConfig, context);
      logger.debug('AgentRuntime', 'ReAct loop completed', { taskId: task.id, stepsCount: steps.length });

      const finalOutput = steps[steps.length - 1]?.content || '';
      await memoryEngine.appendMessage('assistant', finalOutput, [], task.id);
      logger.info('AgentRuntime', 'Task completed, response saved to memory', { taskId: task.id, outputLength: finalOutput.length });

      await taskOrchestrator.updateTaskStatus(task.id, 'COMPLETED', undefined, finalOutput);

      this.emit('task_completed', { taskId: task.id, steps });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      await db.insert(schema.taskLogs).values({
        taskId: task.id,
        stepIndex: 0,
        stepType: 'OBSERVATION',
        content: `Error: ${errorMessage}`,
        timestamp: new Date(),
      });

      await taskOrchestrator.updateTaskStatus(task.id, 'EXCEPTION', errorMessage);
      this.emit('task_failed', { taskId: task.id, error: errorMessage });
    } finally {
      this.runningTasks.delete(task.id);
    }
  }

  private async buildContext(task: Task, agentConfig: AgentConfig): Promise<AgentExecutionContext> {
    let inputPayload: any = {};
    try {
      inputPayload = task.inputPayload ? JSON.parse(task.inputPayload) : {};
    } catch {
      inputPayload = { content: task.inputPayload };
    }
    const userInput = inputPayload.content || inputPayload.description || '';

    logger.debug('AgentRuntime', 'Building context', { taskId: task.id, userInputLength: userInput.length });

    const history = await memoryEngine.getActiveHistory(10);
    const historyMessages = history.map(h => ({
      role: h.role || 'user',
      content: h.content,
    }));

    const knowledgeResults = await knowledgeEngine.search(userInput, agentConfig.id, 3);
    const knowledgeContext = knowledgeResults
      .map(r => `[${r.source}]: ${r.content}`)
      .join('\n\n');

    const memoryResults = await memoryEngine.searchLtm({
      query: userInput,
      agentId: agentConfig.id,
      topK: 3,
    });
    const memoryContext = memoryResults
      .map(r => `[${r.type}]: ${r.content}`)
      .join('\n\n');

    const systemPrompt = await this.buildSystemPrompt(agentConfig);

    return {
      task,
      agentConfig,
      systemPrompt,
      history: historyMessages,
      knowledgeContext,
      memoryContext,
    };
  }

  private async buildSystemPrompt(agentConfig: AgentConfig): Promise<string> {
    const parts: string[] = [];

    if (agentConfig.rolePrompt) {
      parts.push(agentConfig.rolePrompt);
    } else {
      parts.push(`You are a professional AI assistant.`);
    }

    if (agentConfig.behaviorRules) {
      parts.push(`\nBehavior Guidelines:\n${agentConfig.behaviorRules}`);
    }
    parts.push(`\nAlways respond in the same language as the user's input.`);

    if (agentConfig.capabilityBoundary) {
      parts.push(`\nCapability Boundaries:\n${agentConfig.capabilityBoundary}`);
    }

    logger.info('AgentRuntime', 'Building system prompt', {
      agentId: agentConfig.id,
      tools: agentConfig.tools,
      skills: agentConfig.skills.map(s => s.name)
    })

    const skillsText = agentConfig.skills.length > 0
      ? `\nAvailable Skills (lazy load - use skill name to load when needed):\n${agentConfig.skills.map(s => `- ${s.name}: ${s.description}`).join('\n')}`
      : '';

    let basePrompt = parts.join('\n\n');

    if (basePrompt.includes('${skills}')) {
      basePrompt = basePrompt.replace('${skills}', skillsText);
    } else if (skillsText) {
      basePrompt += skillsText;
    }

    return basePrompt;
  }

  private async runReActLoop(
    task: Task,
    agentConfig: AgentConfig,
    context: AgentExecutionContext
  ): Promise<ReActStep[]> {
    const steps: ReActStep[] = [];
    let stepIndex = 0;

    let payload: any = {};
    try {
      payload = task.inputPayload ? JSON.parse(task.inputPayload) : {};
    } catch {
      payload = { content: task.inputPayload };
    }
    const userRequest = payload.content || payload.description || '';

    const messages: { role: string; content: string; name?: string }[] = [];

    messages.push({ role: 'system', content: context.systemPrompt });
    messages.push({ role: 'user', content: `User request: ${userRequest}` });

    if (context.knowledgeContext) {
      messages.push({ role: 'system', content: `Relevant knowledge:\n${context.knowledgeContext}` });
    }

    if (context.memoryContext) {
      messages.push({ role: 'system', content: `User preferences and context:\n${context.memoryContext}` });
    }

    const loadedSkills: Set<string> = new Set();
    const loadedToolNames: string[] = [];

    while (stepIndex < this.maxReActSteps) {
      logger.debug('AgentRuntime', 'ReAct step', { taskId: task.id, stepIndex, type: 'THOUGHT', tools: loadedToolNames });

      const response = await this.callModelWithMessages(
        messages,
        agentConfig.modelConfig,
        agentConfig.temperature,
        loadedToolNames
      );

      const thought = response.content;

      const thoughtStep: ReActStep = {
        stepIndex: stepIndex++,
        stepType: 'THOUGHT',
        content: thought,
      };
      steps.push(thoughtStep);
      await this.logStep(task.id, thoughtStep);

      if (response.toolCall) {
        logger.info('AgentRuntime', 'Executing tool call', { taskId: task.id, toolName: response.toolCall.name, args: JSON.stringify(response.toolCall.args) });
        
        const action = response.toolCall.name;
        const actionInput = response.toolCall.args;

        const toolResult = await this.executeTool(agentConfig.id, action, actionInput);
        logger.info('AgentRuntime', 'Tool executed', { taskId: task.id, toolName: action, result: toolResult.slice(0, 200) });

        messages.push({ role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: action, arguments: JSON.stringify(actionInput) } }] } as any);
        messages.push({ role: 'tool', tool_call_id: 'call_1', content: toolResult } as any);
        continue;
      }

      const parsed = this.parseReAct(thought);
      if (!parsed) {
        logger.debug('AgentRuntime', 'ReAct completed (no action)', { taskId: task.id, totalSteps: stepIndex });
        break;
      }

      const { action, actionInput } = parsed;

      if (action === 'FINISH' || action === 'final_answer') {
        logger.debug('AgentRuntime', 'Task completed', { taskId: task.id, finalAnswer: actionInput });
        break;
      }

      const needsReload = this.checkSkillReload(agentConfig.skills, action, loadedSkills);
      if (needsReload) {
        const skillDef = this.buildSkillDefinition(needsReload);
        messages.push({ role: 'system', content: `【Skill Definition】: ${skillDef}` });
        loadedSkills.add(needsReload.id);

        const skillToolNames = needsReload.tools.map(t => `skill:${needsReload.name}:${t.name}`);
        loadedToolNames.push(...skillToolNames);

        logger.info('AgentRuntime', 'Skill lazy loaded', {
          taskId: task.id,
          skillName: needsReload.name,
          tools: skillToolNames.join(', ')
        });

        continue;
      }

      const actionStep: ReActStep = {
        stepIndex: stepIndex++,
        stepType: 'ACTION',
        content: `Executing: ${action}(${JSON.stringify(actionInput)})`,
        toolName: action,
        toolArgs: actionInput,
      };
      steps.push(actionStep);
      await this.logStep(task.id, actionStep);

      logger.debug('AgentRuntime', 'ReAct step', { taskId: task.id, stepIndex, type: 'ACTION', toolName: action });

      const observation = await this.executeTool(agentConfig.id, action, actionInput);

      const observationStep: ReActStep = {
        stepIndex: stepIndex++,
        stepType: 'OBSERVATION',
        content: observation,
      };
      steps.push(observationStep);
      await this.logStep(task.id, observationStep);

      messages.push({ role: 'assistant', content: thought });
      messages.push({ role: 'tool', name: action, content: observation });

      await taskOrchestrator.updateTaskHeartbeat(task.id);

      if (this.isTaskComplete(observation)) {
        break;
      }
    }

    return steps;
  }

  private parseReAct(response: string): { action: string; actionInput: Record<string, unknown> } | null {
    const finalMatch = response.match(/(?:FINISH|Final Answer)[:\s]*(.+)/is);
    if (finalMatch) {
      return { action: 'FINISH', actionInput: { result: finalMatch[1].trim() } };
    }

    const actionMatch = response.match(/Action:\s*(\w+)\s*\(([^)]*)\)/is);
    if (!actionMatch) {
      return null;
    }

    const action = actionMatch[1].trim();
    const argsStr = actionMatch[2].trim();

    let actionInput: Record<string, unknown> = {};
    if (argsStr) {
      try {
        actionInput = JSON.parse(`{${argsStr}}`);
      } catch {
        actionInput = { input: argsStr };
      }
    }

    return { action, actionInput };
  }

  private checkSkillReload(
    skills: AgentSkill[],
    action: string,
    loadedSkills: Set<string>
  ): AgentSkill | null {
    const skillToolMatch = action.match(/^skill:([^:]+):(.+)$/);
    if (skillToolMatch) {
      const skillName = skillToolMatch[1];
      return skills.find(s => s.name === skillName && !loadedSkills.has(s.name)) || null;
    }
    return null;
  }

  private buildSkillDefinition(skill: AgentSkill): string {
    const toolDefs = skill.tools.map(t => `- ${t.name}: ${t.description}`).join('\n');
    return `Skill: ${skill.name}\nDescription: ${skill.description}\nTools:\n${toolDefs}`;
  }

  private async callModelWithMessages(
    messages: { role: string; content: string; name?: string }[],
    modelConfig: DbModelConfig,
    temperature?: number,
    toolNames: string[] = []
  ): Promise<{ content: string; toolCall?: { name: string; args: Record<string, unknown> } }> {
    try {
      if (!modelConfig || !modelConfig.modelName) {
        return { content: 'Model not configured. Please configure a model first.' };
      }

      const client = new OpenAI({
        apiKey: modelConfig.apiKey || '',
        baseURL: modelConfig.baseUrl || undefined,
        timeout: 60000,
      });

      logger.debug('AgentRuntime', 'LLM input', { model: modelConfig.modelName, messages: messages.map(m => JSON.stringify(m)).join(',\n') });

      const effectiveTemperature = temperature ?? modelConfig.temperature;

      const allTools = toolHub.listTools();
      for (const toolName of allTools) {
        logger.info('AgentRuntime', 'toolName', { toolName: toolName.name });
      }

      const toolsParam = allTools.length > 0 ? allTools.map(t => t.jsonSchema as any) : undefined;
      logger.debug('AgentRuntime', 'LLM tools', { 
        model: modelConfig.modelName, 
        toolsCount: allTools.length,
        toolsParam: toolsParam ? JSON.stringify(toolsParam) : 'undefined',
      });

      const chatOptions: any = {
        model: modelConfig.modelName,
        messages: messages as any,
        temperature: effectiveTemperature,
      };
      
      if (toolsParam) {
        chatOptions.tools = toolsParam;
        chatOptions.tool_choice = 'auto';
      }
      
      const response = await client.chat.completions.create(chatOptions);

      const message = response.choices[0]?.message;
      const finishReason = response.choices[0]?.finish_reason;
      logger.debug('AgentRuntime', 'response info', { model: modelConfig.modelName, finishReason, hasToolCalls: !!message?.tool_calls });
      
      let output = message?.content || '';
      const hasToolCalls = message?.tool_calls && message.tool_calls.length > 0;
      logger.debug('AgentRuntime', 'LLM output', { model: modelConfig.modelName, output, hasToolCalls, toolCallCount: message?.tool_calls?.length || 0 });

      if (!output && !hasToolCalls && toolsParam) {
        logger.info('AgentRuntime', 'empty response with tools, retrying without tools', { model: modelConfig.modelName });
        const retryResponse = await client.chat.completions.create({
          model: modelConfig.modelName,
          messages: messages as any,
          temperature: effectiveTemperature,
        });
        const retryMessage = retryResponse.choices[0]?.message;
        output = retryMessage?.content || '';
        logger.info('AgentRuntime', 'retry response', { model: modelConfig.modelName, output: output.slice(0, 200) });
      }

      if (message?.tool_calls && message.tool_calls.length > 0) {
        const toolCall = message.tool_calls[0] as any;
        return {
          content: output,
          toolCall: {
            name: toolCall.function.name,
            args: JSON.parse(toolCall.function.arguments || '{}'),
          },
        };
      }

      return { content: output };
    } catch (error) {
      console.error('Model call failed:', error);
      return { content: `Error calling model: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async executeTool(agentId: string, toolName: string, args: Record<string, unknown>): Promise<string> {
    if (toolName === 'finish') {
      return args.result as string || 'Task completed';
    }

    try {
      const result = await toolHub.execute(agentId, toolName, args);

      if (result.success) {
        return result.output || 'Tool executed successfully';
      } else {
        return `Error: ${result.error}`;
      }
    } catch (error) {
      return `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private isTaskComplete(observation: string): boolean {
    const completeIndicators = ['task completed', 'finished', 'done', 'final answer', 'completed successfully'];
    const lowerObs = observation.toLowerCase();
    return completeIndicators.some(ind => lowerObs.includes(ind));
  }

  private async logStep(taskId: string, step: ReActStep): Promise<void> {
    await db.insert(schema.taskLogs).values({
      taskId,
      stepIndex: step.stepIndex,
      stepType: step.stepType,
      content: step.content,
      toolName: step.toolName || null,
      toolArgsJson: step.toolArgs ? JSON.stringify(step.toolArgs) : null,
      timestamp: new Date(),
    });

    eventBus.broadcast({
      type: 'step_logged',
      data: {
        taskId,
        stepIndex: step.stepIndex,
        stepType: step.stepType,
        content: step.content,
        toolName: step.toolName,
        timestamp: new Date(),
      },
    });

    this.emit('step_logged', { taskId, step });
  }

  async abortTask(taskId: string): Promise<void> {
    const running = this.runningTasks.get(taskId);
    if (running) {
      running.abortController.abort();
      running.isRunning = false;
      await taskOrchestrator.updateTaskStatus(taskId, 'TERMINATED', 'Task aborted by user');
    }
  }

  async getTaskLogs(taskId: string): Promise<ReActStep[]> {
    const logs = await db.select()
      .from(schema.taskLogs)
      .where(eq(schema.taskLogs.taskId, taskId))
      .orderBy(schema.taskLogs.stepIndex);

    return logs.map(log => ({
      stepIndex: log.stepIndex,
      stepType: log.stepType as 'THOUGHT' | 'ACTION' | 'OBSERVATION',
      content: log.content,
      toolName: log.toolName || undefined,
      toolArgs: log.toolArgsJson ? JSON.parse(log.toolArgsJson) : undefined,
    }));
  }
}

export const agentRuntime = new AgentRuntime();