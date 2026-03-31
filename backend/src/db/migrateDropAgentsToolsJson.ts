import Database from 'better-sqlite3';

/**
 * Removes legacy `agents.tools_json` — builtin tools are always all registered hub tools in code.
 * Idempotent; requires SQLite 3.35+ for DROP COLUMN.
 */
export function migrateDropAgentsToolsJson(sqlite: InstanceType<typeof Database>): void {
  const tableInfo = sqlite.prepare('PRAGMA table_info(agents)').all() as { name: string }[];
  if (!tableInfo.some((c) => c.name === 'tools_json')) {
    return;
  }
  try {
    sqlite.exec('ALTER TABLE agents DROP COLUMN tools_json');
  } catch (e) {
    console.warn(
      '[migrate] ALTER TABLE agents DROP COLUMN tools_json failed (SQLite may be < 3.35). Leave column unused in app.',
      e
    );
  }
}
