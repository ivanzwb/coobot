import { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAppStore, Message, PendingAttachment, Task, TaskStep } from '../stores/appStore';
import { api } from '../api/client';
import { format } from 'date-fns';

interface Attachment {
  id: string;
  type: 'image' | 'file';
  name: string;
  url: string;
  preview?: string;
  file?: File;
}

interface PendingPermissionRequest {
  id: string;
  action: string;
  target: string;
  description?: string;
  status?: string;
}

interface ChatAreaProps {
  onPermissionRequestIdsChange?: (requestIds: string[]) => void;
}

export function ChatArea({ onPermissionRequestIdsChange }: ChatAreaProps) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hydratedTaskIdRef = useRef<string | null>(null);
  const navigate = useNavigate();
  const params = useParams<{ conversationId: string }>();
  const { messages, isLoading, sendMessage, currentTask, tasks, currentTaskSteps, currentTaskOutputs, cancelTask, retryTask, conversationId, switchConversation, fetchTaskDetail } = useAppStore();
  const [pendingPermissions, setPendingPermissions] = useState<PendingPermissionRequest[]>([]);

  useEffect(() => {
    if (params.conversationId && params.conversationId !== conversationId) {
      void switchConversation(params.conversationId);
    }
  }, [params.conversationId, conversationId, switchConversation]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    const focusTask = currentTask
      || tasks.find((task) => !['completed', 'TaskCompleted', 'failed', 'TaskFailed', 'cancelled', 'TaskCancelled'].includes(task.status))
      || tasks[0]
      || null;

    if (!focusTask) {
      hydratedTaskIdRef.current = null;
      return;
    }

    if (currentTask?.id === focusTask.id && currentTaskSteps.length > 0) {
      hydratedTaskIdRef.current = focusTask.id;
      return;
    }

    if (hydratedTaskIdRef.current === focusTask.id) {
      return;
    }

    hydratedTaskIdRef.current = focusTask.id;
    void fetchTaskDetail(focusTask.id, { silent: true });
  }, [currentTask, currentTaskSteps.length, tasks, fetchTaskDetail]);

  useEffect(() => {
    const loadPendingPermissions = async () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }

      try {
        const requests = await api.getPendingPermissions() as PendingPermissionRequest[];
        setPendingPermissions(Array.isArray(requests) ? requests : []);
      } catch {
        setPendingPermissions([]);
      }
    };

    void loadPendingPermissions();
    const timer = window.setInterval(() => {
      void loadPendingPermissions();
    }, 15000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!onPermissionRequestIdsChange) {
      return;
    }

    onPermissionRequestIdsChange(pendingPermissions.map((request) => request.id));

    return () => {
      onPermissionRequestIdsChange([]);
    };
  }, [pendingPermissions, onPermissionRequestIdsChange]);

  const handleApprovePermission = async (id: string) => {
    await api.approvePermissionRequest(id);
    setPendingPermissions((prev) => prev.filter((item) => item.id !== id));
  };

  const handleRejectPermission = async (id: string) => {
    await api.rejectPermissionRequest(id);
    setPendingPermissions((prev) => prev.filter((item) => item.id !== id));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && attachments.length === 0) || isLoading) return;
    await sendMessage(input, attachments.length > 0 ? attachments : undefined);
    setInput('');
    setAttachments([]);
  };

  const latestTask =
    tasks.find(t => t.id === currentTask?.id)
    || tasks.find((task) => !['completed', 'TaskCompleted', 'failed', 'TaskFailed', 'cancelled', 'TaskCancelled'].includes(task.status))
    || tasks[0]
    || null;
  const handleCancelTask = async (taskId: string) => {
    if (window.confirm('确定要取消这个任务吗?')) {
      await cancelTask(taskId);
    }
  };

  const handleRetryTask = async (taskId: string) => {
    await retryTask(taskId);
  };

  return (
    <div className="chat-page">
      {latestTask && (
        <ConversationTaskStatusBar
          task={latestTask}
          steps={currentTaskSteps}
          onRetryTask={handleRetryTask}
          onCancelTask={handleCancelTask}
          onViewTask={(id) => navigate(`/tasks/${id}`)}
          onViewResult={(id) => navigate(`/results/${id}`)}
        />
      )}

      <ConversationMessagePanel
        messages={messages}
        tasks={tasks}
        currentTaskId={currentTask?.id || null}
        currentTaskSteps={currentTaskSteps}
        currentTaskOutputs={currentTaskOutputs}
        pendingPermissions={pendingPermissions}
        isLoading={isLoading}
        messagesEndRef={messagesEndRef}
        onRetryTask={handleRetryTask}
        onCancelTask={handleCancelTask}
        onApprovePermission={handleApprovePermission}
        onRejectPermission={handleRejectPermission}
        onViewTask={(id) => navigate(`/tasks/${id}`)}
        onViewResult={(id) => navigate(`/results/${id}`)}
      />

      <ConversationComposer
        input={input}
        attachments={attachments}
        onChange={setInput}
        onAttachmentsChange={setAttachments}
        onSubmit={handleSubmit}
        isLoading={isLoading}
      />
    </div>
  );
}

