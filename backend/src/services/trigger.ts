import { taskService } from './task.js';
import { TriggerMode, TriggerStatus } from '../types/index.js';

export interface TriggerEvaluationResult {
  shouldRelease: boolean;
  summary: string;
  nextCheckAt?: Date;
  anomalyCode?: string;
  anomalySummary?: string;
}

export interface TriggerRule {
  type: 'queued' | 'scheduled' | 'event_triggered';
  condition?: string;
  threshold?: {
    maxWaitTimeMs?: number;
    maxRetryCount?: number;
    anomalyThresholdMs?: number;
  };
}

export class TriggerEvaluationService {
  async evaluate(taskId: string): Promise<TriggerEvaluationResult> {
    const task = await taskService.getTask(taskId);
    if (!task) {
      return {
        shouldRelease: false,
        summary: 'Task not found'
      };
    }

    switch (task.triggerMode) {
      case TriggerMode.IMMEDIATE:
        return this.evaluateImmediate(task);
      case TriggerMode.QUEUED:
        return this.evaluateQueued(task);
      case TriggerMode.SCHEDULED:
        return this.evaluateScheduled(task);
      case TriggerMode.EVENT_TRIGGERED:
        return this.evaluateEventTriggered(task);
      case TriggerMode.CLARIFICATION_PENDING:
        return this.evaluateClarificationPending(task);
      default:
        return {
          shouldRelease: false,
          summary: `Unknown trigger mode: ${task.triggerMode}`
        };
    }
  }

  private evaluateImmediate(task: any): TriggerEvaluationResult {
    return {
      shouldRelease: true,
      summary: 'Immediate trigger mode, releasing immediately'
    };
  }

  private async evaluateQueued(task: any): Promise<TriggerEvaluationResult> {
    const queuePosition = task.queuePosition || 1;
    
    if (queuePosition <= 3) {
      return {
        shouldRelease: true,
        summary: `Task is at queue position ${queuePosition}, releasing`
      };
    }

    const nextCheck = new Date(Date.now() + 5000);
    return {
      shouldRelease: false,
      summary: `Task at queue position ${queuePosition}, waiting for turn`,
      nextCheckAt: nextCheck
    };
  }

  private async evaluateScheduled(task: any): Promise<TriggerEvaluationResult> {
    const scheduledAt = task.scheduledAt;
    if (!scheduledAt) {
      return {
        shouldRelease: false,
        summary: 'No scheduled time set'
      };
    }

    const scheduledTime = new Date(scheduledAt);
    const now = new Date();

    if (now >= scheduledTime) {
      return {
        shouldRelease: true,
        summary: `Scheduled time reached: ${scheduledTime.toISOString()}`
      };
    }

    const waitTime = scheduledTime.getTime() - now.getTime();
    const maxWaitTime = 3600000;

    if (waitTime > maxWaitTime) {
      return {
        shouldRelease: false,
        summary: `Scheduled time not yet reached: ${scheduledTime.toISOString()}`,
        nextCheckAt: scheduledTime,
        anomalyCode: 'WAIT_TIMEOUT',
        anomalySummary: `Wait time ${waitTime}ms exceeds threshold ${maxWaitTime}ms`
      };
    }

    return {
      shouldRelease: false,
      summary: `Scheduled time not yet reached: ${scheduledTime.toISOString()}`,
      nextCheckAt: scheduledTime
    };
  }

  private async evaluateEventTriggered(task: any): Promise<TriggerEvaluationResult> {
    const triggerRule = task.triggerRule;
    
    if (!triggerRule) {
      return {
        shouldRelease: false,
        summary: 'No trigger rule defined'
      };
    }

    const rule = typeof triggerRule === 'string' ? JSON.parse(triggerRule) : triggerRule;
    
    const triggered = await this.checkEventCondition(rule);
    
    return {
      shouldRelease: triggered,
      summary: triggered ? 'Event trigger condition met' : 'Waiting for event trigger condition',
      nextCheckAt: triggered ? undefined : new Date(Date.now() + 5000)
    };
  }

  private async checkEventCondition(rule: TriggerRule): Promise<boolean> {
    return false;
  }

  private evaluateClarificationPending(task: any): TriggerEvaluationResult {
    if (task.clarificationRequiredFields && task.clarificationRequiredFields.length > 0) {
      if (task.clarificationResolutionSummary) {
        return {
          shouldRelease: true,
          summary: 'Clarification provided, releasing'
        };
      }
      return {
        shouldRelease: false,
        summary: 'Waiting for clarification'
      };
    }
    return {
      shouldRelease: true,
      summary: 'Clarification complete'
    };
  }

  async checkWaitAnomaly(taskId: string): Promise<TriggerEvaluationResult> {
    const task = await taskService.getTask(taskId);
    if (!task) {
      return {
        shouldRelease: false,
        summary: 'Task not found'
      };
    }

    const createdAt = new Date(task.createdAt);
    const now = new Date();
    const waitTime = now.getTime() - createdAt.getTime();
    
    const maxWaitTime = 3600000;
    
    if (waitTime > maxWaitTime) {
      return {
        shouldRelease: false,
        summary: `Wait time ${waitTime}ms exceeds threshold ${maxWaitTime}ms`,
        anomalyCode: 'WAIT_TIMEOUT',
        anomalySummary: `Task has been waiting for ${Math.floor(waitTime / 60000)} minutes`
      };
    }

    return {
      shouldRelease: false,
      summary: `No anomaly detected, wait time: ${Math.floor(waitTime / 60000)} minutes`
    };
  }

  async reevaluate(taskId: string): Promise<TriggerEvaluationResult> {
    const result = await this.evaluate(taskId);
    
    await taskService.addEvent(taskId, 'TaskTriggerReevaluated', result.summary, {
      shouldRelease: result.shouldRelease,
      anomalyCode: result.anomalyCode,
      anomalySummary: result.anomalySummary
    });

    if (result.anomalyCode) {
      await taskService.addEvent(taskId, 'WaitAnomalyDetected', result.anomalySummary || result.summary, {
        anomalyCode: result.anomalyCode
      });
    }

    return result;
  }
}

export const triggerEvaluationService = new TriggerEvaluationService();
