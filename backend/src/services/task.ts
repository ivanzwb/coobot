import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index.js';
import { tasks, taskEvents, taskSteps, taskOutputs, waitSubscriptions, taskMemoryLinks, memoryEntries } from '../db/schema.js';
import { eq, and, gt, asc, desc, inArray } from 'drizzle-orm';
import { TaskStatus, TriggerMode, TriggerStatus, ArrangementStatus, OutputStage, UserNotificationStage, StepStatus, WaitSubscriptionStatus } from '../types/index.js';
import { isRecordVisibleToClient, parseVisibleClientIds, resolveDisplayScope, resolveVisibleClientIds } from './visibility.js';
import { broadcastArrangementCompleted, broadcastStepUpdate, broadcastTaskCompleted, broadcastTaskCreated, broadcastTaskEvent, broadcastTaskFailed, broadcastTaskUpdate, broadcastTriggerActivated } from '../websocket.js';

export interface CreateTaskOptions {
  conversationId: string;
  parentTaskId?: string;
  triggerMode?: TriggerMode;
  triggerDecisionSummary?: string;
  complexity?: string;
  complexityDecisionSummary?: string;
  entryPoint?: string;
  originClientId?: string;
  syncPolicy?: string;
  visibleClientIds?: string[];
  displayScope?: string;
  assignedDomainAgentId?: string;
  blocking?: 'blocking' | 'non-blocking';
  scheduledAt?: Date;
  triggerRule?: object;
  intakeInputSummary?: string;
  memoryScope?: string;
  selectedAgentIds?: string[];
  selectedSkillIds?: string[];
  selectedMemoryEntryIds?: string[];
}

export interface TaskEventData {
  eventType: string;
  summary?: string;
  payload?: object;
  stepId?: string;
  agentId?: string;
}

export interface TaskWriteCommand {
  id: string;
  taskId: string;
  commandType: string;
  payload: object;
  expectedVersion: string;
  createdAt: Date;
}

export interface TaskWriteResult {
  success: boolean;
  commandId: string;
  errorCode?: string;
  errorMessage?: string;
  newVersion?: string;
}

export const TASK_WRITE_CONFLICT = 'TASK_WRITE_CONFLICT';

export class TaskService {
  private aggregateVersionSequence: number = 0;
  private lastVersionTimestamp: number = 0;

  private generateAggregateVersion(): string {
    const now = Date.now();

    if (now > this.lastVersionTimestamp) {
      this.lastVersionTimestamp = now;
      this.aggregateVersionSequence = 0;
    } else {
      this.aggregateVersionSequence++;
    }

    return `${now}-${this.aggregateVersionSequence.toString().padStart(6, '0')}`;
  }

  private parseSequenceFromCursor(cursor: string): number | null {
    const parts = cursor.split(':');
    if (parts.length < 2) {
      return null;
    }

    const sequence = Number(parts[1]);
    return Number.isFinite(sequence) && sequence >= 0 ? sequence : null;
  }

  private extractSequenceFromCursor(cursor?: string): number | null {
    if (!cursor) {
      return null;
    }
    return this.parseSequenceFromCursor(cursor);
  }

  buildEventCursor(taskId: string, sequence: number, timestamp: Date | number | string): string {
    const ts = new Date(timestamp).getTime();
    const safeTs = Number.isFinite(ts) ? ts : Date.now();
    return `${taskId}:${sequence}:${safeTs}`;
  }

