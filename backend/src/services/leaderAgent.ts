import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import type { DomainAgentProfile, DAGNode, ValidationReport, UnassignableIssue } from '../types';
import type { Task } from '../db';
import { agentCapabilityRegistry } from './agentCapabilityRegistry';
import { taskOrchestrator } from './taskOrchestrator';
import { memoryEngine } from './memoryEngine';
import { eventBus } from './eventBus.js';
import { logger } from './logger.js';
import { modelHub } from './modelHub.js';
import OpenAI from 'openai';
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions/completions.js';

const PROMPTS_DIR = path.join(process.cwd(), 'src/config/prompts');
const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

function loadPromptTemplate(filename: string, variables: Record<string, string>): string {
  const filePath = path.join(PROMPTS_DIR, filename);
  try {
    if (fs.existsSync(filePath)) {
      let template = fs.readFileSync(filePath, 'utf-8');
      for (const [key, value] of Object.entries(variables)) {
        template = template.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value);
      }
      return template;
    }
  } catch (error) {
    console.warn(`Failed to load prompt template ${filename}:`, error);
  }
  return '';
}

const taskAnalysisPrompt = (variables: Record<string, string>) =>
  loadPromptTemplate('task-analysis.md', variables);

export class LeaderAgent extends EventEmitter {
  private leaderAgentId: string = 'LEADER';

  async processTask(task: Task): Promise<void> {
    logger.info('LeaderAgent', 'Processing task', { taskId: task.id });

    try {
      await taskOrchestrator.updateTaskStatus(task.id, 'PARSING');

      const inputPayload = task.inputPayload ? JSON.parse(task.inputPayload) : {};
      const baseContent =
        typeof inputPayload === 'string' ? inputPayload : inputPayload.content || '';
      const clarificationReply =
        typeof inputPayload === 'object' && inputPayload
          ? (inputPayload as Record<string, unknown>).clarificationReply ??
            (inputPayload as Record<string, unknown>).clarification
          : '';
      const userInput = clarificationReply
        ? `${baseContent}\n\n【用户补充】\n${String(clarificationReply)}`
        : baseContent;

      const availableAgents = await agentCapabilityRegistry.getActiveAgents();

      const taskAnalysis = await this.analyzeTask(userInput, availableAgents);
      logger.debug('LeaderAgent', 'Task analyzed', {
        taskId: task.id,
        intent: taskAnalysis.intentType,
        confidence: taskAnalysis.confidenceScore,
        subtaskCount: taskAnalysis.subtasks.length
      });

      if (taskAnalysis.confidenceScore < DEFAULT_CONFIDENCE_THRESHOLD || taskAnalysis.subtasks.length === 0) {
        const questions = taskAnalysis.clarificationQuestions || ['请提供更多信息以便我更好地理解您的需求'];
        await taskOrchestrator.mergeInputPayloadFields(task.id, { clarificationQuestions: questions });
        const systemText =
          '需要您补充以下信息后再继续处理（可直接在下方输入框回复）：\n\n' +
          questions.map((q, i) => `${i + 1}. ${q}`).join('\n');
        await memoryEngine.appendMessage('system', systemText, [], task.id);
        await taskOrchestrator.updateTaskStatus(task.id, 'CLARIFICATION_PENDING');
        this.emit('clarification_needed', {
          taskId: task.id,
          questions,
          reason: `confidenceScore (${taskAnalysis.confidenceScore}) below threshold`,
        });
        eventBus.emitClarificationNeeded(task.id, questions);
        return;
      }

      const validation = await this.validateDAG(taskAnalysis.subtasks, availableAgents);
      logger.debug('LeaderAgent', 'DAG validated', {
        taskId: task.id,
        validTasks: validation.dag.length,
        unassignable: validation.unassignableTasks.length,
        availableAgentIds: availableAgents.map(a => a.agentId)
      });

      if (validation.unassignableTasks.length > 0 && availableAgents.length === 0) {
        await taskOrchestrator.updateTaskStatus(task.id, 'EXCEPTION', '没有可用的 Agent');
        this.emit('task_failed', { taskId: task.id, error: '没有可用的 Agent' });
        return;
      }

      if (validation.unassignableTasks.length > 0 && availableAgents.length > 0) {
        logger.warn('LeaderAgent', 'Some tasks have invalid agent IDs, reassigning to first available agent', {
          taskId: task.id,
          unassignable: validation.unassignableTasks,
          fallbackAgentId: availableAgents[0].agentId
        });

        for (const node of taskAnalysis.subtasks) {
          if (!availableAgents.some(a => a.agentId === node.assignedAgentId)) {
            node.assignedAgentId = availableAgents[0].agentId;
          }
        }
      }

      const finalDag = taskAnalysis.subtasks.map(node => {
        if (!availableAgents.some(a => a.agentId === node.assignedAgentId)) {
          return { ...node, assignedAgentId: availableAgents[0].agentId };
        }
        return node;
      });

      await taskOrchestrator.dispatchSubtasks(task.id, finalDag);
      logger.info('LeaderAgent', 'Subtasks dispatched', { taskId: task.id, subtaskCount: validation.dag.length });

      await taskOrchestrator.updateAgentStatus('LEADER', 'IDLE');

      await taskOrchestrator.updateTaskStatus(task.id, 'AGGREGATING');

      this.watchSubTasksCompletion(task.id);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await taskOrchestrator.updateTaskStatus(task.id, 'EXCEPTION', errorMessage);
      this.emit('task_failed', { taskId: task.id, error: errorMessage });
    }
  }

