import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

const sqlite = new Database(process.env.DB_PATH || './data/biosbot.db');
sqlite.pragma('journal_mode = WAL');

export const db = drizzle(sqlite, { schema });

export type Agent = typeof schema.agents.$inferSelect;
export type NewAgent = typeof schema.agents.$inferInsert;
export type Task = typeof schema.tasks.$inferSelect;
export type NewTask = typeof schema.tasks.$inferInsert;
export type Skill = typeof schema.skills.$inferSelect;
export type Prompt = typeof schema.prompts.$inferSelect;
export type KnowledgeFile = typeof schema.knowledgeFiles.$inferSelect;
export type SessionMessage = typeof schema.sessionMemory.$inferSelect;
export type LongTermMemory = typeof schema.longTermMemory.$inferSelect;
export type ScheduledJob = typeof schema.scheduledJobs.$inferSelect;
export type ModelConfig = typeof schema.modelConfigs.$inferSelect;

export { schema };