  async createTask(options: CreateTaskOptions): Promise<string> {
    const id = uuidv4();
    const now = new Date();
    const visibleClientIds = resolveVisibleClientIds(options.originClientId, options.visibleClientIds);
    const syncPolicy = options.syncPolicy || 'origin_only';
    const displayScope = options.displayScope || resolveDisplayScope(syncPolicy, visibleClientIds);

    await db.insert(tasks).values({
      id,
      parentTaskId: options.parentTaskId,
      conversationId: options.conversationId,
      status: TaskStatus.PENDING,
      blocking: options.blocking || 'blocking',
      triggerMode: options.triggerMode || TriggerMode.IMMEDIATE,
      triggerStatus: options.triggerMode === TriggerMode.IMMEDIATE
        ? TriggerStatus.READY
        : (this.getInitialTriggerStatus(options.triggerMode || TriggerMode.IMMEDIATE) || TriggerStatus.READY),
      scheduledAt: options.scheduledAt,
      triggerRule: options.triggerRule ? JSON.stringify(options.triggerRule) : null,
      triggerDecisionSummary: options.triggerDecisionSummary,
      complexity: options.complexity || 'simple',
      complexityDecisionSummary: options.complexityDecisionSummary,
      entryPoint: options.entryPoint || 'web',
      originClientId: options.originClientId,
      syncPolicy,
      visibleClientIds: visibleClientIds.length > 0 ? JSON.stringify(visibleClientIds) : null,
      displayScope,
      queuePosition: options.triggerMode === TriggerMode.QUEUED ? 1 : null,
      assignedDomainAgentId: options.assignedDomainAgentId,
      arrangementStatus: options.parentTaskId ? ArrangementStatus.WAITING_FOR_ARRANGEMENT : null,
      userNotificationStage: UserNotificationStage.NONE,
      outputStage: OutputStage.NONE,
      finalOutputReady: false,
      memoryScope: options.memoryScope || 'conversation',
      selectedAgentIds: options.selectedAgentIds ? JSON.stringify(options.selectedAgentIds) : null,
      selectedSkillIds: options.selectedSkillIds ? JSON.stringify(options.selectedSkillIds) : null,
      intakeInputSummary: options.intakeInputSummary,
      aggregateVersion: this.generateAggregateVersion(),
      createdAt: now,
      updatedAt: now
    });

    await this.addEvent(id, 'TaskCreated', '任务已创建', { triggerMode: options.triggerMode });

    if (options.triggerMode === TriggerMode.IMMEDIATE) {
      await this.addEvent(id, 'TaskReadyForPlanning', '任务已准备好进入规划');
    } else {
      await this.addEvent(id, 'TaskTriggerWaiting', '任务已等待触发', {
        triggerMode: options.triggerMode,
        scheduledAt: options.scheduledAt
      });
    }

    if (options.triggerMode !== TriggerMode.IMMEDIATE) {
      await this.createWaitSubscription(id, options);
      await this.freezeIntakeSnapshot(
        id,
        options.selectedMemoryEntryIds || [],
        options.memoryScope || 'conversation',
        options.intakeInputSummary || '',
        options.triggerDecisionSummary || ''
      );
    }

    const createdTask = await this.getTask(id);
    if (createdTask) {
      broadcastTaskCreated(id, { task: createdTask });
    }

    return id;
  }

  private getInitialTriggerStatus(mode: TriggerMode): TriggerStatus {
    switch (mode) {
      case TriggerMode.QUEUED:
        return TriggerStatus.QUEUED;
      case TriggerMode.SCHEDULED:
        return TriggerStatus.WAITING_SCHEDULE;
      case TriggerMode.EVENT_TRIGGERED:
        return TriggerStatus.WAITING_EVENT;
      case TriggerMode.CLARIFICATION_PENDING:
        return TriggerStatus.READY;
      default:
        return TriggerStatus.READY;
    }
  }

  private async createWaitSubscription(taskId: string, options: CreateTaskOptions) {
    const id = uuidv4();
    const now = new Date();
    const nextCheckAt = new Date(now.getTime() + 5000);

    await db.insert(waitSubscriptions).values({
      id,
      taskId,
      type: options.triggerMode || TriggerMode.IMMEDIATE,
      domainAgentId: options.assignedDomainAgentId,
      queuePosition: options.triggerMode === TriggerMode.QUEUED ? 1 : null,
      scheduledAt: options.scheduledAt,
      triggerRule: options.triggerRule ? JSON.stringify(options.triggerRule) : null,
      nextCheckAt,
      lastEvaluatedAt: now,
      thresholdConfig: JSON.stringify({ maxWaitTimeMs: 3600000, maxRetryCount: 3 }),
      status: WaitSubscriptionStatus.ACTIVE,
      createdAt: now
    });
  }

