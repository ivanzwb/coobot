import { taskService } from './task.js';
import { taskOutputService } from './output.js';
import { db } from '../db/index.js';
import { agentParticipations, knowledgeDocuments, knowledgeHitLogs, memoryEntries, modelCallLogs, taskMemoryLinks, toolInvocationLogs } from '../db/schema.js';
import { desc, eq, inArray } from 'drizzle-orm';
import { BlockingStatusChange, buildTaskReport, DegradedDeliverySummary, DomainAgentContribution, ResultExplanation } from './report.js';

type JsonObject = Record<string, unknown>;

export interface AgentExecutionSummaryDTO {
  agentId: string;
  stepId: string;
  status: string;
  reasoningSummary: string;
  actionSummary: string;
  observationSummary: string;
}

export interface SupplementalUpdateDTO {
  id: string;
  content: string;
  arrivedAt: Date | string;
  stepSummary?: string;
  outputType: string;
}

export interface PermissionDecisionSummaryDTO {
  requestId: string | null;
  requestedAction: string;
  decision: 'allow' | 'deny' | 'ask' | 'unknown';
  reasoning: string;
  riskLevel: 'low' | 'medium' | 'high' | 'unknown';
}

export interface PermissionExplanationDTO {
  permissionRequestId: string | null;
  requestedAction: string;
  decision: 'allow' | 'deny' | 'ask' | 'unknown';
  reasoning: string;
  riskLevel: 'low' | 'medium' | 'high' | 'unknown';
  timeoutMinutes?: number;
  confirmedAt?: Date | string;
}

export interface TaskExecutionStageNotificationsDTO {
  arrangementStatus: string | null;
  userNotificationStage: string | null;
}

export interface TerminalSummaryVisibilityDTO {
  displayScope: string | null;
  visibleClientIds: string[];
}

export interface TaskExecutionReportDTO {
  finalOutputReady: boolean;
  stageNotifications: TaskExecutionStageNotificationsDTO;
  permissionDecisionSummary: PermissionDecisionSummaryDTO[];
  domainAgentContributions: DomainAgentContribution[];
  degradedDeliverySummary: DegradedDeliverySummary | null;
  supplementalUpdates: SupplementalUpdateDTO[];
  blockingStatusChanges: BlockingStatusChange[];
  terminalSummaryVisibility: TerminalSummaryVisibilityDTO;
}

export interface ReportReferenceDTO {
  title: string;
  summary: string;
}

export interface ToolCallSummaryDTO {
  id: string;
  toolName: string;
  status: string;
  duration?: number;
  createdAt?: Date | string;
}

export interface ModelCallSummaryDTO {
  id: string;
  model: string;
  status: string;
  duration?: number;
  totalTokens?: number;
  createdAt?: Date | string;
}

export interface StepSummaryDTO {
  id: string;
  name: string;
  status: string;
  reasoningSummary: string;
  actionSummary: string;
  observationSummary: string;
}

export interface TaskReportSummaryDTO {
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  finalOutputReady: boolean;
  terminalSummary: string;
}

export interface TaskReportMemoryScopeDTO {
  memoryScope: string;
  memoryLoadSummary: string;
  memoryWriteSummary: string;
  knowledgeHitSummary: string;
}

export interface TaskReportDTO {
  summary: TaskReportSummaryDTO;
  resultExplanation: ResultExplanation;
  memoryScope: TaskReportMemoryScopeDTO;
  suggestedActions: string[];
  failureAnalysis: string | null;
  permissionExplanations: PermissionExplanationDTO[];
  domainAgentContributions: DomainAgentContribution[];
  blockingStatusChanges: BlockingStatusChange[];
  degradedDelivery: DegradedDeliverySummary | null;
  supplementalUpdates: SupplementalUpdateDTO[];
  stepSummaries: StepSummaryDTO[];
  references: ReportReferenceDTO[];
  toolCallSummary: ToolCallSummaryDTO[];
  modelCallSummary: ModelCallSummaryDTO[];
}

export interface TaskExecutionView {
  task: JsonObject;
  steps: JsonObject[];
  outputs: JsonObject[];
  events: JsonObject[];
  agentExecutionSummary: AgentExecutionSummaryDTO[];
  knowledgeHitSummary: string;
  memoryWriteSummary: string;
  supplementalUpdates: SupplementalUpdateDTO[];
  supplementalNotificationType: string;
  arrangementNoticeSummary: string | null;
  degradedDeliverySummary: DegradedDeliverySummary | null;
  terminalSummary: string;
  outputStage: string;
  finalOutputReady: boolean;
  availableActions: string[];
  permissionExplanations: PermissionExplanationDTO[];
  executionReport: TaskExecutionReportDTO;
  report: TaskReportDTO;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' ? (value as JsonObject) : {};
}

