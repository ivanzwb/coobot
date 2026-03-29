import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { configManager } from '../services/configManager';
import * as schema from './schema';
import path from 'path';
import fs from 'fs';

const workspacePath = configManager.getWorkspacePath();
const databaseDir = path.join(workspacePath, 'database');
if (!fs.existsSync(databaseDir)) {
  fs.mkdirSync(databaseDir, { recursive: true });
}
const sqlitePath = path.join(databaseDir, 'biosbot.db');
const sqlite = new Database(sqlitePath);
sqlite.pragma('journal_mode = WAL');

export const db = drizzle(sqlite, { schema });

export type Agent = typeof schema.agents.$inferSelect;
export type NewAgent = typeof schema.agents.$inferInsert;
export type Task = typeof schema.tasks.$inferSelect;
export type NewTask = typeof schema.tasks.$inferInsert;
export type Skill = typeof schema.skills.$inferSelect;
export type KnowledgeFile = typeof schema.knowledgeFiles.$inferSelect;
export type SessionMessage = typeof schema.sessionMemory.$inferSelect;
export type LongTermMemory = typeof schema.longTermMemory.$inferSelect;
export type ScheduledJob = typeof schema.scheduledJobs.$inferSelect;
export type ModelConfig = typeof schema.modelConfigs.$inferSelect;

export { schema };