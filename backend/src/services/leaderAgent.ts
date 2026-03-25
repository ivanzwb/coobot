import { EventEmitter } from 'events';
import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import type { DomainAgentProfile, DAGNode, IntentResult, ValidationReport, UnassignableIssue, AgentConfig } from '../types';
import type { Task } from '../db';
import { agentCapabilityRegistry } from './agentCapabilityRegistry';
import { taskOrchestrator } from './taskOrchestrator';
import { agentRuntime } from './agentRuntime';
import { memoryEngine } from './memoryEngine';
import { eventBus } from './eventBus.js';
import { logger } from './logger.js';
import { modelHub } from './modelHub.js';
import OpenAI from 'openai';

const CONFIDENCE_THRESHOLD = 0.7;

export class LeaderAgent extends EventEmitter {
  private leaderAgentId: string = 'LEADER';

  async processTask(task: Task): Promise<void> {
    logger.info('LeaderAgent', 'Processing task', { taskId: task.id });
    
    try {
      await taskOrchestrator.updateTaskStatus(task.id, 'PARSING');
      
      const inputPayload = task.inputPayload ? JSON.parse(task.inputPayload) : {};
      const userInput = typeof inputPayload === 'string' ? inputPayload : inputPayload.content || '';

      await memoryEngine.appendMessage('user', userInput, [], task.id);

      const availableAgents = await agentCapabilityRegistry.getActiveAgents();

      const intentResult = await this.analyzeIntent(userInput, availableAgents);
      logger.debug('LeaderAgent', 'Intent analyzed', { taskId: task.id, intent: intentResult.intentType, confidence: intentResult.confidenceScore });

      if (intentResult.status === 'CLARIFICATION_NEEDED') {
        await taskOrchestrator.updateTaskStatus(task.id, 'CLARIFICATION_PENDING');
        this.emit('clarification_needed', { taskId: task.id, questions: intentResult.questions });
        eventBus.emitClarificationNeeded(task.id, intentResult.questions || []);
        return;
      }

      if (!intentResult.refinedGoal) {
        throw new Error('Failed to analyze intent');
      }

      const dag = await this.generateDAG(intentResult.refinedGoal, availableAgents);
      logger.debug('LeaderAgent', 'DAG generated', { taskId: task.id, nodeCount: dag.length });

      const validation = await this.validateDAG(dag, availableAgents);
      logger.debug('LeaderAgent', 'DAG validated', { taskId: task.id, validTasks: validation.dag.length, unassignable: validation.unassignableTasks.length });

      if (validation.unassignableTasks.length > 0) {
        await taskOrchestrator.updateTaskStatus(task.id, 'CLARIFICATION_PENDING');
        const questions = this.generateClarificationQuestions(validation.unassignableTasks);
        this.emit('clarification_needed', { taskId: task.id, questions });
        eventBus.emitClarificationNeeded(task.id, questions);
        return;
      }

      await taskOrchestrator.dispatchSubtasks(task.id, validation.dag);
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

  private async analyzeIntent(
    userInput: string,
    availableAgents: DomainAgentProfile[]
  ): Promise<IntentResult> {
    const context = await memoryEngine.getActiveHistory(5);
    const historyText = context.map(h => `${h.role}: ${h.content}`).join('\n');

    const agentListJson = JSON.stringify(availableAgents.map(a => ({
      id: a.agentId,
      name: a.name,
      skills: a.skills,
      tools: a.tools,
    })), null, 2);

    const prompt = `
You are the Leader Agent for BiosBot. Your task is to analyze user input and determine the intent.

## Available Agents
${agentListJson}

## Conversation History
${historyText}

## User Input
${userInput}

Analyze the user input and return a JSON object with the following structure:
{
  "confidenceScore": number (0.0 to 1.0),
  "intentType": string,
  "refinedGoal": string (refined and clear goal description),
  "missingInfoQuestions": string[] (if confidence is low),
  "requiredSkills": string[] (skills needed to complete this task)
}

If confidenceScore is below ${CONFIDENCE_THRESHOLD} or critical information is missing, set status to CLARIFICATION_NEEDED.
Otherwise, set status to READY_TO_PLAN.

Return only valid JSON, no other text.
`;

    try {
      const response = await this.callLeaderModel(prompt);
      const result = JSON.parse(response);

      if (result.confidenceScore < CONFIDENCE_THRESHOLD) {
        return {
          status: 'CLARIFICATION_NEEDED',
          questions: result.missingInfoQuestions || ['Could you please provide more details?'],
          reason: 'Low confidence',
        };
      }

      return {
        status: 'READY_TO_PLAN',
        intent: result.intentType,
        refinedGoal: result.refinedGoal,
        questions: result.missingInfoQuestions,
      };
    } catch (error) {
      console.error('Intent analysis failed:', error);
      return {
        status: 'READY_TO_PLAN',
        refinedGoal: userInput,
      };
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
        timeout: 60000,
      });

      logger.info('LeaderAgent', 'Calling OpenAI API');
      const messages = [{ role: 'user', content: prompt }];
      logger.debug('LeaderAgent', 'LLM input', { model: modelConfig.modelName, messages });

      const response = await client.chat.completions.create({
        model: modelConfig.modelName,
        messages,
        temperature: 0.3,
      });

      const result = response.choices[0]?.message?.content || '{"confidenceScore": 0.8, "intentType": "general", "refinedGoal": ""}';
      logger.debug('LeaderAgent', 'LLM output', { model: modelConfig.modelName, output: result });
      return result;
    } catch (error) {
      logger.error('LeaderAgent', 'Model call failed', error);
      return '{"confidenceScore": 0.8, "intentType": "general", "refinedGoal": ""}';
    }
  }

