import { v4 as uuidv4 } from 'uuid';
import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import type { TaskStatus, TaskInput, DAGNode } from '../types';
import type { Task } from '../db';
import { agentRuntime } from './agentRuntime';
import { EventEmitter } from 'events';
import { eventBus } from './eventBus.js';
import { leaderAgent } from './leaderAgent.js';
import { logger } from './logger.js';
import { memoryEngine } from './memoryEngine.js';
import { skillRegistry } from './skillRegistry.js';

export class TaskOrchestrator extends EventEmitter {
  private taskQueue: Map<string, Task> = new Map();
  private agentQueues: Map<string, string[]> = new Map();
  private leaderTaskQueue: string[] = [];
  private isLeaderTaskRunning: boolean = false;
  private heartbeatInterval: NodeJS.Timeout;
  private timeoutThreshold: number = 10 * 60 * 1000;

  constructor() {
    super();
    this.heartbeatInterval = setInterval(() => this.handleTimeout(), 30000);
    this.loadQueuesFromDB();
  }

  async enqueueLeaderTask(taskId: string): Promise<void> {
    if (!this.leaderTaskQueue.includes(taskId)) {
      this.leaderTaskQueue.push(taskId);
      logger.info('TaskOrchestrator', 'Task enqueued to leader queue', { taskId, queueLength: this.leaderTaskQueue.length });
    }
    await this.processLeaderQueue();
  }

  private async processLeaderQueue(): Promise<void> {
    if (this.isLeaderTaskRunning) {
      logger.debug('TaskOrchestrator', 'Leader task already running, waiting');
      return;
    }

    if (this.leaderTaskQueue.length === 0) {
      logger.debug('TaskOrchestrator', 'Leader queue empty');
      return;
    }

    const taskId = this.leaderTaskQueue.shift()!;
    this.isLeaderTaskRunning = true;

    logger.info('TaskOrchestrator', 'Processing leader task from queue', { taskId, remaining: this.leaderTaskQueue.length });

    try {
      const task = await this.getTask(taskId);
      if (!task) {
        logger.error('TaskOrchestrator', 'Task not found', { taskId });
        return;
      }

      if (!this.taskQueue.has(task.id)) {
        this.taskQueue.set(task.id, task as Task);
      }

      await this.updateTaskStatus(task.id, 'PARSING');
      await leaderAgent.processTask(task as Task);
    } catch (error) {
      logger.error('TaskOrchestrator', 'Leader task failed', { taskId, error });
    } finally {
      this.isLeaderTaskRunning = false;
      if (this.leaderTaskQueue.length > 0) {
        setTimeout(() => this.processLeaderQueue(), 100);
      }
    }
  }

  private async loadQueuesFromDB(): Promise<void> {
    try {
      const queuedTasks = await db.select()
        .from(schema.tasks)
        .where(eq(schema.tasks.status, 'QUEUED'));

      for (const task of queuedTasks) {
        const agentId = task.assignedAgentId;
        const queue = this.agentQueues.get(agentId) || [];
        queue.push(task.id);
        this.agentQueues.set(agentId, queue);
        this.taskQueue.set(task.id, task);
      }

      const runningTasks = await db.select()
        .from(schema.tasks)
        .where(eq(schema.tasks.status, 'RUNNING'));

      for (const task of runningTasks) {
        this.taskQueue.set(task.id, task);
      }

      const staleParsingTasks = await db.select()
        .from(schema.tasks)
        .where(eq(schema.tasks.status, 'PARSING'));

      for (const task of staleParsingTasks) {
        const staleAge = task.updatedAt ? Date.now() - new Date(task.updatedAt).getTime() : 0;
        if (staleAge > 60000) {
          await db.update(schema.tasks)
            .set({ status: 'EXCEPTION', errorMsg: 'Task stale - process restarted', updatedAt: new Date() })
            .where(eq(schema.tasks.id, task.id));
          logger.info('TaskOrchestrator', 'Reset stale PARSING task on startup', { taskId: task.id, staleAge });
        } else {
          this.taskQueue.set(task.id, task);
        }
      }

      console.log(`Loaded ${queuedTasks.length} queued tasks and ${runningTasks.length} running tasks from DB`);
    } catch (error) {
      console.error('Failed to load queues from DB:', error);
    }
  }