interface ConversationMessagePanelProps {
  messages: Message[];
  tasks: Task[];
  currentTaskId: string | null;
  currentTaskSteps: TaskStep[];
  currentTaskOutputs: Array<{ id: string; type: string; content?: string; summary?: string }>;
  pendingPermissions: PendingPermissionRequest[];
  isLoading: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  onRetryTask: (taskId: string) => void;
  onCancelTask: (taskId: string) => void;
  onApprovePermission: (requestId: string) => void;
  onRejectPermission: (requestId: string) => void;
  onViewTask: (taskId: string) => void;
  onViewResult: (taskId: string) => void;
}

function isTaskCompletedLike(task: Task) {
  return (
    task.status === 'completed' ||
    task.status === 'TaskCompleted' ||
    task.status === 'manually_closed' ||
    task.finalOutputReady === true ||
    task.outputStage === 'final' ||
    task.userNotificationStage === 'final_notified' ||
    (task.arrangementStatus === 'arranged_completed' && task.userNotificationStage === 'final_notified') ||
    Boolean(task.completedAt)
  );
}

function normalizeTaskStatus(task: Task) {
  const status = task.status;
  const arrangementStatus = task.arrangementStatus;
  const triggerStatus = (task as Task & { triggerStatus?: string }).triggerStatus;

  const isArranged = arrangementStatus === 'arranged_completed' || arrangementStatus === 'TaskArrangementCompleted';
  const isRunning = status === 'running' || status === 'TaskExecuting';
  const isCompleted = isTaskCompletedLike(task);
  const isFailed =
    status === 'failed' ||
    status === 'TaskFailed' ||
    status === 'partial_failed' ||
    status === 'timed_out' ||
    status === 'intervention_required';
  const isClarification = status === 'clarification_pending' || status === 'TaskClarificationPending';
  const isWaiting =
    status === 'pending' ||
    status === 'TaskPending' ||
    status === 'queued' ||
    status === 'TaskQueued' ||
    status === 'waiting' ||
    status === 'scheduled' ||
    status === 'event_triggered' ||
    status === 'ready_for_planning' ||
    triggerStatus === 'waiting_schedule' ||
    triggerStatus === 'waiting_event';

  return {
    isArranged,
    isRunning,
    isCompleted,
    isFailed,
    isClarification,
    isWaiting,
    triggerStatus
  };
}

