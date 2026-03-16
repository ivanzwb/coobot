import { db } from '../db/index.js';
import { tasks } from '../db/schema.js';
import { eq, and, asc } from 'drizzle-orm';

export interface QueueEntry {
  taskId: string;
  agentId: string;
  position: number;
  status: string;
  createdAt: Date;
}

export interface QueueStats {
  agentId: string;
  totalWaiting: number;
  currentPosition: number;
  estimatedWaitTime: number;
}

export class AgentQueueService {
  private queues: Map<string, QueueEntry[]> = new Map();
  private maxConcurrentPerAgent = 1;

  async addToQueue(taskId: string, agentId: string): Promise<number> {
    let queue = this.queues.get(agentId) || [];
    
    const position = queue.length + 1;
    
    queue.push({
      taskId,
      agentId,
      position,
      status: 'waiting',
      createdAt: new Date()
    });
    
    this.queues.set(agentId, queue);
    
    await this.updateTaskQueuePosition(taskId, agentId, position);
    
    return position;
  }

  async removeFromQueue(taskId: string, agentId: string): Promise<void> {
    let queue = this.queues.get(agentId) || [];
    
    queue = queue.filter(entry => entry.taskId !== taskId);
    
    for (let i = 0; i < queue.length; i++) {
      queue[i].position = i + 1;
    }
    
    this.queues.set(agentId, queue);
    
    await this.recalculateQueuePositions(agentId);
  }

  async getNextInQueue(agentId: string): Promise<string | null> {
    const queue = this.queues.get(agentId) || [];
    
    if (queue.length === 0) {
      return null;
    }
    
    return queue[0]?.taskId || null;
  }

  async getQueuePosition(taskId: string, agentId: string): Promise<number> {
    const queue = this.queues.get(agentId) || [];
    const entry = queue.find(e => e.taskId === taskId);
    return entry?.position || -1;
  }

  async getQueueStatus(agentId: string): Promise<QueueStats[]> {
    const queue = this.queues.get(agentId) || [];
    
    const totalWaiting = queue.length;
    const currentPosition = 1;
    
    const avgExecutionTime = 60000;
    const estimatedWaitTime = (totalWaiting - currentPosition) * avgExecutionTime;
    
    return [{
      agentId,
      totalWaiting,
      currentPosition,
      estimatedWaitTime
    }];
  }

  async getQueueList(agentId: string): Promise<QueueEntry[]> {
    return this.queues.get(agentId) || [];
  }

  private async updateTaskQueuePosition(taskId: string, agentId: string, position: number): Promise<void> {
    await db.update(tasks)
      .set({ queuePosition: position })
      .where(and(
        eq(tasks.id, taskId),
        eq(tasks.assignedDomainAgentId, agentId)
      ));
  }

  private async recalculateQueuePositions(agentId: string): Promise<void> {
    const queue = this.queues.get(agentId) || [];
    
    for (let i = 0; i < queue.length; i++) {
      await this.updateTaskQueuePosition(queue[i].taskId, agentId, i + 1);
    }
  }

  async getEstimatedCompletionTime(taskId: string, agentId: string): Promise<Date | null> {
    const position = await this.getQueuePosition(taskId, agentId);
    
    if (position <= 0) {
      return null;
    }
    
    const avgExecutionTime = 60000;
    const waitTime = (position - 1) * avgExecutionTime;
    
    return new Date(Date.now() + waitTime);
  }

  async canExecuteTask(agentId: string): Promise<boolean> {
    const queue = this.queues.get(agentId) || [];
    const runningCount = queue.filter(e => e.status === 'running').length;
    
    return runningCount < this.maxConcurrentPerAgent;
  }

  async markAsRunning(taskId: string, agentId: string): Promise<void> {
    let queue = this.queues.get(agentId) || [];
    const entry = queue.find(e => e.taskId === taskId);
    
    if (entry) {
      entry.status = 'running';
    }
  }

  async markAsCompleted(taskId: string, agentId: string): Promise<void> {
    await this.removeFromQueue(taskId, agentId);
  }

  async restoreQueuesFromDb(): Promise<void> {
    const queuedTasks = await db.select()
      .from(tasks)
      .where(eq(tasks.triggerStatus, 'queued'))
      .orderBy(asc(tasks.queuePosition));

    const agentQueues = new Map<string, QueueEntry[]>();
    
    for (const task of queuedTasks) {
      if (task.assignedDomainAgentId) {
        const queue = agentQueues.get(task.assignedDomainAgentId) || [];
        queue.push({
          taskId: task.id,
          agentId: task.assignedDomainAgentId,
          position: task.queuePosition || queue.length + 1,
          status: 'waiting',
          createdAt: new Date(task.createdAt)
        });
        agentQueues.set(task.assignedDomainAgentId, queue);
      }
    }

    for (const [agentId, queue] of agentQueues) {
      this.queues.set(agentId, queue.sort((a, b) => a.position - b.position));
    }
  }
}

export const agentQueueService = new AgentQueueService();
