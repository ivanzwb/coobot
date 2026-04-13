/**
 * Resolves `agent_tool_permissions` + code defaults for AgentBrain SecuritySandbox rules
 * ({@link loadBrainSandboxRulesForAgent}).
 */
import { db, schema } from '../db';
import { and, eq } from 'drizzle-orm';
import type { ToolPolicy } from '../types';
import { DEFAULT_BRAIN_INNATE_TOOL_POLICIES, DEFAULT_BUILTIN_TOOL_POLICIES } from './builtinToolPolicies.js';
import { resolveSkillToolHubName, skillToolHubKey } from './skillToolNames.js';

class AgentToolPolicy {
  private defaultToolPolicies: Record<string, ToolPolicy> = {
    ...DEFAULT_BUILTIN_TOOL_POLICIES,
    ...DEFAULT_BRAIN_INNATE_TOOL_POLICIES,
  };

  /** Effective policy for a canonical tool name (same resolution as sandbox rule builder). */
  async resolveToolPolicy(
    agentId: string,
    toolName: string,
    alternateToolNames?: string[]
  ): Promise<ToolPolicy> {
    return this.getPolicy(agentId, toolName, alternateToolNames);
  }

  private normPolicyKey(s: string): string {
    return s.normalize('NFKC').trim().toLowerCase();
  }

  private findPermissionRow(
    permissions: { toolName: string; policy: string }[],
    candidate: string
  ): { toolName: string; policy: string } | undefined {
    const want = this.normPolicyKey(candidate);
    return permissions.find((p) => this.normPolicyKey(p.toolName) === want);
  }

  private async resolveAssignedSkillHubKey(
    agentId: string,
    segment: string,
    logical: string
  ): Promise<string | null> {
    if (!segment || !logical) return null;

    const rows = await db
      .select({ id: schema.skills.id, name: schema.skills.name })
      .from(schema.agentSkills)
      .innerJoin(schema.skills, eq(schema.agentSkills.skillId, schema.skills.id))
      .where(and(eq(schema.agentSkills.agentId, agentId), eq(schema.skills.enabled, true)));

    const ns = this.normPolicyKey(segment);
    for (const r of rows) {
      if (this.normPolicyKey(r.id) === ns || this.normPolicyKey(r.name) === ns) {
        return skillToolHubKey(r.name, logical);
      }
    }
    return null;
  }

  private async resolveSkillDotToolToHubKey(agentId: string, dotName: string): Promise<string | null> {
    if (!dotName.startsWith('skill.')) return null;
    const rest = dotName.slice('skill.'.length);
    const idx = rest.lastIndexOf('.');
    if (idx <= 0) return null;
    const seg = rest.slice(0, idx);
    const logical = rest.slice(idx + 1);
    if (!logical) return null;

    return this.resolveAssignedSkillHubKey(agentId, seg, logical);
  }

  private async expandPolicyCandidates(
    agentId: string,
    toolName: string,
    alternateToolNames?: string[]
  ): Promise<string[]> {
    const raw = [toolName, ...(alternateToolNames || [])].filter(
      (n, i, a) => typeof n === 'string' && n.length > 0 && a.indexOf(n) === i
    );

    const out: string[] = [];
    const seen = new Set<string>();
    const add = (s: string | null | undefined) => {
      if (!s || seen.has(s)) return;
      seen.add(s);
      out.push(s);
    };

    for (const n of raw) add(n);

    for (const n of raw) {
      if (n.startsWith('skill:')) {
        add(resolveSkillToolHubName(n));
        const m = n.match(/^skill:([^:]+):(.+)$/);
        if (m) {
          const mapped = await this.resolveAssignedSkillHubKey(agentId, m[1], m[2]);
          add(mapped);
        }
      }
      if (n.startsWith('skill.')) {
        const rest = n.slice('skill.'.length);
        const idx = rest.lastIndexOf('.');
        if (idx > 0) {
          const seg = rest.slice(0, idx);
          const logical = rest.slice(idx + 1);
          add(skillToolHubKey(seg, logical));
        }
        const mapped = await this.resolveSkillDotToolToHubKey(agentId, n);
        add(mapped);
      }
    }

    return out;
  }

  private async getPolicy(
    agentId: string,
    toolName: string,
    alternateToolNames?: string[]
  ): Promise<ToolPolicy> {
    const permissions = await db
      .select()
      .from(schema.agentToolPermissions)
      .where(eq(schema.agentToolPermissions.agentId, agentId));

    const candidates = await this.expandPolicyCandidates(agentId, toolName, alternateToolNames);

    for (const name of candidates) {
      const toolPerm = this.findPermissionRow(permissions, name);
      if (toolPerm) {
        return toolPerm.policy as ToolPolicy;
      }
    }

    for (const name of candidates) {
      if (this.defaultToolPolicies[name]) {
        return this.defaultToolPolicies[name];
      }
    }

    if (candidates.some((n) => n.startsWith('skill:'))) {
      return 'ASK';
    }

    return 'DENY';
  }
}

export const agentToolPolicy = new AgentToolPolicy();