  async createTask(input: TaskInput, triggerMode: 'immediate' | 'scheduled' | 'event_triggered' = 'immediate'): Promise<Task> {
    logger.info('TaskOrchestrator', 'Creating task', { triggerMode, input });

    const taskId = uuidv4();
    const rootTaskId = taskId;

    const task: Task = {
      id: taskId,
      parentTaskId: null as unknown as string,
      rootTaskId,
      assignedAgentId: 'LEADER',
      status: 'WAITING_FOR_LEADER',
      triggerMode,
      inputPayload: JSON.stringify(input),
      outputSummary: null as unknown as string,
      errorMsg: null as unknown as string,
      retryCount: 0,
      heartbeat: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      startedAt: null as unknown as Date,
      finishedAt: null as unknown as Date,
    };

    await db.insert(schema.tasks).values({
      id: task.id,
      parentTaskId: task.parentTaskId,
      rootTaskId: task.rootTaskId,
      assignedAgentId: task.assignedAgentId,
      status: task.status,
      triggerMode: task.triggerMode,
      inputPayload: task.inputPayload,
      retryCount: task.retryCount,
      heartbeat: task.heartbeat,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    });

    this.taskQueue.set(taskId, task);
    this.emit('task_created', task);
    logger.info('TaskOrchestrator', 'Task created', { taskId, status: task.status });

    this.enqueueLeaderTask(taskId).catch(err => {
      logger.error('TaskOrchestrator', 'Failed to enqueue leader task', { taskId, error: err });
    });

    return task;
  }

  async dispatchSubtasks(taskId: string, dag: DAGNode[]): Promise<void> {
    const parentTask = this.taskQueue.get(taskId);
    if (!parentTask) {
      logger.error('TaskOrchestrator', 'Parent task not found in queue', { parentTaskId: taskId });
      return;
    }

    const deadlockError = this.detectDeadlock(dag);
    if (deadlockError) {
      await this.updateTaskStatus(taskId, 'EXCEPTION', `Deadlock detected: ${deadlockError}`);
      throw new Error(`Deadlock detected: ${deadlockError}`);
    }

    logger.info('TaskOrchestrator', 'Dispatching subtasks', { parentTaskId: taskId, nodeCount: dag.length });

    for (const node of dag) {
      const subtaskId = uuidv4();
      const subtask: Task = {
        id: subtaskId,
        parentTaskId: taskId,
        rootTaskId: parentTask.rootTaskId,
        assignedAgentId: node.assignedAgentId,
        status: 'QUEUED',
        triggerMode: parentTask.triggerMode,
        inputPayload: JSON.stringify(node),
        outputSummary: null as unknown as string,
        errorMsg: null as unknown as string,
        retryCount: 0,
        heartbeat: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        startedAt: null as unknown as Date,
        finishedAt: null as unknown as Date,
      };

      await db.insert(schema.tasks).values({
        id: subtask.id,
        parentTaskId: subtask.parentTaskId,
        rootTaskId: subtask.rootTaskId,
        assignedAgentId: subtask.assignedAgentId,
        status: subtask.status,
        triggerMode: subtask.triggerMode,
        inputPayload: subtask.inputPayload,
        retryCount: subtask.retryCount,
        heartbeat: subtask.heartbeat,
        createdAt: subtask.createdAt,
        updatedAt: subtask.updatedAt,
      });

      this.taskQueue.set(subtaskId, subtask);
      await this.enqueueToAgent(node.assignedAgentId, subtaskId);
      logger.info('TaskOrchestrator', 'Subtask enqueued', { subtaskId, agentId: node.assignedAgentId, description: node.description });
    }

    logger.info('TaskOrchestrator', 'Triggering agent queues processing');
    for (const node of dag) {
      await this.processAgentQueue(node.assignedAgentId);
    }

    await this.updateTaskStatus(taskId, 'DISPATCHING');
  }

  private async enqueueToAgent(agentId: string, taskId: string): Promise<void> {
    const queue = this.agentQueues.get(agentId) || [];
    queue.push(taskId);
    this.agentQueues.set(agentId, queue);
    logger.debug('TaskOrchestrator', 'Task enqueued to agent', { agentId, taskId, queueLength: queue.length });
  }

