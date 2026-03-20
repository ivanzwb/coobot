import { taskService } from './task.js';
import { orchestrationService } from './orchestration.js';
import config from 'config';
import { TaskStatus } from '../types/index.js';

export interface ExecutionSlot {
  taskId: string;
  acquiredAt: Date;
  parallelGroupId?: string;
}

export class SchedulerService {
  private scanInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private executionSlots: ExecutionSlot[] = [];
  private maxConcurrent: number;

  constructor() {
    this.maxConcurrent = (config.get('execution.maxConcurrentTasks') as number) || 3;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    const interval = (config.get('scheduler.scanIntervalMs') as number) || 5000;
    this.scanInterval = setInterval(() => this.scan(), interval);

    console.log('[Scheduler] Started');
  }

  stop() {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    this.isRunning = false;
    console.log('[Scheduler] Stopped');
  }

  getStatus() {
    return {
      running: this.isRunning,
      scanIntervalActive: this.scanInterval !== null,
      executionSlots: {
        used: this.executionSlots.length,
        total: this.maxConcurrent,
        available: this.maxConcurrent - this.executionSlots.length
      }
    };
  }

  private getAvailableSlots(): number {
    const currentlyRunning = this.executionSlots.length;
    return Math.max(0, this.maxConcurrent - currentlyRunning);
  }

  async acquireExecutionSlot(taskId: string, parallelGroupId?: string): Promise<boolean> {
    const available = this.getAvailableSlots();

    if (available <= 0) {
      console.log(`[Scheduler] No execution slots available for task ${taskId}`);
      return false;
    }

    this.executionSlots.push({
      taskId,
      acquiredAt: new Date(),
      parallelGroupId
    });

    console.log(`[Scheduler] Acquired execution slot for task ${taskId}. Slots: ${this.executionSlots.length}/${this.maxConcurrent}`);
    return true;
  }

  releaseExecutionSlot(taskId: string): boolean {
    const index = this.executionSlots.findIndex(slot => slot.taskId === taskId);
    if (index !== -1) {
      this.executionSlots.splice(index, 1);
      console.log(`[Scheduler] Released execution slot for task ${taskId}. Slots: ${this.executionSlots.length}/${this.maxConcurrent}`);
      return true;
    }
    return false;
  }

  getRunningTasks(): string[] {
    return this.executionSlots.map(slot => slot.taskId);
  }

  async canExecuteTask(taskId: string): Promise<{ allowed: boolean; reason?: string }> {
    const available = this.getAvailableSlots();

    if (available > 0) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `Maximum concurrent tasks (${this.maxConcurrent}) reached. Please wait for a running task to complete.`
    };
  }

  private async scan() {
    try {
      const immediateTasks = await taskService.getReadyForPlanningTasks(20);
      for (const task of immediateTasks) {
        if (task.status === TaskStatus.PENDING && task.triggerMode === 'immediate') {
          await this.triggerTaskExecution(task.id);
        }
      }

      const subscriptions = await taskService.getActiveWaitSubscriptions();

      for (const sub of subscriptions) {
        await this.evaluateSubscription(sub);
      }
    } catch (error) {
      console.error('[Scheduler] Scan error:', error);
    }
  }

  private async evaluateSubscription(subscription: any) {
    const now = new Date();
    const nextCheckAt = new Date(subscription.nextCheckAt);

    if (now < nextCheckAt) return;

    const task = await taskService.getTask(subscription.taskId);
    if (!task) {
      await taskService.updateWaitSubscription(subscription.id, { status: 'cancelled' });
      return;
    }

    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      await taskService.updateWaitSubscription(subscription.id, { status: 'cancelled' });
      return;
    }

    const shouldRelease = await this.checkReleaseCondition(subscription, task);

    if (shouldRelease) {
      await taskService.releaseTask(subscription.taskId);
      await this.triggerTaskExecution(subscription.taskId);
    } else {
      const backoffMs = this.calculateBackoff(subscription);
      const nextCheck = new Date(now.getTime() + backoffMs);

      await taskService.updateWaitSubscription(subscription.id, {
        lastEvaluatedAt: now,
        nextCheckAt: nextCheck
      });
    }
  }

  private async checkReleaseCondition(subscription: any, task: any): Promise<boolean> {
    const type = subscription.type;

    switch (type) {
      case 'scheduled': {
        const scheduledAt = subscription.scheduledAt ? new Date(subscription.scheduledAt) : null;
        return scheduledAt ? new Date() >= scheduledAt : false;
      }
      case 'queued':
        return true;

      case 'event_triggered':
        return false;

      default:
        return true;
    }
  }

  private calculateBackoff(subscription: any): number {
    const maxBackoff = (config.get('scheduler.backoffMaxMs') as number) || 30000;
    const lastEvaluated = subscription.lastEvaluatedAt ? new Date(subscription.lastEvaluatedAt).getTime() : 0;
    const now = Date.now();
    const elapsed = now - lastEvaluated;

    const backoff = Math.min(elapsed * 1.5, maxBackoff);
    return Math.max(backoff, 5000);
  }

  private async triggerTaskExecution(taskId: string) {
    const canExecute = await this.canExecuteTask(taskId);
    if (!canExecute.allowed) {
      console.log(`[Scheduler] Cannot execute task ${taskId}: ${canExecute.reason}`);
      await taskService.addEvent(taskId, 'TaskExecutionDeferred', '任务执行因槽位不足被延迟', {
        reason: canExecute.reason,
        currentRunningCount: this.executionSlots.length,
        maxConcurrent: this.maxConcurrent
      });
      return;
    }

    const acquired = await this.acquireExecutionSlot(taskId);
    if (!acquired) {
      return;
    }

    try {
      await orchestrationService.createTaskPlan(taskId, '', []);
      await orchestrationService.executeTask(taskId);
    } catch (error) {
      console.error(`[Scheduler] Task execution error:`, error);
    } finally {
      this.releaseExecutionSlot(taskId);
    }
  }
}

export const schedulerService = new SchedulerService();