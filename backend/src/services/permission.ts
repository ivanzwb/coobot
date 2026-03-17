import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index.js';
import { permissionDecisionLogs, permissionPolicies, permissionRequests, tasks } from '../db/schema.js';
import { eq, and, asc } from 'drizzle-orm';
import { PermissionAction, PermissionDecision } from '../types/index.js';
import { broadcastPermissionRequest } from '../websocket.js';

export interface PermissionCheckRequest {
  taskId: string;
  stepId?: string;
  action: PermissionAction;
  target: string;
  agentId?: string;
  skillId?: string;
  toolName?: string;
}

export interface PermissionCheckResult {
  decision: PermissionDecision;
  requestId?: string;
  trace: PermissionTrace[];
}

export interface PermissionTrace {
  layer: string;
  policy: any;
  decision: PermissionDecision;
  reason?: string;
}

function parseJsonObject(value: string | null | undefined) {
  if (!value) {
    return {} as Record<string, any>;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {} as Record<string, any>;
  }
}

function isMissingTableError(error: unknown) {
  return typeof (error as any)?.message === 'string' && /no such table/i.test((error as any).message);
}

export class PermissionService {
  private defaultPolicies = {
    [PermissionAction.READ]: PermissionDecision.ALLOW,
    [PermissionAction.WRITE]: PermissionDecision.ASK,
    [PermissionAction.EXECUTE]: PermissionDecision.DENY
  };

  async check(request: PermissionCheckRequest): Promise<PermissionCheckResult> {
    const trace: PermissionTrace[] = [];

    const globalPolicies = await this.getPoliciesForCheck(undefined, undefined, undefined);
    const agentPolicies = request.agentId
      ? await this.getPoliciesForCheck(request.agentId, undefined, undefined)
      : [];
    const skillPolicies = request.skillId
      ? await this.getPoliciesForCheck(undefined, request.skillId, undefined)
      : [];
    const toolPolicies = request.toolName
      ? await this.getPoliciesForCheck(undefined, undefined, request.toolName)
      : [];

    const allPolicies = [...globalPolicies, ...agentPolicies, ...skillPolicies, ...toolPolicies];

    const actionMap: Record<PermissionAction, PermissionDecision> = {
      [PermissionAction.READ]: this.defaultPolicies[PermissionAction.READ],
      [PermissionAction.WRITE]: this.defaultPolicies[PermissionAction.WRITE],
      [PermissionAction.EXECUTE]: this.defaultPolicies[PermissionAction.EXECUTE]
    };

    trace.push({
      layer: 'default',
      policy: this.defaultPolicies,
      decision: actionMap[request.action]
    });

    for (const policy of allPolicies) {
      let decision: PermissionDecision;

      switch (request.action) {
        case PermissionAction.READ:
          decision = (policy.readAction as PermissionDecision) || PermissionDecision.ALLOW;
          break;
        case PermissionAction.WRITE:
          decision = (policy.writeAction as PermissionDecision) || PermissionDecision.ASK;
          break;
        case PermissionAction.EXECUTE:
          decision = (policy.executeAction as PermissionDecision) || PermissionDecision.DENY;
          break;
      }

      trace.push({
        layer: this.getPolicyLayer(policy),
        policy,
        decision
      });

      if (this.isTighter(decision, actionMap[request.action])) {
        actionMap[request.action] = decision;
      }
    }

    const finalDecision = actionMap[request.action];

    if (finalDecision === PermissionDecision.ASK) {
      const requestId = await this.createPermissionRequest(request, trace);
      return { decision: finalDecision, requestId, trace };
    }

    return { decision: finalDecision, trace };
  }

  private getPolicyLayer(policy: any): string {
    if (policy.agentId) return 'agent';
    if (policy.skillId) return 'skill';
    if (policy.toolName) return 'tool';
    return 'global';
  }

  private isTighter(a: PermissionDecision, b: PermissionDecision): boolean {
    const priority = { [PermissionDecision.DENY]: 3, [PermissionDecision.ASK]: 2, [PermissionDecision.ALLOW]: 1 };
    return priority[a] > priority[b];
  }

