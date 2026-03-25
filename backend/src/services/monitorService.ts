import * as os from 'os';
import { db, schema } from '../db';
import { eq, count } from 'drizzle-orm';
import type { AgentMatrixDTO, ResourceMetrics, TaskTimelineNode } from '../types';
import { eventBus } from './eventBus.js';

const MEMORY_THRESHOLD = 90;
const CPU_THRESHOLD = 90;
const DISK_THRESHOLD = 90;

export class MonitorService {
  private monitoringInterval: NodeJS.Timeout | null = null;
  private alerted: Set<string> = new Set();

  startMonitoring(intervalMs: number = 5000): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    this.monitoringInterval = setInterval(async () => {
      await this.checkResources();
    }, intervalMs);
  }

  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

  private async checkResources(): Promise<void> {
    const metrics = await this.getResourceMetrics();

    if (metrics.memory > MEMORY_THRESHOLD && !this.alerted.has('memory')) {
      eventBus.emitResourceAlert({
        type: 'memory',
        value: metrics.memory,
        threshold: MEMORY_THRESHOLD,
        timestamp: new Date(),
      });
      this.alerted.add('memory');
    } else if (metrics.memory < MEMORY_THRESHOLD * 0.8) {
      this.alerted.delete('memory');
    }

    if (metrics.cpu > CPU_THRESHOLD && !this.alerted.has('cpu')) {
      eventBus.emitResourceAlert({
        type: 'cpu',
        value: metrics.cpu,
        threshold: CPU_THRESHOLD,
        timestamp: new Date(),
      });
      this.alerted.add('cpu');
    } else if (metrics.cpu < CPU_THRESHOLD * 0.8) {
      this.alerted.delete('cpu');
    }
  }

  async getAgentMatrix(): Promise<AgentMatrixDTO[]> {
    const agents = await db.select().from(schema.agents);
    const result: AgentMatrixDTO[] = [];

    for (const agent of agents) {
      const tasks = await db.select().from(schema.tasks)
        .where(eq(schema.tasks.assignedAgentId, agent.id));

      const runningTasks = tasks.filter(t => t.status === 'RUNNING');
      const queuedTasks = tasks.filter(t => t.status === 'QUEUED');

      result.push({
        agentId: agent.id,
        name: agent.name,
        status: agent.status as 'IDLE' | 'RUNNING' | 'BUSY_WITH_QUEUE',
        currentTaskId: runningTasks[0]?.id,
        queueLength: queuedTasks.length,
      });
    }

    return result;
  }

  async getResourceMetrics(): Promise<ResourceMetrics> {
    const memUsage = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    const cpuLoad = os.loadavg()[0] / os.cpus().length * 100;

    return {
      cpu: Math.min(cpuLoad, 100),
      memory: (usedMem / totalMem) * 100,
      disk: 0,
    };
  }

  async getTaskTimeline(rootTaskId: string): Promise<TaskTimelineNode[]> {
    const root = await db.select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, rootTaskId));

    if (root.length === 0) return [];

    const children = await db.select()
      .from(schema.tasks)
      .where(eq(schema.tasks.rootTaskId, rootTaskId));

    const buildNode = (task: typeof root[0]): TaskTimelineNode => ({
      taskId: task.id,
      agentId: task.assignedAgentId,
      status: task.status as 'WAITING_FOR_LEADER' | 'CLARIFICATION_PENDING' | 'PARSING' | 'DISPATCHING' | 'QUEUED' | 'QUEUED_WAITING_RESOURCE' | 'RUNNING' | 'AGGREGATING' | 'COMPLETED' | 'EXCEPTION' | 'TERMINATED',
      startTime: task.startedAt ? new Date(task.startedAt) : (task.createdAt ? new Date(task.createdAt) : new Date()),
      endTime: task.finishedAt ? new Date(task.finishedAt) : undefined,
      children: children
        .filter(c => c.parentTaskId === task.id)
        .map(c => buildNode(c)),
    });

    return [buildNode(root[0])];
  }

  async getTaskStats(days: number = 7): Promise<{
    total: number;
    completed: number;
    failed: number;
    avgDuration: number;
  }> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const allTasks = await db.select().from(schema.tasks);

    const recentTasks = allTasks.filter(t => 
      t.createdAt && new Date(t.createdAt) >= startDate
    );

    const completed = recentTasks.filter(t => t.status === 'COMPLETED');
    const failed = recentTasks.filter(t => 
      t.status === 'EXCEPTION' || t.status === 'TERMINATED'
    );

    const durations: number[] = [];
    for (const task of completed) {
      if (task.startedAt && task.finishedAt) {
        const duration = new Date(task.finishedAt).getTime() - new Date(task.startedAt).getTime();
        durations.push(duration);
      }
    }

    const avgDuration = durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : 0;

    return {
      total: recentTasks.length,
      completed: completed.length,
      failed: failed.length,
      avgDuration,
    };
  }

  async getAgentStats(agentId: string): Promise<{
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    avgDuration: number;
  }> {
    const tasks = await db.select()
      .from(schema.tasks)
      .where(eq(schema.tasks.assignedAgentId, agentId));

    const completed = tasks.filter(t => t.status === 'COMPLETED');
    const failed = tasks.filter(t => t.status === 'EXCEPTION' || t.status === 'TERMINATED');

    const durations: number[] = [];
    for (const task of completed) {
      if (task.startedAt && task.finishedAt) {
        const duration = new Date(task.finishedAt).getTime() - new Date(task.startedAt).getTime();
        durations.push(duration);
      }
    }

    return {
      totalTasks: tasks.length,
      completedTasks: completed.length,
      failedTasks: failed.length,
      avgDuration: durations.length > 0
        ? durations.reduce((a, b) => a + b, 0) / durations.length
        : 0,
    };
  }

  async detectBottlenecks(): Promise<string[]> {
    const agents = await db.select().from(schema.agents);
    const warnings: string[] = [];

    for (const agent of agents) {
      const tasks = await db.select()
        .from(schema.tasks)
        .where(eq(schema.tasks.assignedAgentId, agent.id));

      const queuedCount = tasks.filter(t => t.status === 'QUEUED').length;

      if (queuedCount > 5) {
        warnings.push(`Agent "${agent.name}" has ${queuedCount} queued tasks. Consider adding more instances.`);
      }
    }

    const metrics = await this.getResourceMetrics();
    if (metrics.memory > 90) {
      warnings.push('Memory usage is above 90%. Consider reducing concurrent tasks.');
    }
    if (metrics.cpu > 90) {
      warnings.push('CPU usage is above 90%. System may be overloaded.');
    }

    return warnings;
  }
}

export const monitorService = new MonitorService();