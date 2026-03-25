import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { db, schema } from '../db';
import { eq, and } from 'drizzle-orm';
import type { DomainAgentProfile, IntentResult, DAGNode, PermissionResult } from '../types';
import type { ModelConfig as DbModelConfig } from '../db';
import type { Task } from '../db';
import { agentCapabilityRegistry } from './agentCapabilityRegistry';
import { knowledgeEngine } from './knowledgeEngine';
import { memoryEngine } from './memoryEngine';
import { toolHub } from './toolHub';
import { securitySandbox } from './securitySandbox';
import { taskOrchestrator } from './taskOrchestrator';
import { modelHub } from './modelHub';
import { eventBus } from './eventBus.js';
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

export interface AgentConfig {
  id: string;
  name: string;
  type: 'LEADER' | 'DOMAIN';
  modelConfig: DbModelConfig;
  promptTemplateId?: string;
  skills: string[];
  tools: string[];
}

export class AgentRuntime extends EventEmitter {
  private maxReActSteps: number = 15;
  private runningTasks: Map<string, { abortController: AbortController; isRunning: boolean }> = new Map();

  async executeTask(task: Task, agentConfig: AgentConfig): Promise<void> {
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
      const steps = await this.runReActLoop(task, agentConfig, context);

      await taskOrchestrator.updateTaskStatus(task.id, 'COMPLETED');
      
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
    const inputPayload = task.inputPayload ? JSON.parse(task.inputPayload) : {};
    const userInput = typeof inputPayload === 'string' ? inputPayload : inputPayload.content || inputPayload.description || '';

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
    const basePrompt = `You are ${agentConfig.name}, a specialized AI agent.`;

    const toolsPrompt = agentConfig.tools.length > 0
      ? `\n\nAvailable tools:\n${agentConfig.tools.map(t => `- ${t}`).join('\n')}`
      : '';

    const skillsPrompt = agentConfig.skills.length > 0
      ? `\n\nSkills: ${agentConfig.skills.join(', ')}`
      : '';

    return basePrompt + toolsPrompt + skillsPrompt;
  }

  private async runReActLoop(
    task: Task,
    agentConfig: AgentConfig,
    context: AgentExecutionContext
  ): Promise<ReActStep[]> {
    const steps: ReActStep[] = [];
    let stepIndex = 0;

    const payload = task.inputPayload ? JSON.parse(task.inputPayload) : {};
    let currentContext = `${context.systemPrompt}\n\nUser request: ${payload.content || payload}\n`;

    if (context.knowledgeContext) {
      currentContext += `\n\nRelevant knowledge:\n${context.knowledgeContext}\n`;
    }

    if (context.memoryContext) {
      currentContext += `\n\nUser preferences and context:\n${context.memoryContext}\n`;
    }

    while (stepIndex < this.maxReActSteps) {
      const thought = await this.callModel(currentContext, agentConfig.modelConfig);
      
      const thoughtStep: ReActStep = {
        stepIndex: stepIndex++,
        stepType: 'THOUGHT',
        content: thought,
      };
      steps.push(thoughtStep);
      await this.logStep(task.id, thoughtStep);

      const action = this.parseAction(thought);
      
      if (!action) {
        break;
      }

      const actionStep: ReActStep = {
        stepIndex: stepIndex++,
        stepType: 'ACTION',
        content: `Executing: ${action.name}`,
        toolName: action.name,
        toolArgs: action.args,
      };
      steps.push(actionStep);
      await this.logStep(task.id, actionStep);

      const observation = await this.executeTool(agentConfig.id, action.name, action.args);
      
      const observationStep: ReActStep = {
        stepIndex: stepIndex++,
        stepType: 'OBSERVATION',
        content: observation,
      };
      steps.push(observationStep);
      await this.logStep(task.id, observationStep);

      currentContext += `\n\nThought: ${thought}\nAction: ${action.name}(${JSON.stringify(action.args)})\nObservation: ${observation}\n`;

      await taskOrchestrator.updateTaskHeartbeat(task.id);

      if (this.isTaskComplete(observation)) {
        break;
      }
    }

    return steps;
  }

  private async callModel(prompt: string, modelConfig: DbModelConfig): Promise<string> {
    try {
      if (!modelConfig || !modelConfig.modelName) {
        return 'Model not configured. Please configure a model first.';
      }

      const client = new OpenAI({
        apiKey: modelConfig.apiKey || '',
        baseURL: modelConfig.baseUrl || undefined,
        timeout: 60000,
      });

      const response = await client.chat.completions.create({
        model: modelConfig.modelName,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
      });

      return response.choices[0]?.message?.content || '';
    } catch (error) {
      console.error('Model call failed:', error);
      return `Error calling model: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private parseAction(thought: string): { name: string; args: Record<string, unknown> } | null {
    const actionMatch = thought.match(/Action:\s*(\w+)\(([^)]+)\)/i);
    
    if (!actionMatch) {
      const finalMatch = thought.match(/Final Answer:?\s*(.+)/i);
      if (finalMatch) {
        return null;
      }
      return { name: 'finish', args: { result: thought } };
    }

    const toolName = actionMatch[1].toLowerCase();
    const argsStr = actionMatch[2];

    try {
      const args = argsStr ? JSON.parse(`{${argsStr}}`) : {};
      return { name: toolName, args };
    } catch {
      return { name: toolName, args: { input: argsStr } };
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