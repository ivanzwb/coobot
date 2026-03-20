import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAppStore } from '../stores/appStore';

interface Memory {
  id: string;
  type: string;
  content: string;
  summary: string;
  importance: string;
  sourceType: string;
  agentId?: string;
  agentName?: string;
  conversationId?: string;
  taskId?: string;
  createdAt: string;
  expiresAt?: string;
}

type MemoryImportance = 'low' | 'medium' | 'high';

interface Agent {
  id: string;
  name: string;
  type: string;
}

interface DailyConsolidation {
  date: string;
  status: 'completed' | 'skipped' | 'failed';
  memoryCount?: number;
  note?: string;
  agentId?: string;
  agentName?: string;
}

interface MemorySourceDetail {
  memoryEntryId: string;
  sourceType: string;
  summaryDate?: string;
  sourceConversationIds: string[];
  sourceTaskId?: string | null;
  sourceAttachmentIds: string[];
  dedupKey?: string | null;
  jobId?: string | null;
  summaryVersion?: string | null;
}

export function MemoryPage() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [dailyHistory, setDailyHistory] = useState<DailyConsolidation[]>([]);
  const [loading, setLoading] = useState(true);
  const [rerunSubmitting, setRerunSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceDrawerMemoryId, setSourceDrawerMemoryId] = useState<string | null>(null);
  const [rerunDialogDate, setRerunDialogDate] = useState<string | null>(null);
  const [rerunDateInput, setRerunDateInput] = useState('');
  const [sourceLoadingId, setSourceLoadingId] = useState<string | null>(null);
  const [contentDialogMemory, setContentDialogMemory] = useState<Memory | null>(null);
  const [editingContent, setEditingContent] = useState(false);
  const [contentDraft, setContentDraft] = useState('');
  const [summaryDraft, setSummaryDraft] = useState('');
  const [importanceDraft, setImportanceDraft] = useState<MemoryImportance>('medium');
  const [contentSubmitting, setContentSubmitting] = useState(false);
  const [memorySources, setMemorySources] = useState<Record<string, MemorySourceDetail>>({});
  const [sourceErrors, setSourceErrors] = useState<Record<string, string>>({});
  const navigate = useNavigate();
  const initApp = useAppStore((state) => state.init);
  const conversationId = useAppStore((state) => state.conversationId);

  useEffect(() => {
    loadAgents();
    loadDailyHistory();
  }, []);

  useEffect(() => {
    loadMemories();
    loadDailyHistory(selectedAgentId || undefined);
  }, [selectedAgentId]);

  const loadAgents = async () => {
    try {
      const data = await api.getAgents();
      setAgents(data as Agent[]);
    } catch (error) {
      console.error('Failed to load agents:', error);
    }
  };

  const loadMemories = async () => {
    try {
      setLoading(true);
      const data = await api.getMemories(selectedAgentId || undefined);
      setMemories(data as Memory[]);
    } catch (error) {
      console.error('Failed to load memories:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadDailyHistory = async (agentId?: string) => {
    try {
      const data = await api.getDailyConsolidationHistory(agentId);
      setDailyHistory(data as DailyConsolidation[]);
    } catch (error) {
      console.error('Failed to load daily history:', error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这条记忆吗?')) return;
    try {
      await api.deleteMemory(id);
      loadMemories();
    } catch (error) {
      console.error('Failed to delete:', error);
    }
  };

  const handleOpenSourceDrawer = async (memoryId: string) => {
    setSourceDrawerMemoryId(memoryId);
    if (memorySources[memoryId] || sourceLoadingId === memoryId) {
      return;
    }

    try {
      setSourceLoadingId(memoryId);
      const source = await api.getMemoryEntrySource(memoryId) as MemorySourceDetail;
      setMemorySources((current) => ({
        ...current,
        [memoryId]: source
      }));
      setSourceErrors((current) => {
        const next = { ...current };
        delete next[memoryId];
        return next;
      });
    } catch (error: any) {
      setSourceErrors((current) => ({
        ...current,
        [memoryId]: error.message || '加载来源失败'
      }));
    } finally {
      setSourceLoadingId(null);
    }
  };

  const handleOpenContentDialog = (memory: Memory) => {
    setContentDialogMemory(memory);
    setEditingContent(false);
    setContentDraft(memory.content || '');
    setSummaryDraft(memory.summary || '');
    setImportanceDraft((memory.importance as MemoryImportance) || 'medium');
  };

  const handleCloseContentDialog = () => {
    if (contentSubmitting) {
      return;
    }
    setContentDialogMemory(null);
    setEditingContent(false);
    setContentDraft('');
    setSummaryDraft('');
  };

  const handleSaveMemoryContent = async () => {
    if (!contentDialogMemory) {
      return;
    }

    const nextSummary = summaryDraft.trim();
    const nextContent = contentDraft.trim();

    if (!nextSummary || !nextContent) {
      alert('总览和记忆内容不能为空');
      return;
    }

    try {
      setContentSubmitting(true);
      await api.updateMemory(contentDialogMemory.id, {
        summary: nextSummary,
        content: nextContent,
        importance: importanceDraft
      });

      setMemories((current) => current.map((item) => {
        if (item.id !== contentDialogMemory.id) {
          return item;
        }

        return {
          ...item,
          summary: nextSummary,
          content: nextContent,
          importance: importanceDraft
        };
      }));

      setContentDialogMemory((current) => current ? {
        ...current,
        summary: nextSummary,
        content: nextContent,
        importance: importanceDraft
      } : null);
      setEditingContent(false);
    } catch (error) {
      console.error('Failed to update memory:', error);
      alert('保存失败，请稍后重试');
    } finally {
      setContentSubmitting(false);
    }
  };

  const handleSubmitRerun = async () => {
    if (!selectedAgentId) {
      return;
    }

    const targetDate = rerunDateInput || rerunDialogDate;
    if (!targetDate) {
      return;
    }

    try {
      setRerunSubmitting(true);
      await api.runDailyConsolidation(selectedAgentId || undefined, targetDate);
      await Promise.all([
        loadMemories(),
        loadDailyHistory(selectedAgentId || undefined)
      ]);
      setRerunDialogDate(null);
      setRerunDateInput('');
    } catch (error) {
      console.error('Failed to rerun:', error);
    } finally {
      setRerunSubmitting(false);
    }
  };

  const handleOpenTask = (taskId: string) => {
    navigate(`/tasks/${taskId}`);
  };

  const handleOpenConversation = async (_targetConversationId: string) => {
    if (!conversationId) {
      await initApp();
    }

    navigate(`/chat/${_targetConversationId}`);
  };

  const handleManualConsolidation = async () => {
    if (!selectedAgentId) {
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    setRerunDateInput(today);
    setRerunDialogDate(today);
  };

  const getImportanceLabel = (importance: string) => {
    const labels: Record<string, string> = {
      'low': '低',
      'medium': '中',
      'high': '高'
    };
    return labels[importance] || importance;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return '✓';
      case 'skipped': return '⚠️';
      case 'failed': return '✕';
      default: return '○';
    }
  };

  const getHistorySummaryText = (item: DailyConsolidation) => {
    if (item.status === 'completed') {
      return `完成 (生成${item.memoryCount ?? 0}条)`;
    }

    if (item.status === 'skipped') {
      return item.note || '去重跳过';
    }

    return '失败';
  };

  const formatShortDate = (value: string) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value.slice(5);
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }

    return `${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
  };

  const filteredMemories = memories.filter(m => {
    if (searchQuery && !m.summary?.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !m.content?.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    return true;
  });

  const agentNameById = new Map(agents.map((agent) => [agent.id, agent.name]));
  const showAgentSource = selectedAgentId === '';
  const canManualConsolidate = selectedAgentId !== '';

  const getMemoryAgentName = (memory: Memory) => {
    if (memory.agentName) {
      return memory.agentName;
    }
    if (memory.agentId) {
      return agentNameById.get(memory.agentId) || memory.agentId;
    }
    return '未指定';
  };

  const getHistoryAgentName = (item: DailyConsolidation) => {
    if (item.agentName) {
      return item.agentName;
    }
    if (item.agentId) {
      return agentNameById.get(item.agentId) || item.agentId;
    }
    return '未指定';
  };

  const currentSource = sourceDrawerMemoryId ? memorySources[sourceDrawerMemoryId] : undefined;
  const currentSourceError = sourceDrawerMemoryId ? sourceErrors[sourceDrawerMemoryId] : undefined;
  const sourceLoading = sourceDrawerMemoryId ? sourceLoadingId === sourceDrawerMemoryId : false;

  return (
    <div className="memory-page">
      <div className="page-header">
        <h2>记忆管理</h2>
        <div className="memory-header-actions">
          <label className="agent-inline-switcher">
            <span>Agent:</span>
            <select
              className="agent-select"
              value={selectedAgentId}
              onChange={(event) => setSelectedAgentId(event.target.value)}
            >
              <option value="">全部</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
          </label>
          {canManualConsolidate && (
            <button className="btn btn-primary memory-manual-btn" onClick={handleManualConsolidation} disabled={rerunSubmitting}>
              {rerunSubmitting ? '整理中...' : '手动整理'}
            </button>
          )}
        </div>
      </div>

      <div className="memory-content-stack">
        <div className="memory-main">
          <div className="memory-toolbar">
            <input
              type="text"
              className="search-input"
              placeholder="🔍 搜索记忆..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {loading ? (
            <div className="loading"><div className="spinner"></div></div>
          ) : filteredMemories.length === 0 ? (
            <div className="empty-state">
              <h3>暂无记忆</h3>
              <p>选择 Agent 后，将显示该 Agent 的记忆条目</p>
            </div>
          ) : (
            <div className="memory-list">
              <div className="list-header">
                <span className="memory-list-title">记忆列表</span>
              </div>
              {filteredMemories.map((memory) => (
                <div key={memory.id} className="memory-item">
                  <div className="memory-title-block">
                    <div className="memory-title">
                      <span className="memory-icon">📌</span>
                      {memory.summary || '记忆'}
                    </div>
                    <div className="memory-overview">{memory.summary || '暂无总览'}</div>
                    <div className="memory-meta-inline">
                      <span className={`badge ${
                        memory.importance === 'high' ? 'badge-error' :
                        memory.importance === 'medium' ? 'badge-warning' : 'badge-success'
                      }`}>
                        {getImportanceLabel(memory.importance)}
                      </span>
                      {showAgentSource && <span className="meta-agent">{getMemoryAgentName(memory)}</span>}
                    </div>
                  </div>
                  <div className="memory-row-date">
                    {memory.createdAt.slice(0, 10)}
                  </div>
                  <div className="memory-actions">
                    <button className="btn-link memory-row-action-btn" onClick={() => handleOpenContentDialog(memory)}>
                      查看
                    </button>
                    <button className="btn-link memory-row-action-btn" onClick={() => handleOpenSourceDrawer(memory.id)}>
                      来源
                    </button>
                    <button
                      className="btn-danger-small memory-row-action-btn"
                      onClick={() => handleDelete(memory.id)}
                    >
                      删
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="memory-history">
          <h3>📅 日摘要整理历史</h3>
          <div className="history-list">
            {dailyHistory.length === 0 ? (
              <div className="empty-hint">暂无整理记录</div>
            ) : (
              dailyHistory.map((item, idx) => (
                <div key={idx} className={`history-item ${item.status}`}>
                  <div className="history-content">
                    <div className="history-line">
                      {formatShortDate(item.date)}: {getStatusIcon(item.status)} {getHistorySummaryText(item)}
                    </div>
                    {showAgentSource && <div className="history-agent">{getHistoryAgentName(item)}</div>}
                  </div>
                  {canManualConsolidate && (
                    <button
                      className="btn-link-small history-rerun-btn"
                      disabled={rerunSubmitting}
                      onClick={() => {
                        setRerunDateInput(item.date);
                        setRerunDialogDate(item.date);
                      }}
                    >
                      {rerunSubmitting ? '处理中...' : '重跑'}
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <MemoryEntrySourceDrawer
        open={Boolean(sourceDrawerMemoryId)}
        loading={sourceLoading}
        error={currentSourceError}
        source={currentSource}
        onClose={() => setSourceDrawerMemoryId(null)}
        onOpenTask={handleOpenTask}
        onOpenConversation={handleOpenConversation}
      />

      <MemoryContentDialog
        open={Boolean(contentDialogMemory)}
        memory={contentDialogMemory || undefined}
        editing={editingContent}
        summaryDraft={summaryDraft}
        contentDraft={contentDraft}
        importanceDraft={importanceDraft}
        submitting={contentSubmitting}
        onToggleEdit={() => setEditingContent((current) => !current)}
        onSummaryChange={setSummaryDraft}
        onContentChange={setContentDraft}
        onImportanceChange={setImportanceDraft}
        onClose={handleCloseContentDialog}
        onSave={handleSaveMemoryContent}
      />

      <MemoryConsolidationRerunDialog
        open={Boolean(rerunDialogDate)}
        dateValue={rerunDateInput}
        submitting={rerunSubmitting}
        onChangeDate={setRerunDateInput}
        onClose={() => {
          if (rerunSubmitting) return;
          setRerunDialogDate(null);
          setRerunDateInput('');
        }}
        onConfirm={handleSubmitRerun}
      />
    </div>
  );
}

function MemoryContentDialog({
  open,
  memory,
  editing,
  summaryDraft,
  contentDraft,
  importanceDraft,
  submitting,
  onToggleEdit,
  onSummaryChange,
  onContentChange,
  onImportanceChange,
  onClose,
  onSave
}: {
  open: boolean;
  memory?: Memory;
  editing: boolean;
  summaryDraft: string;
  contentDraft: string;
  importanceDraft: MemoryImportance;
  submitting: boolean;
  onToggleEdit: () => void;
  onSummaryChange: (value: string) => void;
  onContentChange: (value: string) => void;
  onImportanceChange: (value: MemoryImportance) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  if (!open || !memory) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal memory-content-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">记忆内容</div>
        <div className="modal-body">
          <div className="memory-content-field">
            <span className="memory-content-label">总览</span>
            {editing ? (
              <input
                type="text"
                className="form-input"
                value={summaryDraft}
                onChange={(event) => onSummaryChange(event.target.value)}
                disabled={submitting}
              />
            ) : (
              <div className="memory-content-readonly">{memory.summary || '暂无总览'}</div>
            )}
          </div>
          <div className="memory-content-field">
            <span className="memory-content-label">重要级别</span>
            {editing ? (
              <select
                className="agent-select"
                value={importanceDraft}
                onChange={(event) => onImportanceChange(event.target.value as MemoryImportance)}
                disabled={submitting}
              >
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
              </select>
            ) : (
              <div className="memory-content-readonly">{importanceDraft === 'high' ? '高' : importanceDraft === 'medium' ? '中' : '低'}</div>
            )}
          </div>
          <div className="memory-content-field">
            <span className="memory-content-label">记忆内容</span>
            {editing ? (
              <textarea
                className="memory-content-textarea"
                value={contentDraft}
                onChange={(event) => onContentChange(event.target.value)}
                disabled={submitting}
              />
            ) : (
              <pre className="memory-content-readonly memory-content-pre">{memory.content || '暂无内容'}</pre>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={submitting}>关闭</button>
          {editing ? (
            <button className="btn btn-primary" onClick={onSave} disabled={submitting}>{submitting ? '保存中...' : '保存'}</button>
          ) : (
            <button className="btn btn-primary" onClick={onToggleEdit}>编辑</button>
          )}
        </div>
      </div>
    </div>
  );
}

function MemoryEntrySourceDrawer({
  open,
  source,
  loading,
  error,
  onClose,
  onOpenTask,
  onOpenConversation
}: {
  open: boolean;
  source?: MemorySourceDetail;
  loading: boolean;
  error?: string;
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
  onOpenConversation: (conversationId: string) => void | Promise<void>;
}) {
  if (!open) {
    return null;
  }

  if (loading) {
    return (
      <div className="memory-source-drawer-overlay" onClick={onClose}>
        <div className="memory-source-drawer" onClick={(event) => event.stopPropagation()}>
          <div className="memory-source-drawer-header">
            <h3>来源链路</h3>
            <button className="btn-link" onClick={onClose}>关闭</button>
          </div>
          <div className="memory-source-panel">正在加载来源详情...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="memory-source-drawer-overlay" onClick={onClose}>
        <div className="memory-source-drawer" onClick={(event) => event.stopPropagation()}>
          <div className="memory-source-drawer-header">
            <h3>来源链路</h3>
            <button className="btn-link" onClick={onClose}>关闭</button>
          </div>
          <div className="memory-source-panel memory-source-error">{error}</div>
        </div>
      </div>
    );
  }

  if (!source) {
    return null;
  }

  return (
    <div className="memory-source-drawer-overlay" onClick={onClose}>
      <div className="memory-source-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="memory-source-drawer-header">
          <h3>来源链路</h3>
          <button className="btn-link" onClick={onClose}>关闭</button>
        </div>

        <div className="memory-source-panel">
          <div className="memory-source-grid">
            <div className="memory-source-row">
              <span className="memory-source-label">来源类型</span>
              <span className="memory-source-value">{source.sourceType}</span>
            </div>
            {source.summaryDate && (
              <div className="memory-source-row">
                <span className="memory-source-label">摘要日期</span>
                <span className="memory-source-value">{source.summaryDate}</span>
              </div>
            )}
            {source.sourceTaskId && (
              <div className="memory-source-row">
                <span className="memory-source-label">来源任务</span>
                <button className="memory-source-link" onClick={() => onOpenTask(source.sourceTaskId || '')}>
                  {source.sourceTaskId}
                </button>
              </div>
            )}
            {source.sourceConversationIds.length > 0 && (
              <div className="memory-source-row">
                <span className="memory-source-label">来源会话</span>
                <div className="memory-source-links">
                  {source.sourceConversationIds.map((conversationId) => (
                    <button key={conversationId} className="memory-source-link" onClick={() => onOpenConversation(conversationId)}>
                      {conversationId}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {source.jobId && (
              <div className="memory-source-row">
                <span className="memory-source-label">整理作业</span>
                <span className="memory-source-value">{source.jobId}</span>
              </div>
            )}
            {source.summaryVersion && (
              <div className="memory-source-row">
                <span className="memory-source-label">摘要版本</span>
                <span className="memory-source-value">{source.summaryVersion}</span>
              </div>
            )}
            {source.dedupKey && (
              <div className="memory-source-row memory-source-row-block">
                <span className="memory-source-label">去重键</span>
                <span className="memory-source-value memory-source-code">{source.dedupKey}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MemoryConsolidationRerunDialog({
  open,
  dateValue,
  submitting,
  onChangeDate,
  onClose,
  onConfirm
}: {
  open: boolean;
  dateValue: string;
  submitting: boolean;
  onChangeDate: (date: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">手动补跑日摘要整理</div>
        <div className="modal-body">
          <p style={{ marginTop: 0, color: '#4b5563' }}>
            选择要补跑的日期，系统会重新触发当日记忆整理并更新历史记录。
          </p>
          <div className="memory-source-row">
            <span className="memory-source-label">补跑日期</span>
            <input
              type="date"
              className="form-input"
              value={dateValue}
              onChange={(event) => onChangeDate(event.target.value)}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={submitting}>取消</button>
          <button className="btn btn-primary" onClick={onConfirm} disabled={!dateValue || submitting}>
            {submitting ? '提交中...' : '确认补跑'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default MemoryPage;
