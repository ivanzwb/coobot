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
  const [consolidating, setConsolidating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null);
  const [sourceLoadingId, setSourceLoadingId] = useState<string | null>(null);
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

  const handleToggleSource = async (memoryId: string) => {
    if (expandedSourceId === memoryId) {
      setExpandedSourceId(null);
      return;
    }

    setExpandedSourceId(memoryId);

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

  const handleRerun = async (date: string) => {
    if (!confirm(`确定要重新整理 ${date} 的记忆吗?`)) return;
    try {
      setConsolidating(true);
      await api.runDailyConsolidation(selectedAgentId || undefined, date);
      await Promise.all([
        loadMemories(),
        loadDailyHistory(selectedAgentId || undefined)
      ]);
    } catch (error) {
      console.error('Failed to rerun:', error);
    } finally {
      setConsolidating(false);
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
    try {
      setConsolidating(true);
      const result = await api.runDailyConsolidation(selectedAgentId || undefined) as {
        totalConversations?: number;
        totalMessages?: number;
        memoriesCreated?: number;
        summary?: string;
      };
      await Promise.all([
        loadMemories(),
        loadDailyHistory(selectedAgentId || undefined)
      ]);
      alert(result.summary || '手动整理已完成');
    } catch (error) {
      console.error('Failed to consolidate memories:', error);
    } finally {
      setConsolidating(false);
    }
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

  const filteredMemories = memories.filter(m => {
    if (searchQuery && !m.summary?.toLowerCase().includes(searchQuery.toLowerCase()) &&
        !m.content?.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    return true;
  });

  return (
    <div className="memory-page">
      <div className="page-header">
        <h2>记忆管理</h2>
        <button className="btn btn-secondary" onClick={() => {
          loadMemories();
          loadDailyHistory(selectedAgentId || undefined);
        }}>
          🔄 刷新
        </button>
      </div>

      <div className="memory-layout">
        <div className="memory-sidebar">
          <div className="sidebar-section">
            <h3>Agent 选择</h3>
            <div className="agent-list">
              <button
                className={`agent-item ${selectedAgentId === '' ? 'active' : ''}`}
                onClick={() => setSelectedAgentId('')}
              >
                全部 Agent
              </button>
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  className={`agent-item ${selectedAgentId === agent.id ? 'active' : ''}`}
                  onClick={() => setSelectedAgentId(agent.id)}
                >
                  <span className="agent-icon">🤖</span>
                  {agent.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="memory-main">
          <div className="memory-toolbar">
            <input
              type="text"
              className="search-input"
              placeholder="🔍 搜索记忆..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button className="btn btn-primary" onClick={handleManualConsolidation} disabled={consolidating}>
              {consolidating ? '整理中...' : '手动整理'}
            </button>
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
                <span>记忆列表</span>
                <span>{filteredMemories.length} 条</span>
              </div>
              {filteredMemories.map((memory) => (
                <div key={memory.id} className="memory-item">
                  <div className="memory-header">
                    <div className="memory-title">
                      <span className="memory-icon">📌</span>
                      {memory.summary || '记忆'}
                    </div>
                    <div className="memory-actions">
                      <button className="btn-link" onClick={() => handleToggleSource(memory.id)}>
                        {expandedSourceId === memory.id ? '收起来源' : '来源'}
                      </button>
                      <button
                        className="btn-danger-small"
                        onClick={() => handleDelete(memory.id)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                  <div className="memory-meta">
                    <span className={`badge ${
                      memory.importance === 'high' ? 'badge-error' :
                      memory.importance === 'medium' ? 'badge-warning' : 'badge-success'
                    }`}>
                      {getImportanceLabel(memory.importance)}
                    </span>
                    {memory.agentName && <span className="meta-agent">{memory.agentName}</span>}
                    <span className="meta-date">
                      {new Date(memory.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="memory-content">
                    {memory.content?.substring(0, 200)}...
                  </div>
                  {expandedSourceId === memory.id && (
                    <MemorySourcePanel
                      source={memorySources[memory.id]}
                      loading={sourceLoadingId === memory.id}
                      error={sourceErrors[memory.id]}
                      onOpenTask={handleOpenTask}
                      onOpenConversation={handleOpenConversation}
                    />
                  )}
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
                  <div className="history-status">{getStatusIcon(item.status)}</div>
                  <div className="history-content">
                    <div className="history-date">{item.date}</div>
                    <div className="history-info">
                      {item.status === 'completed' ? `完成 (生成${item.memoryCount}条)` :
                       item.status === 'skipped' ? item.note || '去重跳过' : '失败'}
                    </div>
                  </div>
                  <button
                    className="btn-link-small"
                    disabled={consolidating}
                    onClick={() => handleRerun(item.date)}
                  >
                    {consolidating ? '处理中...' : '重跑'}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MemorySourcePanel({
  source,
  loading,
  error,
  onOpenTask,
  onOpenConversation
}: {
  source?: MemorySourceDetail;
  loading: boolean;
  error?: string;
  onOpenTask: (taskId: string) => void;
  onOpenConversation: (conversationId: string) => void | Promise<void>;
}) {
  if (loading) {
    return <div className="memory-source-panel">正在加载来源详情...</div>;
  }

  if (error) {
    return <div className="memory-source-panel memory-source-error">{error}</div>;
  }

  if (!source) {
    return null;
  }

  return (
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
  );
}

export default MemoryPage;