export function ConversationMessagePanel({
  messages,
  tasks,
  currentTaskId,
  currentTaskSteps,
  currentTaskOutputs,
  pendingPermissions,
  isLoading,
  messagesEndRef,
  onRetryTask,
  onCancelTask,
  onApprovePermission,
  onRejectPermission,
  onViewTask,
  onViewResult
}: ConversationMessagePanelProps) {
  const EMPTY_RESULT_PREVIEW = '暂无可展示结果内容。';
  const [taskResultPreviewById, setTaskResultPreviewById] = useState<Record<string, string>>({});
  const [loadingResultPreviewById, setLoadingResultPreviewById] = useState<Record<string, boolean>>({});
  const [taskStepsById, setTaskStepsById] = useState<Record<string, TaskStep[]>>({});
  const [loadingTaskStepsById, setLoadingTaskStepsById] = useState<Record<string, boolean>>({});

  const truncateText = (value: string, maxLength = 250) => {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (normalized.length <= maxLength) {
      return normalized;
    }

    return `${normalized.slice(0, maxLength).trimEnd()}...`;
  };

  const isGenericResultText = (value?: string) => {
    if (!value) {
      return true;
    }

    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return true;
    }

    return [
      '任务执行成功',
      '任务已完成',
      '任务完成',
      '任务已成功完成',
      '任务结束',
      '任务已结束'
    ].includes(normalized);
  };

  const extractPreviewFromOutputs = (outputs: Array<{ type?: string; summary?: string; content?: string }>) => {
    const preferredOutput = outputs.find((output) => output.type === 'final') || outputs[0];
    if (!preferredOutput) {
      return '';
    }

    const content = typeof preferredOutput.content === 'string' ? preferredOutput.content.trim() : '';
    const summary = typeof preferredOutput.summary === 'string' ? preferredOutput.summary.trim() : '';

    if (content && !isGenericResultText(content)) {
      return truncateText(content);
    }

    if (summary && !isGenericResultText(summary)) {
      return truncateText(summary);
    }

    if (content) {
      return truncateText(content);
    }

    if (summary) {
      return truncateText(summary);
    }

    return '';
  };

  const extractPreviewFromExecutionView = (view: any) => {
    const report = view?.report;
    const raw =
      report?.resultExplanation?.mainContent
      || report?.summary?.terminalSummary
      || view?.terminalSummary
      || '';

    if (typeof raw !== 'string' || !raw.trim()) {
      return '';
    }

    if (isGenericResultText(raw)) {
      return '';
    }

    return truncateText(raw);
  };

  useEffect(() => {
    const completedTasks = tasks.filter((task) => normalizeTaskStatus(task).isCompleted);
    const targets = completedTasks.filter((task) => {
      if (taskResultPreviewById[task.id] && taskResultPreviewById[task.id] !== EMPTY_RESULT_PREVIEW) {
        return false;
      }

      if (loadingResultPreviewById[task.id]) {
        return false;
      }

      return true;
    });

    if (targets.length === 0) {
      return;
    }

    let cancelled = false;

    const loadPreviews = async () => {
      for (const task of targets) {
        if (cancelled) {
          return;
        }

        setLoadingResultPreviewById((prev) => ({ ...prev, [task.id]: true }));
        try {
          const outputs = await api.getTaskOutputs(task.id) as Array<{ type?: string; summary?: string; content?: string }>;
          let preview = extractPreviewFromOutputs(Array.isArray(outputs) ? outputs : []);

          if (!preview) {
            try {
              const executionView = await api.getTaskExecutionView(task.id);
              preview = extractPreviewFromExecutionView(executionView);
            } catch {
              // Keep empty preview and fallback below.
            }
          }

          if (!cancelled) {
            setTaskResultPreviewById((prev) => ({ ...prev, [task.id]: preview || EMPTY_RESULT_PREVIEW }));
          }
        } catch {
          if (!cancelled) {
            setTaskResultPreviewById((prev) => ({ ...prev, [task.id]: EMPTY_RESULT_PREVIEW }));
          }
        } finally {
          if (!cancelled) {
            setLoadingResultPreviewById((prev) => ({ ...prev, [task.id]: false }));
          }
        }
      }
    };

    void loadPreviews();

    return () => {
      cancelled = true;
    };
  }, [tasks, taskResultPreviewById, loadingResultPreviewById, EMPTY_RESULT_PREVIEW]);

  useEffect(() => {
    if (tasks.length === 0) {
      return;
    }

    const targets = tasks.filter((task) => {
      if (task.id === currentTaskId && currentTaskSteps.length > 0) {
        return false;
      }

      if (taskStepsById[task.id]) {
        return false;
      }

      if (loadingTaskStepsById[task.id]) {
        return false;
      }

      return true;
    });

    if (targets.length === 0) {
      return;
    }

    let cancelled = false;

    const loadTaskSteps = async () => {
      for (const task of targets) {
        if (cancelled) {
          return;
        }

        setLoadingTaskStepsById((prev) => ({ ...prev, [task.id]: true }));
        try {
          const steps = await api.getTaskSteps(task.id) as TaskStep[];
          if (!cancelled) {
            setTaskStepsById((prev) => ({ ...prev, [task.id]: Array.isArray(steps) ? steps : [] }));
          }
        } catch {
          if (!cancelled) {
            setTaskStepsById((prev) => ({ ...prev, [task.id]: [] }));
          }
        } finally {
          if (!cancelled) {
            setLoadingTaskStepsById((prev) => ({ ...prev, [task.id]: false }));
          }
        }
      }
    };

    void loadTaskSteps();

    return () => {
      cancelled = true;
    };
  }, [tasks, currentTaskId, currentTaskSteps, taskStepsById, loadingTaskStepsById]);

  const getStepsForTask = (task: Task) => {
    const isCurrentTask = currentTaskId === task.id;
    if (isCurrentTask && currentTaskSteps.length > 0) {
      return currentTaskSteps;
    }

    return taskStepsById[task.id] || [];
  };

  const getTaskResultPreview = (task: Task, isCurrentTask: boolean) => {
    const preferredOutput = isCurrentTask
      ? currentTaskOutputs.find((output) => output.type === 'final') || currentTaskOutputs[0]
      : undefined;

    const fromOutput = extractPreviewFromOutputs(preferredOutput ? [preferredOutput] : []);
    if (fromOutput) {
      return fromOutput;
    }

    const fromCache = taskResultPreviewById[task.id];
    if (fromCache && fromCache !== EMPTY_RESULT_PREVIEW) {
      return fromCache;
    }

    const rawTask = task as Task & {
      terminalSummary?: string;
      finalOutputSummary?: string;
      finalOutput?: string;
      summary?: string;
    };

    const fromTask =
      rawTask.finalOutputSummary ||
      rawTask.terminalSummary ||
      rawTask.finalOutput ||
      rawTask.summary;

    if (typeof fromTask === 'string' && fromTask.trim() && !isGenericResultText(fromTask)) {
      return truncateText(fromTask);
    }

    if (loadingResultPreviewById[task.id]) {
      return '正在加载结果摘要...';
    }

    return EMPTY_RESULT_PREVIEW;
  };

  const getTriggerLabel = (task: Task) => {
    const mode = task.triggerMode;
    if (mode === 'scheduled') return '定时触发';
    if (mode === 'event_triggered') return '事件触发';
    if (mode === 'queued') return '队列触发';
    if (mode === 'clarification_pending') return '待澄清';
    if (mode === 'immediate') return '立即触发';
    return mode || '未指定触发模式';
  };

  const getTriggerStatusLabel = (triggerStatus?: string) => {
    if (triggerStatus === 'waiting_schedule') return '等待计划时间';
    if (triggerStatus === 'waiting_event') return '等待事件命中';
    if (triggerStatus === 'queued') return '排队等待';
    if (triggerStatus === 'triggered') return '已触发';
    if (triggerStatus === 'ready') return '可触发';
    return '等待执行';
  };

  const renderStepList = (steps: TaskStep[]) => {
    if (steps.length === 0) {
      return null;
    }

    const statusLabel = (status: string) => {
      if (status === 'completed' || status === 'TaskStepCompleted') return '已完成';
      if (status === 'running' || status === 'TaskStepRunning') return '执行中';
      if (status === 'failed' || status === 'TaskStepFailed') return '失败';
      if (status === 'waiting' || status === 'TaskStepWaiting') return '等待中';
      return '待处理';
    };

    const sorted = [...steps].sort((a, b) => (a.stepOrder || 0) - (b.stepOrder || 0));
    return (
      <div className="card-summary">
        {sorted.map((step) => (
          <div key={step.id}>步骤{step.stepOrder}: {step.name}（{statusLabel(step.status)}）</div>
        ))}
      </div>
    );
  };

  const renderTaskCard = (task: Task) => {
    const normalized = normalizeTaskStatus(task);
    const stepsForTask = getStepsForTask(task);

    if (normalized.isRunning) {
      const runningStep = stepsForTask.find((step) => step.status === 'running' || step.status === 'TaskStepRunning');
      const totalSteps = stepsForTask.length;
      const completedSteps = stepsForTask.filter((step) => step.status === 'completed' || step.status === 'TaskStepCompleted').length;
      const progress = totalSteps > 0
        ? Math.min(100, Math.max(0, Math.round((completedSteps / totalSteps) * 100)))
        : 60;
      const inferredStepOrder = runningStep?.stepOrder || (totalSteps > 0 ? Math.min(totalSteps, completedSteps + 1) : null);
      const inferredStepName = runningStep?.name || task.currentReasoningSummary || '正在整理任务执行上下文';
      const runningLine = inferredStepOrder
        ? `步骤${inferredStepOrder}进行中: ${inferredStepName}`
        : `步骤进行中: ${inferredStepName}`;

      return (
        <div className="message-card running-card">
          <div className="card-icon">🔄</div>
          <div className="card-content">
            <div className="card-title">任务执行中</div>
            <div className="card-meta-row">
              <span className="card-meta-pill">步骤推进</span>
              <span className="card-meta-pill">实时进度</span>
              {totalSteps > 0 && <span className="card-meta-pill">{completedSteps}/{totalSteps}</span>}
            </div>
            <div className="running-step-line">{runningLine}</div>
            {renderStepList(stepsForTask)}
            <div className="card-progress running-progress-row">
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progress}%` }}></div>
              </div>
              <span className="progress-text running-progress-text">{progress}%</span>
            </div>
            <button className="btn-link" onClick={() => onViewTask(task.id)}>
              查看详情
            </button>
          </div>
        </div>
      );
    }

    if (normalized.isCompleted) {
      const isCurrentTask = currentTaskId === task.id;
      const totalSteps = stepsForTask.length;
      const completedSteps = stepsForTask.filter((step) => step.status === 'completed' || step.status === 'TaskStepCompleted').length;
      const progress = totalSteps > 0 ? 100 : (task.finalOutputReady ? 100 : 95);
      const resultPreview = getTaskResultPreview(task, isCurrentTask);
      const completionLine = totalSteps > 0
        ? `步骤已完成: ${completedSteps}/${totalSteps}`
        : (task.finalOutputReady ? '步骤已完成: 任务输出已生成' : '任务已完成: 正在整理输出');

      return (
        <div className="message-card completed-card">
          <div className="card-icon">✅</div>
          <div className="card-content">
            <div className="card-title">任务已完成</div>
            <div className="card-meta-row">
              <span className="card-meta-pill">步骤收敛</span>
              <span className="card-meta-pill">结果可查看</span>
              {totalSteps > 0 && <span className="card-meta-pill">{completedSteps}/{totalSteps}</span>}
            </div>
            <div className="running-step-line">{completionLine}</div>
            {renderStepList(stepsForTask)}
            <div className="card-summary card-result-preview">结果: {resultPreview}</div>
            <div className="card-progress running-progress-row">
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: `${progress}%` }}></div>
              </div>
              <span className="progress-text running-progress-text">{progress}%</span>
            </div>
            <div className="card-actions">
              <button className="btn-secondary" onClick={() => onViewTask(task.id)}>
                查看详情
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (task.complexityDecisionSummary) {
      return (
        <div className="message-card complex-task-card">
          <div className="card-icon">🤖</div>
          <div className="card-content">
            <div className="card-title">复杂任务判定</div>
            <div className="card-summary">{task.complexityDecisionSummary}</div>
            <button className="btn-link" onClick={() => onViewTask(task.id)}>
              查看详情
            </button>
            <button className="btn-link" onClick={() => onCancelTask(task.id)}>
              取消任务
            </button>
          </div>
        </div>
      );
    }

    if (normalized.isClarification) {
      return (
        <div className="message-card clarification-card">
          <div className="card-icon">🧭</div>
          <div className="card-content">
            <div className="card-title">正式待澄清（原任务）</div>
            <div className="card-meta-row">
              <span className="card-meta-pill">{getTriggerLabel(task)}</span>
              <span className="card-meta-pill">原 Task 继续推进</span>
            </div>
            <div className="card-summary">
              {task.triggerDecisionSummary || task.intakeInputSummary || '入口判定低置信度，等待补充条件后继续执行。'}
            </div>
            <button className="btn-link" onClick={() => onViewTask(task.id)}>
              查看详情
            </button>
          </div>
        </div>
      );
    }

    if (normalized.isArranged) {
      return (
        <div className="message-card arranged-card">
          <div className="card-icon">✅</div>
          <div className="card-content">
            <div className="card-title">任务已安排好</div>
            <div className="card-meta-row">
              <span className="card-meta-pill">阶段通知</span>
              <span className="card-meta-pill">安排完成</span>
            </div>
            <div className="card-summary">
              父任务: {task.intakeInputSummary || '任务'}
            </div>
            {task.arrangementEta && (
              <div className="card-eta">📊 ETA: {task.arrangementEta}</div>
            )}
            <button className="btn-link" onClick={() => onViewTask(task.id)}>
              查看详情
            </button>
          </div>
        </div>
      );
    }

    if (normalized.isFailed) {
      return (
        <div className="message-card failed-card">
          <div className="card-icon">❌</div>
          <div className="card-content">
            <div className="card-title">任务执行失败</div>
            <div className="card-summary">{task.intakeInputSummary || '-'}</div>
            <div className="card-actions">
              <button className="btn-secondary" onClick={() => onViewTask(task.id)}>
                查看详情
              </button>
              <button className="btn-secondary" onClick={() => onRetryTask(task.id)}>
                重试任务
              </button>
              <button className="btn-primary" onClick={() => onViewResult(task.id)}>
                查看结果摘要
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (normalized.isWaiting) {
      return (
        <div className="message-card trigger-card">
          <div className="card-icon">⏳</div>
          <div className="card-content">
            <div className="card-title">触发模式识别结果</div>
            <div className="card-meta-row">
              <span className="card-meta-pill">{getTriggerLabel(task)}</span>
              <span className="card-meta-pill">{getTriggerStatusLabel(normalized.triggerStatus)}</span>
            </div>
            <div className="card-summary">{task.triggerDecisionSummary || '系统已识别触发模式并进入等待执行阶段。'}</div>
            <button className="btn-link" onClick={() => onViewTask(task.id)}>
              查看详情
            </button>
          </div>
        </div>
      );
    }

    return null;
  };

  const toTimestamp = (value?: string) => {
    if (!value) {
      return 0;
    }

    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const timelineItems = [
    ...messages.map((msg) => ({
      kind: 'message' as const,
      id: `message-${msg.id}`,
      createdAt: msg.createdAt,
      sortValue: toTimestamp(msg.createdAt),
      message: msg
    })),
    ...tasks.map((task) => ({
      kind: 'task' as const,
      id: `task-${task.id}`,
      createdAt: task.createdAt,
      sortValue: toTimestamp(task.createdAt),
      task
    }))
  ].sort((left, right) => {
    if (left.sortValue === right.sortValue) {
      return left.id.localeCompare(right.id);
    }

    return left.sortValue - right.sortValue;
  });

  return (
    <div className="message-panel">
      <div className="message-list">
        {timelineItems.length === 0 ? (
          <div className="empty-state">
            <h3>欢迎使用 BiosBot</h3>
            <p>请问有什么可以为你效劳的</p>
          </div>
        ) : (
          timelineItems.map((item) => {
            if (item.kind === 'message') {
              const msg = item.message;
              return (
                <div className="message" key={item.id}>
                  <div className="message-avatar">
                    {msg.role === 'user' ? '👤' : '🤖'}
                  </div>
                  <div className="message-content">
                    <div className={`message-bubble ${msg.role === 'assistant' ? 'assistant' : ''}`}>
                      {msg.content}
                    </div>
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="message-attachments">
                        {msg.attachments.map((att, idx) => (
                          <div key={idx} className="message-attachment">
                            {att.type === 'image' && (att.url.startsWith('data:') || att.url.startsWith('blob:') || att.url.startsWith('http')) ? (
                              <img src={att.url} alt={att.id} className="attachment-img" />
                            ) : (
                              <div className="attachment-file">
                                <span className="file-icon">📎</span>
                                <span className="file-name">{att.id}</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="message-time">
                      {format(new Date(msg.createdAt), 'HH:mm:ss')}
                    </div>
                  </div>
                </div>
              );
            }

            const card = renderTaskCard(item.task);
            if (!card) {
              return null;
            }

            return (
              <div className="message" key={item.id}>
                {card}
              </div>
            );
          })
        )}

        <div className="message-card-stream">
          {pendingPermissions.map((request) => (
            <div className="message" key={`permission-${request.id}`}>
              <div className="message-card permission-request-card">
                <div className="card-icon">⚠️</div>
                <div className="card-content">
                  <div className="card-title">权限确认请求</div>
                  <div className="card-meta-row">
                    <span className="card-meta-pill">{request.action}</span>
                    <span className="card-meta-pill">待确认</span>
                  </div>
                  <div className="card-summary">目标: {request.target}</div>
                  {request.description && <div className="card-summary">说明: {request.description}</div>}
                  <div className="card-actions">
                    <button className="btn btn-secondary" onClick={() => onRejectPermission(request.id)}>拒绝</button>
                    <button className="btn btn-primary" onClick={() => onApprovePermission(request.id)}>批准</button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
        {isLoading && (
          <div className="loading">
            <div className="spinner"></div>
            <span>处理中...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}

interface ConversationComposerProps {
  input: string;
  attachments: PendingAttachment[];
  onChange: (value: string) => void;
  onAttachmentsChange: (attachments: PendingAttachment[]) => void;
  onSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
}

export function ConversationComposer({
  input,
  attachments: propAttachments,
  onChange,
  onAttachmentsChange,
  onSubmit,
  isLoading
}: ConversationComposerProps) {
  const [localAttachments, setLocalAttachments] = useState<Attachment[]>(
    (propAttachments || []).map(a => ({
      ...a,
      id: a.name,
      type: (a.type === 'image' ? 'image' : 'file') as 'image' | 'file',
      preview: a.type === 'image' ? a.url : undefined
    }))
  );
  const [isDragging, setIsDragging] = useState(false);
  const [activeCommandIndex, setActiveCommandIndex] = useState(-1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (propAttachments.length === 0 && localAttachments.length > 0) {
      localAttachments.forEach(att => {
        if (att.url) URL.revokeObjectURL(att.url);
        if (att.preview) URL.revokeObjectURL(att.preview);
      });
      setLocalAttachments([]);
    }
  }, [propAttachments]);

  const attachments = propAttachments.length > 0
    ? propAttachments.map(a => ({ ...a, id: a.name, preview: a.type === 'image' ? a.url : undefined }))
    : localAttachments;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (showCommandSuggestions && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveCommandIndex((prev) => (prev < 0 ? 0 : (prev + 1) % filteredCommands.length));
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveCommandIndex((prev) => (prev < 0 ? filteredCommands.length - 1 : (prev - 1 + filteredCommands.length) % filteredCommands.length));
        return;
      }

      if (e.key === 'Enter' && !e.shiftKey && activeCommandIndex >= 0) {
        e.preventDefault();
        handleApplyCommand(filteredCommands[activeCommandIndex].value);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit(e);
    }
  };

  const handleFileSelect = (files: FileList | null) => {
    if (!files) return;

    const newAttachments: Attachment[] = [];

    Array.from(files).forEach((file) => {
      const isImage = file.type.startsWith('image/');
      const attachment: Attachment = {
        id: `att-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: isImage ? 'image' : 'file',
        name: file.name,
        url: URL.createObjectURL(file),
        preview: isImage ? URL.createObjectURL(file) : undefined,
        file
      };
      newAttachments.push(attachment);
    });

    const newAtts = [...localAttachments, ...newAttachments];
    setLocalAttachments(newAtts);
    onAttachmentsChange(newAtts.map(a => ({ type: a.type, name: a.name, url: a.url, file: a.file })));
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileSelect(e.target.files);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleImageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileSelect(e.target.files);
    if (imageInputRef.current) {
      imageInputRef.current.value = '';
    }
  };

  const handleRemoveAttachment = (id: string) => {
    const newLocal = localAttachments.filter(a => a.id !== id);
    setLocalAttachments(newLocal);
    onAttachmentsChange(newLocal.map(a => ({ type: a.type, name: a.name, url: a.url, file: a.file })));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const files: File[] = [];

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) files.push(file);
      }
    }

    if (files.length > 0) {
      const dataTransfer = new DataTransfer();
      files.forEach(f => dataTransfer.items.add(f));
      handleFileSelect(dataTransfer.files);
    }
  };

  const canSubmit = (input.trim() || attachments.length > 0) && !isLoading;

  const commandHints = [
    { label: '查看任务详情', value: '/task detail latest' },
    { label: '查看结果摘要', value: '/result summary latest' },
    { label: '重试当前任务', value: '/task retry latest' },
    { label: '取消当前任务', value: '/task cancel latest' },
    { label: '补充澄清信息', value: '/task clarify latest' }
  ];

  const normalizedInput = input.trimStart();
  const isCompletedCommand = commandHints.some(
    (hint) => normalizedInput === hint.value || normalizedInput === `${hint.value} `
  );
  const showCommandSuggestions = normalizedInput.startsWith('/') && !isCompletedCommand;
  const commandKeyword = showCommandSuggestions ? normalizedInput.slice(1).toLowerCase() : '';
  const filteredCommands = commandHints.filter((hint) => {
    if (!commandKeyword) {
      return true;
    }

    return hint.value.toLowerCase().includes(commandKeyword) || hint.label.includes(commandKeyword);
  });

  const handleApplyCommand = (command: string) => {
    onChange(`${command} `);
    setActiveCommandIndex(-1);
  };

  useEffect(() => {
    if (!showCommandSuggestions || filteredCommands.length === 0) {
      setActiveCommandIndex(-1);
      return;
    }

    setActiveCommandIndex((prev) => {
      if (prev < 0) {
        return -1;
      }

      return prev >= filteredCommands.length ? filteredCommands.length - 1 : prev;
    });
  }, [showCommandSuggestions, filteredCommands.length]);

  const handleSubmit = (e: React.FormEvent) => {
    if (!canSubmit) return;

    const formData = new FormData();
    formData.append('message', input);
    attachments.forEach(att => {
      if (att.type === 'image') {
        formData.append('images', att.url);
      } else {
        formData.append('files', att.url);
      }
    });

    onSubmit(e);
  };

  return (
    <div
      className={`composer ${isDragging ? 'dragging' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="drop-overlay">
          <div className="drop-message">
            <span className="drop-icon">📥</span>
            <span>拖放文件到此处上传</span>
          </div>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="attachment-preview-list">
          {attachments.map((att) => (
            <div key={att.id} className="attachment-preview-item">
              {att.type === 'image' && att.preview ? (
                <img src={att.preview} alt={att.name} className="attachment-image-preview" />
              ) : (
                <div className="attachment-file-preview">
                  <span className="file-icon">📄</span>
                  <span className="file-name">{att.name}</span>
                </div>
              )}
              <button
                type="button"
                className="attachment-remove"
                onClick={() => handleRemoveAttachment(att.id)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="composer-input-wrapper">
          <div className="attachment-buttons">
            <button
              type="button"
              className="btn-attachment"
              title="上传图片"
              onClick={() => imageInputRef.current?.click()}
            >
              📷
            </button>
            <button
              type="button"
              className="btn-attachment"
              title="上传附件"
              onClick={() => fileInputRef.current?.click()}
            >
              📎
            </button>

            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageInputChange}
              style={{ display: 'none' }}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.txt,.md,.xlsx,.xls,.ppt,.pptx"
              multiple
              onChange={handleFileInputChange}
              style={{ display: 'none' }}
            />
          </div>

          <textarea
            value={input}
            onChange={(e) => onChange(e.target.value)}
            placeholder="输入任务描述或快捷指令..."
            disabled={isLoading}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            rows={1}
          />

          {showCommandSuggestions && (
            <div className="composer-command-suggest">
              {filteredCommands.length === 0 ? (
                <div className="command-suggest-empty">未匹配到快捷指令</div>
              ) : (
                filteredCommands.map((hint, index) => (
                  <button
                    type="button"
                    key={hint.value}
                    className={`command-suggest-item ${index === activeCommandIndex ? 'active' : ''}`}
                    onClick={() => handleApplyCommand(hint.value)}
                    aria-selected={index === activeCommandIndex}
                  >
                    <span className="command-suggest-value">{hint.value}</span>
                    <span className="command-suggest-sep">-</span>
                    <span className="command-suggest-label">{hint.label}</span>
                  </button>
                ))
              )}
            </div>
          )}

          <button
            type="submit"
            className="btn-send"
            disabled={!canSubmit}
          >
            ➤
          </button>
        </div>
      </form>
    </div>
  );
}

interface ConversationTaskStatusBarProps {
  task: Task;
  steps: TaskStep[];
  onRetryTask: (taskId: string) => void;
  onCancelTask: (taskId: string) => void;
  onViewTask: (taskId: string) => void;
  onViewResult: (taskId: string) => void;
}

export function ConversationTaskStatusBar({ task, steps, onRetryTask, onCancelTask, onViewTask, onViewResult }: ConversationTaskStatusBarProps) {
  const isCompleted = isTaskCompletedLike(task);

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      pending: '等待中',
      queued: '排队中',
      waiting: '等待中',
      scheduled: '定时等待',
      event_triggered: '事件等待',
      clarification_pending: '待澄清',
      ready_for_planning: '待规划',
      running: '执行中',
      TaskExecuting: '执行中',
      arranged_completed: '已安排',
      TaskArrangementCompleted: '已安排',
      completed: '已完成',
      TaskCompleted: '已完成',
      manually_closed: '已完成',
      failed: '失败',
      partial_failed: '部分失败',
      timed_out: '超时',
      cancelled: '已取消',
      TaskFailed: '失败',
      intervention_required: '需人工介入'
    };

    return labels[status] || status;
  };

  const getStatusClass = (status: string) => {
    if (status === 'completed' || status === 'TaskCompleted' || status === 'manually_closed' || status === 'arranged_completed' || status === 'TaskArrangementCompleted') return 'status-completed';
    if (status === 'failed' || status === 'TaskFailed' || status === 'partial_failed' || status === 'timed_out') return 'status-failed';
    if (status === 'running' || status === 'TaskExecuting') return 'status-running';
    if (status === 'queued' || status === 'pending' || status === 'waiting') return 'status-pending';
    if (status === 'clarification_pending' || status === 'scheduled' || status === 'event_triggered') return 'status-pending';
    if (status === 'intervention_required') return 'status-failed';
    return 'status-default';
  };

  if (task.arrangementStatus === 'TaskArrangementCompleted' || task.arrangementStatus === 'arranged_completed') {
    if (isCompleted) {
      const completedSteps = steps.filter(s => s.status === 'completed' || s.status === 'TaskStepCompleted').length;
      const progress = steps.length > 0 ? 100 : (task.finalOutputReady ? 100 : 95);

      return (
        <div className="task-status-bar arranged">
          <div className="status-info">
            <span className={`status-badge ${getStatusClass(task.status)}`}>
              {getStatusLabel(task.status)}
            </span>
            <span className="task-id">#{task.id?.slice(0, 12)}</span>
          </div>
          <div className="progress-info">
            <span className="current-step">步骤完成: {steps.length > 0 ? `${completedSteps}/${steps.length}` : '已收敛'}</span>
            <div className="progress-bar-small">
              <div className="progress-fill" style={{ width: `${progress}%` }}></div>
            </div>
            <span className="progress-text">{progress}%</span>
          </div>
          <div className="status-actions">
            <button className="btn-link" onClick={() => onViewTask(task.id)}>
              查看详情
            </button>
            <button className="btn-link" onClick={() => onViewResult(task.id)}>
              查看结果
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="task-status-bar arranged">
        <div className="status-info">
          <span className={`status-badge ${getStatusClass(task.arrangementStatus)}`}>
            已安排完成
          </span>
          <span className="task-id">#{task.id?.slice(0, 12)}</span>
        </div>
        {task.arrangementEta && (
          <div className="eta-info">📊 ETA: {task.arrangementEta}</div>
        )}
        <div className="status-actions">
          <button className="btn-link" onClick={() => onViewTask(task.id)}>
            查看详情
          </button>
          <button className="btn-link" onClick={() => onViewResult(task.id)}>
            查看结果
          </button>
        </div>
      </div>
    );
  }

  if (task.status === 'running' || task.status === 'TaskExecuting') {
    const currentStep = steps.find(s => s.status === 'running' || s.status === 'TaskStepRunning');
    const completedSteps = steps.filter(s => s.status === 'completed' || s.status === 'TaskStepCompleted').length;
    const progress = steps.length > 0 ? Math.round((completedSteps / steps.length) * 100) : 0;

    return (
      <div className="task-status-bar running">
        <div className="status-info">
          <span className={`status-badge ${getStatusClass(task.status)}`}>
            {getStatusLabel(task.status)}
          </span>
          <span className="task-id">#{task.id?.slice(0, 12)}</span>
        </div>
        <div className="progress-info">
          {currentStep && <span className="current-step">步骤{currentStep.stepOrder}: {currentStep.name}</span>}
          <div className="progress-bar-small">
            <div className="progress-fill" style={{ width: `${progress}%` }}></div>
          </div>
          <span className="progress-text">{progress}%</span>
        </div>
        <div className="status-actions">
          <button className="btn-link" onClick={() => onViewTask(task.id)}>
            查看详情
          </button>
          <button className="btn-link" onClick={() => onCancelTask(task.id)}>
            取消任务
          </button>
        </div>
      </div>
    );
  }

  if (isCompleted) {
    const completedSteps = steps.filter(s => s.status === 'completed' || s.status === 'TaskStepCompleted').length;
    const progress = steps.length > 0 ? 100 : (task.finalOutputReady ? 100 : 95);
    const statusPreviewRaw = (task as Task & { terminalSummary?: string; finalOutputSummary?: string }).finalOutputSummary
      || (task as Task & { terminalSummary?: string }).terminalSummary
      || '任务已完成，点击查看结果。';
    const statusPreview = statusPreviewRaw.replace(/\s+/g, ' ').trim();
    const preview = statusPreview.length > 120 ? `${statusPreview.slice(0, 120).trimEnd()}...` : statusPreview;

    return (
      <div className="task-status-bar arranged">
        <div className="status-info">
          <span className={`status-badge ${getStatusClass(task.status)}`}>
            {getStatusLabel(task.status)}
          </span>
          <span className="task-id">#{task.id?.slice(0, 12)}</span>
        </div>
        <div className="progress-info">
          <span className="current-step">步骤完成: {steps.length > 0 ? `${completedSteps}/${steps.length}` : '已收敛'}</span>
          <span className="current-step">结果摘要: {preview}</span>
          <div className="progress-bar-small">
            <div className="progress-fill" style={{ width: `${progress}%` }}></div>
          </div>
          <span className="progress-text">{progress}%</span>
        </div>
        <div className="status-actions">
          <button className="btn-link" onClick={() => onViewTask(task.id)}>
            查看详情
          </button>
          <button className="btn-link" onClick={() => onViewResult(task.id)}>
            查看结果
          </button>
        </div>
      </div>
    );
  }

  if (task.status === 'failed' || task.status === 'TaskFailed' || task.status === 'partial_failed' || task.status === 'timed_out') {
    return (
      <div className="task-status-bar failed">
        <div className="status-info">
          <span className={`status-badge ${getStatusClass(task.status)}`}>
            {getStatusLabel(task.status)}
          </span>
          <span className="task-id">#{task.id?.slice(0, 12)}</span>
        </div>
        <div className="status-actions">
          <button className="btn-link" onClick={() => onViewTask(task.id)}>
            查看详情
          </button>
          <button className="btn-link" onClick={() => onRetryTask(task.id)}>
            重试任务
          </button>
          <button className="btn-link" onClick={() => onViewResult(task.id)}>
            查看结果摘要
          </button>
        </div>
      </div>
    );
  }

  if (task.waitingAnomalySummary || task.interventionRequiredReason) {
    return (
      <div className="task-status-bar warning">
        <div className="status-info">
          <span className="status-badge status-failed">
            {task.interventionRequiredReason ? '需人工介入' : '等待异常'}
          </span>
          <span className="task-id">#{task.id?.slice(0, 12)}</span>
        </div>
        <div className="status-summary">
          {task.waitingAnomalySummary || task.interventionRequiredReason}
        </div>
        <div className="status-actions">
          <button className="btn-link" onClick={() => onViewTask(task.id)}>
            查看详情
          </button>
        </div>
      </div>
    );
  }

  if (
    task.status === 'pending' ||
    task.status === 'TaskPending' ||
    task.status === 'queued' ||
    task.status === 'TaskQueued' ||
    task.status === 'waiting' ||
    task.status === 'ready_for_planning' ||
    task.status === 'clarification_pending' ||
    task.status === 'scheduled' ||
    task.status === 'event_triggered'
  ) {
    return (
      <div className="task-status-bar pending">
        <div className="status-info">
          <span className={`status-badge ${getStatusClass(task.status)}`}>
            {getStatusLabel(task.status)}
          </span>
          <span className="task-id">#{task.id?.slice(0, 12)}</span>
        </div>
        <div className="status-summary">
          {task.triggerDecisionSummary || task.intakeInputSummary || '任务等待执行或补充条件'}
        </div>
        <div className="status-actions">
          <button className="btn-link" onClick={() => onViewTask(task.id)}>
            查看详情
          </button>
          <button className="btn-link" onClick={() => onCancelTask(task.id)}>
            取消任务
          </button>
        </div>
      </div>
    );
  }

  return null;
}

export default ChatArea;
