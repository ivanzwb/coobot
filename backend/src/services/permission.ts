import { v4 as uuidv4 } from 'uuid';
import config from 'config';
import { db } from '../db/index.js';
import { agentSkillPermissionBindings, permissionDecisionLogs, permissionPolicies, permissionRequests, tasks } from '../db/schema.js';
import { eq, and, asc, inArray } from 'drizzle-orm';
import { PermissionAction, PermissionDecision } from '../types/index.js';
import { broadcastPermissionRequest } from '../websocket.js';
import { taskService } from './task.js';

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

type PermissionRisk = 'low' | 'medium' | 'high';

interface AskTimeoutConfig {
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  autoUpgradeOnTimeout: boolean;
  riskBasedTimeout: boolean;
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

function getOptionalConfig<T>(key: string, fallback: T): T {
  try {
    return (config.get(key) as T) ?? fallback;
  } catch {
    return fallback;
  }
}

export class PermissionService {
  private askTimeoutConfig: AskTimeoutConfig = {
    defaultTimeoutMs: Number(getOptionalConfig('permission.askTimeout.defaultMs', 300000)),
    maxTimeoutMs: Number(getOptionalConfig('permission.askTimeout.maxMs', 1800000)),
    autoUpgradeOnTimeout: Boolean(getOptionalConfig('permission.askTimeout.autoUpgradeOnTimeout', false)),
    riskBasedTimeout: Boolean(getOptionalConfig('permission.askTimeout.riskBasedTimeout', true))
  };

  async check(request: PermissionCheckRequest): Promise<PermissionCheckResult> {
    await this.handleTimedOutRequests();

    const trace: PermissionTrace[] = [];

    const approvedRequest = await this.findReusablePermissionRequest(request, ['approved']);
    if (approvedRequest) {
      trace.push({
        layer: 'approved_request',
        policy: { requestId: approvedRequest.id },
        decision: PermissionDecision.ALLOW,
        reason: 'reuse approved request for same task/action/target'
      });
      return {
        decision: PermissionDecision.ALLOW,
        requestId: approvedRequest.id,
        trace
      };
    }

    const actionMap: Record<PermissionAction, PermissionDecision> = {
      [PermissionAction.READ]: PermissionDecision.ASK,
      [PermissionAction.WRITE]: PermissionDecision.ASK,
      [PermissionAction.EXECUTE]: PermissionDecision.ASK
    };

    trace.push({
      layer: 'default',
      policy: { read: 'ask', write: 'ask', execute: 'ask' },
      decision: actionMap[request.action]
    });

    const skillToolBinding = await this.getAgentSkillToolPermissionBinding(request);
    if (skillToolBinding) {
      const bindingDecision = this.getPolicyDecision(skillToolBinding, request.action);
      trace.push({
        layer: 'agent_skill_tool_binding',
        policy: skillToolBinding,
        decision: bindingDecision,
        reason: 'permission declared by skill tool and configured on agent-skill binding'
      });
      actionMap[request.action] = bindingDecision;
    }

    const allPolicies = await this.getPoliciesOrderedByPriority();

    const layerBuckets = {
      global: allPolicies.filter((policy) => !policy.agentId && !policy.skillId && !policy.toolName && !policy.resourcePattern),
      agent: allPolicies.filter((policy) => policy.agentId && policy.agentId === request.agentId),
      skill: allPolicies.filter((policy) => policy.skillId && policy.skillId === request.skillId),
      tool: allPolicies.filter((policy) => policy.toolName && policy.toolName === request.toolName),
      resource: allPolicies.filter((policy) => this.matchesResourcePolicy(policy, request))
    };

    for (const [layer, policies] of Object.entries(layerBuckets) as Array<[string, any[]]>) {
      for (const policy of policies) {
        const decision = this.getPolicyDecision(policy, request.action);
        trace.push({ layer, policy, decision });
        if (this.isTighter(decision, actionMap[request.action])) {
          actionMap[request.action] = decision;
        }
      }
    }

    const finalDecision = actionMap[request.action];

    if (finalDecision === PermissionDecision.ASK) {
      const pendingRequest = await this.findReusablePermissionRequest(request, ['pending']);
      if (pendingRequest) {
        trace.push({
          layer: 'pending_request',
          policy: { requestId: pendingRequest.id },
          decision: PermissionDecision.ASK,
          reason: 'reuse pending request for same task/action/target'
        });
        return {
          decision: finalDecision,
          requestId: pendingRequest.id,
          trace
        };
      }

      const requestId = await this.createPermissionRequest(request, trace);
      return { decision: finalDecision, requestId, trace };
    }

    return { decision: finalDecision, trace };
  }

