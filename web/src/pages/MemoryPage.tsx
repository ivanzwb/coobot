import { useState, useEffect } from 'react';
import { api } from '../api/client';

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

export function MemoryPage() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [dailyHistory, setDailyHistory] = useState<DailyConsolidation[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadAgents();
    loadDailyHistory();
  }, []);

  useEffect(() => {
    loadMemories();
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

  const loadDailyHistory = async () => {
    try {
      const data = await api.getDailyConsolidationHistory();
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

  const handleRerun = async (date: string) => {
    if (!confirm(`确定要重新整理 ${date} 的记忆吗?`)) return;
    try {
      await api.runDailyConsolidation(selectedAgentId || undefined);
      loadDailyHistory();
    } catch (error) {
      console.error('Failed to rerun:', error);
    }
  };

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      'short_term': '短期记忆',
      'agent': 'Agent记忆',
      'persistent': '持久记忆'
    };
    return labels[type] || type;
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
        <button className="btn btn-secondary" onClick={loadMemories}>
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
            <button className="btn btn-primary">
              手动整理
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
                      <button className="btn-link">来源</button>
                      <button 
                        className="btn-danger-small"
                        onClick={() => handleDelete(memory.id)}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                  <div className="memory-meta">
                    <span className="badge badge-info">{getTypeLabel(memory.type)}</span>
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
                    onClick={() => handleRerun(item.date)}
                  >
                    重跑
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

export default MemoryPage;