  private async analyzeTask(
    userInput: string,
    availableAgents: DomainAgentProfile[]
  ): Promise<{
    confidenceScore: number;
    intentType: string;
    refinedGoal: string;
    clarificationQuestions: string[];
    subtasks: DAGNode[];
  }> {
    const context = await memoryEngine.getActiveHistory(5);
    const historyText = context.map(h => `${h.role}: ${h.content}`).join('\n');

    const leaderRows = await db.select().from(schema.agents).where(eq(schema.agents.id, this.leaderAgentId));
    const leaderRow = leaderRows[0];

    const roleDescription = leaderRow?.rolePrompt
      || 'You are the core decision-maker for task planning and scheduling. Your responsibility is to analyze user requirements, plan task flows, and coordinate domain agents to complete tasks.';
    const behaviorGuidelines = leaderRow?.behaviorRules
      || '1. Understand user requirements and analyze task intent\n2. Break down complex tasks into executable subtasks\n3. Assign tasks reasonably based on agent capabilities\n4. Ensure correct task dependencies\n5. Ask for clarification from user when necessary';
    const constraints = leaderRow?.capabilityBoundary
      || '1. Only dispatch registered agents, do not execute specific tasks directly\n2. Task assignment must use valid Agent IDs\n3. Request clarification when confidence is below 0.7\n4. Clearly inform the user when tasks cannot be assigned';

    const agentListJson = JSON.stringify(availableAgents.map(a => ({
      id: a.agentId,
      name: a.name,
      rolePrompt: a.rolePrompt
    })), null, 2);

    logger.debug('LeaderAgent', 'Sending agent list to LLM', { agentIds: availableAgents.map(a => a.agentId) });

    const prompt = taskAnalysisPrompt({
      roleDescription,
      behaviorGuidelines,
      constraints,
      agentListJson,
      historyText,
      userInput,
    });

    try {
      const response = await this.callLeaderModel(prompt);
      const cleanedResponse = response.replace(/```json\n?/g, '').replace(/```\n?$/g, '').trim();
      const result = JSON.parse(cleanedResponse);

      return {
        confidenceScore: result.confidenceScore ?? 0.8,
        intentType: result.intentType || 'general',
        refinedGoal: result.refinedGoal || userInput,
        clarificationQuestions: result.clarificationQuestions || [],
        subtasks: result.subtasks || [],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Task analysis failed:', error);
      throw new Error(`任务分析失败: ${errorMessage}`);
    }
  }

  private async callLeaderModel(prompt: string): Promise<string> {
    logger.info('LeaderAgent', 'Calling leader model', { promptLength: prompt.length });

    try {
      const leaderAgent = await db.select()
        .from(schema.agents)
        .where(eq(schema.agents.id, this.leaderAgentId));

      if (leaderAgent.length === 0) {
        throw new Error('Leader agent not found');
      }

      const modelConfigId = leaderAgent[0].modelConfigId;
      if (!modelConfigId) {
        throw new Error('Leader agent has no model config');
      }

      const modelConfigs = await db.select()
        .from(schema.modelConfigs)
        .where(eq(schema.modelConfigs.id, modelConfigId));

      if (modelConfigs.length === 0) {
        throw new Error('Model config not found');
      }

      const modelConfig = modelHub.buildModelConfig(modelConfigs[0]);
      logger.info('LeaderAgent', 'Model config loaded', { provider: modelConfig.provider, model: modelConfig.modelName });

      logger.info('LeaderAgent', 'Creating OpenAI client', { baseUrl: modelConfig.baseUrl });

      const client = new OpenAI({
        apiKey: modelConfig.apiKey || '',
        baseURL: modelConfig.baseUrl || undefined,
        timeout: 600000,
      });

      logger.info('LeaderAgent', 'Calling OpenAI API');
      const messages: { role: 'user' | 'assistant' | 'system'; content: string }[] = [{ role: 'user', content: prompt }];
      logger.debug('LeaderAgent', 'LLM input', { model: modelConfig.modelName, messages: messages.map(m => JSON.stringify(m)).join(',\n') });

      const effectiveTemperature = leaderAgent[0].temperature ?? modelConfig.temperature;

      const response = await client.chat.completions.create({
        model: modelConfig.modelName,
        messages: messages as ChatCompletionMessageParam[],
        temperature: effectiveTemperature,
      });

      const result = response.choices[0]?.message?.content;
      if (!result) {
        throw new Error('Model returned empty response');
      }
      logger.debug('LeaderAgent', 'LLM output', { model: modelConfig.modelName, output: result });
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('LeaderAgent', 'Model call failed', error);
      throw new Error(`模型调用失败: ${errorMessage}`);
    }
  }

  private async validateDAG(
    dag: DAGNode[],
    availableAgents: DomainAgentProfile[]
  ): Promise<ValidationReport> {
    const agentMap = new Map(availableAgents.map(a => [a.agentId, a]));
    const validDag: DAGNode[] = [];
    const unassignableTasks: UnassignableIssue[] = [];

    for (const node of dag) {
      const agent = agentMap.get(node.assignedAgentId);

      if (!agent) {
        unassignableTasks.push({
          nodeId: node.id,
          reason: `Agent '${node.assignedAgentId}' not found`,
          missingSkill: 'N/A',
        });
        continue;
      }

      validDag.push(node);
    }

    return { dag: validDag, unassignableTasks };
  }

  private async watchSubTasksCompletion(parentTaskId: string): Promise<void> {
    const { children } = await taskOrchestrator.getTaskTree(parentTaskId);

    const pendingTasks = children.filter(
      c => c.status !== 'COMPLETED' && c.status !== 'TERMINATED' && c.status !== 'EXCEPTION'
    );

    if (pendingTasks.length === 0) {
      const subtaskResults = children
        .filter(c => c.outputSummary)
        .map(c => c.outputSummary)
        .join('\n\n---\n\n');

      await taskOrchestrator.updateTaskStatus(parentTaskId, 'COMPLETED', undefined, subtaskResults);
      this.emit('task_completed', { taskId: parentTaskId });
      return;
    }

    setTimeout(() => this.watchSubTasksCompletion(parentTaskId), 2000);
  }

  async handleClarification(taskId: string, clarification: string): Promise<void> {
    const task = await taskOrchestrator.getTask(taskId);
    if (!task) return;

    const inputPayload = task.inputPayload ? JSON.parse(task.inputPayload) : {};
    const updatedPayload = {
      ...inputPayload,
      clarificationReply: clarification,
    };

    await db.update(schema.tasks)
      .set({
        inputPayload: JSON.stringify(updatedPayload),
        updatedAt: new Date(),
      })
      .where(eq(schema.tasks.id, taskId));

    await taskOrchestrator.updateTaskStatus(taskId, 'PARSING');
    await this.processTask(task);
  }
}

export const leaderAgent = new LeaderAgent();