  private normalizeTarget(target: string): string {
    return target
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\.\//, '')
      .toLowerCase();
  }

  private async findReusablePermissionRequest(
    request: PermissionCheckRequest,
    statuses: Array<'pending' | 'approved' | 'denied'>
  ) {
    if (statuses.length === 0) {
      return null;
    }

    const candidates = await db.select()
      .from(permissionRequests)
      .where(and(
        eq(permissionRequests.taskId, request.taskId),
        eq(permissionRequests.action, request.action),
        inArray(permissionRequests.status, statuses)
      ))
      .orderBy(asc(permissionRequests.createdAt));

    const normalizedTarget = this.normalizeTarget(request.target);
    for (let index = candidates.length - 1; index >= 0; index--) {
      const candidate = candidates[index];
      if (this.normalizeTarget(candidate.target) === normalizedTarget) {
        return candidate;
      }
    }

    return null;
  }

  private getPolicyLayer(policy: any): string {
    if (policy.resourcePattern) return 'resource';
    if (policy.agentId) return 'agent';
    if (policy.skillId) return 'skill';
    if (policy.toolName) return 'tool';
    return 'global';
  }

  private getPolicyDecision(policy: any, action: PermissionAction): PermissionDecision {
    switch (action) {
      case PermissionAction.READ:
        return (policy.readAction as PermissionDecision) || PermissionDecision.ALLOW;
      case PermissionAction.WRITE:
        return (policy.writeAction as PermissionDecision) || PermissionDecision.ASK;
      case PermissionAction.EXECUTE:
        return (policy.executeAction as PermissionDecision) || PermissionDecision.DENY;
      default:
        return PermissionDecision.DENY;
    }
  }

  private isTighter(a: PermissionDecision, b: PermissionDecision): boolean {
    const priority = { [PermissionDecision.DENY]: 3, [PermissionDecision.ASK]: 2, [PermissionDecision.ALLOW]: 1 };
    return priority[a] > priority[b];
  }

  private async getPoliciesOrderedByPriority() {
    return db.select().from(permissionPolicies).orderBy(asc(permissionPolicies.priority));
  }

  private async getAgentSkillToolPermissionBinding(request: PermissionCheckRequest) {
    if (!request.agentId || !request.skillId || !request.toolName) {
      return null;
    }

    try {
      const [binding] = await db.select().from(agentSkillPermissionBindings).where(and(
        eq(agentSkillPermissionBindings.agentId, request.agentId),
        eq(agentSkillPermissionBindings.skillId, request.skillId),
        eq(agentSkillPermissionBindings.toolName, request.toolName)
      ));

      return binding || null;
    } catch (error) {
      if (isMissingTableError(error)) {
        return null;
      }
      throw error;
    }
  }

