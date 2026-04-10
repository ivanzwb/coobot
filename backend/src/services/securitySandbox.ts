import * as path from 'path';
import { db, schema } from '../db';
import { and, eq } from 'drizzle-orm';
import type { ToolPolicy, PermissionResult } from '../types';
import { configManager } from './configManager';
import { DEFAULT_BRAIN_INNATE_TOOL_POLICIES, DEFAULT_BUILTIN_TOOL_POLICIES } from './builtinToolPolicies.js';
import { resolveSkillToolHubName, skillToolHubKey } from './skillToolNames.js';

export class SecuritySandbox {
  private blockedPaths = [
    '/etc',
    '/sys',
    '/proc',
    'C:\\Windows',
    'C:\\System32',
  ];

  /** 表无记录时使用：内置 7 项来自代码；其余工具同策略。 */
  private defaultToolPolicies: Record<string, ToolPolicy> = {
    ...DEFAULT_BUILTIN_TOOL_POLICIES,
    ...DEFAULT_BRAIN_INNATE_TOOL_POLICIES,
    load_more: 'ALLOW',
  };

  /**
   * @param tool Primary tool id (canonical Hub name).
   * @param alternateToolNames Extra ids to match DB rows (e.g. legacy malformed `skill:*` names from the model).
   */
  async intercept(
    agentId: string,
    tool: string,
    args: Record<string, unknown>,
    alternateToolNames?: string[]
  ): Promise<PermissionResult> {
    const policy = await this.getPolicy(agentId, tool, alternateToolNames);
    
    const permResult: PermissionResult = {
      policy,
      requiresUserConfirmation: policy === 'ASK',
    };

    if (policy === 'DENY') {
      throw new PermissionDeniedError(`Tool ${tool} is denied for agent ${agentId}`);
    }

    if (policy === 'ASK') {
      return permResult;
    }

    this.validateToolPath(args);
    
    return { policy: 'ALLOW' };
  }

  /**
   * AgentBrain 使用 `skill.{segment}.{logical}`；权限表存 `skill:{skill.name}:{logical}`。
   * segment 可能是 skills.id（目录名）或 name，与配置页上的键必须能对上。
   */
  private async resolveSkillDotToolToHubKey(
    agentId: string,
    dotName: string
  ): Promise<string | null> {
    if (!dotName.startsWith('skill.')) return null;
    const rest = dotName.slice('skill.'.length);
    const idx = rest.lastIndexOf('.');
    if (idx <= 0) return null;
    const seg = rest.slice(0, idx);
    const logical = rest.slice(idx + 1);
    if (!logical) return null;

    const rows = await db
      .select({ id: schema.skills.id, name: schema.skills.name })
      .from(schema.agentSkills)
      .innerJoin(schema.skills, eq(schema.agentSkills.skillId, schema.skills.id))
      .where(
        and(eq(schema.agentSkills.agentId, agentId), eq(schema.skills.enabled, true))
      );

    for (const r of rows) {
      if (r.id === seg || r.name === seg) {
        return skillToolHubKey(r.name, logical);
      }
    }
    return null;
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
    const permissions = await db.select()
      .from(schema.agentToolPermissions)
      .where(
        eq(schema.agentToolPermissions.agentId, agentId)
      );

    const candidates = await this.expandPolicyCandidates(agentId, toolName, alternateToolNames);

    for (const name of candidates) {
      const toolPerm = permissions.find((p) => p.toolName === name);
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

  private validateToolPath(args: Record<string, unknown>): void {
    if (args.path && typeof args.path === 'string') {
      const workspacePath = configManager.getWorkspacePath();
      const absPath = path.isAbsolute(args.path) 
        ? args.path 
        : path.join(workspacePath, args.path);

      for (const blocked of this.blockedPaths) {
        if (absPath.toLowerCase().startsWith(blocked.toLowerCase())) {
          throw new SecurityError(`Access to path ${blocked} is not allowed`);
        }
      }

      if (!absPath.startsWith(workspacePath)) {
        throw new SecurityError(`Path must be within workspace: ${workspacePath}`);
      }
    }
  }

  validateToolParams(tool: string, args: Record<string, unknown>): boolean {
    switch (tool) {
      case 'exec_shell':
        const dangerousChars = ['|', '&', ';', '`', '$', '(', ')', '{', '}', '\n', '\r'];
        return !dangerousChars.some(char => String(args.command).includes(char));
      case 'http_request':
        return typeof args.url === 'string' && args.url.startsWith('http');
      default:
        return true;
    }
  }

  getAllowedDomains(agentId: string): string[] {
    return ['api.openai.com', 'api.anthropic.com', 'localhost'];
  }
}

export class PermissionDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermissionDeniedError';
  }
}

export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityError';
  }
}

export const securitySandbox = new SecuritySandbox();