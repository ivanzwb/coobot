import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { format } from 'date-fns';
import { useAppStore } from '../stores/appStore';

const DOCUMENT_TYPE_OPTIONS = [
  { value: 'summary', label: '摘要文档' },
  { value: 'plan', label: '计划文档' },
  { value: 'analysis', label: '分析文档' },
  { value: 'report', label: '报告文档' },
  { value: 'reference', label: '参考文档' }
];

const SUGGESTED_ACTION_LABELS: Record<string, string> = {
  retry_task: '建议重试任务',
  cancel_task: '建议取消任务',
  view_task: '建议查看详情',
  view_result: '建议查看结果',
  continue_wait: '建议继续等待',
  rearrange_task: '建议重新安排',
  clarify_task: '建议补充澄清'
};

interface AgentOption {
  id: string;
  name: string;
  type?: string;
}

interface MemoryEntryDetail {
  id: string;
  summary: string;
  content: string;
  sourceType?: string;
  importance?: string;
  createdAt?: string;
  conversationId?: string | null;
  taskId?: string | null;
}

interface KnowledgeReferenceDetail {
  id: string;
  documentId?: string;
  title: string;
  summary?: string;
  score?: number;
  sourceType?: string | null;
  sourceTaskId?: string | null;
  agentId?: string | null;
  query?: string;
}

interface TaskReport {
  task: {
    id: string;
    status: string;
    complexityDecisionSummary?: string;
    arrangementStatus?: string;
    arrangementSummary?: string;
    terminalSummary?: string;
    degradedDelivery?: {
      summary: string;
      impactScope?: string;
      reason?: string;
      action?: string;
    } | null;
    supplementalUpdates?: Array<{
      id: string;
      content: string;
      arrivedAt: string;
      stepSummary?: string;
      outputType?: string;
    }>;
    supplementalNotificationType?: string;
    notificationRecords?: Array<{
      id: string;
      stage: string;
      summary: string;
      timestamp: string;
    }>;
    outputStage?: string;
    finalOutputReady?: boolean;
    createdAt: string;
    completedAt?: string;
    intakeInputSummary?: string;
    availableActions?: string[];
    assignedDomainAgentId?: string | null;
    assignedLeaderAgentId?: string | null;
    selectedAgentIds?: string[] | string | null;
  };
  steps: any[];
  outputs: TaskOutput[];
  events: any[];
  references?: Array<{ title: string; summary?: string }>;
  knowledgeReferences?: KnowledgeReferenceDetail[];
  summary: {
    totalSteps: number;
    completedSteps: number;
    failedSteps: number;
    finalOutputReady: boolean;
    terminalSummary?: string;
  };
  memoryScope?: {
    memoryScope: string;
    memoryLoadSummary: string;
    memoryWriteSummary: string;
    knowledgeHitSummary: string;
  };
  memoryEntries?: MemoryEntryDetail[];
  permissionDecisions?: Array<{
    id: string;
    action: string;
    target: string;
    status: string;
    policySourceSummary?: string;
    initiatingAgentId?: string | null;
    initiatingSkillId?: string | null;
    toolName?: string | null;
    reason?: string | null;
  }>;
  stepSummaries?: Array<{
    id: string;
    name: string;
    status: string;
    reasoningSummary?: string;
    actionSummary?: string;
    observationSummary?: string;
  }>;
  suggestedActions?: string[];
  toolCallSummary?: Array<{
    id: string;
    toolName: string;
    status: string;
    duration?: number;
    createdAt: string;
  }>;
}

interface TaskOutput {
  id: string;
  type: string;
  content?: string;
  summary?: string;
  createdAt: string;
}

interface KnowledgeDraft {
  agentId: string;
  selectedOutputId: string;
  title: string;
  documentType: string;
  excerpt: string;
}

