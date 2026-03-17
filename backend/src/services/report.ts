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

function deriveTerminalSummary(task: any) {
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

function buildReferences(outputs: any[]) {
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

function buildPermissionDecisions(task: any, permissionDecisions?: any[]) {
  if (permissionDecisions && permissionDecisions.length > 0) {
    return permissionDecisions;
  }

  return parseJsonValue<any[]>(task?.permissionDecisionTrace, []);
}

function buildSuggestedActions(task: any, failedSteps: number) {
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

export function buildTaskReport(
  task: any,
  steps: any[],
  outputs: any[],
  events: any[],
  permissionDecisions?: any[],
  extras?: {
    memoryEntries?: any[];
    knowledgeReferences?: any[];
    toolCalls?: any[];
    modelCalls?: any[];
    agentParticipations?: any[];
  }
) {
  const completedAt = task?.completedAt ? new Date(task.completedAt).getTime() : null;
  const supplementalUpdates = outputs
    .filter((output) => output.type !== 'final' && completedAt && new Date(output.createdAt).getTime() > completedAt)
    .map((output) => ({
      id: output.id,
      content: output.content || output.summary || '补充结果已到达。',
      arrivedAt: output.createdAt,
      stepSummary: output.summary || undefined,
      outputType: output.type
    }));

  const notificationRecords = events
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
  const degradedDelivery = task?.degradeReason || task?.degradeAction || failedSteps > 0
    ? {
        summary: task?.degradeReason || task?.degradeAction || `${failedSteps} 个步骤未成功完成，当前结果为降级交付。`,
        impactScope: failedSteps > 0 ? `共有 ${failedSteps} / ${steps.length || 1} 个步骤失败或被跳过。` : undefined,
        reason: task?.degradeReason || undefined,
        action: task?.degradeAction || undefined
      }
    : null;

  const parsedPermissionDecisions = buildPermissionDecisions(task, permissionDecisions);
  const suggestedActions = buildSuggestedActions(task, failedSteps);
  const toolCalls = extras?.toolCalls || [];
  const modelCalls = extras?.modelCalls || [];
  const memoryEntries = extras?.memoryEntries || [];
  const knowledgeReferences = extras?.knowledgeReferences || [];
  const agentParticipations = extras?.agentParticipations || [];

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
    agentExecutionSummary: agentParticipations.map((participant) => ({
      id: participant.id,
      agentId: participant.agentId,
      role: participant.role,
      joinedAt: participant.joinedAt,
      leftAt: participant.leftAt
    })),
    suggestedActions,
    failureAnalysis: task?.errorMessage || degradedDelivery?.summary || null,
    summary: {
      totalSteps: steps.length,
      completedSteps: steps.filter((step) => step.status === 'completed').length,
      failedSteps,
      finalOutputReady: Boolean(task?.finalOutputReady),
      terminalSummary: deriveTerminalSummary(task)
    },
    memoryScope: {
      memoryScope: task?.memoryScope || 'conversation',
      memoryLoadSummary: task?.memoryLoadSummary || '未记录显式记忆加载摘要。',
      memoryWriteSummary: task?.memoryWriteSummary || '未记录显式记忆写入摘要。',
      knowledgeHitSummary: task?.knowledgeHitSummary || '未记录显式知识命中摘要。'
    },
    stepSummaries: steps.map((step) => ({
      id: step.id,
      name: step.name,
      status: step.status,
      reasoningSummary: step.reasoningSummary,
      actionSummary: step.actionSummary,
      observationSummary: step.observationSummary
    }))
  };
}