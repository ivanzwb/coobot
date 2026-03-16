import { db } from '../db/index.js';
import { auditLogs } from '../db/schema.js';
import { v4 as uuidv4 } from 'uuid';
import { eq, desc } from 'drizzle-orm';

export interface AuditLogEntry {
  userId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  details?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuditQuery {
  userId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export class AuditService {
  async log(entry: AuditLogEntry): Promise<void> {
    const id = uuidv4();
    
    await db.insert(auditLogs).values({
      id,
      userId: entry.userId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      details: entry.details ? JSON.stringify(entry.details) : null,
      ipAddress: entry.ipAddress,
      userAgent: entry.userAgent,
      createdAt: new Date()
    });
  }

  async query(query: AuditQuery): Promise<any[]> {
    try {
      const results = await db.select()
        .from(auditLogs)
        .orderBy(desc(auditLogs.createdAt));
      
      let filtered = results;
      
      if (query.action) {
        filtered = filtered.filter(r => r.action === query.action);
      }
      if (query.resourceType) {
        filtered = filtered.filter(r => r.resourceType === query.resourceType);
      }
      if (query.resourceId) {
        filtered = filtered.filter(r => r.resourceId === query.resourceId);
      }
      
      const offset = query.offset || 0;
      const limit = query.limit || 50;
      
      return filtered.slice(offset, offset + limit);
    } catch (error) {
      console.error('Audit query error:', error);
      return [];
    }
  }

  async getRecentActions(_resourceType: string, resourceId: string, limit = 10): Promise<any[]> {
    try {
      return await db.select()
        .from(auditLogs)
        .where(eq(auditLogs.resourceId, resourceId))
        .limit(limit);
    } catch (error) {
      console.error('Audit getRecentActions error:', error);
      return [];
    }
  }

  async logTaskAction(taskId: string, action: string, details?: Record<string, any>): Promise<void> {
    await this.log({
      action,
      resourceType: 'task',
      resourceId: taskId,
      details
    });
  }

  async logAgentAction(agentId: string, action: string, details?: Record<string, any>): Promise<void> {
    await this.log({
      action,
      resourceType: 'agent',
      resourceId: agentId,
      details
    });
  }

  async logSkillAction(skillId: string, action: string, details?: Record<string, any>): Promise<void> {
    await this.log({
      action,
      resourceType: 'skill',
      resourceId: skillId,
      details
    });
  }

  async logPermissionAction(requestId: string, action: string, decision: string, details?: Record<string, any>): Promise<void> {
    await this.log({
      action,
      resourceType: 'permission',
      resourceId: requestId,
      details: { ...details, decision }
    });
  }

  async logToolInvocation(taskId: string, toolName: string, parameters: any, result: any): Promise<void> {
    await this.log({
      action: 'tool_invocation',
      resourceType: 'tool',
      resourceId: taskId,
      details: { toolName, parameters, result }
    });
  }

  async logModelCall(taskId: string, model: string, prompt: string, response: string, duration: number): Promise<void> {
    await this.log({
      action: 'model_call',
      resourceType: 'model',
      resourceId: taskId,
      details: { model, promptLength: prompt.length, responseLength: response.length, duration }
    });
  }
}

export const auditService = new AuditService();