  async getTask(id: string) {
    return db.query.tasks.findFirst({
      where: eq(tasks.id, id)
    });
  }

  async getVisibleTask(id: string, clientId: string) {
    const task = await this.getTask(id);
    if (!task) {
      return null;
    }

    return isRecordVisibleToClient(task, clientId) ? task : null;
  }

  async getTasks(conversationId: string, limit = 50, offset = 0) {
    return db.select()
      .from(tasks)
      .where(eq(tasks.conversationId, conversationId))
      .orderBy(desc(tasks.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async getVisibleTasks(conversationId: string, clientId: string, limit = 50, offset = 0) {
    const rows = await this.getTasks(conversationId, limit, offset);
    return rows.filter((task) => isRecordVisibleToClient(task, clientId));
  }

  async getSubTasks(parentTaskId: string) {
    return db.select()
      .from(tasks)
      .where(eq(tasks.parentTaskId, parentTaskId))
      .orderBy(asc(tasks.createdAt));
  }

  async updateTaskStatus(id: string, status: TaskStatus, additionalUpdates?: Partial<typeof tasks.$inferInsert>) {
    const updates: Partial<typeof tasks.$inferInsert> = {
      status,
      updatedAt: new Date()
    };

    if (status === TaskStatus.COMPLETED || status === TaskStatus.FAILED || status === TaskStatus.CANCELLED) {
      updates.completedAt = new Date();
    }

    if (additionalUpdates) {
      Object.assign(updates, additionalUpdates);
    }

    await db.update(tasks)
      .set(updates)
      .where(eq(tasks.id, id));

    const updatedTask = await this.getTask(id);
    if (updatedTask) {
      broadcastTaskUpdate(id, { task: updatedTask, status });

      if (status === TaskStatus.ARRANGED) {
        broadcastArrangementCompleted(id, { task: updatedTask });
      }

      if (status === TaskStatus.COMPLETED) {
        broadcastTaskCompleted(id, { task: updatedTask });
      }

      if (status === TaskStatus.FAILED) {
        broadcastTaskFailed(id, updatedTask.errorMessage || 'Task failed', { task: updatedTask });
      }
    }

    const eventType = this.getStatusEventType(status);
    if (eventType) {
      await this.addEvent(id, eventType, `任务状态变更为 ${status}`);
    }
  }

  private getStatusEventType(status: TaskStatus): string | null {
    const eventMap: Record<string, string | null> = {
      [TaskStatus.PENDING]: null,
      [TaskStatus.CLARIFICATION_PENDING]: null,
      [TaskStatus.PLANNING]: 'TaskPlanned',
      [TaskStatus.WAITING]: null,
      [TaskStatus.READY_FOR_PLANNING]: null,
      [TaskStatus.PLANNED]: 'TaskPlanned',
      [TaskStatus.ARRANGED]: 'TaskArrangementCompleted',
      [TaskStatus.RUNNING]: 'StepStarted',
      [TaskStatus.COMPLETED]: 'TaskCompleted',
      [TaskStatus.PARTIAL_FAILED]: 'TaskCompleted',
      [TaskStatus.FAILED]: 'TaskFailed',
      [TaskStatus.CANCELLED]: 'TaskCancelled',
      [TaskStatus.TIMED_OUT]: 'TaskFailed',
      [TaskStatus.MANUALLY_CLOSED]: 'TaskCancelled',
      [TaskStatus.INTERVENTION_REQUIRED]: 'TaskInterventionRequired'
    };
    return eventMap[status] || null;
  }

  async addEvent(taskId: string, eventType: string, summary?: string, payload?: object) {
    const task = await this.getTask(taskId);
    if (!task) return;

    const sequence = (task.lastEventSequence || 0) + 1;
    const now = new Date();
    const id = uuidv4();
    const payloadWithVisibility = {
      ...(payload || {}),
      entryPoint: task.entryPoint,
      originClientId: task.originClientId,
      syncPolicy: task.syncPolicy,
      visibleClientIds: parseVisibleClientIds(task.visibleClientIds),
      displayScope: task.displayScope
    };

    await db.insert(taskEvents).values({
      id,
      taskId,
      sequence,
      eventType,
      timestamp: now,
      summary,
      payload: JSON.stringify(payloadWithVisibility)
    });

    const cursor = this.buildEventCursor(taskId, sequence, now);

    await db.update(tasks)
      .set({
        lastEventSequence: sequence,
        lastEventCursor: cursor,
        updatedAt: now
      })
      .where(eq(tasks.id, taskId));

    broadcastTaskEvent(taskId, {
      id,
      taskId,
      sequence,
      cursor,
      eventType,
      timestamp: now,
      summary,
      payload: payloadWithVisibility
    });

    if (eventType === 'TaskTriggerActivated') {
      broadcastTriggerActivated(taskId, {
        taskId,
        sequence,
        summary,
        payload: payloadWithVisibility
      });
    }
  }

  async getTaskEvents(taskId: string, limit = 100, cursor?: string) {
    const lastSequence = this.extractSequenceFromCursor(cursor);

    const whereClause = lastSequence === null
      ? eq(taskEvents.taskId, taskId)
      : and(eq(taskEvents.taskId, taskId), gt(taskEvents.sequence, lastSequence));

    const baseQuery = db.select()
      .from(taskEvents)
      .where(whereClause)
      .orderBy(asc(taskEvents.sequence));

    const rows = limit
      ? await baseQuery.limit(limit)
      : await baseQuery;

    return rows.map((row) => ({
      ...row,
      cursor: this.buildEventCursor(taskId, row.sequence, row.timestamp)
    }));
  }

  async getVisibleTaskEvents(taskId: string, clientId: string, limit = 100, cursor?: string) {
    const task = await this.getVisibleTask(taskId, clientId);
    if (!task) {
      return [];
    }

    const events = await this.getTaskEvents(taskId, limit, cursor);
    return events.filter((event) => isRecordVisibleToClient({
      originClientId: task.originClientId,
      syncPolicy: task.syncPolicy,
      visibleClientIds: task.visibleClientIds,
      displayScope: task.displayScope,
      payload: event.payload
    }, clientId));
  }

  async createStep(taskId: string, agentId: string, name: string, order: number): Promise<string> {
    const id = uuidv4();
    await db.insert(taskSteps).values({
      id,
      taskId,
      agentId,
      stepOrder: order,
      name,
      status: StepStatus.PENDING,
      createdAt: new Date()
    });

    await this.addEvent(taskId, 'StepCreated', `步骤已创建: ${name}`, { stepId: id });
    return id;
  }

  async updateStep(id: string, updates: Partial<typeof taskSteps.$inferInsert>) {
    const existingStep = await db.query.taskSteps.findFirst({
      where: eq(taskSteps.id, id)
    });

    await db.update(taskSteps)
      .set(updates)
      .where(eq(taskSteps.id, id));

    const step = await db.query.taskSteps.findFirst({
      where: eq(taskSteps.id, id)
    });

    if (step) {
      broadcastStepUpdate(step.taskId, id, step.status, { step });
      if (updates.status && updates.status !== existingStep?.status) {
        await this.addEvent(step.taskId, updates.status === StepStatus.COMPLETED ? 'TaskStepCompleted' : 'TaskStepUpdated', `步骤状态更新为 ${step.status}`, { stepId: id, status: step.status });
      }
    }
  }

  async getSteps(taskId: string) {
    const persistedSteps = await db.select()
      .from(taskSteps)
      .where(eq(taskSteps.taskId, taskId))
      .orderBy(asc(taskSteps.stepOrder));

    if (persistedSteps.length > 0) {
      return persistedSteps;
    }

    const subTasks = await this.getSubTasks(taskId);
    if (subTasks.length === 0) {
      return persistedSteps;
    }

    const toStepStatus = (status: string) => {
      if (status === TaskStatus.COMPLETED || status === 'TaskCompleted') {
        return StepStatus.COMPLETED;
      }

      if (status === TaskStatus.RUNNING || status === 'TaskExecuting') {
        return StepStatus.RUNNING;
      }

      if (
        status === TaskStatus.FAILED
        || status === 'TaskFailed'
        || status === TaskStatus.CANCELLED
        || status === 'cancelled'
        || status === 'partial_failed'
        || status === 'timed_out'
      ) {
        return StepStatus.FAILED;
      }

      if (
        status === 'waiting'
        || status === 'queued'
        || status === 'scheduled'
        || status === 'event_triggered'
        || status === 'clarification_pending'
      ) {
        return 'waiting';
      }

      return StepStatus.PENDING;
    };

    return subTasks.map((subTask, index) => ({
      id: `derived-${taskId}-${subTask.id}`,
      taskId,
      agentId: subTask.assignedDomainAgentId || subTask.assignedLeaderAgentId || 'agent-domain-default',
      stepOrder: index + 1,
      name: subTask.intakeInputSummary || `子任务 ${index + 1}`,
      status: toStepStatus(subTask.status),
      reasoningSummary: subTask.routeDecisionSummary || null,
      actionSummary: subTask.terminalSummary || null,
      observationSummary: subTask.lastObservationSummary || null,
      parallelGroupId: null,
      waitingReason: subTask.waitingAnomalySummary || null,
      startedAt: null,
      completedAt: subTask.completedAt || null,
      duration: 0,
      errorCode: subTask.errorCode || null,
      errorMessage: subTask.errorMessage || null,
      createdAt: subTask.createdAt
    }));
  }

  async createOutput(taskId: string, type: 'final' | 'intermediate' | 'arrangement', content: string, summary?: string): Promise<string> {
    const id = uuidv4();
    const createdAt = new Date();
    await db.insert(taskOutputs).values({
      id,
      taskId,
      type,
      content,
      summary,
      createdAt
    });

    await this.addEvent(taskId, 'TaskOutputCreated', `新增${type === 'final' ? '最终' : '阶段'}输出`, {
      outputId: id,
      outputType: type,
      summary
    });
    return id;
  }

  async getOutputs(taskId: string) {
    return db.select()
      .from(taskOutputs)
      .where(eq(taskOutputs.taskId, taskId));
  }

  async getActiveWaitSubscriptions() {
    const now = new Date();
    return db.select()
      .from(waitSubscriptions)
      .where(
        and(
          eq(waitSubscriptions.status, WaitSubscriptionStatus.ACTIVE),
          gt(waitSubscriptions.nextCheckAt, now)
        )
      )
      .limit(50);
  }

  async getReadyForPlanningTasks(limit = 20) {
    return db.select()
      .from(tasks)
      .where(
        and(
          eq(tasks.triggerMode, TriggerMode.IMMEDIATE),
          eq(tasks.status, TaskStatus.PENDING)
        )
      )
      .orderBy(asc(tasks.createdAt))
      .limit(limit);
  }

  async updateWaitSubscription(id: string, updates: Partial<typeof waitSubscriptions.$inferInsert>) {
    await db.update(waitSubscriptions)
      .set(updates)
      .where(eq(waitSubscriptions.id, id));
  }

  async cancelWaitSubscriptions(taskId: string) {
    await db.update(waitSubscriptions)
      .set({ status: WaitSubscriptionStatus.CANCELLED })
      .where(eq(waitSubscriptions.taskId, taskId));
  }

  async releaseTask(taskId: string) {
    const task = await this.getTask(taskId);
    if (!task) return false;

    const snapshotValidation = await this.validateIntakeSnapshot(taskId);
    if (snapshotValidation.allInvalid) {
      const summary = `冻结记忆快照全部失效，无法自动释放执行（${snapshotValidation.invalidMemoryIds.length}/${snapshotValidation.totalSnapshotEntries}）`;
      await db.update(tasks)
        .set({
          waitingAnomalyCode: 'SNAPSHOT_INVALIDATED',
          waitingAnomalySummary: summary,
          interventionRequiredReason: 'frozen_snapshot_invalid',
          snapshotResolution: 'manual_intervention_required',
          updatedAt: new Date()
        })
        .where(eq(tasks.id, taskId));

      await this.addEvent(taskId, 'IntakeSnapshotInvalidated', summary, {
        invalidMemoryEntryIds: snapshotValidation.invalidMemoryIds,
        totalSnapshotEntries: snapshotValidation.totalSnapshotEntries
      });
      return false;
    }

    await this.addEvent(taskId, 'TaskTriggerActivated', '任务触发激活');
    await this.updateTaskStatus(taskId, TaskStatus.PENDING, {
      triggerStatus: TriggerStatus.TRIGGERED,
      triggerMode: TriggerMode.IMMEDIATE,
      snapshotResolution: snapshotValidation.valid ? 'unchanged' : 'degraded_continue',
      memoryLoadSummary: snapshotValidation.summary
    });

    await db.update(waitSubscriptions)
      .set({ status: WaitSubscriptionStatus.RELEASED })
      .where(eq(waitSubscriptions.taskId, taskId));

    await this.addEvent(taskId, 'TaskReadyForPlanning', '任务准备好进入规划');

    return true;
  }

  async cancelTask(id: string, reason?: string) {
    await this.cancelWaitSubscriptions(id);
    await this.updateTaskStatus(id, TaskStatus.CANCELLED, { closeReason: reason });
  }

  async failTask(id: string, errorCode: string, errorMessage: string, retryable = false) {
    await this.cancelWaitSubscriptions(id);
    await this.updateTaskStatus(id, TaskStatus.FAILED, {
      errorCode,
      errorMessage,
      retryable
    });
  }

  async freezeIntakeSnapshot(taskId: string, selectedMemoryEntryIds: string[], memoryScope: string, intakeInputSummary: string, triggerDecisionSummary: string) {
    const thresholdConfig = {
      maxWaitTimeMs: 3600000,
      maxRetryCount: 3,
      anomalyThresholdMs: 300000
    };

    await db.update(tasks)
      .set({
        selectedMemoryEntryIdsSnapshot: JSON.stringify(selectedMemoryEntryIds),
        memoryScope,
        intakeInputSummary,
        triggerDecisionSummary,
        snapshotResolution: 'frozen'
      })
      .where(eq(tasks.id, taskId));

    for (const memoryId of selectedMemoryEntryIds) {
      await db.insert(taskMemoryLinks).values({
        id: uuidv4(),
        taskId,
        memoryId,
        linkType: 'intake_snapshot',
        createdAt: new Date()
      });
    }

    await this.addEvent(taskId, 'IntakeSnapshotFrozen', '记忆上下文已冻结', {
      selectedMemoryEntryIds,
      memoryScope,
      thresholdConfig
    });
  }

  async validateIntakeSnapshot(taskId: string): Promise<{ valid: boolean; invalidMemoryIds: string[]; summary: string; allInvalid: boolean; totalSnapshotEntries: number }> {
    const task = await this.getTask(taskId);
    if (!task) {
      return { valid: false, invalidMemoryIds: [], summary: 'Task not found', allInvalid: false, totalSnapshotEntries: 0 };
    }

    const snapshotIds = task.selectedMemoryEntryIdsSnapshot
      ? parseVisibleClientIds(task.selectedMemoryEntryIdsSnapshot)
      : [];

    if (snapshotIds.length === 0) {
      return { valid: true, invalidMemoryIds: [], summary: 'No snapshot to validate', allInvalid: false, totalSnapshotEntries: 0 };
    }

    const existingMemories = await db.select()
      .from(memoryEntries)
      .where(inArray(memoryEntries.id, snapshotIds));

    const existingIds = new Set(existingMemories.map(m => m.id));
    const invalidIds = snapshotIds.filter(id => !existingIds.has(id));

    if (invalidIds.length > 0) {
      const allInvalid = invalidIds.length === snapshotIds.length;
      await db.update(tasks)
        .set({
          invalidMemoryEntryIds: JSON.stringify(invalidIds),
          snapshotResolution: allInvalid ? 'manual_intervention_required' : 'degraded_continue'
        })
        .where(eq(tasks.id, taskId));

      await this.addEvent(taskId, allInvalid ? 'IntakeSnapshotInvalidated' : 'IntakeSnapshotPartiallyInvalid', allInvalid ? '冻结记忆快照已全部失效' : '部分记忆条目已失效', {
        invalidMemoryEntryIds: invalidIds,
        validCount: snapshotIds.length - invalidIds.length,
        totalCount: snapshotIds.length
      });
    }

    const allInvalid = invalidIds.length === snapshotIds.length;

    return {
      valid: invalidIds.length === 0,
      invalidMemoryIds: invalidIds,
      allInvalid,
      totalSnapshotEntries: snapshotIds.length,
      summary: invalidIds.length === 0
        ? 'All snapshot memories are valid'
        : `${invalidIds.length} of ${snapshotIds.length} snapshot memories are invalid`
    };
  }

  async getTaskExecutionView(taskId: string, clientId: string) {
    const task = await this.getVisibleTask(taskId, clientId);
    if (!task) {
      return null;
    }

    const [steps, outputs, events, memoryLinks] = await Promise.all([
      this.getSteps(taskId),
      this.getOutputs(taskId),
      this.getVisibleTaskEvents(taskId, clientId, 20),
      db.select().from(taskMemoryLinks).where(eq(taskMemoryLinks.taskId, taskId))
    ]);

    const memoryIds = memoryLinks.map(l => l.memoryId);
    const memories = memoryIds.length > 0
      ? await db.select().from(memoryEntries).where(inArray(memoryEntries.id, memoryIds))
      : [];

    const completedSteps = steps.filter(s => s.status === StepStatus.COMPLETED).length;
    const totalSteps = steps.length;
    const progressPercent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;

    const arrangementNoticeSummary = task.arrangementStatus
      ? `${task.arrangementStatus}: ${task.arrangementSummary || ''}`
      : null;

    const degradedDeliverySummary = task.degradeReason
      ? `${task.degradeReason} - ${task.degradeAction || '降级处理'}`
      : null;

    const suggestedActions: string[] = [];
    if (task.status === TaskStatus.PENDING) {
      if (task.triggerMode === TriggerMode.QUEUED) {
        suggestedActions.push('查看队列位置');
      }
      if (task.triggerMode === TriggerMode.SCHEDULED && task.scheduledAt) {
        suggestedActions.push('查看计划时间');
      }
    }
    if (task.status === TaskStatus.RUNNING) {
      suggestedActions.push('查看执行详情');
    }
    if (task.status === TaskStatus.FAILED) {
      suggestedActions.push('重试任务', '查看错误详情');
    }
    if (task.finalOutputReady) {
      suggestedActions.push('查看结果');
    }

    return {
      taskId: task.id,
      status: task.status,
      triggerMode: task.triggerMode,
      triggerStatus: task.triggerStatus,
      complexity: task.complexity,
      arrangementStatus: task.arrangementStatus,
      arrangementSummary: task.arrangementSummary,
      estimatedCompletionAt: task.estimatedCompletionAt,
      estimatedDurationMinutes: task.estimatedDurationMinutes,
      outputStage: task.outputStage,
      arrangementNoticeSummary,
      degradedDeliverySummary,
      supplementalUpdates: events
        .filter(e => ['TaskReplanned', 'GoalSatisfactionEvaluated'].includes(e.eventType))
        .map(e => ({ eventType: e.eventType, summary: e.summary })),
      suggestedActions,
      visibleClientIds: parseVisibleClientIds(task.visibleClientIds),
      progress: {
        completedSteps,
        totalSteps,
        percent: progressPercent
      },
      memorySnapshot: {
        scope: task.memoryScope,
        entriesCount: memories.length,
        invalidEntriesCount: task.invalidMemoryEntryIds
          ? parseVisibleClientIds(task.invalidMemoryEntryIds).length
          : 0
      },
      lastEvent: events.length > 0 ? {
        eventType: events[events.length - 1].eventType,
        summary: events[events.length - 1].summary,
        timestamp: events[events.length - 1].timestamp
      } : null
    };
  }

  async executeWriteCommand(
    command: TaskWriteCommand,
    executeFn: () => Promise<void>
  ): Promise<TaskWriteResult> {
    const task = await this.getTask(command.taskId);
    if (!task) {
      return {
        success: false,
        commandId: command.id,
        errorCode: 'TASK_NOT_FOUND',
        errorMessage: 'Task not found'
      };
    }

    const currentVersion = task.aggregateVersion || '';
    if (currentVersion !== command.expectedVersion) {
      await this.addEvent(command.taskId, 'TaskWriteConflictDetected', '写命令版本冲突', {
        commandId: command.id,
        commandType: command.commandType,
        expectedVersion: command.expectedVersion,
        currentVersion,
        conflictCode: 'VERSION_MISMATCH'
      });

      return {
        success: false,
        commandId: command.id,
        errorCode: TASK_WRITE_CONFLICT,
        errorMessage: `Version mismatch: expected ${command.expectedVersion}, got ${currentVersion}`,
        newVersion: currentVersion
      };
    }

    try {
      await executeFn();

      const newVersion = this.generateAggregateVersion();
      await db.update(tasks)
        .set({
          aggregateVersion: newVersion,
          lastAcceptedWriteCommandId: command.id,
          pendingWriteCommandCount: Math.max(0, (task.pendingWriteCommandCount || 0) - 1)
        })
        .where(eq(tasks.id, command.taskId));

      await this.addEvent(command.taskId, 'TaskWriteCommandAccepted', '写命令已接受', {
        commandId: command.id,
        commandType: command.commandType,
        newVersion
      });

      return {
        success: true,
        commandId: command.id,
        newVersion
      };
    } catch (error: any) {
      return {
        success: false,
        commandId: command.id,
        errorCode: 'EXECUTION_ERROR',
        errorMessage: error.message
      };
    }
  }

  async queueWriteCommand(
    taskId: string,
    commandType: string,
    payload: object
  ): Promise<TaskWriteCommand> {
    const task = await this.getTask(taskId);
    if (!task) {
      throw new Error('Task not found');
    }

    const command: TaskWriteCommand = {
      id: uuidv4(),
      taskId,
      commandType,
      payload,
      expectedVersion: task.aggregateVersion || '',
      createdAt: new Date()
    };

    await db.update(tasks)
      .set({
        pendingWriteCommandCount: (task.pendingWriteCommandCount || 0) + 1
      })
      .where(eq(tasks.id, taskId));

    await this.addEvent(taskId, 'TaskWriteQueued', '写命令已入队', {
      commandId: command.id,
      commandType,
      expectedVersion: command.expectedVersion
    });

    return command;
  }
}

export const taskService = new TaskService();