  private patternToRegExp(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`, 'i');
  }

  private matchesResourcePolicy(policy: any, request: PermissionCheckRequest): boolean {
    if (!policy.resourcePattern) {
      return false;
    }

    if (policy.agentId && policy.agentId !== request.agentId) {
      return false;
    }

    if (policy.skillId && policy.skillId !== request.skillId) {
      return false;
    }

    if (policy.toolName && policy.toolName !== request.toolName) {
      return false;
    }

    return this.patternToRegExp(policy.resourcePattern).test(request.target);
  }

  private getPermissionRisk(action: PermissionAction, target: string): PermissionRisk {
    if (action === PermissionAction.EXECUTE) {
      return 'high';
    }

    if (action === PermissionAction.WRITE) {
      const lowerTarget = target.toLowerCase();
      if (/(\.exe|\.bat|\.ps1|\.sh|\.py|\.js)$/.test(lowerTarget)) {
        return 'high';
      }
      return 'medium';
    }

    return 'low';
  }

  private resolveAskTimeoutMs(action: PermissionAction, target: string): number {
    if (!this.askTimeoutConfig.riskBasedTimeout) {
      return Math.min(this.askTimeoutConfig.defaultTimeoutMs, this.askTimeoutConfig.maxTimeoutMs);
    }

    const risk = this.getPermissionRisk(action, target);
    if (risk === 'high') return Math.min(60000, this.askTimeoutConfig.maxTimeoutMs);
    if (risk === 'medium') return Math.min(120000, this.askTimeoutConfig.maxTimeoutMs);
    return Math.min(300000, this.askTimeoutConfig.maxTimeoutMs);
  }

  private async handleTimedOutRequests() {
    const pendingRequests = await db.select()
      .from(permissionRequests)
      .where(eq(permissionRequests.status, 'pending'));

    const now = Date.now();
    for (const request of pendingRequests) {
      const timeoutMs = this.resolveAskTimeoutMs(request.action as PermissionAction, request.target);
      const createdAtMs = request.createdAt ? new Date(request.createdAt).getTime() : now;
      if (now - createdAtMs <= timeoutMs) {
        continue;
      }

      const timeoutReason = `Permission request timed out after ${Math.floor(timeoutMs / 1000)}s`;
      const shouldDeny = this.askTimeoutConfig.autoUpgradeOnTimeout;
      let shouldRecordTimeoutEvent = false;

      if (shouldDeny) {
        await db.update(permissionRequests)
          .set({
            status: 'denied',
            reason: timeoutReason,
            decidedAt: new Date(),
            decidedBy: 'system-timeout'
          })
          .where(eq(permissionRequests.id, request.id));

        await this.setTaskPermissionState(request.taskId, 'denied', timeoutReason);
        shouldRecordTimeoutEvent = true;
      } else if (!request.reason?.startsWith('TIMEOUT_NOTIFIED:')) {
        await db.update(permissionRequests)
          .set({ reason: `TIMEOUT_NOTIFIED:${new Date().toISOString()}` })
          .where(eq(permissionRequests.id, request.id));

        await this.setTaskPermissionState(request.taskId, 'pending', timeoutReason);
        shouldRecordTimeoutEvent = true;
      }

      if (shouldRecordTimeoutEvent) {
        const timeoutAlreadyRecorded = await this.hasTimeoutDecisionRecorded(request.id);
        if (timeoutAlreadyRecorded) {
          continue;
        }

        await this.appendDecisionLog({
          id: uuidv4(),
          requestId: request.id,
          policyId: null,
          action: request.action,
          decision: shouldDeny ? 'denied' : 'timeout',
          reason: JSON.stringify({
            layer: 'timeout',
            timeoutMs,
            autoUpgradedToDeny: shouldDeny,
            eventType: 'PermissionCheckTimeout'
          }),
          createdAt: new Date()
        });

        await taskService.addEvent(request.taskId, 'PermissionCheckTimeout', '权限确认超时', {
          requestId: request.id,
          action: request.action,
          target: request.target,
          timeoutMs,
          autoUpgradedToDeny: shouldDeny
        });
      }
    }
  }

  private async hasTimeoutDecisionRecorded(requestId: string) {
    const logs = await this.getDecisionLogs(requestId);
    return logs.some((log) => {
      const reason = parseJsonObject(log.reason);
      return reason.layer === 'timeout' || reason.eventType === 'PermissionCheckTimeout';
    });
  }

  private buildRequestMetadata(request: PermissionCheckRequest, trace: PermissionTrace[]) {
    const matchedPolicies = trace
      .filter((entry) => entry.layer !== 'default')
      .map((entry) => `${entry.layer}:${entry.policy?.name || entry.policy?.id || 'unnamed'}`);

    return {
      initiatingAgentId: request.agentId || null,
      initiatingSkillId: request.skillId || null,
      toolName: request.toolName || null,
      askTimeoutMs: this.resolveAskTimeoutMs(request.action, request.target),
      riskLevel: this.getPermissionRisk(request.action, request.target),
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
    const rawTrace = logs.map((log) => {
      const reason = parseJsonObject(log.reason);
      return {
        layer: reason.layer || (log.policyId ? 'policy' : 'default'),
        decision: log.decision,
        policyName: reason.policyName || null,
        reason: reason.reason || null
      };
    });

    const traceKeySet = new Set<string>();
    const trace = rawTrace.filter((entry) => {
      const key = `${entry.layer}|${entry.decision}|${entry.policyName || ''}|${entry.reason || ''}`;
      if (traceKeySet.has(key)) {
        return false;
      }

      traceKeySet.add(key);
      return true;
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
      askTimeoutMs: firstReason.askTimeoutMs || null,
      riskLevel: firstReason.riskLevel || null,
      policySourceSummary: policySources.length > 0 ? policySources.join(', ') : 'default',
      trace,
      summary: `${request.action} ${request.target}`,
      minimalFactSummary: null
    };
  }

  private async buildMinimalFactSummary(taskId: string, action: PermissionAction, target: string) {
    const task = await db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
    if (!task) {
      return {
        taskId,
        status: 'unknown',
        triggerReason: null,
        impactScope: target,
        pendingAction: `${action} ${target}`
      };
    }

    return {
      taskId: task.id,
      status: task.status,
      triggerReason: task.triggerDecisionSummary || task.lastTriggerEvaluationSummary || null,
      impactScope: task.intakeInputSummary || target,
      pendingAction: `${action} ${target}`
    };
  }

  async createPermissionRequest(request: PermissionCheckRequest, trace: PermissionTrace[] = []): Promise<string> {
    const id = uuidv4();
    const createdAt = new Date();
    const metadata = this.buildRequestMetadata(request, trace);
    const minimalFactSummary = await this.buildMinimalFactSummary(request.taskId, request.action, request.target);
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

    await taskService.addEvent(request.taskId, 'PermissionCheckRequested', '权限请求已创建，等待确认', {
      requestId: id,
      action: request.action,
      target: request.target,
      policyMode: PermissionDecision.ASK,
      decisionTraceSummary: trace.map((entry) => ({
        layer: entry.layer,
        decision: entry.decision,
        policyName: entry.policy?.name || null
      })),
      minimalFactSummary
    });

    broadcastPermissionRequest(id, {
      id,
      taskId: request.taskId,
      stepId: request.stepId,
      action: request.action,
      target: request.target,
      description: `请求${request.action}操作: ${request.target}`,
      status: 'pending',
      createdAt,
      minimalFactSummary,
      ...metadata
    });

    return id;
  }

  async getPermissionRequests(status?: string) {
    await this.handleTimedOutRequests();

    const query = db.select().from(permissionRequests).orderBy(asc(permissionRequests.createdAt));

    const requests = status
      ? await query.where(eq(permissionRequests.status, status))
      : await query;

    return Promise.all(requests.map(async (request) => {
      const details = this.buildRequestDetails(request, await this.getDecisionLogs(request.id));
      return {
        ...details,
        minimalFactSummary: await this.buildMinimalFactSummary(request.taskId, request.action as PermissionAction, request.target)
      };
    }));
  }

  async getPermissionRequest(id: string) {
    return db.query.permissionRequests.findFirst({
      where: eq(permissionRequests.id, id)
    });
  }

  async approvePermissionRequest(id: string, decidedBy: string, reason?: string): Promise<{ taskId?: string; changed: boolean }> {
    const request = await this.getPermissionRequest(id);
    if (!request) {
      return { changed: false };
    }

    if (request.status !== 'pending') {
      return { taskId: request.taskId, changed: false };
    }

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
      action: request.action,
      decision: 'approved',
      reason: JSON.stringify({ decidedBy, reason: reason || null, layer: 'user_confirmation' }),
      createdAt: new Date()
    });

    await this.setTaskPermissionState(request.taskId, 'approved', `权限已批准: ${request.action} ${request.target}`);
    await taskService.addEvent(request.taskId, 'PermissionGranted', '权限请求已批准', {
      requestId: id,
      action: request.action,
      target: request.target,
      decidedBy,
      reason: reason || null
    });

    return { taskId: request.taskId, changed: true };
  }

  async denyPermissionRequest(id: string, decidedBy: string, reason?: string) {
    const request = await this.getPermissionRequest(id);
    if (!request) {
      return;
    }
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
      action: request.action,
      decision: 'denied',
      reason: JSON.stringify({ decidedBy, reason: reason || null, layer: 'user_confirmation' }),
      createdAt: new Date()
    });

    await this.setTaskPermissionState(request.taskId, 'denied', `权限已拒绝: ${request.action} ${request.target}`);
    await taskService.addEvent(request.taskId, 'PermissionDenied', '权限请求已拒绝', {
      requestId: id,
      action: request.action,
      target: request.target,
      decidedBy,
      reason: reason || null
    });
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