import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index.js';
import { permissionPolicies, permissionRequests } from '../db/schema.js';
import { eq, and, asc } from 'drizzle-orm';
import { PermissionAction, PermissionDecision } from '../types/index.js';

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
      const requestId = await this.createPermissionRequest(request);
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

  async createPermissionRequest(request: PermissionCheckRequest): Promise<string> {
    const id = uuidv4();
    await db.insert(permissionRequests).values({
      id,
      taskId: request.taskId,
      stepId: request.stepId,
      action: request.action,
      target: request.target,
      description: `请求${request.action}操作: ${request.target}`,
      status: 'pending'
    });
    return id;
  }

  async getPermissionRequest(id: string) {
    return db.query.permissionRequests.findFirst({
      where: eq(permissionRequests.id, id)
    });
  }

  async approvePermissionRequest(id: string, decidedBy: string, reason?: string) {
    await db.update(permissionRequests)
      .set({
        status: 'approved',
        decidedBy,
        decidedAt: new Date(),
        reason
      })
      .where(eq(permissionRequests.id, id));
  }

  async denyPermissionRequest(id: string, decidedBy: string, reason?: string) {
    await db.update(permissionRequests)
      .set({
        status: 'denied',
        decidedBy,
        decidedAt: new Date(),
        reason
      })
      .where(eq(permissionRequests.id, id));
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