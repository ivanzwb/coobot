import { db, schema } from '../db';
import { eq, and, gte, lte } from 'drizzle-orm';
import type { AuditEvent } from '../types';

export interface AuditQuery {
  eventType?: string;
  actorId?: string;
  taskId?: string;
  startTime?: Date;
  endTime?: Date;
  limit?: number;
}

export class AuditService {
  async log(event: AuditEvent): Promise<void> {
    await db.insert(schema.auditLogs).values({
      eventType: event.eventType,
      actorId: event.actorId,
      taskId: event.taskId || null,
      detailsJson: JSON.stringify(event.details),
      result: event.result,
      timestamp: new Date(),
    });
  }

  async query(filter: AuditQuery): Promise<AuditEvent[]> {
    let query = db.select().from(schema.auditLogs);

    const conditions = [];

    if (filter.eventType) {
      conditions.push(eq(schema.auditLogs.eventType, filter.eventType));
    }

    if (filter.actorId) {
      conditions.push(eq(schema.auditLogs.actorId, filter.actorId));
    }

    if (filter.taskId) {
      conditions.push(eq(schema.auditLogs.taskId, filter.taskId));
    }

    if (filter.startTime) {
      conditions.push(gte(schema.auditLogs.timestamp, filter.startTime));
    }

    if (filter.endTime) {
      conditions.push(lte(schema.auditLogs.timestamp, filter.endTime));
    }

    let results = await db.select()
      .from(schema.auditLogs)
      .where(and(...conditions))
      .orderBy(schema.auditLogs.timestamp)
      .limit(filter.limit || 100);

    return results.map(row => ({
      eventType: row.eventType,
      actorId: row.actorId,
      taskId: row.taskId || undefined,
      details: row.detailsJson ? JSON.parse(row.detailsJson) : {},
      result: row.result || '',
      timestamp: row.timestamp || undefined,
    }));
  }

  async logPermissionDecision(
    agentId: string,
    toolName: string,
    decision: 'ALLOW' | 'DENY' | 'ASK',
    taskId?: string
  ): Promise<void> {
    await this.log({
      eventType: 'PERMISSION_DECISION',
      actorId: agentId,
      taskId,
      details: { toolName },
      result: decision,
    });
  }

  async logTaskAction(
    action: 'CREATED' | 'STARTED' | 'COMPLETED' | 'TERMINATED' | 'FAILED',
    taskId: string,
    agentId: string,
    details?: Record<string, unknown>
  ): Promise<void> {
    await this.log({
      eventType: `TASK_${action}`,
      actorId: agentId,
      taskId,
      details: details || {},
      result: action,
    });
  }

  async logConfigChange(
    userId: string,
    configKey: string,
    oldValue: unknown,
    newValue: unknown
  ): Promise<void> {
    await this.log({
      eventType: 'CONFIG_CHANGE',
      actorId: userId,
      details: { configKey, oldValue, newValue },
      result: 'SUCCESS',
    });
  }

  async exportLogs(filter: AuditQuery): Promise<string> {
    const logs = await this.query(filter);
    
    const headers = ['Timestamp', 'Event Type', 'Actor', 'Task ID', 'Result', 'Details'];
    const rows = logs.map(log => [
      log.timestamp ? new Date(log.timestamp).toISOString() : '',
      log.eventType,
      log.actorId,
      log.taskId || '',
      log.result,
      JSON.stringify(log.details),
    ]);

    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  }
}

export const auditService = new AuditService();