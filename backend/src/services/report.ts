import { TaskStatus } from '../types/index.js';

function parseJsonValue<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export interface ResultExplanation {
  type: 'final_conclusion' | 'partial_result' | 'degraded_delivery' | 'supplementary_update' | 'error_explanation';
  mainContent: string;
  supportingEvidence: SupportingEvidence[];
  confidenceLevel: 'high' | 'medium' | 'low';
  caveats?: string[];
  suggestedFollowUp?: string[];
}

export interface SupportingEvidence {
  source: 'step_output' | 'knowledge_reference' | 'memory_entry' | 'domain_agent' | 'tool_execution';
  sourceId?: string;
  content: string;
  relevanceScore?: number;
}

export interface DegradedDeliverySummary {
  summary: string;
  completedBlockingTasks: BlockingTaskResult[];
  failedOrSkippedNonBlockingTasks: NonBlockingTaskResult[];
  impactScope: string;
  reason?: string;
  action?: string;
  stillDeliverableReason: string;
  completionPercentage: number;
}

export interface BlockingTaskResult {
  taskId: string;
  taskName: string;
  status: TaskStatus;
  outputSummary?: string | null;
  completedAt?: Date;
}

export interface NonBlockingTaskResult {
  taskId: string;
  taskName: string;
  status: TaskStatus;
  reason?: string;
  skipped?: boolean;
  lateArrival?: boolean;
}

export interface BlockingStatusChange {
  taskId: string;
  previousStatus: 'blocking' | 'non-blocking';
  newStatus: 'blocking' | 'non-blocking';
  reason: string;
  timestamp: Date;
}

export interface DomainAgentContribution {
  agentId: string;
  agentName?: string;
  subtaskId: string;
  subtaskName: string;
  contribution: string;
  resultSummary: string;
  isBlocking: boolean;
  completedAt?: Date | null;
}

export interface PermissionExplanation {
  permissionRequestId?: string;
  requestedAction: string;
  decision: 'allow' | 'deny' | 'ask';
  reasoning: string;
  riskLevel: 'low' | 'medium' | 'high';
  timeoutMinutes?: number;
  confirmedAt?: Date;
}

export interface TaskReportReference {
  title: string;
  summary: string;
}

export interface PermissionDecisionSummary {
  requestId?: string | null;
  layer?: string | null;
  policyName?: string | null;
  reason?: string | null;
  action?: string;
  requestedAction?: string;
  decision?: 'allow' | 'deny' | 'ask' | 'unknown';
  reasoning?: string;
  summary?: string;
  riskLevel?: 'low' | 'medium' | 'high' | 'unknown';
  timeoutMinutes?: number;
  confirmedAt?: Date | string;
}

export interface TaskReportMemoryEntry {
  id: string;
  summary: string;
  content?: string;
  sourceType?: string | null;
  importance?: string | null;
  createdAt?: Date;
  conversationId?: string | null;
  taskId?: string | null;
}

export interface TaskReportKnowledgeReference {
  id: string;
  documentId: string | null;
  title: string;
  summary: string;
  score?: number | null;
  sourceType?: string | null;
  sourceTaskId?: string | null;
  agentId?: string | null;
  query?: string | null;
}

export interface ToolCallSummary {
  id: string;
  toolName: string;
  status: string;
  duration?: number | null;
  createdAt?: Date | null;
}

export interface ModelCallSummary {
  id: string;
  model: string;
  status: string;
  duration?: number | null;
  totalTokens?: number | null;
  createdAt?: Date | null;
}

export interface AgentExecutionSummary {
  agentId: string;
  stepId: string;
  status: string;
  reasoningSummary: string;
  actionSummary: string;
  observationSummary: string;
}

export interface StepSummary {
  id: string;
  name: string;
  status: string;
  reasoningSummary: string;
  actionSummary: string;
  observationSummary: string;
}

export interface SupplementalUpdate {
  id: string;
  content: string;
  arrivedAt: Date;
  stepSummary?: string;
  outputType: string;
}

export type NotificationStage = 'arranged' | 'final' | 'supplemental' | 'terminal';

export interface NotificationRecord {
  id: string;
  stage: NotificationStage;
  summary: string;
  timestamp: Date;
}

export interface TaskStatusSummary {
  totalSteps: number;
  completedSteps: number;
  failedSteps: number;
  finalOutputReady: boolean;
  terminalSummary: string;
}

