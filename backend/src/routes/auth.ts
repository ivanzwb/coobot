import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { securitySandbox } from '../services/index.js';

interface PendingAuthRequest {
  authId: string;
  agentId: string;
  toolName: string;
  args: Record<string, unknown>;
  taskId?: string;
  resolve: (value: { allowed: boolean; persistPolicy: boolean; policy?: string }) => void;
  reject: (reason?: unknown) => void;
  timeout: NodeJS.Timeout;
}

const pendingAuthRequests: Map<string, PendingAuthRequest> = new Map();

export class AuthService {
  private defaultTimeoutMs: number = 10 * 60 * 1000;

  async createAuthRequest(
    agentId: string,
    toolName: string,
    args: Record<string, unknown>,
    taskId?: string
  ): Promise<{ authId: string; requiresConfirmation: boolean }> {
    const authId = uuidv4();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(async () => {
        const request = pendingAuthRequests.get(authId);
        if (request) {
          pendingAuthRequests.delete(authId);
          request.reject(new Error('Authorization timeout'));
        }
      }, this.defaultTimeoutMs);

      const pendingRequest: PendingAuthRequest = {
        authId,
        agentId,
        toolName,
        args,
        taskId,
        resolve: (value) => {
          clearTimeout(timeout);
          pendingAuthRequests.delete(authId);
          resolve({ authId, requiresConfirmation: value.allowed });
        },
        reject: (reason) => {
          clearTimeout(timeout);
          pendingAuthRequests.delete(authId);
          reject(reason);
        },
        timeout,
      };

      pendingAuthRequests.set(authId, pendingRequest);

      resolve({ authId, requiresConfirmation: true });
    });
  }

  async handleDecision(
    authId: string,
    allow: boolean,
    persistPolicy: boolean = false,
    policyForAgent?: 'DENY' | 'ASK' | 'ALLOW'
  ): Promise<void> {
    const request = pendingAuthRequests.get(authId);
    if (!request) {
      throw new Error('Authorization request not found or expired');
    }

    if (persistPolicy && allow && policyForAgent) {
      const { db, schema } = await import('../db/index.js');
      const { eq } = await import('drizzle-orm');
      
      await import('../db/index.js').then(async ({ db, schema }) => {
        await db.insert(schema.agentToolPermissions)
          .values({
            agentId: request.agentId,
            toolName: request.toolName,
            policy: policyForAgent,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [schema.agentToolPermissions.agentId, schema.agentToolPermissions.toolName],
            set: { policy: policyForAgent, updatedAt: new Date() },
          });
      });
    }

    request.resolve({ allowed: allow, persistPolicy, policy: policyForAgent });
  }
}

const authService = new AuthService();

const router = Router();

router.post('/decision', async (req: Request, res: Response) => {
  try {
    const { authId, allow, persistPolicy, policyForAgent } = req.body;
    
    await authService.handleDecision(authId, allow, persistPolicy, policyForAgent);
    
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

router.get('/pending', async (req: Request, res: Response) => {
  const requests = Array.from(pendingAuthRequests.entries()).map(([authId, req]) => ({
    authId,
    agentId: req.agentId,
    toolName: req.toolName,
    taskId: req.taskId,
  }));
  
  res.json(requests);
});

export default router;
export { authService, pendingAuthRequests };