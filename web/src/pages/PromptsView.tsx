import React, { useEffect, useState } from 'react';
import axios from 'axios';

interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  content: string;
  variables: { name: string; description: string; required: boolean }[];
  tags: string[];
}

const PromptsView: React.FC = () => {
  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<PromptTemplate | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    content: '',
    tags: '',
  });

  useEffect(() => {
    fetchPrompts();
  }, []);

  const fetchPrompts = async () => {
    try {
      const response = await axios.get('/api/v1/prompts');
      setPrompts(response.data);
    } catch (error) {
      console.error('Failed to fetch prompts:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    try {
      await axios.post('/api/v1/prompts', {
        ...formData,
        tags: formData.tags.split(',').map(t => t.trim()).filter(t => t),
      });
      fetchPrompts();
      setShowModal(false);
      setFormData({ name: '', description: '', content: '', tags: '' });
    } catch (error) {
      console.error('Failed to create prompt:', error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个模板吗？')) return;
    try {
      await axios.delete(`/api/v1/prompts/${id}`);
      fetchPrompts();
    } catch (error) {
      console.error('Failed to delete prompt:', error);
    }
  };

  if (loading) {
    return <div className="page-content">加载中...</div>;
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">Prompt 模板</h1>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          + 创建模板
        </button>
      </div>

      <div>
        {prompts.map(prompt => (
          <div key={prompt.id} className="agent-card">
            <div className="agent-card-header">
              <span className="agent-name">{prompt.name}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button 
                  className="btn"
                  onClick={() => {
                    setEditingPrompt(prompt);
                    setFormData({
                      name: prompt.name,
                      description: prompt.description,
                      content: prompt.content,
                      tags: prompt.tags.join(', '),
                    });
                    setShowModal(true);
                  }}
                >
                  编辑
                </button>
                <button 
                  className="btn btn-danger"
                  onClick={() => handleDelete(prompt.id)}
                >
                  删除
                </button>
              </div>
            </div>
            <p style={{ color: '#666', marginBottom: 8 }}>{prompt.description}</p>
            <div className="agent-tags">
              {prompt.tags.map((tag, i) => (
                <span key={i} className="tag">{tag}</span>
              ))}
            </div>
          </div>
        ))}

        {prompts.length === 0 && (
          <div style={{ textAlign: 'center', color: '#999', padding: 40 }}>
            暂无 Prompt 模板，点击上方按钮创建
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => { setShowModal(false); setEditingPrompt(null); }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ minWidth: 600 }}>
            <h2 className="modal-title">{editingPrompt ? '编辑模板' : '创建模板'}</h2>
            
            <div className="form-group">
              <label className="form-label">名称</label>
              <input
                type="text"
                className="form-input"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                placeholder="输入模板名称"
              />
            </div>

            <div className="form-group">
              <label className="form-label">描述</label>
              <input
                type="text"
                className="form-input"
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                placeholder="输入模板描述"
              />
            </div>

            <div className="form-group">
              <label className="form-label">内容</label>
              <textarea
                className="form-input"
                value={formData.content}
                onChange={e => setFormData({ ...formData, content: e.target.value })}
                placeholder="输入 Prompt 内容，使用 {{variable}} 表示变量"
                rows={10}
                style={{ resize: 'vertical', fontFamily: 'monospace' }}
              />
            </div>

            <div className="form-group">
              <label className="form-label">标签 (逗号分隔)</label>
              <input
                type="text"
                className="form-input"
                value={formData.tags}
                onChange={e => setFormData({ ...formData, tags: e.target.value })}
                placeholder="代码, 分析, 写作"
              />
            </div>

            <div className="modal-actions">
              <button className="btn" onClick={() => { setShowModal(false); setEditingPrompt(null); }}>
                取消
              </button>
              <button className="btn btn-primary" onClick={handleCreate}>
                {editingPrompt ? '保存' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PromptsView;