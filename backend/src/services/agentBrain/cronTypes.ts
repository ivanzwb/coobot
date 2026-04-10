/** Ported from agent-brain demo `demo/src/cron-types.ts` (aligned with CronHubAdapter snapshots). */

export type CronJobStatus = 'active' | 'paused' | 'completed' | 'failed';

export interface CronScheduledJobSnapshot {
  id: string;
  name: string;
  cronExpression: string;
  command: string;
  status: CronJobStatus;
  resolvedResources?: Record<string, unknown>;
  nextRunTime?: string;
  lastRunTime?: string;
  lastStatus?: 'success' | 'error';
  lastError?: string;
  createdAt: string;
}

export type CronJobTriggerHandler = (job: CronScheduledJobSnapshot) => Promise<void>;