function asRecordArray(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => asRecord(entry));
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeAgentExecutionSummary(value: unknown): AgentExecutionSummaryDTO[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => {
    const item = (entry || {}) as Record<string, unknown>;
    return {
      agentId: asString(item.agentId, 'system'),
      stepId: asString(item.stepId, ''),
      status: asString(item.status, 'unknown'),
      reasoningSummary: asString(item.reasoningSummary, ''),
      actionSummary: asString(item.actionSummary, ''),
      observationSummary: asString(item.observationSummary, '')
    };
  });
}

function normalizeSupplementalUpdates(value: unknown): SupplementalUpdateDTO[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry, index) => {
    const item = (entry || {}) as Record<string, unknown>;
    return {
      id: asString(item.id, `supplement-${index + 1}`),
      content: asString(item.content, ''),
      arrivedAt: (item.arrivedAt as Date | string) || new Date().toISOString(),
      stepSummary: typeof item.stepSummary === 'string' ? item.stepSummary : undefined,
      outputType: asString(item.outputType, 'intermediate')
    };
  });
}

function normalizePermissionDecisionSummary(value: unknown): PermissionDecisionSummaryDTO[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => {
    const item = (entry || {}) as Record<string, unknown>;
    const decisionRaw = asString(item.decision, '').toLowerCase();
    const decision: PermissionDecisionSummaryDTO['decision'] =
      decisionRaw === 'allow' || decisionRaw === 'deny' || decisionRaw === 'ask'
        ? decisionRaw
        : 'unknown';
    const riskRaw = asString(item.riskLevel, '').toLowerCase();
    const riskLevel: PermissionDecisionSummaryDTO['riskLevel'] =
      riskRaw === 'low' || riskRaw === 'medium' || riskRaw === 'high'
        ? riskRaw
        : 'unknown';

    return {
      requestId: asNullableString(item.requestId),
      requestedAction: asString(item.action, asString(item.requestedAction, '未知操作')),
      decision,
      reasoning: asString(item.reasoning, asString(item.summary, '')),
      riskLevel
    };
  });
}

function normalizePermissionExplanations(value: unknown): PermissionExplanationDTO[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => {
    const item = asRecord(entry);
    const decisionRaw = asString(item.decision, '').toLowerCase();
    const decision: PermissionExplanationDTO['decision'] =
      decisionRaw === 'allow' || decisionRaw === 'deny' || decisionRaw === 'ask'
        ? decisionRaw
        : 'unknown';
    const riskRaw = asString(item.riskLevel, '').toLowerCase();
    const riskLevel: PermissionExplanationDTO['riskLevel'] =
      riskRaw === 'low' || riskRaw === 'medium' || riskRaw === 'high'
        ? riskRaw
        : 'unknown';

    return {
      permissionRequestId: asNullableString(item.permissionRequestId),
      requestedAction: asString(item.requestedAction, '未知操作'),
      decision,
      reasoning: asString(item.reasoning, ''),
      riskLevel,
      timeoutMinutes: typeof item.timeoutMinutes === 'number' ? item.timeoutMinutes : undefined,
      confirmedAt: (item.confirmedAt as Date | string | undefined) || undefined
    };
  });
}

function normalizeDomainAgentContributions(value: unknown): DomainAgentContribution[] {
  return Array.isArray(value) ? (value as DomainAgentContribution[]) : [];
}

function normalizeBlockingStatusChanges(value: unknown): BlockingStatusChange[] {
  return Array.isArray(value) ? (value as BlockingStatusChange[]) : [];
}

function normalizeReportReferences(value: unknown): ReportReferenceDTO[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry) => {
    const item = asRecord(entry);
    return {
      title: asString(item.title, '未命名引用'),
      summary: asString(item.summary, '')
    };
  });
}

function normalizeToolCallSummary(value: unknown): ToolCallSummaryDTO[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry, index) => {
    const item = asRecord(entry);
    return {
      id: asString(item.id, `tool-call-${index + 1}`),
      toolName: asString(item.toolName, 'unknown_tool'),
      status: asString(item.status, 'unknown'),
      duration: typeof item.duration === 'number' ? item.duration : undefined,
      createdAt: (item.createdAt as Date | string | undefined) || undefined
    };
  });
}

function normalizeModelCallSummary(value: unknown): ModelCallSummaryDTO[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry, index) => {
    const item = asRecord(entry);
    return {
      id: asString(item.id, `model-call-${index + 1}`),
      model: asString(item.model, 'unknown_model'),
      status: asString(item.status, 'unknown'),
      duration: typeof item.duration === 'number' ? item.duration : undefined,
      totalTokens: typeof item.totalTokens === 'number' ? item.totalTokens : undefined,
      createdAt: (item.createdAt as Date | string | undefined) || undefined
    };
  });
}

