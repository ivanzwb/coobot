import { v4 as uuidv4 } from 'uuid';
import { eventBus } from './eventBus.js';
import { PermissionDeniedError } from './permissionErrors.js';
import { persistAgentToolPolicy } from './agentToolPermissionPersistence.js';

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  try {
    return JSON.parse(
      JSON.stringify(args, (key, value) => {
        if (typeof key === 'string' && ['password', 'secret', 'token', 'apikey', 'api_key'].includes(key.toLowerCase())) {
          return '[REDACTED]';
        }
        return value;
      })
    ) as Record<string, unknown>;
  } catch {
    return {};
  }
}

interface PendingAuthRequest {
  authId: string;
  agentId: string;
  toolName: string;
  args: Record<string, unknown>;
  taskId?: string;
  timeout: NodeJS.Timeout;
  resolve: () => void;
  reject: (err: Error) => void;
}

const pendingAuthRequests = new Map<string, PendingAuthRequest>();

export class AuthService {
  private defaultTimeoutMs = 10 * 60 * 1000;

  /**
   * Blocks until the user allows via POST /v1/auth/decision.
   * Rejects with PermissionDeniedError on deny or timeout.
   */
  waitForAuthorization(
    agentId: string,
    toolName: string,
    args: Record<string, unknown>,
    taskId?: string
  ): Promise<void> {
    const authId = uuidv4();

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const pending = pendingAuthRequests.get(authId);
        if (!pending) return;
        pendingAuthRequests.delete(authId);
        pending.reject(new PermissionDeniedError('Authorization request timed out'));
      }, this.defaultTimeoutMs);

      pendingAuthRequests.set(authId, {
        authId,
        agentId,
        toolName,
        args,
        taskId,
        timeout,
        resolve: () => {
          clearTimeout(timeout);
          pendingAuthRequests.delete(authId);
          resolve();
        },
        reject: (err: Error) => {
          clearTimeout(timeout);
          pendingAuthRequests.delete(authId);
          reject(err);
        },
      });

      eventBus.broadcast({
        type: 'AUTH_REQUEST',
        data: {
          authId,
          agentId,
          tool: toolName,
          toolName,
          args: sanitizeArgs(args),
          taskId,
          expiresAt: new Date(Date.now() + this.defaultTimeoutMs).toISOString(),
        },
      });
    });
  }

  async handleDecision(
    authId: string,
    allow: boolean,
    persistPolicy: boolean = false,
    policyForAgent?: 'DENY' | 'ASK' | 'ALLOW'
  ): Promise<void> {
    const pending = pendingAuthRequests.get(authId);
    if (!pending) {
      throw new Error('Authorization request not found or expired');
    }

    clearTimeout(pending.timeout);
    pendingAuthRequests.delete(authId);

    if (persistPolicy && policyForAgent) {
      await persistAgentToolPolicy(pending.agentId, pending.toolName, policyForAgent);
    }

    if (allow) {
      pending.resolve();
    } else {
      pending.reject(new PermissionDeniedError('User denied tool execution'));
    }
  }

  getPendingSummaries(): { authId: string; agentId: string; toolName: string; taskId?: string }[] {
    return Array.from(pendingAuthRequests.values()).map((p) => ({
      authId: p.authId,
      agentId: p.agentId,
      toolName: p.toolName,
      taskId: p.taskId,
    }));
  }
}

export const authService = new AuthService();