export interface TaskMemoryScopeSummary {
  memoryScope: string;
  memoryLoadSummary: string;
  memoryWriteSummary: string;
  knowledgeHitSummary: string;
}

export interface TaskReportTaskSnapshot {
  id?: string;
  status?: TaskStatus | string | null;
  closeReason?: string | null;
  errorMessage?: string | null;
  outputStage?: string | null;
  arrangementStatus?: string | null;
  arrangementSummary?: string | null;
  interventionRequiredReason?: string | null;
  intakeInputSummary?: string | null;
  terminalSummary: string;
  finalOutputReady?: boolean | null;
  degradeReason?: string | null;
  degradeAction?: string | null;
  waitingAnomalySummary?: string | null;
  clarificationRequiredFields?: unknown;
  completedAt?: Date | null;
  visibleClientIds?: string[] | string | null;
  supplementalUpdates: SupplementalUpdate[];
  supplementalNotificationType: string;
  degradedDelivery: DegradedDeliverySummary | null;
  availableActions: string[];
  notificationRecords: NotificationRecord[];
}

export interface TaskStepInput {
  id: string;
  name?: string | null;
  taskId?: string | null;
  status: string;
  assignedAgentId?: string | null;
  reasoningSummary?: string | null;
  reasoning?: string | null;
  actionSummary?: string | null;
  action?: string | null;
  observationSummary?: string | null;
  observation?: string | null;
}

export interface TaskOutputInput {
  id: string;
  taskId?: string | null;
  type: string;
  content?: string | null;
  summary?: string | null;
  references?: string | null;
  createdAt: Date;
}

export interface TaskEventInput {
  id: string;
  taskId?: string | null;
  eventType: string;
  summary?: string | null;
  payload?: string | null;
  timestamp: Date;
}

export interface SubTaskInput {
  id: string;
  status: TaskStatus | string;
  blocking?: string | null;
  intakeInputSummary?: string | null;
  outputStage?: string | null;
  completedAt?: Date | null;
  errorMessage?: string | null;
  closeReason?: string | null;
  assignedDomainAgentId?: string | null;
  arrangementSummary?: string | null;
}

export interface ToolCallInput {
  id: string;
  toolName: string;
  status: string;
  duration?: number | null;
  createdAt?: Date | null;
}

export interface ModelCallInput {
  id: string;
  model: string;
  status: string;
  duration?: number | null;
  totalTokens?: number | null;
  createdAt?: Date | null;
}

export interface AgentParticipationInput {
  id: string;
  agentId: string;
  role?: string | null;
  joinedAt?: Date | null;
  leftAt?: Date | null;
}

export interface PermissionEventPayload {
  requestId?: string;
  action?: string;
  decision?: string;
  reasoning?: string;
  summary?: string;
  riskLevel?: string;
  timeoutMinutes?: number;
}

export interface BlockingStatusPayload {
  taskId?: string;
  previousStatus?: string;
  newStatus?: string;
  reason?: string;
  summary?: string;
}

export interface TaskSnapshotInput {
  id?: string;
  status?: TaskStatus | string | null;
  closeReason?: string | null;
  errorMessage?: string | null;
  outputStage?: string | null;
  arrangementStatus?: string | null;
  arrangementSummary?: string | null;
  interventionRequiredReason?: string | null;
  intakeInputSummary?: string | null;
  terminalSummary?: string | null;
  completedAt?: Date | null;
  finalOutputReady?: boolean | null;
  degradeReason?: string | null;
  degradeAction?: string | null;
  memoryScope?: string | null;
  memoryLoadSummary?: string | null;
  memoryWriteSummary?: string | null;
  knowledgeHitSummary?: string | null;
  permissionDecisionTrace?: string | null;
  waitingAnomalySummary?: string | null;
  clarificationRequiredFields?: unknown;
  visibleClientIds?: string[] | string | null;
}

function deriveTerminalSummary(task: TaskSnapshotInput) {
  if (task?.terminalSummary) {
    return task.terminalSummary;
  }

  if (task?.status === 'cancelled') {
    return task.closeReason ? `任务已取消: ${task.closeReason}` : '任务已取消。';
  }

  if (task?.status === 'failed') {
    return task.errorMessage || task.closeReason || '任务执行失败，未形成完整最终输出。';
  }

  if (task?.outputStage === 'arranged_only' || (task?.arrangementStatus && !task?.finalOutputReady)) {
    return task.arrangementSummary || '任务已安排完成，尚未形成最终输出。';
  }

  if (task?.interventionRequiredReason) {
    return `任务已停止等待人工处理: ${task.interventionRequiredReason}`;
  }

  return task?.intakeInputSummary || '任务已结束。';
}

