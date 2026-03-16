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

export function KnowledgePage() {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ title: '', content: '' });
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    loadDocuments();
  }, []);

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

  const filteredDocs = documents.filter(doc => 
    doc.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    doc.content?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="content">
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">知识库</h2>
          <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? '取消' : '添加知识'}
          </button>
        </div>

        {showForm && (
          <div style={{ marginBottom: 24, padding: 16, background: '#f9fafb', borderRadius: 8 }}>
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
            <button className="btn btn-primary" onClick={handleCreate}>
              保存
            </button>
          </div>
        )}

        <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
          <input
            type="text"
            className="form-input"
            placeholder="搜索知识..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            style={{ flex: 1 }}
          />
          <button className="btn btn-secondary" onClick={handleSearch}>
            搜索
          </button>
        </div>

        {loading ? (
          <div className="loading"><div className="spinner"></div></div>
        ) : filteredDocs.length === 0 ? (
          <div className="empty-state">
            <h3>暂无知识</h3>
            <p>添加您的第一条知识</p>
          </div>
        ) : (
          <div className="task-list">
            {filteredDocs.map((doc) => (
              <div key={doc.id} className="task-item">
                <div className="task-header">
                  <span style={{ fontWeight: 500 }}>{doc.title}</span>
                  <button
                    className="btn btn-danger"
                    style={{ padding: '4px 8px', fontSize: 12 }}
                    onClick={() => handleDelete(doc.id)}
                  >
                    删除
                  </button>
                </div>
                <div className="task-summary">{doc.content?.substring(0, 150)}...</div>
                <div className="task-meta">
                  <span>来源: {doc.sourceType}</span>
                  <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
