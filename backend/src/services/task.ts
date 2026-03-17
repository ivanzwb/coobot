import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/index.js';
import { tasks, taskEvents, taskSteps, taskOutputs, waitSubscriptions } from '../db/schema.js';
import { eq, and, gt, asc, desc } from 'drizzle-orm';
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
}

export interface TaskEventData {
  eventType: string;
  summary?: string;
  payload?: object;
  stepId?: string;
  agentId?: string;
}

export class TaskService {
  private generateAggregateVersion(): string {
    const timestamp = Date.now();
    const sequence = Math.floor(Math.random() * 10000);
    return `${timestamp}-${sequence}`;
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
    const eventMap: Record<TaskStatus, string | null> = {
      [TaskStatus.PENDING]: null,
      [TaskStatus.PLANNING]: 'TaskPlanned',
      [TaskStatus.ARRANGED]: 'TaskArrangementCompleted',
      [TaskStatus.RUNNING]: 'StepStarted',
      [TaskStatus.COMPLETED]: 'TaskCompleted',
      [TaskStatus.FAILED]: 'TaskFailed',
      [TaskStatus.CANCELLED]: 'TaskCancelled'
    };
    return eventMap[status];
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

    await db.update(tasks)
      .set({
        lastEventSequence: sequence,
        lastEventCursor: `${taskId}:${sequence}:${now.getTime()}`,
        updatedAt: now
      })
      .where(eq(tasks.id, taskId));

    broadcastTaskEvent(taskId, {
      id,
      taskId,
      sequence,
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
    const query = db.select()
      .from(taskEvents)
      .where(eq(taskEvents.taskId, taskId))
      .orderBy(asc(taskEvents.sequence));

    if (limit) {
      query.limit(limit);
    }

    return query;
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
    return db.select()
      .from(taskSteps)
      .where(eq(taskSteps.taskId, taskId))
      .orderBy(asc(taskSteps.stepOrder));
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

    await this.addEvent(taskId, 'TaskTriggerActivated', '任务触发激活');
    await this.updateTaskStatus(taskId, TaskStatus.PENDING, {
      triggerStatus: TriggerStatus.TRIGGERED,
      triggerMode: TriggerMode.IMMEDIATE
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
}

export const taskService = new TaskService();