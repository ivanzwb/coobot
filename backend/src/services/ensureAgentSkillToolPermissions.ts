import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import { skillToolHubKey } from './skillToolNames.js';

/**
 * After binding a skill: for each manifest tool, ensure an `agent_tool_permissions` row exists
 * with Hub canonical `tool_name` (`skillToolHubKey`); default policy ASK if inserted.
 */
export async function ensureAgentSkillToolPermissions(
  agentId: string,
  skillDisplayName: string,
  toolsManifest: { name?: unknown }[]
): Promise<void> {
  const rows = await db
    .select({ toolName: schema.agentToolPermissions.toolName })
    .from(schema.agentToolPermissions)
    .where(eq(schema.agentToolPermissions.agentId, agentId));

  const existing = new Set(rows.map((r) => r.toolName));

  for (const tool of toolsManifest) {
    const raw = typeof tool.name === 'string' ? tool.name : '';
    if (!raw) continue;

    const canonical = skillToolHubKey(skillDisplayName, raw);
    if (existing.has(canonical)) continue;

    await db.insert(schema.agentToolPermissions).values({
      agentId,
      toolName: canonical,
      policy: 'ASK',
      updatedAt: new Date(),
    });
    existing.add(canonical);
  }
}
