/**
 * In-process Cron hub aligned with agent-brain demo `demo/src/cron-hub-adapter.ts`:
 * `cron-parser` (UTC) + timers + `onJobTrigger`.
 */
import { CronExpressionParser } from 'cron-parser';
import type { CronHub } from '@biosbot/agent-brain/dist/cron/cron-hub.js';
import { CRON_TOOL_DEFINITIONS } from '@biosbot/agent-brain/dist/cron/cron-tool-definitions.js';
import type { ToolDefinition } from '@biosbot/agent-brain';
import type { CronJobTriggerHandler, CronScheduledJobSnapshot, CronJobStatus } from './cronTypes.js';
import {
  saveAgentBrainCronJob,
  deleteAgentBrainCronJob,
  loadAllAgentBrainCronJobRows,
} from './agentBrainCronPersistence.js';
import { logger } from '../logger.js';

type Timer = ReturnType<typeof setTimeout>;

const MAX_TIMEOUT_MS = 2147483647;

interface InternalJob extends CronScheduledJobSnapshot {
  timeout?: Timer;
}

function delayThen(ms: number, fn: () => void): Timer {
  if (ms <= MAX_TIMEOUT_MS) {
    return setTimeout(fn, ms);
  }
  return setTimeout(() => {
    delayThen(ms - MAX_TIMEOUT_MS, fn);
  }, MAX_TIMEOUT_MS);
}

function computeNextRunIso(cronExpression: string, from: Date): string | undefined {
  try {
    const expr = CronExpressionParser.parse(cronExpression.trim(), {
      currentDate: from,
      tz: 'UTC',
    });
    if (!expr.hasNext()) return undefined;
    const next = expr.next();
    return next.toDate().toISOString();
  } catch {
    return undefined;
  }
}

function scheduleDelayMs(nextIso: string, now: number): number {
  const t = Date.parse(nextIso);
  if (Number.isNaN(t)) return 60_000;
  return Math.max(0, t - now);
}

export class CoobotCronHub implements CronHub {
  private readonly jobs = new Map<string, InternalJob>();
  private readonly toolMap = new Map<string, ToolDefinition>(
    Object.entries(CRON_TOOL_DEFINITIONS).map(([, v]) => [v.name, v])
  );

  constructor(private readonly opts: { onJobTrigger: CronJobTriggerHandler }) {}

  private persistSnapshot(s: CronScheduledJobSnapshot): void {
    void saveAgentBrainCronJob(s).catch((e) => {
      logger.error('AgentBrainCron', 'Persist cron job failed', { id: s.id, err: String(e) });
    });
  }

  /** Restore jobs from SQLite after process start (see `agent_brain_cron_jobs`). */
  async restoreFromDisk(): Promise<void> {
    const rows = await loadAllAgentBrainCronJobRows();
    for (const row of rows) {
      const job: InternalJob = {
        id: row.id,
        name: row.name,
        cronExpression: row.cronExpression,
        command: row.command,
        status: row.status as CronJobStatus,
        createdAt: row.createdAtIso,
        nextRunTime: row.nextRunIso ?? undefined,
        lastRunTime: row.lastRunIso ?? undefined,
        lastStatus:
          row.lastStatus === 'success' || row.lastStatus === 'error' ? row.lastStatus : undefined,
        lastError: row.lastError ?? undefined,
        timeout: undefined,
      };
      this.jobs.set(job.id, job);
      if (job.status === 'active') this.armTimer(job);
    }
  }

  listJobSnapshots(): CronScheduledJobSnapshot[] {
    return Array.from(this.jobs.values()).map((j) => this.toSnapshot(j));
  }

  getToolDefinition(name: string): ToolDefinition | undefined {
    return this.toolMap.get(name);
  }

  hasTool(name: string): boolean {
    return this.toolMap.has(name);
  }

  dispose(): void {
    for (const j of this.jobs.values()) {
      if (j.timeout) clearTimeout(j.timeout);
    }
    this.jobs.clear();
  }

  async cron_list(status?: string, limit = 20): Promise<string> {
    let rows = Array.from(this.jobs.values());
    if (status) {
      rows = rows.filter((j) => j.status === status);
    }
    const jobs: CronScheduledJobSnapshot[] = rows.slice(0, limit).map((j) => this.toSnapshot(j));
    return JSON.stringify({ status: 'ok', count: jobs.length, jobs });
  }

