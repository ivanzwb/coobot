import * as path from 'path';
import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import type { ToolPolicy, PermissionResult } from '../types';
import { configManager } from './configManager';
import { DEFAULT_BUILTIN_TOOL_POLICIES } from './builtinToolPolicies.js';

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

    const candidates = [toolName, ...(alternateToolNames || [])].filter(
      (n, i, a) => n && a.indexOf(n) === i
    );

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