function buildReferences(outputs: TaskOutputInput[]): TaskReportReference[] {
  const refs = outputs.flatMap((output) => {
    const parsed = parseJsonValue<Array<string | { title?: string; summary?: string }>>(output.references, []);
    return parsed.map((entry) => {
      if (typeof entry === 'string') {
        return { title: entry, summary: '' };
      }

      return {
        title: entry.title || entry.summary || '未命名引用',
        summary: entry.summary || ''
      };
    });
  });

  return refs.filter((ref, index, list) => list.findIndex((item) => item.title === ref.title && item.summary === ref.summary) === index);
}

function normalizePermissionDecision(value: unknown): 'allow' | 'deny' | 'ask' | 'unknown' {
  if (typeof value !== 'string') {
    return 'unknown';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'allow' || normalized === 'approved') {
    return 'allow';
  }
  if (normalized === 'deny' || normalized === 'denied' || normalized === 'rejected') {
    return 'deny';
  }
  if (normalized === 'ask' || normalized === 'pending') {
    return 'ask';
  }

  return 'unknown';
}

function normalizePermissionRiskLevel(value: unknown): 'low' | 'medium' | 'high' | 'unknown' {
  if (typeof value !== 'string') {
    return 'unknown';
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
    return normalized;
  }

  return 'unknown';
}

function buildPermissionDecisions(task: TaskSnapshotInput, permissionDecisions?: PermissionDecisionSummary[]): PermissionDecisionSummary[] {
  const source = permissionDecisions && permissionDecisions.length > 0
    ? permissionDecisions
    : parseJsonValue<PermissionDecisionSummary[]>(task?.permissionDecisionTrace, []);

  return source.map((item) => ({
    ...item,
    decision: normalizePermissionDecision(item?.decision),
    riskLevel: normalizePermissionRiskLevel(item?.riskLevel)
  }));
}

function buildPermissionExplanations(task: TaskSnapshotInput, events: TaskEventInput[]): PermissionExplanation[] {
  const permissionEvents = events.filter(e =>
    e.eventType.includes('Permission') ||
    e.eventType.includes('permission')
  );

  return permissionEvents.map(e => {
    const payload = parseJsonValue<PermissionEventPayload>(e.payload, {});
    const decision: PermissionExplanation['decision'] =
      payload.decision === 'allow' || payload.decision === 'deny' || payload.decision === 'ask'
        ? payload.decision
        : 'ask';
    const riskLevel: PermissionExplanation['riskLevel'] =
      payload.riskLevel === 'low' || payload.riskLevel === 'medium' || payload.riskLevel === 'high'
        ? payload.riskLevel
        : 'medium';

    return {
      permissionRequestId: payload.requestId,
      requestedAction: payload.action || '未知操作',
      decision,
      reasoning: payload.reasoning || payload.summary || '',
      riskLevel,
      timeoutMinutes: payload.timeoutMinutes,
      confirmedAt: e.timestamp
    };
  });
}

function buildSuggestedActions(task: TaskSnapshotInput, failedSteps: number) {
  const actions: string[] = [];

  if (task?.status === 'failed' || failedSteps > 0) {
    actions.push('retry_task');
  }

  if (task?.status === 'pending' || task?.status === 'queued' || task?.status === 'clarification_pending') {
    actions.push('view_task');
    actions.push('cancel_task');
  }

  if (task?.waitingAnomalySummary || task?.interventionRequiredReason) {
    actions.push('continue_wait');
    actions.push('rearrange_task');
  }

  if (task?.clarificationRequiredFields) {
    actions.push('clarify_task');
  }

  if (task?.finalOutputReady) {
    actions.push('view_result');
  }

  return Array.from(new Set(actions));
}

function buildDomainAgentContributions(task: TaskSnapshotInput, subTasks: SubTaskInput[], outputs: TaskOutputInput[]): DomainAgentContribution[] {
  if (!subTasks || subTasks.length === 0) {
    return [];
  }

  return subTasks.map(subTask => {
    const relatedOutputs = outputs.filter(o => o.taskId === subTask.id);
    const mainOutput = relatedOutputs.find(o => o.type === 'final') || relatedOutputs[0];

    return {
      agentId: subTask.assignedDomainAgentId || 'unknown',
      subtaskId: subTask.id,
      subtaskName: subTask.intakeInputSummary || `子任务 ${subTask.id.slice(0, 8)}`,
      contribution: mainOutput?.summary || subTask.arrangementSummary || '',
      resultSummary: mainOutput?.content || mainOutput?.summary || '',
      isBlocking: subTask.blocking === 'blocking',
      completedAt: subTask.completedAt
    };
  });
}