function parseSelectedAgentIds(selectedAgentIds: TaskReport['task']['selectedAgentIds']) {
  if (Array.isArray(selectedAgentIds)) {
    return selectedAgentIds;
  }

  if (typeof selectedAgentIds === 'string') {
    try {
      const parsed = JSON.parse(selectedAgentIds);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

function inferDocumentType(output?: TaskOutput) {
  if (!output?.type) {
    return 'summary';
  }

  if (/report|final/i.test(output.type)) {
    return 'report';
  }
  if (/analysis/i.test(output.type)) {
    return 'analysis';
  }
  if (/plan/i.test(output.type)) {
    return 'plan';
  }
  return 'summary';
}

function buildConversationCommand(action: string, taskId: string, clarificationText?: string) {
  switch (action) {
    case 'retry_task':
      return `重试任务 #${taskId}`;
    case 'cancel_task':
      return `取消任务 #${taskId}`;
    case 'view_task':
      return `查看任务详情 #${taskId}`;
    case 'view_result':
      return `查看结果 #${taskId}`;
    case 'continue_wait':
      return `继续等待 #${taskId}`;
    case 'rearrange_task':
      return `重新安排 #${taskId}`;
    case 'clarify_task':
      return clarificationText ? `补充澄清 #${taskId} ${clarificationText}` : null;
    default:
      return null;
  }
}

export function ResultPage({ taskId: propTaskId }: { taskId?: string }) {
  const params = useParams<{ taskId: string }>();
  const routeTaskId = (propTaskId || params.taskId || '').trim();
  const [resolvedTaskId, setResolvedTaskId] = useState(routeTaskId);
  const [report, setReport] = useState<TaskReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [memorySource, setMemorySource] = useState<Record<string, any>>({});
  const [availableAgents, setAvailableAgents] = useState<AgentOption[]>([]);
  const [knowledgeDraft, setKnowledgeDraft] = useState<KnowledgeDraft | null>(null);
  const [actionInFlight, setActionInFlight] = useState<string | null>(null);
  const [knowledgeSaving, setKnowledgeSaving] = useState(false);
  const navigate = useNavigate();
  const sendMessage = useAppStore((state) => state.sendMessage);
  const initApp = useAppStore((state) => state.init);
  const conversationId = useAppStore((state) => state.conversationId);

  useEffect(() => {
    if (routeTaskId) {
      setResolvedTaskId(routeTaskId);
      void loadReport(routeTaskId);
    }
  }, [routeTaskId, conversationId]);

  const resolveTaskIdPrefix = async (rawTaskId: string) => {
    if (!rawTaskId || rawTaskId.length >= 32) {
      return rawTaskId;
    }

    try {
      const conversation = conversationId
        ? { id: conversationId }
        : await api.getConversation() as { id: string };
      const tasks = await api.getTasks(conversation.id, 200, 0) as Array<{ id: string }>;
      const matched = tasks.find((task) => task.id === rawTaskId || task.id.startsWith(rawTaskId));
      return matched?.id || rawTaskId;
    } catch {
      return rawTaskId;
    }
  };

  const loadReport = async (requestedTaskId: string) => {
    if (!requestedTaskId) return;
    try {
      setLoading(true);
      const targetTaskId = await resolveTaskIdPrefix(requestedTaskId);
      setResolvedTaskId(targetTaskId);

      const data = await api.getTaskReport(targetTaskId);
      const next = (data || {}) as Partial<TaskReport>;

      if (next.task && next.summary) {
        setReport(next as TaskReport);
        return;
      }

      const executionView = await api.getTaskExecutionView(targetTaskId) as any;
      if (executionView?.task && executionView?.report?.summary) {
        setReport({
          ...executionView.report,
          task: executionView.task,
          steps: Array.isArray(executionView.steps) ? executionView.steps : [],
          outputs: Array.isArray(executionView.outputs) ? executionView.outputs : [],
          events: Array.isArray(executionView.events) ? executionView.events : []
        } as TaskReport);
        return;
      }

      if (executionView?.task && executionView?.summary) {
        setReport(executionView as TaskReport);
        return;
      }

      setReport(null);
    } catch (error) {
      console.error('Failed to load report:', error);
      setReport(null);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="result-page">
        <div className="loading"><div className="spinner"></div></div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="result-page">
        <div className="empty-state">
          <h3>未找到任务</h3>
        </div>
      </div>
    );
  }

  if (!report.task || !report.summary) {
    return (
      <div className="result-page">
        <div className="empty-state">
          <h3>任务报告数据不完整</h3>
          <p>请稍后刷新重试。</p>
        </div>
      </div>
    );
  }

  const isArrangedOnly = (report.task?.outputStage === 'arranged_only' || report.task?.arrangementStatus === 'TaskArrangementCompleted') && !report.task?.finalOutputReady;
  const isInterventionOnly = report.task?.status === 'intervention_required' && !report.task?.finalOutputReady;
  const taskCompleted = report.task?.status === 'completed' || report.task?.status === 'TaskCompleted';
  const taskPartialFailed = report.summary.failedSteps > 0 && report.summary.finalOutputReady;

  const getDefaultAgentId = () => {
    const selectedAgentIds = parseSelectedAgentIds(report.task.selectedAgentIds);
    return report.task.assignedDomainAgentId
      || report.task.assignedLeaderAgentId
      || selectedAgentIds[0]
      || availableAgents[0]?.id
      || 'default';
  };

  const loadAgentsIfNeeded = async () => {
    if (availableAgents.length > 0) {
      return availableAgents;
    }

    const agents = await api.getAgents() as AgentOption[];
    setAvailableAgents(agents);
    return agents;
  };

  const openKnowledgeComposer = async (preferredOutputId?: string) => {
    const preferredOutput = preferredOutputId
      ? report.outputs.find((output) => output.id === preferredOutputId)
      : null;
    const primaryOutput = preferredOutput || report.outputs.find((output) => output.type === 'final') || report.outputs[0];
    if (!primaryOutput) {
      alert('当前任务没有可加入知识库的输出。');
      return;
    }

    const agents = await loadAgentsIfNeeded();
    const fallbackAgentId = report.task.assignedDomainAgentId
      || report.task.assignedLeaderAgentId
      || parseSelectedAgentIds(report.task.selectedAgentIds)[0]
      || agents[0]?.id
      || 'default';

    setKnowledgeDraft({
      agentId: fallbackAgentId,
      selectedOutputId: primaryOutput.id,
      title: `${report.task.intakeInputSummary || '任务结果'} / ${primaryOutput.summary || primaryOutput.type}`,
      documentType: inferDocumentType(primaryOutput),
      excerpt: primaryOutput.content || primaryOutput.summary || report.task.terminalSummary || report.summary.terminalSummary || ''
    });
  };

  const handleAddToKnowledge = async (outputId?: string) => {
    await openKnowledgeComposer(outputId);
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `task-report-${report.task.id}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleViewDetail = () => {
    navigate(`/tasks/${report.task.id}`);
  };

  const handleKnowledgeOutputChange = (outputId: string) => {
    if (!knowledgeDraft) {
      return;
    }

    const selectedOutput = report.outputs.find((output) => output.id === outputId);
    setKnowledgeDraft({
      ...knowledgeDraft,
      selectedOutputId: outputId,
      documentType: inferDocumentType(selectedOutput),
      excerpt: selectedOutput?.content || selectedOutput?.summary || '',
      title: `${report.task.intakeInputSummary || '任务结果'} / ${selectedOutput?.summary || selectedOutput?.type || '输出片段'}`
    });
  };

  const submitKnowledgeDraft = async () => {
    if (!knowledgeDraft) {
      return;
    }

    const selectedOutput = report.outputs.find((output) => output.id === knowledgeDraft.selectedOutputId);
    if (!selectedOutput) {
      alert('请选择有效的输出片段。');
      return;
    }

    if (!knowledgeDraft.excerpt.trim()) {
      alert('知识内容不能为空。');
      return;
    }

    setKnowledgeSaving(true);
    try {
      const metadata = [
        `文档类型: ${knowledgeDraft.documentType}`,
        `来源任务: ${report.task.id}`,
        `来源输出: ${selectedOutput.type}`
      ].join('\n');

      await api.addKnowledgeDocument(knowledgeDraft.agentId || getDefaultAgentId(), {
        title: `[${knowledgeDraft.documentType}] ${knowledgeDraft.title}`,
        content: `${metadata}\n\n${knowledgeDraft.excerpt.trim()}`,
        sourceType: 'task_output',
        sourceTaskId: report.task.id,
        sourceOutputId: selectedOutput.id,
        documentType: knowledgeDraft.documentType
      });
      setKnowledgeDraft(null);
      alert('已加入知识库');
    } catch (error: any) {
      alert(error.message || '加入知识库失败');
    } finally {
      setKnowledgeSaving(false);
    }
  };

  const executeSuggestedAction = async (action: string) => {
    let clarificationText: string | undefined;
    if (action === 'clarify_task') {
      const response = window.prompt('请输入需要补充的澄清内容，支持“字段: 值”格式。');
      if (response === null) {
        return;
      }
      if (!response.trim()) {
        alert('澄清内容不能为空。');
        return;
      }
      clarificationText = response.trim();
    }

    const command = buildConversationCommand(action, report.task.id, clarificationText);
    if (!command) {
      return;
    }

    setActionInFlight(action);
    try {
      if (!conversationId) {
        await initApp();
      }
      await sendMessage(command);
      await loadReport(resolvedTaskId || routeTaskId);

      if (action === 'view_task') {
        navigate(`/tasks/${report.task.id}`);
      }
    } catch (error: any) {
      alert(error.message || '执行建议动作失败');
    } finally {
      setActionInFlight(null);
    }
  };

  const handleViewMemorySource = async (memoryEntryId: string) => {
    if (memorySource[memoryEntryId]) {
      return;
    }

    const source = await api.getMemoryEntrySource(memoryEntryId);
    setMemorySource((current) => ({
      ...current,
      [memoryEntryId]: source
    }));
  };

  return (
    <div className="result-page">
      <ResultBanner
        task={report.task}
        summary={report.summary}
        isCompleted={taskCompleted}
        isPartialFailed={taskPartialFailed}
        isArrangedOnly={isArrangedOnly}
        isInterventionOnly={isInterventionOnly}
        onBack={() => navigate('/tasks')}
        onAddToKnowledge={handleAddToKnowledge}
        onExport={handleExport}
        onViewDetail={handleViewDetail}
      />

      <ResultStageBanner
        outputStage={report.task.outputStage}
        finalOutputReady={report.task.finalOutputReady}
        hasSupplement={Boolean(report.task?.supplementalUpdates && report.task.supplementalUpdates.length > 0)}
      />

      {(report.summary.failedSteps > 0 || report.task?.degradedDelivery) && (
        <DegradationSection
          degradedDelivery={report.task?.degradedDelivery}
          failedSteps={report.summary.failedSteps}
          totalSteps={report.summary.totalSteps}
        />
      )}

      {report.task?.supplementalUpdates && report.task.supplementalUpdates.length > 0 && (
        <SupplementSection
          updates={report.task.supplementalUpdates}
          supplementalNotificationType={report.task.supplementalNotificationType}
        />
      )}

      {isArrangedOnly && (
        <ResultArrangementSection
          arrangementSummary={report.task.arrangementSummary}
          terminalSummary={report.task.terminalSummary || report.summary.terminalSummary}
        />
      )}

      {(report.task?.terminalSummary || report.task?.complexityDecisionSummary) && (
        <ResultSummarySection
          summary={report.task.terminalSummary || report.summary.terminalSummary || ''}
          detail={report.task.complexityDecisionSummary}
        />
      )}

      {report.outputs.length > 0 && (
        <ResultOutputSection outputs={report.outputs} onUseForKnowledge={handleAddToKnowledge} />
      )}

      {report.memoryScope && (
        <MemoryScopeSection scope={report.memoryScope} entries={report.memoryEntries || []} memorySource={memorySource} onViewMemorySource={handleViewMemorySource} />
      )}

      {report.stepSummaries && report.stepSummaries.length > 0 && (
        <StepSummarySection steps={report.stepSummaries} />
      )}

      {report.permissionDecisions && report.permissionDecisions.length > 0 && (
        <PermissionSummarySection decisions={report.permissionDecisions} />
      )}

      {report.task.notificationRecords && report.task.notificationRecords.length > 0 && (
        <ResultNotificationSection notifications={report.task.notificationRecords} />
      )}

      <ResultReferenceSection references={report.references || []} />

      {report.knowledgeReferences && report.knowledgeReferences.length > 0 && (
        <KnowledgeReferenceDetailSection references={report.knowledgeReferences} onViewDetail={handleViewDetail} />
      )}

      {report.suggestedActions && report.suggestedActions.length > 0 && (
        <ResultActionSection actions={report.suggestedActions} activeAction={actionInFlight} onTriggerAction={executeSuggestedAction} />
      )}

      {report.toolCallSummary && report.toolCallSummary.length > 0 && (
        <ToolCallSummarySection items={report.toolCallSummary} />
      )}

      {knowledgeDraft && (
        <KnowledgeComposerModal
          draft={knowledgeDraft}
          outputs={report.outputs}
          agents={availableAgents}
          isSaving={knowledgeSaving}
          onClose={() => setKnowledgeDraft(null)}
          onChange={setKnowledgeDraft}
          onOutputChange={handleKnowledgeOutputChange}
          onSubmit={submitKnowledgeDraft}
        />
      )}
    </div>
  );
}

interface ResultBannerProps {
  task: any;
  summary: any;
  isCompleted?: boolean;
  isPartialFailed?: boolean;
  isArrangedOnly: boolean;
  isInterventionOnly: boolean;
  onBack: () => void;
  onAddToKnowledge: () => void;
  onExport: () => void;
  onViewDetail: () => void;
}

function ResultStageBanner({ outputStage, finalOutputReady, hasSupplement }: {
  outputStage?: string;
  finalOutputReady?: boolean;
  hasSupplement: boolean;
}) {
  return (
    <div className="result-stage-banner">
      <div className={`stage-chip ${outputStage === 'arranged_only' ? 'active' : ''}`}>
        1. 已安排
      </div>
      <div className={`stage-chip ${outputStage === 'final' || finalOutputReady ? 'active' : ''}`}>
        2. 最终交付
      </div>
      <div className={`stage-chip ${hasSupplement ? 'active' : ''}`}>
        3. 补充更新
      </div>
    </div>
  );
}

function ResultBanner({ task, summary, isCompleted, isPartialFailed, isArrangedOnly, isInterventionOnly, onBack, onAddToKnowledge, onExport, onViewDetail }: ResultBannerProps) {
  const completed = isCompleted ?? (task?.status === 'completed' || task?.status === 'TaskCompleted');
  const partialFailed = isPartialFailed ?? (summary.failedSteps > 0 && summary.finalOutputReady);

  return (
    <div className="result-banner">
      <div className="banner-header">
        <button className="btn-back" onClick={onBack}>← 返回</button>
        <h2>任务结果</h2>
      </div>

      <div className={`banner-status ${completed ? 'completed' : partialFailed ? 'partial' : 'failed'}`}>
        {isArrangedOnly && '📋 任务已安排完成'}
        {isInterventionOnly && '⚠️ 任务需人工介入'}
        {!isArrangedOnly && !isInterventionOnly && (completed ? '✅ 任务已完成' : '❌ 任务未完成')}
      </div>

      {task?.intakeInputSummary && (
        <div className="banner-summary">{task.intakeInputSummary}</div>
      )}

      {(task?.terminalSummary || summary.terminalSummary) && (
        <div className="banner-summary">{task?.terminalSummary || summary.terminalSummary}</div>
      )}

      <div className="banner-stats">
        <div className="stat-item">
          <span className="stat-value">{summary.totalSteps}</span>
          <span className="stat-label">总步骤</span>
        </div>
        <div className="stat-item completed">
          <span className="stat-value">{summary.completedSteps}</span>
          <span className="stat-label">已完成</span>
        </div>
        <div className="stat-item failed">
          <span className="stat-value">{summary.failedSteps}</span>
          <span className="stat-label">失败</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{summary.finalOutputReady ? '是' : '否'}</span>
          <span className="stat-label">最终输出</span>
        </div>
      </div>

      <div className="banner-actions">
        <button className="btn btn-secondary" onClick={onViewDetail}>
          查看详情
        </button>
        <button className="btn btn-secondary" onClick={onAddToKnowledge}>
          加入知识库
        </button>
        <button className="btn btn-secondary" onClick={onExport}>
          📤 导出
        </button>
      </div>
    </div>
  );
}

function ResultArrangementSection({ arrangementSummary, terminalSummary }: { arrangementSummary?: string; terminalSummary?: string }) {
  return (
    <div className="result-section arrangement">
      <h3>📋 阶段性安排通知</h3>
      <div className="section-content">
        <p>{arrangementSummary || '当前仅完成任务安排，系统尚未形成最终输出。'}</p>
        {terminalSummary && <p>{terminalSummary}</p>}
      </div>
    </div>
  );
}

function ResultSummarySection({ summary, detail }: { summary: string; detail?: string }) {
  return (
    <div className="result-section">
      <h3>📋 终态摘要</h3>
      <div className="section-content">
        <p>{summary}</p>
        {detail && <p>{detail}</p>}
      </div>
    </div>
  );
}

interface DegradationSectionProps {
  degradedDelivery?: {
    summary: string;
    impactScope?: string;
    reason?: string;
    action?: string;
  } | null;
  failedSteps: number;
  totalSteps: number;
}

function DegradationSection({ degradedDelivery, failedSteps, totalSteps }: DegradationSectionProps) {
  return (
    <div className="result-section degradation">
      <h3>⚠️ 降级交付说明</h3>
      <div className="section-content">
        <p>{failedSteps} 个步骤失败 ({Math.round((failedSteps / totalSteps) * 100)}%)</p>
        {degradedDelivery?.summary && <p>{degradedDelivery.summary}</p>}
        {degradedDelivery?.impactScope && <p>{degradedDelivery.impactScope}</p>}
        {degradedDelivery?.reason && <p>原因: {degradedDelivery.reason}</p>}
        {degradedDelivery?.action && <p>降级动作: {degradedDelivery.action}</p>}
      </div>
    </div>
  );
}

function ResultOutputSection({ outputs, onUseForKnowledge }: { outputs: TaskOutput[]; onUseForKnowledge: (outputId: string) => void }) {
  return (
    <div className="result-section">
      <h3>📖 输出物</h3>
      <div className="output-grid">
        {outputs.map((output) => (
          <div key={output.id} className="output-card">
            <div className="output-header">
              <span className="output-icon">📄</span>
              <span className="output-type">{output.type}</span>
            </div>
            {output.summary && <div className="output-summary">{output.summary}</div>}
            {output.content && <div className="output-content">{output.content}</div>}
            <div className="output-footer">
              <span className="output-time">
                {format(new Date(output.createdAt), 'yyyy-MM-dd HH:mm:ss')}
              </span>
              <button className="btn-link" onClick={() => onUseForKnowledge(output.id)}>加入知识片段</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface MemoryScopeSectionProps {
  scope: {
    memoryScope: string;
    memoryLoadSummary: string;
    memoryWriteSummary: string;
    knowledgeHitSummary: string;
  };
  entries: MemoryEntryDetail[];
  memorySource: Record<string, any>;
  onViewMemorySource: (memoryEntryId: string) => void;
}

function MemoryScopeSection({ scope, entries, memorySource, onViewMemorySource }: MemoryScopeSectionProps) {
  return (
    <div className="result-section">
      <h3>🧠 记忆加载范围</h3>
      <div className="section-content">
        <p>记忆范围: {scope.memoryScope}</p>
        <p>加载摘要: {scope.memoryLoadSummary}</p>
        <p>写入摘要: {scope.memoryWriteSummary}</p>
        <p>知识命中: {scope.knowledgeHitSummary}</p>
        {entries.length > 0 && (
          <div className="memory-group">
            <h4>关键记忆条目</h4>
            {entries.map((entry) => (
              <div key={entry.id} className="supplement-item">
                <div className="supplement-header">
                  <strong>{entry.summary}</strong>
                  <span>{entry.sourceType || 'unknown'}</span>
                </div>
                <p>{entry.content}</p>
                <button className="btn-link" onClick={() => onViewMemorySource(entry.id)}>查看来源</button>
                {memorySource[entry.id] && (
                  <div className="section-content">
                    <p>来源类型: {memorySource[entry.id].sourceType}</p>
                    {memorySource[entry.id].summaryDate && <p>摘要日期: {memorySource[entry.id].summaryDate}</p>}
                    {memorySource[entry.id].jobId && <p>整理作业: {memorySource[entry.id].jobId}</p>}
                    {memorySource[entry.id].sourceConversationIds?.length > 0 && <p>会话范围: {memorySource[entry.id].sourceConversationIds.join(', ')}</p>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function KnowledgeReferenceDetailSection({ references, onViewDetail }: { references: KnowledgeReferenceDetail[]; onViewDetail: () => void }) {
  return (
    <div className="result-section">
      <h3>📚 知识引用明细</h3>
      <div className="section-content">
        {references.map((reference) => (
          <div key={reference.id} className="supplement-item">
            <div className="supplement-header">
              <strong>{reference.title}</strong>
              {typeof reference.score === 'number' && <span>score: {reference.score.toFixed(2)}</span>}
            </div>
            {reference.summary && <p>{reference.summary}</p>}
            {reference.query && <p>命中查询: {reference.query}</p>}
            <button className="btn-link" onClick={onViewDetail}>查看详情</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepSummarySection({ steps }: { steps: TaskReport['stepSummaries'] }) {
  return (
    <div className="result-section">
      <h3>🧩 关键步骤摘要</h3>
      <div className="section-content">
        {steps?.map((step) => (
          <div key={step.id} className="supplement-item">
            <div className="supplement-header">
              <strong>{step.name}</strong>
              <span>{step.status}</span>
            </div>
            {step.reasoningSummary && <p>推理摘要: {step.reasoningSummary}</p>}
            {step.actionSummary && <p>动作摘要: {step.actionSummary}</p>}
            {step.observationSummary && <p>观察摘要: {step.observationSummary}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

interface PermissionSummarySectionProps {
  decisions: NonNullable<TaskReport['permissionDecisions']>;
}

function PermissionSummarySection({ decisions }: PermissionSummarySectionProps) {
  return (
    <div className="result-section">
      <h3>🔐 权限决策摘要</h3>
      <div className="section-content">
        {decisions.map((dec, idx) => (
          <div key={idx} className="permission-decision">
            <span className={`decision-badge ${dec.status === 'approved' ? 'allowed' : dec.status === 'pending' ? 'pending' : 'denied'}`}>
              {dec.status === 'approved' ? '✓' : dec.status === 'pending' ? '…' : '✗'}
            </span>
            <span className="decision-action">{dec.action}</span>
            <span className="decision-target">{dec.target}</span>
            {dec.policySourceSummary && (
              <span className="decision-policy">- {dec.policySourceSummary}</span>
            )}
            {(dec.initiatingAgentId || dec.toolName) && <span className="decision-policy">- {dec.initiatingAgentId || dec.toolName}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultNotificationSection({ notifications }: { notifications: NonNullable<TaskReport['task']['notificationRecords']> }) {
  return (
    <div className="result-section">
      <h3>🔔 通知记录</h3>
      <div className="section-content">
        {notifications.map((notification) => (
          <div key={notification.id} className="supplement-item">
            <div className="supplement-header">
              <span>{notification.stage}</span>
              <span>{format(new Date(notification.timestamp), 'yyyy-MM-dd HH:mm:ss')}</span>
            </div>
            <p>{notification.summary}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultActionSection({ actions, activeAction, onTriggerAction }: { actions: string[]; activeAction: string | null; onTriggerAction: (action: string) => void }) {
  return (
    <div className="result-section">
      <h3>🪄 建议动作</h3>
      <div className="section-content">
        {actions.map((action) => (
          <div key={action} className="permission-decision">
            <span className="decision-action">{SUGGESTED_ACTION_LABELS[action] || action}</span>
            <button className="btn-link" disabled={activeAction === action} onClick={() => onTriggerAction(action)}>
              {activeAction === action ? '执行中...' : '立即执行'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ToolCallSummarySection({ items }: { items: NonNullable<TaskReport['toolCallSummary']> }) {
  return (
    <div className="result-section">
      <h3>🛠 工具调用摘要</h3>
      <div className="section-content">
        {items.map((item) => (
          <div key={item.id} className="permission-decision">
            <span className="decision-action">{item.toolName}</span>
            <span className="decision-policy">{item.status}</span>
            {typeof item.duration === 'number' && <span className="decision-policy">{item.duration}ms</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultReferenceSection({ references }: { references: Array<{ title: string; summary?: string }> }) {
  return (
    <div className="result-section">
      <h3>📚 引用与参考</h3>
      <div className="section-content">
        {references.length === 0 ? (
          <p className="empty-text">暂无引用</p>
        ) : (
          references.map((reference, index) => (
            <div key={`${reference.title}-${index}`} className="supplement-item">
              <div className="supplement-header">
                <strong>{reference.title}</strong>
              </div>
              {reference.summary && <p>{reference.summary}</p>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

interface SupplementSectionProps {
  updates: NonNullable<TaskReport['task']['supplementalUpdates']>;
  supplementalNotificationType?: string;
}

function SupplementSection({ updates, supplementalNotificationType }: SupplementSectionProps) {
  const getNotificationTypeLabel = (value?: string) => {
    if (!value) {
      return '补充更新';
    }

    const normalized = value.toLowerCase();
    if (normalized.includes('result')) {
      return '结果补充';
    }
    if (normalized.includes('impact')) {
      return '影响说明';
    }
    if (normalized.includes('timeline')) {
      return '时间线更新';
    }
    return value;
  };

  const notificationTypeLabel = getNotificationTypeLabel(supplementalNotificationType);

  return (
    <div className="result-section supplement">
      <h3>📥 补充更新</h3>
      <div className="section-content">
        <div className="supplement-type-row">
          <span className="supplement-type-label">通知类型</span>
          <span className="supplement-type-badge">{notificationTypeLabel}</span>
        </div>
        <p>
          {supplementalNotificationType === 'supplemental_update'
            ? '这些内容作为补充更新展示，不会覆盖原最终输出主体。'
            : '以下内容为被动展示的补充更新。'}
        </p>
      </div>
      {updates.map((update) => (
        <div key={update.id} className="supplement-item">
          <div className="supplement-header">
            <span className="supplement-time">
              {format(new Date(update.arrivedAt), 'yyyy-MM-dd HH:mm')}
            </span>
            {update.outputType && <span>{update.outputType}</span>}
          </div>
          <div className="supplement-content">
            {update.stepSummary && <p className="supplement-step">{update.stepSummary}</p>}
            <p>{update.content}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

interface KnowledgeComposerModalProps {
  draft: KnowledgeDraft;
  outputs: TaskOutput[];
  agents: AgentOption[];
  isSaving: boolean;
  onClose: () => void;
  onChange: (draft: KnowledgeDraft) => void;
  onOutputChange: (outputId: string) => void;
  onSubmit: () => void;
}

function KnowledgeComposerModal({ draft, outputs, agents, isSaving, onClose, onChange, onOutputChange, onSubmit }: KnowledgeComposerModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal knowledge-compose-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">加入知识库</div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">输出片段</label>
            <select className="form-input" value={draft.selectedOutputId} onChange={(event) => onOutputChange(event.target.value)}>
              {outputs.map((output) => (
                <option key={output.id} value={output.id}>{output.summary || output.type}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">目标 Agent</label>
            <select className="form-input" value={draft.agentId} onChange={(event) => onChange({ ...draft, agentId: event.target.value })}>
              {agents.length === 0 && <option value="default">default</option>}
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name}{agent.type ? ` (${agent.type})` : ''}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">文档类型</label>
            <select className="form-input" value={draft.documentType} onChange={(event) => onChange({ ...draft, documentType: event.target.value })}>
              {DOCUMENT_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">标题</label>
            <input className="form-input" value={draft.title} onChange={(event) => onChange({ ...draft, title: event.target.value })} />
          </div>

          <div className="form-group">
            <label className="form-label">输出片段摘录</label>
            <textarea className="form-input knowledge-compose-textarea" value={draft.excerpt} onChange={(event) => onChange({ ...draft, excerpt: event.target.value })} rows={10} />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={isSaving}>取消</button>
          <button className="btn btn-primary" onClick={onSubmit} disabled={isSaving}>{isSaving ? '保存中...' : '写入知识库'}</button>
        </div>
      </div>
    </div>
  );
}

export default ResultPage;
