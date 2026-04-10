import Database from 'better-sqlite3';

/** Idempotent: AgentBrain `cron_*` jobs persist here so they survive restarts and appear in the UI. */
export function migrateAgentBrainCronJobs(sqlite: InstanceType<typeof Database>): void {
  sqlite.exec(`
CREATE TABLE IF NOT EXISTS agent_brain_cron_jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  cron_expression TEXT NOT NULL,
  command TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  next_run_iso TEXT,
  last_run_iso TEXT,
  last_status TEXT,
  last_error TEXT,
  created_at_iso TEXT NOT NULL
);
`);
}
