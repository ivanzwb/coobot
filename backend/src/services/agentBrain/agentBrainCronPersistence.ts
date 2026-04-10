import { db, schema } from '../../db/index.js';
import { eq } from 'drizzle-orm';
import type { CronScheduledJobSnapshot } from './cronTypes.js';

export type AgentBrainCronJobRow = typeof schema.agentBrainCronJobs.$inferSelect;

function snapshotToInsert(s: CronScheduledJobSnapshot) {
  return {
    id: s.id,
    name: s.name ?? '',
    cronExpression: s.cronExpression,
    command: s.command ?? '',
    status: s.status,
    nextRunIso: s.nextRunTime ?? null,
    lastRunIso: s.lastRunTime ?? null,
    lastStatus: s.lastStatus ?? null,
    lastError: s.lastError ?? null,
    createdAtIso: s.createdAt,
  };
}

export async function saveAgentBrainCronJob(s: CronScheduledJobSnapshot): Promise<void> {
  const row = snapshotToInsert(s);
  await db
    .insert(schema.agentBrainCronJobs)
    .values(row)
    .onConflictDoUpdate({
      target: schema.agentBrainCronJobs.id,
      set: {
        name: row.name,
        cronExpression: row.cronExpression,
        command: row.command,
        status: row.status,
        nextRunIso: row.nextRunIso,
        lastRunIso: row.lastRunIso,
        lastStatus: row.lastStatus,
        lastError: row.lastError,
      },
    });
}

export async function deleteAgentBrainCronJob(id: string): Promise<void> {
  await db.delete(schema.agentBrainCronJobs).where(eq(schema.agentBrainCronJobs.id, id));
}

export async function loadAllAgentBrainCronJobRows(): Promise<AgentBrainCronJobRow[]> {
  return db.select().from(schema.agentBrainCronJobs);
}