  private async getPoliciesForCheck(agentId?: string, skillId?: string, toolName?: string) {
    const conditions = [];
    if (agentId) conditions.push(eq(permissionPolicies.agentId, agentId));
    if (skillId) conditions.push(eq(permissionPolicies.skillId, skillId));
    if (toolName) conditions.push(eq(permissionPolicies.toolName, toolName));

    return db.select()
      .from(permissionPolicies)
      .where(conditions.length > 0 ? and(...conditions) : undefined);
  }

  private buildRequestMetadata(request: PermissionCheckRequest, trace: PermissionTrace[]) {
    const matchedPolicies = trace
      .filter((entry) => entry.layer !== 'default')
      .map((entry) => `${entry.layer}:${entry.policy?.name || entry.policy?.id || 'unnamed'}`);

    return {
      initiatingAgentId: request.agentId || null,
      initiatingSkillId: request.skillId || null,
      toolName: request.toolName || null,
      policySourceSummary: matchedPolicies.length > 0 ? matchedPolicies.join(', ') : 'default',
      trace: trace.map((entry) => ({
        layer: entry.layer,
        decision: entry.decision,
        policyId: entry.policy?.id || null,
        policyName: entry.policy?.name || null,
        reason: entry.reason || null
      }))
    };
  }

  private async recordPermissionTrace(requestId: string, request: PermissionCheckRequest, trace: PermissionTrace[]) {
    const createdAt = new Date();
    const rows = trace.map((entry) => ({
      id: uuidv4(),
      requestId,
      policyId: entry.policy?.id || null,
      action: request.action,
      decision: entry.decision,
      reason: JSON.stringify({
        layer: entry.layer,
        reason: entry.reason || null,
        policyName: entry.policy?.name || null,
        initiatingAgentId: request.agentId || null,
        initiatingSkillId: request.skillId || null,
        toolName: request.toolName || null,
        target: request.target
      }),
      createdAt
    }));

    if (rows.length > 0) {
      try {
        await db.insert(permissionDecisionLogs).values(rows);
      } catch (error) {
        if (!isMissingTableError(error)) {
          throw error;
        }
      }
    }
  }

  private async setTaskPermissionState(taskId: string, status: string, summary: string, trace?: PermissionTrace[]) {
    await db.update(tasks)
      .set({
        permissionStatus: status,
        permissionSummary: summary,
        permissionDecisionTrace: trace ? JSON.stringify(trace.map((entry) => ({
          layer: entry.layer,
          decision: entry.decision,
          policyName: entry.policy?.name || null,
          reason: entry.reason || null
        }))) : null,
        updatedAt: new Date()
      })
      .where(eq(tasks.id, taskId));
  }

  private async getDecisionLogs(requestId: string) {
    try {
      return await db.select()
        .from(permissionDecisionLogs)
        .where(eq(permissionDecisionLogs.requestId, requestId))
        .orderBy(asc(permissionDecisionLogs.createdAt));
    } catch (error) {
      if (isMissingTableError(error)) {
        return [];
      }
      throw error;
    }
  }

  private async appendDecisionLog(entry: typeof permissionDecisionLogs.$inferInsert) {
    try {
      await db.insert(permissionDecisionLogs).values(entry);
    } catch (error) {
      if (!isMissingTableError(error)) {
        throw error;
      }
    }
  }

  private buildRequestDetails(request: any, logs: any[]) {
    const trace = logs.map((log) => {
      const reason = parseJsonObject(log.reason);
      return {
        layer: reason.layer || (log.policyId ? 'policy' : 'default'),
        decision: log.decision,
        policyName: reason.policyName || null,
        reason: reason.reason || null
      };
    });

    const firstReason = logs.length > 0 ? parseJsonObject(logs[0].reason) : {};
    const policySources = trace
      .filter((entry) => entry.policyName)
      .map((entry) => `${entry.layer}:${entry.policyName}`);

    return {
      ...request,
      initiatingAgentId: firstReason.initiatingAgentId || null,
      initiatingSkillId: firstReason.initiatingSkillId || null,
      toolName: firstReason.toolName || null,
      policySourceSummary: policySources.length > 0 ? policySources.join(', ') : 'default',
      trace,
      summary: `${request.action} ${request.target}`
    };
  }

