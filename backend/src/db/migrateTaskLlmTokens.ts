import Database from 'better-sqlite3';

/** Per-task LLM usage (OpenAI-style prompt/completion/total). */
export function migrateTaskLlmTokens(sqlite: InstanceType<typeof Database>): void {
  const cols = sqlite.prepare('PRAGMA table_info(tasks)').all() as { name: string }[];
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('llm_prompt_tokens')) {
    sqlite.exec('ALTER TABLE tasks ADD COLUMN llm_prompt_tokens INTEGER');
  }
  if (!names.has('llm_completion_tokens')) {
    sqlite.exec('ALTER TABLE tasks ADD COLUMN llm_completion_tokens INTEGER');
  }
  if (!names.has('llm_total_tokens')) {
    sqlite.exec('ALTER TABLE tasks ADD COLUMN llm_total_tokens INTEGER');
  }
}