  private detectDeadlock(dag: DAGNode[]): string | null {
    const graph = new Map<string, string[]>();

    for (const node of dag) {
      if (!graph.has(node.id)) {
        graph.set(node.id, []);
      }
      for (const dep of node.dependencies || []) {
        const deps = graph.get(node.id) || [];
        deps.push(dep);
        graph.set(node.id, deps);
      }
    }

    const visited = new Set<string>();
    const recStack = new Set<string>();

    const dfs = (nodeId: string, path: string[]): string | null => {
      visited.add(nodeId);
      recStack.add(nodeId);

      const deps = graph.get(nodeId) || [];
      for (const dep of deps) {
        if (!visited.has(dep)) {
          const result = dfs(dep, [...path, dep]);
          if (result) return result;
        } else if (recStack.has(dep)) {
          return `Circular dependency detected: ${[...path, dep].join(' -> ')}`;
        }
      }

      recStack.delete(nodeId);
      return null;
    };

    for (const nodeId of graph.keys()) {
      if (!visited.has(nodeId)) {
        const result = dfs(nodeId, [nodeId]);
        if (result) return result;
      }
    }

    return null;
  }

  async dequeueFromAgent(agentId: string): Promise<string | null> {
    const queue = this.agentQueues.get(agentId);
    logger.debug('TaskOrchestrator', 'Agent queue state', { agentId, queueLength: queue?.length || 0 });
    if (!queue || queue.length === 0) return null;
    const taskId = queue.shift() || null;
    logger.debug('TaskOrchestrator', 'Dequeued task', { agentId, taskId, remaining: queue.length });
    return taskId;
  }

  async getAgentQueueLength(agentId: string): Promise<number> {
    return this.agentQueues.get(agentId)?.length || 0;
  }

  async updateTaskStatus(taskId: string, status: TaskStatus, errorMsg?: string, outputSummary?: string): Promise<void> {
    const task = this.taskQueue.get(taskId);
    if (!task) return;

    const previousStatus = task.status;
    task.status = status;
    task.updatedAt = new Date();

    if (status === 'RUNNING') {
      task.startedAt = new Date();
    }

    if (status === 'COMPLETED' || status === 'TERMINATED' || status === 'EXCEPTION') {
      task.finishedAt = new Date();
    }

    if (errorMsg) {
      task.errorMsg = errorMsg;
    }

    if (outputSummary) {
      task.outputSummary = outputSummary;
    }

    logger.info('TaskOrchestrator', 'Task status changed', {
      taskId,
      previousStatus,
      newStatus: status,
      errorMsg
    });

    const updateData: Record<string, unknown> = {
      status: task.status,
      updatedAt: task.updatedAt,
    };

    if (task.startedAt) updateData.startedAt = task.startedAt;
    if (task.finishedAt) updateData.finishedAt = task.finishedAt;
    if (task.errorMsg) updateData.errorMsg = task.errorMsg;
    if (task.outputSummary) updateData.outputSummary = task.outputSummary;

    await db.update(schema.tasks)
      .set(updateData)
      .where(eq(schema.tasks.id, taskId));

    if ((status === 'COMPLETED' || status === 'TERMINATED' || status === 'EXCEPTION') && task.assignedAgentId !== 'LEADER') {
      await this.processAgentQueue(task.assignedAgentId);
    }

    this.emit('task_status_changed', { taskId, status });
    eventBus.emitTaskStatus({
      taskId,
      status,
      agentId: task.assignedAgentId,
      timestamp: new Date(),
    });
  }

