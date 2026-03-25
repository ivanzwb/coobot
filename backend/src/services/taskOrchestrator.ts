import { v4 as uuidv4 } from 'uuid';
import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import type { TaskStatus, TaskInput, DAGNode, DomainAgentProfile, IntentResult } from '../types';
import type { Task } from '../db';
import { agentCapabilityRegistry } from './agentCapabilityRegistry';
import { EventEmitter } from 'events';
import { eventBus } from './eventBus.js';

export class TaskOrchestrator extends EventEmitter {
  private taskQueue: Map<string, Task> = new Map();
  private agentQueues: Map<string, string[]> = new Map();
  private heartbeatInterval: NodeJS.Timeout;
  private timeoutThreshold: number = 10 * 60 * 1000;

  constructor() {
    super();
    this.heartbeatInterval = setInterval(() => this.handleTimeout(), 30000);
    this.loadQueuesFromDB();
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

      console.log(`Loaded ${queuedTasks.length} queued tasks and ${runningTasks.length} running tasks from DB`);
    } catch (error) {
      console.error('Failed to load queues from DB:', error);
    }
  }

  async createTask(input: TaskInput, triggerMode: 'immediate' | 'scheduled' | 'event_triggered' = 'immediate'): Promise<Task> {
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

    return task;
  }

  async dispatchSubtasks(taskId: string, dag: DAGNode[]): Promise<void> {
    const parentTask = this.taskQueue.get(taskId);
    if (!parentTask) return;

    const deadlockError = this.detectDeadlock(dag);
    if (deadlockError) {
      await this.updateTaskStatus(taskId, 'EXCEPTION', `Deadlock detected: ${deadlockError}`);
      throw new Error(`Deadlock detected: ${deadlockError}`);
    }

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
    }

    await this.updateTaskStatus(taskId, 'DISPATCHING');
  }

  private async enqueueToAgent(agentId: string, taskId: string): Promise<void> {
    const queue = this.agentQueues.get(agentId) || [];
    queue.push(taskId);
    this.agentQueues.set(agentId, queue);
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
    if (!queue || queue.length === 0) return null;
    return queue.shift() || null;
  }

  async getAgentQueueLength(agentId: string): Promise<number> {
    return this.agentQueues.get(agentId)?.length || 0;
  }

  async updateTaskStatus(taskId: string, status: TaskStatus, errorMsg?: string): Promise<void> {
    const task = this.taskQueue.get(taskId);
    if (!task) return;

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

    const updateData: Record<string, unknown> = {
      status: task.status,
      updatedAt: task.updatedAt,
    };

    if (task.startedAt) updateData.startedAt = task.startedAt;
    if (task.finishedAt) updateData.finishedAt = task.finishedAt;
    if (task.errorMsg) updateData.errorMsg = task.errorMsg;

    await db.update(schema.tasks)
      .set(updateData)
      .where(eq(schema.tasks.id, taskId));

    this.emit('task_status_changed', { taskId, status });
    eventBus.emitTaskStatus({
      taskId,
      status,
      agentId: task.assignedAgentId,
      timestamp: new Date(),
    });
  }

  async updateTaskHeartbeat(taskId: string): Promise<void> {
    const task = this.taskQueue.get(taskId);
    if (!task) return;

    task.heartbeat = new Date();
    
    await db.update(schema.tasks)
      .set({ heartbeat: new Date() })
      .where(eq(schema.tasks.id, taskId));
  }

  async terminateTask(taskId: string): Promise<void> {
    const task = this.taskQueue.get(taskId);
    if (!task) return;

    await this.updateTaskStatus(taskId, 'TERMINATED');

    if (task.assignedAgentId !== 'LEADER') {
      const queue = this.agentQueues.get(task.assignedAgentId);
      if (queue) {
        const index = queue.indexOf(taskId);
        if (index > -1) {
          queue.splice(index, 1);
        }
      }
    }

    const subtasks = await db.select().from(schema.tasks)
      .where(eq(schema.tasks.parentTaskId, taskId));
    
    for (const subtask of subtasks) {
      if (subtask.status !== 'COMPLETED' && subtask.status !== 'TERMINATED') {
        await this.terminateTask(subtask.id);
      }
    }

    this.emit('task_terminated', taskId);
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
}

export const taskOrchestrator = new TaskOrchestrator();