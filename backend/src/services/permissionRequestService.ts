import { v4 as uuidv4 } from 'uuid';
import { db, schema } from '../db';
import { eq, and } from 'drizzle-orm';
import { eventBus, type WebSocketMessage } from './eventBus.js';
import { auditService } from './auditService.js';

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export interface PermissionRequest {
  id: string;
  taskId: string;
  agentId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  policy: string;
  status: 'PENDING' | 'APPROVED' | 'DENIED' | 'TIMEOUT';
  requestedAt: Date;
  respondedAt?: Date;
  response?: string;
}

export class PermissionRequestService {
  private pendingRequests: Map<string, { resolve: (result: PermissionRequest) => void; timeout: NodeJS.Timeout }> = new Map();
  private timeoutMs: number = DEFAULT_TIMEOUT_MS;

  setTimeout(ms: number): void {
    this.timeoutMs = ms;
  }

  async createRequest(
    taskId: string,
    agentId: string,
    toolName: string,
    toolArgs: Record<string, unknown>,
    policy: string
  ): Promise<PermissionRequest> {
    const id = uuidv4();
    const requestedAt = new Date();
    const request: PermissionRequest = {
      id,
      taskId,
      agentId,
      toolName,
      toolArgs,
      policy,
      status: 'PENDING',
      requestedAt,
    };

    await db.insert(schema.permissionRequests).values({
      id,
      taskId,
      agentId,
      toolName,
      toolArgsJson: JSON.stringify(toolArgs),
      policy,
      status: 'PENDING',
      requestedAt,
    });

    eventBus.broadcast({
      type: 'permission_request',
      data: {
        requestId: id,
        taskId,
        agentId,
        toolName,
        toolArgs,
        policy,
        requestedAt: requestedAt.toISOString(),
      }
    } as WebSocketMessage);

    return new Promise<PermissionRequest>((resolve) => {
      const timeout = setTimeout(async () => {
        const timeoutResult = await this.handleTimeout(id, taskId);
        resolve(timeoutResult);
      }, this.timeoutMs);

      this.pendingRequests.set(id, { resolve, timeout });
    });
  }

  async respond(requestId: string, approved: boolean, response?: string): Promise<PermissionRequest | null> {
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(requestId);
    }

    const updateData = {
      status: approved ? 'APPROVED' as const : 'DENIED' as const,
      respondedAt: new Date(),
      response: response || (approved ? 'Approved by user' : 'Denied by user'),
    };

    await db.update(schema.permissionRequests)
      .set(updateData)
      .where(eq(schema.permissionRequests.id, requestId));

    const [updated] = await db.select()
      .from(schema.permissionRequests)
      .where(eq(schema.permissionRequests.id, requestId));

    if (updated) {
      await auditService.log({
        eventType: 'PERMISSION_DECISION',
        actorId: 'user',
        taskId: updated.taskId,
        details: {
          toolName: updated.toolName,
          toolArgs: updated.toolArgsJson ? JSON.parse(updated.toolArgsJson) : {},
          policy: updated.policy,
          decision: approved ? 'APPROVED' : 'DENIED',
          response: updateData.response,
          requestId,
        },
        result: approved ? 'APPROVED' : 'DENIED',
      });

      eventBus.broadcast({
        type: 'permission_response',
        data: {
          requestId,
          taskId: updated.taskId,
          approved,
          response: updateData.response,
        }
      } as WebSocketMessage);

      pending?.resolve({
        id: updated.id,
        taskId: updated.taskId,
        agentId: updated.agentId,
        toolName: updated.toolName,
        toolArgs: updated.toolArgsJson ? JSON.parse(updated.toolArgsJson) : {},
        policy: updated.policy,
        status: updateData.status,
        requestedAt: updated.requestedAt || new Date(),
        respondedAt: updateData.respondedAt,
        response: updateData.response,
      });
    }

    return this.mapToPermissionRequest(updated);
  }

  private async handleTimeout(requestId: string, taskId: string): Promise<PermissionRequest> {
    this.pendingRequests.delete(requestId);

    await db.update(schema.permissionRequests)
      .set({
        status: 'TIMEOUT',
        respondedAt: new Date(),
        response: 'Auto-denied due to timeout',
      })
      .where(eq(schema.permissionRequests.id, requestId));

    await auditService.log({
      eventType: 'PERMISSION_TIMEOUT',
      actorId: 'system',
      taskId,
      details: { requestId, reason: 'timeout' },
      result: 'TIMEOUT',
    });

    eventBus.broadcast({
      type: 'permission_timeout',
      data: { requestId, taskId }
    } as WebSocketMessage);

    return {
      id: requestId,
      taskId,
      agentId: '',
      toolName: '',
      toolArgs: {},
      policy: 'ASK',
      status: 'TIMEOUT',
      requestedAt: new Date(),
      respondedAt: new Date(),
      response: 'Auto-denied due to timeout',
    };
  }

  async getPendingRequests(agentId?: string): Promise<PermissionRequest[]> {
    let query = db.select().from(schema.permissionRequests)
      .where(eq(schema.permissionRequests.status, 'PENDING'));

    if (agentId) {
      query = db.select().from(schema.permissionRequests)
        .where(
          and(
            eq(schema.permissionRequests.status, 'PENDING'),
            eq(schema.permissionRequests.agentId, agentId)
          )
        ) as typeof query;
    }

    const results = await query;
    return results.map(r => this.mapToPermissionRequest(r)).filter((r): r is PermissionRequest => r !== null);
  }

  async getRequestById(requestId: string): Promise<PermissionRequest | null> {
    const [result] = await db.select()
      .from(schema.permissionRequests)
      .where(eq(schema.permissionRequests.id, requestId));

    return this.mapToPermissionRequest(result);
  }

  private mapToPermissionRequest(r: typeof schema.permissionRequests.$inferSelect | undefined): PermissionRequest | null {
    if (!r) return null;

    return {
      id: r.id,
      taskId: r.taskId,
      agentId: r.agentId,
      toolName: r.toolName,
      toolArgs: r.toolArgsJson ? JSON.parse(r.toolArgsJson) : {},
      policy: r.policy,
      status: r.status as 'PENDING' | 'APPROVED' | 'DENIED' | 'TIMEOUT',
      requestedAt: r.requestedAt || new Date(),
      respondedAt: r.respondedAt || undefined,
      response: r.response || undefined,
    };
  }
}

export const permissionRequestService = new PermissionRequestService();
