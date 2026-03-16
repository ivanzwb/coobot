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
  conversationId?: string;
  taskId?: string;
  createdAt: string;
  expiresAt?: string;
}

export function MemoryPage() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('');
  const [filterImportance, setFilterImportance] = useState<string>('');

  useEffect(() => {
    loadMemories();
  }, []);

  const loadMemories = async () => {
    try {
      setLoading(true);
      const data = await api.getMemories();
      setMemories(data as Memory[]);
    } catch (error) {
      console.error('Failed to load memories:', error);
    } finally {
      setLoading(false);
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

  const filteredMemories = memories.filter(m => {
    if (filterType && m.type !== filterType) return false;
    if (filterImportance && m.importance !== filterImportance) return false;
    return true;
  });

  return (
    <div className="content">
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">记忆管理</h2>
          <button className="btn btn-secondary" onClick={loadMemories}>
            刷新
          </button>
        </div>

        <div style={{ marginBottom: 16, display: 'flex', gap: 16 }}>
          <div>
            <label style={{ fontSize: 12, marginRight: 8 }}>类型:</label>
            <select
              className="form-input"
              style={{ width: 'auto' }}
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
            >
              <option value="">全部</option>
              <option value="short_term">短期记忆</option>
              <option value="agent">Agent记忆</option>
              <option value="persistent">持久记忆</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, marginRight: 8 }}>重要性:</label>
            <select
              className="form-input"
              style={{ width: 'auto' }}
              value={filterImportance}
              onChange={(e) => setFilterImportance(e.target.value)}
            >
              <option value="">全部</option>
              <option value="high">高</option>
              <option value="medium">中</option>
              <option value="low">低</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="loading"><div className="spinner"></div></div>
        ) : filteredMemories.length === 0 ? (
          <div className="empty-state">
            <h3>暂无记忆</h3>
            <p>记忆将在任务执行过程中自动生成</p>
          </div>
        ) : (
          <div className="task-list">
            {filteredMemories.map((memory) => (
              <div key={memory.id} className="task-item">
                <div className="task-header">
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontWeight: 500 }}>{memory.summary || '记忆'}</span>
                    <span className="badge badge-info">{getTypeLabel(memory.type)}</span>
                    <span className={`badge ${
                      memory.importance === 'high' ? 'badge-error' : 
                      memory.importance === 'medium' ? 'badge-warning' : 'badge-success'
                    }`}>
                      {getImportanceLabel(memory.importance)}
                    </span>
                  </div>
                  <button
                    className="btn btn-danger"
                    style={{ padding: '4px 8px', fontSize: 12 }}
                    onClick={() => handleDelete(memory.id)}
                  >
                    删除
                  </button>
                </div>
                <div className="task-summary">{memory.content?.substring(0, 200)}...</div>
                <div className="task-meta">
                  <span>来源: {memory.sourceType}</span>
                  {memory.taskId && <span>任务: {memory.taskId.substring(0, 8)}...</span>}
                  <span>{new Date(memory.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