function normalizeStepSummaries(value: unknown): StepSummaryDTO[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry, index) => {
    const item = asRecord(entry);
    return {
      id: asString(item.id, `step-${index + 1}`),
      name: asString(item.name, `步骤${index + 1}`),
      status: asString(item.status, 'unknown'),
      reasoningSummary: asString(item.reasoningSummary, ''),
      actionSummary: asString(item.actionSummary, ''),
      observationSummary: asString(item.observationSummary, '')
    };
  });
}

function normalizeTaskReport(report: unknown, fallbackTask: JsonObject): TaskReportDTO {
  const item = asRecord(report);
  const summaryRaw = asRecord(item.summary);
  const memoryScopeRaw = asRecord(item.memoryScope);
  const supplementalUpdates = normalizeSupplementalUpdates(item.supplementalUpdates);

  const defaultResultExplanation: ResultExplanation = {
    type: 'partial_result',
    mainContent: asString((fallbackTask as Record<string, unknown>).terminalSummary, '任务已结束。'),
    supportingEvidence: [],
    confidenceLevel: 'medium'
  };

  return {
    summary: {
      totalSteps: asNumber(summaryRaw.totalSteps, 0),
      completedSteps: asNumber(summaryRaw.completedSteps, 0),
      failedSteps: asNumber(summaryRaw.failedSteps, 0),
      finalOutputReady: Boolean(summaryRaw.finalOutputReady),
      terminalSummary: asString(summaryRaw.terminalSummary, asString((fallbackTask as Record<string, unknown>).terminalSummary, '任务已结束。'))
    },
    resultExplanation: (item.resultExplanation as ResultExplanation) || defaultResultExplanation,
    memoryScope: {
      memoryScope: asString(memoryScopeRaw.memoryScope, 'conversation'),
      memoryLoadSummary: asString(memoryScopeRaw.memoryLoadSummary, '未记录显式记忆加载摘要。'),
      memoryWriteSummary: asString(memoryScopeRaw.memoryWriteSummary, '未记录显式记忆写入摘要。'),
      knowledgeHitSummary: asString(memoryScopeRaw.knowledgeHitSummary, '未记录显式知识命中摘要。')
    },
    suggestedActions: Array.isArray(item.suggestedActions) ? (item.suggestedActions as string[]) : [],
    failureAnalysis: asNullableString(item.failureAnalysis),
    permissionExplanations: normalizePermissionExplanations(item.permissionExplanations),
    domainAgentContributions: normalizeDomainAgentContributions(item.domainAgentContributions),
    blockingStatusChanges: normalizeBlockingStatusChanges(item.blockingStatusChanges),
    degradedDelivery: (item.degradedDelivery as DegradedDeliverySummary | null) || null,
    supplementalUpdates,
    stepSummaries: normalizeStepSummaries(item.stepSummaries),
    references: normalizeReportReferences(item.references),
    toolCallSummary: normalizeToolCallSummary(item.toolCallSummary),
    modelCallSummary: normalizeModelCallSummary(item.modelCallSummary)
  };
}