  async cron_add(
    name: string,
    cronExpression: string,
    command: string,
    resolvedResources?: Record<string, unknown>
  ): Promise<string> {
    const jobName = String(name ?? '');
    const expr = String(cronExpression ?? '');
    const cmd = String(command ?? '');
    const trimmed = expr.trim();
    const probe = computeNextRunIso(trimmed, new Date());
    if (probe === undefined) {
      return JSON.stringify({
        status: 'error',
        message: 'Invalid cron expression or no future occurrence (UTC).',
        cronExpression: trimmed,
      });
    }

    const id = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const job: InternalJob = {
      id,
      name: jobName,
      cronExpression: trimmed,
      command: cmd,
      status: 'active',
      createdAt: new Date().toISOString(),
      nextRunTime: probe,
      resolvedResources,
    };
    this.jobs.set(id, job);
    this.armTimer(job);
    this.persistSnapshot(this.toSnapshot(job));
    return JSON.stringify({
      status: 'ok',
      id,
      name: jobName,
      cronExpression: trimmed,
      nextRunTime: job.nextRunTime,
    });
  }

  async cron_delete(id: string): Promise<string> {
    const job = this.jobs.get(id);
    if (!job) {
      return JSON.stringify({ status: 'error', message: `Job ${id} not found` });
    }
    this.clearTimer(job);
    this.jobs.delete(id);
    void deleteAgentBrainCronJob(id).catch((e) => {
      logger.error('AgentBrainCron', 'Delete persisted cron job failed', { id, err: String(e) });
    });
    return JSON.stringify({ status: 'ok', id });
  }

  async cron_pause(id: string): Promise<string> {
    const job = this.jobs.get(id);
    if (!job) {
      return JSON.stringify({ status: 'error', message: `Job ${id} not found` });
    }
    this.clearTimer(job);
    job.status = 'paused';
    job.nextRunTime = undefined;
    this.persistSnapshot(this.toSnapshot(job));
    return JSON.stringify({ status: 'ok', id });
  }

  async cron_resume(id: string): Promise<string> {
    const job = this.jobs.get(id);
    if (!job) {
      return JSON.stringify({ status: 'error', message: `Job ${id} not found` });
    }
    job.status = 'active';
    const next = computeNextRunIso(job.cronExpression, new Date());
    job.nextRunTime = next;
    this.armTimer(job);
    this.persistSnapshot(this.toSnapshot(job));
    return JSON.stringify({ status: 'ok', id, nextRunTime: job.nextRunTime });
  }

  async cron_run_now(id: string): Promise<string> {
    const job = this.jobs.get(id);
    if (!job) {
      return JSON.stringify({ status: 'error', message: `Job ${id} not found` });
    }
    await this.fireJob(job, 'manual');
    return JSON.stringify({ status: 'ok', id, triggered: 'now' });
  }

  private toSnapshot(j: InternalJob): CronScheduledJobSnapshot {
    return {
      id: j.id,
      name: j.name,
      cronExpression: j.cronExpression,
      command: j.command,
      status: j.status as CronJobStatus,
      resolvedResources: j.resolvedResources,
      nextRunTime: j.nextRunTime,
      lastRunTime: j.lastRunTime,
      lastStatus: j.lastStatus,
      lastError: j.lastError,
      createdAt: j.createdAt,
    };
  }

  private clearTimer(job: InternalJob): void {
    if (job.timeout) {
      clearTimeout(job.timeout);
      job.timeout = undefined;
    }
  }

  private armTimer(job: InternalJob): void {
    this.clearTimer(job);
    if (job.status !== 'active') return;
    const nextIso = job.nextRunTime ?? computeNextRunIso(job.cronExpression, new Date());
    if (!nextIso) return;
    job.nextRunTime = nextIso;
    const ms = scheduleDelayMs(nextIso, Date.now());
    job.timeout = delayThen(ms, () => {
      job.timeout = undefined;
      void this.fireJob(job, 'schedule').finally(() => {
        const still = this.jobs.get(job.id);
        if (still && still.status === 'active') {
          const after = computeNextRunIso(job.cronExpression, new Date());
          if (after) {
            job.nextRunTime = after;
            this.armTimer(job);
          }
        }
        const latest = this.jobs.get(job.id);
        if (latest) this.persistSnapshot(this.toSnapshot(latest));
      });
    });
  }

  private async fireJob(job: InternalJob, _reason: 'schedule' | 'manual'): Promise<void> {
    try {
      await this.opts.onJobTrigger(this.toSnapshot(job));
      job.lastRunTime = new Date().toISOString();
      job.lastStatus = 'success';
      job.lastError = undefined;
    } catch (e) {
      job.lastRunTime = new Date().toISOString();
      job.lastStatus = 'error';
      job.lastError = String(e);
    }
    this.persistSnapshot(this.toSnapshot(job));
  }
}
