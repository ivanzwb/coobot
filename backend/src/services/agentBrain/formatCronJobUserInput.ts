import type { CronScheduledJobSnapshot } from './cronTypes.js';

/**
 * Ported from agent-brain demo `demo/src/format-cron-job-input.ts`.
 * Builds the user message for scheduled runs (e.g. enqueued as a Coobot task).
 */
export function formatCronJobUserInput(job: CronScheduledJobSnapshot): string {
  const header = `[Scheduled job: ${job.name}] [jobId=${job.id}]`;
  const res =
    job.resolvedResources && Object.keys(job.resolvedResources).length > 0
      ? `\n[Resolved resources — do not ask the user to re-supply these]\n${JSON.stringify(job.resolvedResources, null, 2)}\n`
      : '\n';
  return `${header}${res}\n[Task]\n${job.command}`;
}