  async createPermissionRequest(request: PermissionCheckRequest, trace: PermissionTrace[] = []): Promise<string> {
    const id = uuidv4();
    const createdAt = new Date();
    const metadata = this.buildRequestMetadata(request, trace);
    await db.insert(permissionRequests).values({
      id,
      taskId: request.taskId,
      stepId: request.stepId,
      action: request.action,
      target: request.target,
      description: `请求${request.action}操作: ${request.target}`,
      status: 'pending',
      createdAt
    });

    await this.recordPermissionTrace(id, request, trace);
    await this.setTaskPermissionState(request.taskId, 'pending', `等待权限确认: ${request.action} ${request.target}`, trace);

    broadcastPermissionRequest(id, {
      id,
      taskId: request.taskId,
      stepId: request.stepId,
      action: request.action,
      target: request.target,
      description: `请求${request.action}操作: ${request.target}`,
      status: 'pending',
      createdAt,
      ...metadata
    });

    return id;
  }

  async getPermissionRequests(status?: string) {
    const query = db.select().from(permissionRequests).orderBy(asc(permissionRequests.createdAt));

    const requests = status
      ? await query.where(eq(permissionRequests.status, status))
      : await query;

    return Promise.all(requests.map(async (request) => this.buildRequestDetails(request, await this.getDecisionLogs(request.id))));
  }

  async getPermissionRequest(id: string) {
    return db.query.permissionRequests.findFirst({
      where: eq(permissionRequests.id, id)
    });
  }

  async approvePermissionRequest(id: string, decidedBy: string, reason?: string) {
    const request = await this.getPermissionRequest(id);
    await db.update(permissionRequests)
      .set({
        status: 'approved',
        decidedBy,
        decidedAt: new Date(),
        reason
      })
      .where(eq(permissionRequests.id, id));

    await this.appendDecisionLog({
      id: uuidv4(),
      requestId: id,
      policyId: null,
      action: request?.action || 'approve',
      decision: 'approved',
      reason: JSON.stringify({ decidedBy, reason: reason || null, layer: 'user_confirmation' }),
      createdAt: new Date()
    });

    if (request?.taskId) {
      await this.setTaskPermissionState(request.taskId, 'approved', `权限已批准: ${request.action} ${request.target}`);
    }
  }

  async denyPermissionRequest(id: string, decidedBy: string, reason?: string) {
    const request = await this.getPermissionRequest(id);
    await db.update(permissionRequests)
      .set({
        status: 'denied',
        decidedBy,
        decidedAt: new Date(),
        reason
      })
      .where(eq(permissionRequests.id, id));

    await this.appendDecisionLog({
      id: uuidv4(),
      requestId: id,
      policyId: null,
      action: request?.action || 'reject',
      decision: 'denied',
      reason: JSON.stringify({ decidedBy, reason: reason || null, layer: 'user_confirmation' }),
      createdAt: new Date()
    });

    if (request?.taskId) {
      await this.setTaskPermissionState(request.taskId, 'denied', `权限已拒绝: ${request.action} ${request.target}`);
    }
  }

  async getTaskPermissionSummary(taskId: string) {
    const requests = await db.select()
      .from(permissionRequests)
      .where(eq(permissionRequests.taskId, taskId))
      .orderBy(asc(permissionRequests.createdAt));

    return Promise.all(requests.map(async (request) => this.buildRequestDetails(request, await this.getDecisionLogs(request.id))));
  }

  async createPolicy(data: {
    name: string;
    priority?: number;
    agentId?: string;
    skillId?: string;
    toolName?: string;
    resourcePattern?: string;
    readAction?: PermissionDecision;
    writeAction?: PermissionDecision;
    executeAction?: PermissionDecision;
  }): Promise<string> {
    const id = uuidv4();
    await db.insert(permissionPolicies).values({
      id,
      name: data.name,
      priority: data.priority || 0,
      agentId: data.agentId,
      skillId: data.skillId,
      toolName: data.toolName,
      resourcePattern: data.resourcePattern,
      readAction: data.readAction || PermissionDecision.ALLOW,
      writeAction: data.writeAction || PermissionDecision.ASK,
      executeAction: data.executeAction || PermissionDecision.DENY
    });
    return id;
  }

  async getPolicies() {
    return db.select()
      .from(permissionPolicies)
      .orderBy(asc(permissionPolicies.priority));
  }

  async deletePolicy(id: string) {
    await db.delete(permissionPolicies).where(eq(permissionPolicies.id, id));
  }
}

export const permissionService = new PermissionService();