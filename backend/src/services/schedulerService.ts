import { v4 as uuidv4 } from 'uuid';
import cron from 'node-cron';
import { db, schema } from '../db';
import { eq, lte } from 'drizzle-orm';
import type { JobStatus, ScheduledJobConfig } from '../types';
import type { ScheduledJob } from '../db';
import { taskOrchestrator } from './taskOrchestrator';

export class SchedulerService {
  private activeJobs: Map<string, cron.ScheduledTask> = new Map();
  private scanIntervalMs: number = 60000;
  private scanInterval!: NodeJS.Timeout;
  private isRunning: boolean = false;

  start(): void {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.loadJobs();
    this.scanInterval = setInterval(() => this.tick(), this.scanIntervalMs);
  }

  stop(): void {
    this.isRunning = false;
    
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
    }

    for (const job of this.activeJobs.values()) {
      job.stop();
    }
    this.activeJobs.clear();
  }

  private async loadJobs(): Promise<void> {
    const jobs = await db.select()
      .from(schema.scheduledJobs)
      .where(eq(schema.scheduledJobs.enabled, true));

    for (const job of jobs) {
      this.registerJob(job);
    }
  }

  async registerJob(job: ScheduledJob): Promise<void> {
    if (!cron.validate(job.cronExpression)) {
      throw new Error(`Invalid cron expression: ${job.cronExpression}`);
    }

    const cronJob = cron.schedule(job.cronExpression, async () => {
      await this.triggerJob(job);
    }, {
      timezone: job.timezone || 'UTC',
    });

    this.activeJobs.set(job.id, cronJob);
  }

  async unregisterJob(jobId: string): Promise<void> {
    const job = this.activeJobs.get(jobId);
    if (job) {
      job.stop();
      this.activeJobs.delete(jobId);
    }
  }

  async tick(): Promise<void> {
    const now = new Date();
    
    const dueJobs = await db.select()
      .from(schema.scheduledJobs)
      .where(
        eq(schema.scheduledJobs.enabled, true)
      );

    for (const job of dueJobs) {
      if (new Date(job.nextRunAt) <= now) {
        await this.triggerJob(job);
        await this.updateNextRun(job.id, job.cronExpression);
      }
    }
  }

  async triggerJob(job: ScheduledJob): Promise<void> {
    const actualStartTime = new Date();
    let status: JobStatus = 'SUCCESS';
    let taskId: string | null = null;
    let errorMessage: string | null = null;

    try {
      const template: ScheduledJobConfig = JSON.parse(job.taskTemplateJson);
      
      const task = await taskOrchestrator.createTask(
        {
          content: template.prompt,
          attachments: [],
        },
        'scheduled'
      );
      
      taskId = task.id;
    } catch (error) {
      status = 'FAILED';
      errorMessage = String(error);
    }

    await db.insert(schema.jobExecutionLogs).values({
      jobId: job.id,
      scheduledTime: job.nextRunAt,
      actualStartTime,
      actualEndTime: new Date(),
      triggeredTaskId: taskId,
      status,
      errorMessage,
      createdAt: new Date(),
    });

    await db.update(schema.scheduledJobs)
      .set({ lastRunAt: actualStartTime })
      .where(eq(schema.scheduledJobs.id, job.id));
  }

  private updateNextRun(jobId: string, cronExpression: string): void {
    const now = new Date();
    const intervals = cronExpression.split(' ');
    
    let nextDate = new Date(now);
    nextDate.setMinutes(nextDate.getMinutes() + 1);
    
    db.update(schema.scheduledJobs)
      .set({ nextRunAt: nextDate })
      .where(eq(schema.scheduledJobs.id, jobId));
  }

  async createJob(params: {
    name: string;
    description?: string;
    cronExpression: string;
    taskTemplate: ScheduledJobConfig;
    timezone?: string;
    concurrencyPolicy?: 'FORBID' | 'ALLOW' | 'REPLACE';
  }): Promise<ScheduledJob> {
    const id = uuidv4();
    const nextRunAt = this.calculateNextRun(params.cronExpression);
    
    const job: ScheduledJob = {
      id,
      name: params.name,
      description: params.description || '',
      cronExpression: params.cronExpression,
      timezone: params.timezone || 'UTC',
      taskTemplateJson: JSON.stringify(params.taskTemplate),
      enabled: true,
      concurrencyPolicy: params.concurrencyPolicy || 'FORBID',
      lastRunAt: null as unknown as Date,
      nextRunAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await db.insert(schema.scheduledJobs).values({
      id: job.id,
      name: job.name,
      description: job.description,
      cronExpression: job.cronExpression,
      timezone: job.timezone,
      taskTemplateJson: job.taskTemplateJson,
      enabled: job.enabled,
      concurrencyPolicy: job.concurrencyPolicy,
      lastRunAt: job.lastRunAt,
      nextRunAt: job.nextRunAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    });

    await this.registerJob(job);

    return job;
  }

  private calculateNextRun(cronExpression: string): Date {
    const now = new Date();
    const nextDate = new Date(now);
    nextDate.setMinutes(nextDate.getMinutes() + 1);
    return nextDate;
  }

  async getJobs(): Promise<ScheduledJob[]> {
    return await db.select().from(schema.scheduledJobs) as unknown as ScheduledJob[];
  }

  async getJob(jobId: string): Promise<ScheduledJob | null> {
    const jobs = await db.select()
      .from(schema.scheduledJobs)
      .where(eq(schema.scheduledJobs.id, jobId));
    return jobs[0] || null;
  }

  async updateJob(jobId: string, updates: Partial<ScheduledJob>): Promise<void> {
    await this.unregisterJob(jobId);
    
    await db.update(schema.scheduledJobs)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(schema.scheduledJobs.id, jobId));

    if (updates.enabled !== false) {
      const job = await this.getJob(jobId);
      if (job) {
        await this.registerJob(job);
      }
    }
  }

  async deleteJob(jobId: string): Promise<void> {
    await this.unregisterJob(jobId);
    
    await db.delete(schema.scheduledJobs)
      .where(eq(schema.scheduledJobs.id, jobId));
  }

  async getExecutionLogs(jobId: string): Promise<Record<string, unknown>[]> {
    return await db.select()
      .from(schema.jobExecutionLogs)
      .where(eq(schema.jobExecutionLogs.jobId, jobId));
  }

  async triggerNow(jobId: string): Promise<string | null> {
    const job = await this.getJob(jobId);
    if (!job) return null;

    const task = await taskOrchestrator.createTask(
      {
        content: JSON.parse(job.taskTemplateJson).prompt,
        attachments: [],
      },
      'immediate'
    );

    return task.id;
  }

  getStatus(): { running: boolean; scanIntervalActive: boolean; executionSlots: { used: number; total: number; available: number } } {
    return {
      running: this.isRunning,
      scanIntervalActive: this.isRunning && !!this.scanInterval,
      executionSlots: {
        used: this.activeJobs.size,
        total: 10,
        available: Math.max(0, 10 - this.activeJobs.size),
      },
    };
  }
}

export const schedulerService = new SchedulerService();