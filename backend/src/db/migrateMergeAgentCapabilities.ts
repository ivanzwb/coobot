import Database from 'better-sqlite3';

/**
 * Merges legacy `agent_capabilities` into `agents` and drops the old table.
 * Safe to run multiple times (idempotent).
 */
export function migrateMergeAgentCapabilities(sqlite: InstanceType<typeof Database>): void {
  const tableInfo = sqlite.prepare('PRAGMA table_info(agents)').all() as { name: string }[];
  const colNames = new Set(tableInfo.map((c) => c.name));

  if (!colNames.has('role_prompt')) {
    sqlite.exec(`ALTER TABLE agents ADD COLUMN role_prompt TEXT`);
  }
  if (!colNames.has('behavior_rules')) {
    sqlite.exec(`ALTER TABLE agents ADD COLUMN behavior_rules TEXT`);
  }
  if (!colNames.has('capability_boundary')) {
    sqlite.exec(`ALTER TABLE agents ADD COLUMN capability_boundary TEXT`);
  }
  if (!colNames.has('last_capability_heartbeat')) {
    sqlite.exec(`ALTER TABLE agents ADD COLUMN last_capability_heartbeat INTEGER`);
  }
  if (!colNames.has('capability_status')) {
    sqlite.exec(`ALTER TABLE agents ADD COLUMN capability_status TEXT DEFAULT 'OFFLINE'`);
  }

  const capTable = sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='agent_capabilities'`)
    .get() as { name: string } | undefined;

  if (!capTable) {
    return;
  }

  sqlite.exec(`
    UPDATE agents SET
      role_prompt = COALESCE((SELECT role_prompt FROM agent_capabilities WHERE agent_id = agents.id), role_prompt),
      behavior_rules = COALESCE((SELECT behavior_rules FROM agent_capabilities WHERE agent_id = agents.id), behavior_rules),
      capability_boundary = COALESCE((SELECT capability_boundary FROM agent_capabilities WHERE agent_id = agents.id), capability_boundary),
      last_capability_heartbeat = COALESCE((SELECT last_heartbeat FROM agent_capabilities WHERE agent_id = agents.id), last_capability_heartbeat),
      capability_status = COALESCE((SELECT status FROM agent_capabilities WHERE agent_id = agents.id), capability_status)
    WHERE EXISTS (SELECT 1 FROM agent_capabilities WHERE agent_id = agents.id);
  `);

  sqlite.exec('DROP TABLE IF EXISTS agent_capabilities');
}
