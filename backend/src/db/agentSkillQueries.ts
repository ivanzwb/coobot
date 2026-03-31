import { db, schema } from './index.js';
import { eq, inArray } from 'drizzle-orm';

/** Skill display names bound to an agent (via `agent_skills` → `skills`). */
export async function getSkillNamesForAgent(agentId: string): Promise<string[]> {
  const rows = await db
    .select({ name: schema.skills.name })
    .from(schema.agentSkills)
    .innerJoin(schema.skills, eq(schema.agentSkills.skillId, schema.skills.id))
    .where(eq(schema.agentSkills.agentId, agentId));
  return rows.map((r) => r.name);
}

export async function getSkillNamesByAgentIds(agentIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  for (const id of agentIds) {
    map.set(id, []);
  }
  if (agentIds.length === 0) return map;

  const rows = await db
    .select({
      agentId: schema.agentSkills.agentId,
      name: schema.skills.name,
    })
    .from(schema.agentSkills)
    .innerJoin(schema.skills, eq(schema.agentSkills.skillId, schema.skills.id))
    .where(inArray(schema.agentSkills.agentId, agentIds));

  for (const r of rows) {
    map.get(r.agentId)?.push(r.name);
  }
  return map;
}