  private async processAgentQueue(agentId: string): Promise<void> {
    logger.debug('TaskOrchestrator', 'Processing agent queue', { agentId });

    const nextTaskId = await this.dequeueFromAgent(agentId);

    if (nextTaskId) {
      logger.info('TaskOrchestrator', 'Dequeuing task for agent', { agentId, taskId: nextTaskId });
      await this.updateAgentStatus(agentId, 'RUNNING');

      const nextTask = this.taskQueue.get(nextTaskId);
      if (nextTask) {
        logger.info('TaskOrchestrator', 'Starting task execution', { taskId: nextTaskId, agentId, description: nextTask.inputPayload });
        await this.updateTaskStatus(nextTaskId, 'RUNNING');

        const agents = await db.select()
          .from(schema.agents)
          .where(eq(schema.agents.id, agentId));

        if (agents.length > 0) {
          const agentConfig = await this.buildAgentConfig(agents[0]);
          logger.info('TaskOrchestrator', 'Executing task with agent', { taskId: nextTaskId, agentId: agentConfig.id, agentName: agentConfig.name });
          await agentRuntime.executeTask(nextTask, agentConfig);
        } else {
          logger.error('TaskOrchestrator', 'Agent not found in database', { agentId });
        }
      } else {
        logger.error('TaskOrchestrator', 'Task not found in queue', { taskId: nextTaskId });
      }
    } else {
      logger.debug('TaskOrchestrator', 'No tasks in agent queue', { agentId });
      await this.updateAgentStatus(agentId, 'IDLE');
    }
  }

  private async buildAgentConfig(agent: any): Promise<any> {
    let modelConfig = null;
    if (agent.modelConfigId) {
      const configs = await db.select()
        .from(schema.modelConfigs)
        .where(eq(schema.modelConfigs.id, agent.modelConfigId));
      if (configs.length > 0) {
        const c = configs[0];
        modelConfig = {
          provider: c.provider,
          modelName: c.modelName,
          baseUrl: c.baseUrl || undefined,
          apiKey: c.apiKey || undefined,
          contextWindow: c.contextWindow || 4096,
        };
      }
    }

    const agentSkillRelations = await db.select()
      .from(schema.agentSkills)
      .where(eq(schema.agentSkills.agentId, agent.id));

    const agentSkills: { id: string; name: string; description: string; tools: { name: string; description: string }[] }[] = [];

    if (agentSkillRelations.length > 0) {
      const skillIds = agentSkillRelations.map(r => r.skillId);
      const installedSkills = await skillRegistry.listInstalled();
      const matchedSkills = installedSkills.filter(s => skillIds.includes(s.id));

      for (const skill of matchedSkills) {
        agentSkills.push({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          tools: skill.tools.map(t => ({ name: t.name, description: t.description }))
        });
      }
    }

    const capabilities = await db.select()
      .from(schema.agentCapabilities)
      .where(eq(schema.agentCapabilities.agentId, agent.id));

    const agentTools = JSON.parse(capabilities[0].toolsJson || '[]');

    logger.info('TaskOrchestrator', 'buildAgentConfig', {
      agentId: agent.id,
      capabilitiesFound: capabilities.length,
      tools: agentTools,
      skills: agentSkills
    });

    return {
      id: agent.id,
      name: agent.name,
      type: agent.type,
      modelConfig,
      rolePrompt: capabilities[0]?.rolePrompt || undefined,
      behaviorRules: capabilities[0]?.behaviorRules || undefined,
      capabilityBoundary: capabilities[0]?.capabilityBoundary || undefined,
      skills: agentSkills,
      tools: agentTools,
    };
  }

  async updateTaskHeartbeat(taskId: string): Promise<void> {
    const task = this.taskQueue.get(taskId);
    if (!task) return;

    task.heartbeat = new Date();

    await db.update(schema.tasks)
      .set({ heartbeat: new Date() })
      .where(eq(schema.tasks.id, taskId));
  }

  async updateAgentStatus(agentId: string, status: 'IDLE' | 'RUNNING' | 'BUSY_WITH_QUEUE'): Promise<void> {
    await db.update(schema.agents)
      .set({ status, updatedAt: new Date() })
      .where(eq(schema.agents.id, agentId));

    logger.info('TaskOrchestrator', 'Agent status updated', { agentId, status });
  }

  async terminateTask(taskId: string): Promise<void> {
    const task = this.taskQueue.get(taskId);
    if (!task) return;

    const report = await this.generateTerminationReport(taskId);
    await this.updateTaskStatus(taskId, 'TERMINATED', `Task terminated. Report: ${JSON.stringify(report)}`);

    if (task.assignedAgentId !== 'LEADER') {
      const queue = this.agentQueues.get(task.assignedAgentId);
      if (queue) {
        const index = queue.indexOf(taskId);
        if (index > -1) {
          queue.splice(index, 1);
        }
      }

      await this.releaseAgentResources(task.assignedAgentId);
    }

    const subtasks = await db.select().from(schema.tasks)
      .where(eq(schema.tasks.parentTaskId, taskId));

    for (const subtask of subtasks) {
      if (subtask.status !== 'COMPLETED' && subtask.status !== 'TERMINATED') {
        await this.terminateTask(subtask.id);
      }
    }

    this.emit('task_terminated', taskId, report);
  }