export class TaskProjectionService {
  private async buildTaskExecutionView(task: any, clientId?: string): Promise<TaskExecutionView> {
    const [steps, outputs, events, subTasks, linkedMemoryRows, directMemoryRows, knowledgeHits, toolCalls, modelCalls, participants] = await Promise.all([
      taskService.getSteps(task.id),
      taskOutputService.getOutputs(task.id),
      clientId
        ? taskService.getVisibleTaskEvents(task.id, clientId, 200)
        : taskService.getTaskEvents(task.id, 200),
      taskService.getSubTasks(task.id),
      db.select().from(taskMemoryLinks).where(eq(taskMemoryLinks.taskId, task.id)),
      db.select().from(memoryEntries).where(eq(memoryEntries.taskId, task.id)),
      db.select().from(knowledgeHitLogs).where(eq(knowledgeHitLogs.taskId, task.id)),
      db.select().from(toolInvocationLogs).where(eq(toolInvocationLogs.taskId, task.id)).orderBy(desc(toolInvocationLogs.createdAt)),
      db.select().from(modelCallLogs).where(eq(modelCallLogs.taskId, task.id)).orderBy(desc(modelCallLogs.createdAt)),
      db.select().from(agentParticipations).where(eq(agentParticipations.taskId, task.id))
    ]);

    const linkedMemoryIds = linkedMemoryRows.map((row) => row.memoryId);
    const linkedMemories = linkedMemoryIds.length > 0
      ? await db.select().from(memoryEntries).where(inArray(memoryEntries.id, linkedMemoryIds))
      : [];
    const memoryDetails = [...directMemoryRows, ...linkedMemories]
      .filter((entry, index, list) => list.findIndex((candidate) => candidate.id === entry.id) === index)
      .map((entry) => ({
        id: entry.id,
        summary: entry.summary || entry.content?.slice(0, 120) || '未命名记忆',
        content: entry.content,
        sourceType: entry.sourceType,
        importance: entry.importance,
        createdAt: entry.createdAt,
        conversationId: entry.conversationId,
        taskId: entry.taskId
      }));

    const knowledgeDocIds = knowledgeHits.map((hit) => hit.documentId).filter(Boolean) as string[];
    const referencedDocs = knowledgeDocIds.length > 0
      ? await db.select().from(knowledgeDocuments).where(inArray(knowledgeDocuments.id, knowledgeDocIds))
      : [];
    const knowledgeReferences = knowledgeHits.map((hit) => {
      const document = referencedDocs.find((doc) => doc.id === hit.documentId);
      return {
        id: hit.id,
        documentId: hit.documentId,
        title: document?.title || '未命中文档标题',
        summary: document?.content?.slice(0, 160) || '',
        score: hit.score,
        sourceType: document?.sourceType || null,
        sourceTaskId: document?.sourceTaskId || null,
        agentId: document?.agentId || null,
        query: hit.query
      };
    });

    const report = buildTaskReport(task, steps, outputs, events, undefined, {
      subTasks,
      memoryEntries: memoryDetails,
      knowledgeReferences,
      toolCalls,
      modelCalls,
      agentParticipations: participants
    });

    const arrangementNoticeSummary = task.arrangementStatus
      ? `${task.arrangementStatus}: ${task.arrangementSummary || ''}`
      : null;
    const supplementalUpdates = normalizeSupplementalUpdates(report.supplementalUpdates);
    const supplementalNotificationType = supplementalUpdates.length > 0 ? 'result_supplement' : 'none';
    const taskRecord = asRecord(task);
    const normalizedReport = normalizeTaskReport(report, taskRecord);

    return {
      task: taskRecord,
      steps: asRecordArray(steps),
      outputs: asRecordArray(outputs),
      events: asRecordArray(events),
      agentExecutionSummary: normalizeAgentExecutionSummary(report.agentExecutionSummary),
      knowledgeHitSummary: report.memoryScope?.knowledgeHitSummary || '未记录知识命中摘要。',
      memoryWriteSummary: report.memoryScope?.memoryWriteSummary || '未记录记忆写回摘要。',
      supplementalUpdates,
      supplementalNotificationType,
      arrangementNoticeSummary,
      degradedDeliverySummary: (report.degradedDelivery || null) as DegradedDeliverySummary | null,
      terminalSummary: report.summary?.terminalSummary || task.terminalSummary || '任务已结束。',
      outputStage: String(task.outputStage || 'none'),
      finalOutputReady: Boolean(task.finalOutputReady),
      availableActions: report.suggestedActions || [],
      permissionExplanations: normalizePermissionExplanations(report.permissionExplanations),
      executionReport: {
        finalOutputReady: Boolean(task.finalOutputReady),
        stageNotifications: {
          arrangementStatus: asNullableString(task.arrangementStatus),
          userNotificationStage: asNullableString(task.userNotificationStage)
        },
        permissionDecisionSummary: normalizePermissionDecisionSummary(report.permissionDecisions),
        domainAgentContributions: normalizeDomainAgentContributions(report.domainAgentContributions),
        degradedDeliverySummary: (report.degradedDelivery || null) as DegradedDeliverySummary | null,
        supplementalUpdates,
        blockingStatusChanges: normalizeBlockingStatusChanges(report.blockingStatusChanges),
        terminalSummaryVisibility: {
          displayScope: asNullableString(task.displayScope),
          visibleClientIds: Array.isArray(report.visibleClientIds) ? report.visibleClientIds : []
        }
      },
      report: normalizedReport
    };
  }

  async getTaskExecutionView(taskId: string): Promise<TaskExecutionView | null> {
    const task = await taskService.getTask(taskId);
    if (!task) {
      return null;
    }

    return this.buildTaskExecutionView(task);
  }

  async getVisibleTaskExecutionView(taskId: string, clientId: string): Promise<TaskExecutionView | null> {
    const task = await taskService.getVisibleTask(taskId, clientId);
    if (!task) {
      return null;
    }

    return this.buildTaskExecutionView(task, clientId);
  }
}

export const taskProjectionService = new TaskProjectionService();