function buildBlockingStatusChanges(events: TaskEventInput[]): BlockingStatusChange[] {
  const blockingEvents = events.filter(e =>
    e.eventType === 'BlockingStatusChanged' ||
    e.eventType.includes('blocking')
  );

  return blockingEvents.map(e => {
    const payload = parseJsonValue<BlockingStatusPayload>(e.payload, {});
    const previousStatus: BlockingStatusChange['previousStatus'] =
      payload.previousStatus === 'blocking' || payload.previousStatus === 'non-blocking'
        ? payload.previousStatus
        : 'non-blocking';
    const newStatus: BlockingStatusChange['newStatus'] =
      payload.newStatus === 'blocking' || payload.newStatus === 'non-blocking'
        ? payload.newStatus
        : 'blocking';

    return {
      taskId: payload.taskId || e.taskId || 'unknown-task',
      previousStatus,
      newStatus,
      reason: payload.reason || payload.summary || '',
      timestamp: e.timestamp
    };
  });
}

function buildDegradedDeliverySummary(
  task: TaskSnapshotInput,
  subTasks: SubTaskInput[],
  steps: TaskStepInput[]
): DegradedDeliverySummary | null {
  const hasDegradation =
    task?.degradeReason ||
    task?.degradeAction ||
    steps.some(s => s.status === 'failed');

  if (!hasDegradation) {
    return null;
  }

  const blockingTasks = subTasks?.filter(t => t.blocking === 'blocking') || [];
  const nonBlockingTasks = subTasks?.filter(t => t.blocking !== 'blocking') || [];
  const failedSteps = steps.filter(s => s.status === 'failed');

  const completedBlocking: BlockingTaskResult[] = blockingTasks
    .filter(t => t.status === TaskStatus.COMPLETED)
    .map(t => ({
      taskId: t.id,
      taskName: t.intakeInputSummary || `阻塞任务 ${t.id.slice(0, 8)}`,
      status: t.status as TaskStatus,
      outputSummary: t.outputStage,
      completedAt: t.completedAt || undefined
    }));

  const failedOrSkippedNonBlocking: NonBlockingTaskResult[] = nonBlockingTasks
    .filter(t => t.status === TaskStatus.FAILED || t.status === TaskStatus.CANCELLED)
    .map(t => ({
      taskId: t.id,
      taskName: t.intakeInputSummary || `非阻塞任务 ${t.id.slice(0, 8)}`,
      status: t.status as TaskStatus,
      reason: t.errorMessage || t.closeReason || undefined
    }));

  const completedCount = blockingTasks.filter(t => t.status === TaskStatus.COMPLETED).length;
  const totalCount = blockingTasks.length || 1;
  const completionPercentage = Math.round((completedCount / totalCount) * 100);

  const allBlockingCompleted = completedCount === blockingTasks.length;
  const stillDeliverableReason = allBlockingCompleted
    ? '所有核心阻塞任务已完成，结果可交付'
    : '部分核心任务已完成，系统决定继续交付并标记为降级';

  return {
    summary: task?.degradeReason || `${failedSteps.length} 个步骤未成功完成，当前结果为降级交付。`,
    completedBlockingTasks: completedBlocking,
    failedOrSkippedNonBlockingTasks: failedOrSkippedNonBlocking,
    impactScope: failedSteps.length > 0
      ? `共有 ${failedSteps.length} / ${steps.length || 1} 个步骤失败或被跳过。`
      : `降级原因: ${task?.degradeReason || '未知'}`,
    reason: task?.degradeReason || undefined,
    action: task?.degradeAction || undefined,
    stillDeliverableReason,
    completionPercentage
  };
}