  async generateTerminationReport(taskId: string): Promise<{
    taskId: string;
    completedSteps: number;
    interruptionPoint: string;
    resourceReleased: boolean;
    timestamp: string;
  }> {
    const taskLogs = await db.select()
      .from(schema.taskLogs)
      .where(eq(schema.taskLogs.taskId, taskId))
      .orderBy(schema.taskLogs.stepIndex);

    const completedSteps = taskLogs.length;
    const lastStep = taskLogs[taskLogs.length - 1];
    const interruptionPoint = lastStep
      ? `Step ${lastStep.stepIndex}: ${lastStep.stepType} - ${lastStep.content.substring(0, 100)}`
      : 'No steps executed';

    const task = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
    const agentId = task[0]?.assignedAgentId;

    return {
      taskId,
      completedSteps,
      interruptionPoint,
      resourceReleased: true,
      timestamp: new Date().toISOString(),
    };
  }

  private async releaseAgentResources(agentId: string): Promise<void> {
    const runningTask = Array.from(this.taskQueue.values())
      .find(t => t.assignedAgentId === agentId && t.status === 'RUNNING');

    if (runningTask) {
      this.taskQueue.delete(runningTask.id);
    }

    await this.updateAgentStatus(agentId, 'IDLE');
    await this.processAgentQueue(agentId);
  }

  private async handleTimeout(): Promise<void> {
    const now = new Date();
    const runningTasks = Array.from(this.taskQueue.values())
      .filter(t => t.status === 'RUNNING' || t.status === 'QUEUED');

    for (const task of runningTasks) {
      const lastHeartbeat = task.heartbeat;
      if (lastHeartbeat && (now.getTime() - lastHeartbeat.getTime()) > this.timeoutThreshold) {
        await this.updateTaskStatus(task.id, 'EXCEPTION', 'Task timeout');
        this.emit('task_timeout', task);
      }
    }
  }

  /** Keep in-memory task row in sync after persisting `inputPayload` (e.g. clarification). */
  patchTaskInputPayload(taskId: string, inputPayloadJson: string): void {
    const task = this.taskQueue.get(taskId);
    if (task) {
      task.inputPayload = inputPayloadJson;
      task.updatedAt = new Date();
    }
  }

  async getTask(taskId: string): Promise<Task | undefined> {
    return this.taskQueue.get(taskId) || (await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)))[0];
  }

  async getTaskTree(rootTaskId: string): Promise<{ root: Task; children: Task[] }> {
    const root = await this.getTask(rootTaskId);
    if (!root) return { root: null as unknown as Task, children: [] };

    const children = await db.select().from(schema.tasks)
      .where(eq(schema.tasks.rootTaskId, rootTaskId));

    return { root, children: children.filter(c => c.parentTaskId !== null) };
  }

  destroy(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
  }

  async extractTaskSummary(taskId: string): Promise<void> {
    try {
      const task = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
      if (!task.length || task[0].status !== 'COMPLETED') return;

      const taskLogs = await db.select()
        .from(schema.taskLogs)
        .where(eq(schema.taskLogs.taskId, taskId))
        .orderBy(schema.taskLogs.stepIndex);

      const observations = taskLogs
        .filter(log => log.stepType === 'OBSERVATION')
        .map(log => log.content)
        .join('\n');

      if (observations.length > 50) {
        const summary = `Task completed. Key observations: ${observations.substring(0, 500)}`;

        await memoryEngine.appendMessage(
          'assistant',
          summary,
          undefined,
          taskId
        );

        if (task[0].outputSummary) {
          await memoryEngine.addFact(
            task[0].assignedAgentId,
            'task_completion',
            task[0].outputSummary,
            { taskId, completedAt: new Date().toISOString() }
          );
        }
      }
    } catch (error) {
      logger.error('TaskOrchestrator', 'Failed to extract task summary', error);
    }
  }
}

export const taskOrchestrator = new TaskOrchestrator();