import { taskService } from './task.js';
import { orchestrationService } from './orchestration.js';
import config from 'config';

export class SchedulerService {
  private scanInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

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

  private async scan() {
    try {
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
    try {
      await orchestrationService.createTaskPlan(taskId, '', []);
      await orchestrationService.executeTask(taskId);
    } catch (error) {
      console.error(`[Scheduler] Task execution error:`, error);
    }
  }
}

export const schedulerService = new SchedulerService();