function buildResultExplanation(
  task: TaskSnapshotInput,
  degradedDelivery: DegradedDeliverySummary | null,
  supplementalUpdates: SupplementalUpdate[]
): ResultExplanation {
  let type: ResultExplanation['type'] = 'final_conclusion';
  let confidenceLevel: ResultExplanation['confidenceLevel'] = 'high';
  let caveats: string[] = [];

  if (degradedDelivery) {
    type = 'degraded_delivery';
    confidenceLevel = 'medium';
    caveats.push(`完成度: ${degradedDelivery.completionPercentage}%`);
    if (degradedDelivery.failedOrSkippedNonBlockingTasks.length > 0) {
      caveats.push(`有 ${degradedDelivery.failedOrSkippedNonBlockingTasks.length} 个非核心任务未完成`);
    }
  }

  if (supplementalUpdates.length > 0) {
    type = 'supplementary_update';
    confidenceLevel = 'high';
  }

  if (task?.status === TaskStatus.FAILED) {
    type = 'error_explanation';
    confidenceLevel = 'low';
    caveats.push(`错误原因: ${task.errorMessage || task.closeReason || '未知'}`);
  }

  const mainContent = task?.finalOutputReady
    ? '任务已成功完成'
    : degradedDelivery
      ? `任务以降级方式完成 (${degradedDelivery.completionPercentage}%)`
      : deriveTerminalSummary(task);

  return {
    type,
    mainContent,
    supportingEvidence: [],
    confidenceLevel,
    caveats: caveats.length > 0 ? caveats : undefined,
    suggestedFollowUp: buildSuggestedFollowUps(task, degradedDelivery)
  };
}

function buildSuggestedFollowUps(
  task: TaskSnapshotInput,
  degradedDelivery: DegradedDeliverySummary | null
): string[] | undefined {
  const followUps: string[] = [];

  if (degradedDelivery) {
    if (degradedDelivery.completedBlockingTasks.length < degradedDelivery.completedBlockingTasks.length) {
      followUps.push('查看未完成的核心任务详情');
    }
    if (degradedDelivery.failedOrSkippedNonBlockingTasks.length > 0) {
      followUps.push('重新执行失败的补充任务');
    }
  }

  if (task?.status === TaskStatus.FAILED) {
    followUps.push('查看错误详情');
    followUps.push('重试任务');
  }

  return followUps.length > 0 ? followUps : undefined;
}

