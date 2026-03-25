import * as path from 'path';
import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import type { ToolPolicy, PermissionResult } from '../types';
import { configManager } from './configManager';

export class SecuritySandbox {
  private blockedPaths = [
    '/etc',
    '/sys',
    '/proc',
    'C:\\Windows',
    'C:\\System32',
  ];

  private defaultToolPolicies: Record<string, ToolPolicy> = {
    read_file: 'ASK',
    edit_file: 'ASK',
    write_file: 'ASK',
    list_directory: 'ALLOW',
    exec_shell: 'DENY',
    http_request: 'ASK',
    clipboard: 'ASK',
    system_info: 'ALLOW',
  };

  async intercept(agentId: string, tool: string, args: Record<string, unknown>): Promise<PermissionResult> {
    const policy = await this.getPolicy(agentId, tool);
    
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

  private async getPolicy(agentId: string, toolName: string): Promise<ToolPolicy> {
    const permissions = await db.select()
      .from(schema.agentToolPermissions)
      .where(
        eq(schema.agentToolPermissions.agentId, agentId)
      );

    const toolPerm = permissions.find(p => p.toolName === toolName);
    
    if (toolPerm) {
      return toolPerm.policy as ToolPolicy;
    }

    return this.defaultToolPolicies[toolName] || 'DENY';
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
      case 'read_file':
      case 'write_file':
        return typeof args.path === 'string' && args.path.length > 0;
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

  getAllowedCommands(agentId: string): string[] {
    return ['ls', 'cat', 'grep', 'find', 'echo'];
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