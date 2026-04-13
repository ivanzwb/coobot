/**
 * Builds `@biosbot/agent-brain` SecuritySandbox `PermissionRule[]` from `agent_tool_permissions`
 * (same effective policy resolution as {@link agentToolPolicy}).
 */
import type { ActionCategory, PermissionLevel, PermissionRule } from '@biosbot/agent-brain';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '../../db';
import type { ToolPolicy } from '../../types';
import {
  BUILTIN_TOOL_NAMES,
  DEFAULT_BRAIN_INNATE_TOOL_POLICIES,
} from '../builtinToolPolicies.js';
import { agentToolPolicy } from '../agentToolPolicy.js';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rank(p: ToolPolicy): number {
  return p === 'DENY' ? 3 : p === 'ASK' ? 2 : 1;
}

function stricter(a: ToolPolicy, b: ToolPolicy): ToolPolicy {
  return rank(a) >= rank(b) ? a : b;
}

function specKey(action: ActionCategory, pattern?: string): string {
  return pattern ? `${action}\0${pattern}` : action;
}

function normSeg(s: string): string {
  return s.normalize('NFKC').trim().toLowerCase();
}

/** `skill:segment:logical` from DB / hub (segment is usually skill display name). */
function parseSkillHubKey(toolName: string): { segment: string; logical: string } | null {
  if (!toolName.startsWith('skill:')) return null;
  const rest = toolName.slice('skill:'.length);
  const idx = rest.indexOf(':');
  if (idx <= 0) return null;
  return { segment: rest.slice(0, idx), logical: rest.slice(idx + 1) };
}

/** Patterns so `skill.id.tool` / `skill.name.tool` match DB rows keyed by display name. */
function skillExecSpecsFromDbKey(
  toolName: string,
  assignedSkills: { id: string; name: string }[]
): Array<{ action: ActionCategory; pattern: string }> {
  const parsed = parseSkillHubKey(toolName);
  if (!parsed) {
    return [{ action: 'skill_exec', pattern: `/${escapeRegex(toolName)}/` }];
  }
  const patterns = new Set<string>();
  const add = (seg: string, logical: string) => {
    patterns.add(`/${escapeRegex(`skill:${seg}:${logical}`)}/`);
  };
  add(parsed.segment, parsed.logical);
  const ns = normSeg(parsed.segment);
  for (const s of assignedSkills) {
    if (normSeg(s.id) === ns || normSeg(s.name) === ns) {
      add(s.id, parsed.logical);
      if (normSeg(s.name) !== normSeg(s.id)) add(s.name, parsed.logical);
    }
  }
  return [...patterns].map((pattern) => ({ action: 'skill_exec' as const, pattern }));
}

/** DB / UI `tool_name` → sandbox rule targets (action + optional target pattern). */
export function toolNameToSandboxSpecs(
  toolName: string
): Array<{ action: ActionCategory; pattern?: string }> {
  if (toolName.startsWith('skill:')) {
    return [{ action: 'skill_exec', pattern: `/${escapeRegex(toolName)}/` }];
  }

  const builtin: Record<string, ActionCategory[]> = {
    read_file: ['fs_read'],
    list_directory: ['fs_read'],
    write_file: ['fs_write'],
    edit_file: ['fs_edit'],
    http_request: ['web_fetch'],
    web_scrape: ['web_fetch'],
    http_get: ['web_fetch'],
    http_post: ['web_fetch'],
    http_fetch_html: ['web_fetch'],
    web_search: ['web_search'],
    exec_shell: ['cmd_exec', 'cmd_run', 'cmd_bg'],
  };
  const m = builtin[toolName];
  if (m) return m.map((action) => ({ action }));

  const innateToAction: Record<string, ActionCategory> = {
    fs_delete: 'fs_delete',
    fs_mkdir: 'fs_mkdir',
    fs_exists: 'fs_read',
    fs_stat: 'fs_read',
    fs_search: 'fs_read',
    fs_grep: 'fs_read',
  };
  if (toolName in innateToAction) {
    return [{ action: innateToAction[toolName]! }];
  }

  return [];
}

/**
 * Load merged sandbox rules for an agent. Later entries win on conflict only within the same
 * permission tier batching here: ALLOW first, then ASK, then DENY so DENY overrides when scanning
 * reverse order in SecuritySandbox.
 */
export async function loadBrainSandboxRulesForAgent(agentId: string): Promise<PermissionRule[]> {
  const rows = await db
    .select({
      toolName: schema.agentToolPermissions.toolName,
    })
    .from(schema.agentToolPermissions)
    .where(eq(schema.agentToolPermissions.agentId, agentId));

  const assignedSkills = await db
    .select({ id: schema.skills.id, name: schema.skills.name })
    .from(schema.agentSkills)
    .innerJoin(schema.skills, eq(schema.agentSkills.skillId, schema.skills.id))
    .where(and(eq(schema.agentSkills.agentId, agentId), eq(schema.skills.enabled, true)));

  const keys = new Set<string>();
  for (const r of rows) keys.add(r.toolName);
  for (const b of BUILTIN_TOOL_NAMES) keys.add(b);
  for (const k of Object.keys(DEFAULT_BRAIN_INNATE_TOOL_POLICIES)) keys.add(k);

  const merged = new Map<
    string,
    { action: ActionCategory; pattern?: string; policy: ToolPolicy }
  >();

  for (const key of keys) {
    const specs = key.startsWith('skill:')
      ? skillExecSpecsFromDbKey(key, assignedSkills)
      : toolNameToSandboxSpecs(key);
    if (specs.length === 0) continue;

    const policy = await agentToolPolicy.resolveToolPolicy(agentId, key);
    for (const spec of specs) {
      const sk = specKey(spec.action, spec.pattern);
      const prev = merged.get(sk);
      const next = prev ? stricter(prev.policy, policy) : policy;
      merged.set(sk, { action: spec.action, pattern: spec.pattern, policy: next });
    }
  }

  const allow: PermissionRule[] = [];
  const ask: PermissionRule[] = [];
  const deny: PermissionRule[] = [];

  for (const v of merged.values()) {
    const rule: PermissionRule = {
      action: v.action,
      ...(v.pattern ? { pattern: v.pattern } : {}),
      permission: v.policy as PermissionLevel,
    };
    if (v.policy === 'ALLOW') allow.push(rule);
    else if (v.policy === 'ASK') ask.push(rule);
    else deny.push(rule);
  }

  return [...allow, ...ask, ...deny];
}