export function buildTaskReport(
  task: TaskSnapshotInput,
  steps: TaskStepInput[],
  outputs: TaskOutputInput[],
  events: TaskEventInput[],
  permissionDecisions?: PermissionDecisionSummary[],
  extras?: {
    subTasks?: SubTaskInput[];
    memoryEntries?: TaskReportMemoryEntry[];
    knowledgeReferences?: TaskReportKnowledgeReference[];
    toolCalls?: ToolCallInput[];
    modelCalls?: ModelCallInput[];
    agentParticipations?: AgentParticipationInput[];
  }
): TaskReport {
  const completedAt = task?.completedAt ? new Date(task.completedAt).getTime() : null;
  const supplementalUpdates: SupplementalUpdate[] = outputs
    .filter((output) => output.type !== 'final' && completedAt && new Date(output.createdAt).getTime() > completedAt)
    .map((output) => ({
      id: output.id,
      content: output.content || output.summary || '补充结果已到达。',
      arrivedAt: output.createdAt,
      stepSummary: output.summary || undefined,
      outputType: output.type
    }));

  const notificationRecords: NotificationRecord[] = events
    .filter((event) => ['TaskArrangementCompleted', 'TaskCompleted', 'TaskFailed', 'TaskCancelled', 'TaskOutputCreated'].includes(event.eventType))
    .map((event) => ({
      id: event.id,
      stage: event.eventType === 'TaskArrangementCompleted'
        ? 'arranged'
        : event.eventType === 'TaskCompleted'
          ? 'final'
          : event.eventType === 'TaskOutputCreated' && completedAt && new Date(event.timestamp).getTime() > completedAt
            ? 'supplemental'
            : 'terminal',
      summary: event.summary || event.eventType,
      timestamp: event.timestamp
    }));

  const failedSteps = steps.filter((step) => step.status === 'failed').length;
  const subTasks = extras?.subTasks || [];

  const degradedDelivery = buildDegradedDeliverySummary(task, subTasks, steps);
  const permissionExplanations = buildPermissionExplanations(task, events);
  const domainAgentContributions = buildDomainAgentContributions(task, subTasks, outputs);
  const blockingStatusChanges = buildBlockingStatusChanges(events);
  const resultExplanation = buildResultExplanation(task, degradedDelivery, supplementalUpdates);

  const parsedPermissionDecisions = buildPermissionDecisions(task, permissionDecisions);
  const suggestedActions = buildSuggestedActions(task, failedSteps);
  const toolCalls = extras?.toolCalls || [];
  const modelCalls = extras?.modelCalls || [];
  const memoryEntries = extras?.memoryEntries || [];
  const knowledgeReferences = extras?.knowledgeReferences || [];
  const agentParticipations = extras?.agentParticipations || [];
  const statusSummary: TaskStatusSummary = {
    totalSteps: steps.length,
    completedSteps: steps.filter((step) => step.status === 'completed').length,
    failedSteps,
    finalOutputReady: Boolean(task?.finalOutputReady),
    terminalSummary: deriveTerminalSummary(task)
  };
  const memoryScopeSummary: TaskMemoryScopeSummary = {
    memoryScope: task?.memoryScope || 'conversation',
    memoryLoadSummary: task?.memoryLoadSummary || '未记录显式记忆加载摘要。',
    memoryWriteSummary: task?.memoryWriteSummary || '未记录显式记忆写入摘要。',
    knowledgeHitSummary: task?.knowledgeHitSummary || '未记录显式知识命中摘要。'
  };

  return {
    task: {
      ...task,
      terminalSummary: deriveTerminalSummary(task),
      supplementalUpdates,
      supplementalNotificationType: supplementalUpdates.length > 0 ? 'supplemental_update' : 'none',
      degradedDelivery,
      availableActions: suggestedActions,
      notificationRecords
    },
    steps,
    outputs,
    events,
    references: buildReferences(outputs),
    permissionDecisions: parsedPermissionDecisions,
    permissionExplanations,
    memoryEntries,
    knowledgeReferences,
    toolCallSummary: toolCalls.map((toolCall) => ({
      id: toolCall.id,
      toolName: toolCall.toolName,
      status: toolCall.status,
      duration: toolCall.duration,
      createdAt: toolCall.createdAt
    })),
    modelCallSummary: modelCalls.map((modelCall) => ({
      id: modelCall.id,
      model: modelCall.model,
      status: modelCall.status,
      duration: modelCall.duration,
      totalTokens: modelCall.totalTokens,
      createdAt: modelCall.createdAt
    })),
    agentExecutionSummary: steps
      .filter((step) => step.assignedAgentId || step.status === 'completed' || step.status === 'failed')
      .map((step) => ({
        agentId: step.assignedAgentId || 'system',
        stepId: step.id,
        status: step.status,
        reasoningSummary: step.reasoningSummary || step.reasoning || '',
        actionSummary: step.actionSummary || step.action || '',
        observationSummary: step.observationSummary || step.observation || ''
      })),
    domainAgentContributions,
    blockingStatusChanges,
    suggestedActions,
    failureAnalysis: task?.errorMessage || degradedDelivery?.summary || null,
    summary: statusSummary,
    resultExplanation,
    memoryScope: memoryScopeSummary,
    stepSummaries: steps.map((step) => ({
      id: step.id,
      name: step.name || `步骤 ${step.id.slice(0, 8)}`,
      status: step.status,
      reasoningSummary: step.reasoningSummary || '',
      actionSummary: step.actionSummary || '',
      observationSummary: step.observationSummary || ''
    })),
    degradedDelivery,
    supplementalUpdates,
    visibleClientIds: Array.isArray(task?.visibleClientIds) ? task.visibleClientIds : []
  };
}

export interface TaskReport {
  task: TaskReportTaskSnapshot;
  steps: TaskStepInput[];
  outputs: TaskOutputInput[];
  events: TaskEventInput[];
  references: TaskReportReference[];
  permissionDecisions: PermissionDecisionSummary[];
  permissionExplanations: PermissionExplanation[];
  memoryEntries: TaskReportMemoryEntry[];
  knowledgeReferences: TaskReportKnowledgeReference[];
  toolCallSummary: ToolCallSummary[];
  modelCallSummary: ModelCallSummary[];
  agentExecutionSummary: AgentExecutionSummary[];
  domainAgentContributions: DomainAgentContribution[];
  blockingStatusChanges: BlockingStatusChange[];
  suggestedActions: string[];
  failureAnalysis: string | null;
  summary: TaskStatusSummary;
  resultExplanation: ResultExplanation;
  memoryScope: TaskMemoryScopeSummary;
  stepSummaries: StepSummary[];
  degradedDelivery?: DegradedDeliverySummary | null;
  supplementalUpdates?: SupplementalUpdate[];
  supplementalNotificationType?: string;
  visibleClientIds?: string[];
}
