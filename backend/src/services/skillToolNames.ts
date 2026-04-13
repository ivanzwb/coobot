/**
 * Canonical permission / sandbox keys for skill tools: `skill:{skillDisplayName}:{logicalName}`.
 * Models sometimes embed extra `skill:...` segments in the logical segment — normalize here.
 */

export function normalizeSkillToolLogicalName(raw: string): string {
  let t = raw.trim();
  if (!t.toLowerCase().startsWith('skill:')) return t;
  const parts = t.split(':').filter((p) => p.length > 0);
  if (parts.length >= 2 && parts[0].toLowerCase() === 'skill') {
    return parts[parts.length - 1] || t;
  }
  return t;
}

/** Map a possibly malformed API tool id to the Hub registration key. */
export function resolveSkillToolHubName(toolName: string): string {
  const m = toolName.match(/^skill:([^:]+):(.+)$/);
  if (!m) return toolName;
  const logical = normalizeSkillToolLogicalName(m[2]);
  return `skill:${m[1]}:${logical}`;
}

/** Hub registration + `agent_tool_permissions.tool_name` must use this key (manifest `name` may embed extra `skill:` segments). */
export function skillToolHubKey(skillDisplayName: string, toolNameFromManifest: string): string {
  return `skill:${skillDisplayName}:${normalizeSkillToolLogicalName(toolNameFromManifest)}`;
}
