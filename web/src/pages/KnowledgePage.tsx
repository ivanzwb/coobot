import { useState, useEffect } from 'react';
import { api } from '../api/client';

interface KnowledgeDocument {
  id: string;
  title: string;
  content: string;
  sourceType: string;
  createdAt: string;
  updatedAt: string;
}

interface Agent {
  id: string;
  name: string;
}

interface ImportHistory {
  id: string;
  filename: string;
  status: 'success' | 'failed' | 'processing';
  message?: string;
  importedAt: string;
}

export function KnowledgePage() {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('all');
  const [importHistory, setImportHistory] = useState<ImportHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ title: '', content: '' });
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadAgents();
    loadImportHistory();
    loadDocuments();
  }, []);

  useEffect(() => {
    loadDocuments();
  }, [selectedAgentId]);

  const loadAgents = async () => {
    try {
      const data = await api.getAgents();
      setAgents(data as Agent[]);
    } catch (error) {
      console.error('Failed to load agents:', error);
    }
  };

  const loadDocuments = async () => {
    try {
      setLoading(true);
      const data = await api.getKnowledge();
      setDocuments(data as KnowledgeDocument[]);
    } catch (error) {
      console.error('Failed to load documents:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadImportHistory = async () => {
    try {
      const data = await api.getImportHistory();
      setImportHistory(data as ImportHistory[]);
    } catch (error) {
      console.error('Failed to load import history:', error);
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      loadDocuments();
      return;
    }
    try {
      const results = await api.searchKnowledge(searchQuery);
      setDocuments(results as KnowledgeDocument[]);
    } catch (error) {
      console.error('Search failed:', error);
    }
  };

  const handleCreate = async () => {
    try {
      await api.createKnowledgeDocument(formData.title, formData.content);
      setShowForm(false);
      setFormData({ title: '', content: '' });
      loadDocuments();
    } catch (error) {
      console.error('Failed to create document:', error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这条知识吗?')) return;
    try {
      await api.deleteKnowledgeDocument(id);
      loadDocuments();
    } catch (error) {
      console.error('Failed to delete:', error);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success': return '✓';
      case 'failed': return '⚠️';
      case 'processing': return '🔄';
      default: return '○';
    }
  };

  const filteredDocs = documents.filter(doc => 
    doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    doc.content?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="knowledge-page">
      <div className="page-header">
        <h2>知识库</h2>
        <div className="header-actions">
          <select 
            className="form-input"
            value={selectedAgentId}
            onChange={(e) => setSelectedAgentId(e.target.value)}
            style={{ width: 'auto' }}
          >
            <option value="all">全部 Agent</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.name}</option>
            ))}
          </select>
          <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? '取消' : '+ 添加'}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="knowledge-form">
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">标题</label>
              <input
                type="text"
                className="form-input"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="输入知识标题"
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">内容</label>
              <textarea
                className="form-input"
                rows={4}
                value={formData.content}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                placeholder="输入知识内容"
              />
            </div>
          </div>
          <div className="form-actions">
            <button className="btn btn-primary" onClick={handleCreate}>
              保存
            </button>
          </div>
        </div>
      )}

      <div className="knowledge-toolbar">
        <input
          type="text"
          className="search-input"
          placeholder="🔍 搜索知识资料..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <button className="btn btn-secondary" onClick={handleSearch}>
          搜索
        </button>
      </div>

      <div className="knowledge-layout">
        <div className="knowledge-main">
          <div className="document-section">
            <div className="section-header">
              <h3>📄 文档列表</h3>
              <span className="doc-count">{filteredDocs.length} 个文档</span>
            </div>

            {loading ? (
              <div className="loading"><div className="spinner"></div></div>
            ) : filteredDocs.length === 0 ? (
              <div className="empty-state">
                <h3>暂无知识资料</h3>
                <p>点击"添加"按钮创建知识文档</p>
              </div>
            ) : (
              <div className="document-list">
                {filteredDocs.map((doc) => (
                  <div key={doc.id} className="document-item">
                    <div className="document-header">
                      <div className="document-info">
                        <span className="document-icon">📄</span>
                        <span className="document-title">{doc.title}</span>
                      </div>
                      <div className="document-actions">
                        <button className="btn-link">预览</button>
                        <button 
                          className="btn-danger-small"
                          onClick={() => handleDelete(doc.id)}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                    <div className="document-meta">
                      <span>来源: {doc.sourceType}</span>
                      <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
                    </div>
                    <div className="document-preview">
                      {doc.content?.substring(0, 150)}...
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="knowledge-sidebar">
          <h3>📥 导入历史</h3>
          <div className="import-history">
            {importHistory.length === 0 ? (
              <div className="empty-hint">暂无导入记录</div>
            ) : (
              importHistory.map((item) => (
                <div key={item.id} className={`import-item ${item.status}`}>
                  <div className="import-status">{getStatusIcon(item.status)}</div>
                  <div className="import-content">
                    <div className="import-filename">{item.filename}</div>
                    <div className="import-message">
                      {item.status === 'success' ? '成功' : 
                       item.status === 'failed' ? (item.message || '导入失败') : '处理中'}
                    </div>
                    <div className="import-time">
                      {new Date(item.importedAt).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default KnowledgePage;