  private async generateDAG(
    goal: string,
    availableAgents: DomainAgentProfile[]
  ): Promise<DAGNode[]> {
    const agentListJson = JSON.stringify(availableAgents.map(a => ({
      id: a.agentId,
      name: a.name,
      skills: a.skills,
      tools: a.tools,
    })), null, 2);

    const prompt = `
You are the Leader Agent for BiosBot. Your task is to decompose a user goal into executable subtasks.

## Available Agents
${agentListJson}

## User Goal
${goal}

Decompose this goal into atomic subtasks. Each subtask should:
1. Be assigned to exactly one agent (use the agent IDs from the available agents list)
2. Have clear input and expected output
3. Specify required skills for the task

Return a JSON array of subtasks with this structure:
[{
  "id": "task_1",
  "description": "Clear description of what this subtask does",
  "assignedAgentId": "agent_id_from_list",
  "requiredSkills": ["skill1", "skill2"],
  "dependencies": [],
  "inputSources": ["user_input"]
}]

IMPORTANT: You MUST only use agent IDs from the available agents list above.
If no suitable agent exists for a task, do not include it in the list.

Return only valid JSON array, no other text.
`;

    try {
      const response = await this.callLeaderModel(prompt);
      const cleanedResponse = response.replace(/```json\n?/g, '').replace(/```\n?$/g, '').trim();
      const dag = JSON.parse(cleanedResponse);
      return dag;
    } catch (error) {
      console.error('DAG generation failed:', error);
      return [{
        id: 'task_1',
        description: goal,
        assignedAgentId: availableAgents[0]?.agentId || 'LEADER',
        requiredSkills: [],
        dependencies: [],
        inputSources: ['user_input'],
      }];
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

      const hasSkills = node.requiredSkills.every(s => agent.skills.includes(s));
      if (!hasSkills) {
        const missing = node.requiredSkills.find(s => !agent.skills.includes(s));
        unassignableTasks.push({
          nodeId: node.id,
          reason: `Agent '${agent.name}' lacks required skill`,
          missingSkill: missing || 'N/A',
        });
        continue;
      }

      validDag.push(node);
    }

    return { dag: validDag, unassignableTasks };
  }

  private generateClarificationQuestions(issues: UnassignableIssue[]): string[] {
    return issues.map(issue => {
      if (issue.reason.includes('not found')) {
        return `The task requires an agent that doesn't exist. ${issue.reason}`;
      }
      return `Task "${issue.nodeId}" requires skill "${issue.missingSkill}" but no available agent has it.`;
    });
  }

  private async watchSubTasksCompletion(parentTaskId: string): Promise<void> {
    const { root, children } = await taskOrchestrator.getTaskTree(parentTaskId);
    
    const pendingTasks = children.filter(
      c => c.status !== 'COMPLETED' && c.status !== 'TERMINATED' && c.status !== 'EXCEPTION'
    );

    if (pendingTasks.length === 0) {
      await taskOrchestrator.updateTaskStatus(parentTaskId, 'COMPLETED');
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
      clarification,
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