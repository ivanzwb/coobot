import { useState, useEffect } from 'react';
import { api } from '../api/client';

interface Agent {
  id: string;
  name: string;
  type: string;
  role: string;
  model: string;
  temperature: number;
  status: string;
  isSystem: boolean;
  createdAt: string;
}

interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  enabled?: boolean;
}

export function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    type: 'domain',
    role: '',
    model: 'gpt-4',
    temperature: 0.7
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [agentsData, modelsData] = await Promise.all([
        api.getAgents(),
        api.getModels()
      ]);
      setAgents(agentsData as Agent[]);
      const modelsResponse = modelsData as { models: ModelConfig[] };
      setModels(modelsResponse.models || []);
      if (modelsResponse.models && modelsResponse.models.length > 0) {
        const enabledModel = modelsResponse.models.find(m => m.enabled) || modelsResponse.models[0];
        setFormData(prev => ({ ...prev, model: enabledModel.id }));
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    try {
      await api.createAgent(formData);
      setShowForm(false);
      setFormData({ 
        name: '', 
        type: 'domain', 
        role: '', 
        model: models.find(m => m.enabled)?.id || 'gpt-4', 
        temperature: 0.7 
      });
      loadData();
    } catch (error) {
      console.error('Failed to create agent:', error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个Agent吗?')) return;
    try {
      await api.deleteAgent(id);
      loadData();
    } catch (error) {
      console.error('Failed to delete:', error);
    }
  };

  const handleTest = async (_id: string) => {
    try {
      alert('Agent连通性测试功能开发中');
    } catch (error) {
      console.error('Test failed:', error);
    }
  };

  const availableModels = models.filter(m => m.enabled !== false);

  return (
    <div className="content">
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Agent 管理</h2>
          <button className="btn btn-primary" onClick={() => setShowForm(!showForm)}>
            {showForm ? '取消' : '创建 Agent'}
          </button>
        </div>

        {showForm && (
          <div style={{ marginBottom: 24, padding: 16, background: '#f9fafb', borderRadius: 8 }}>
            <div className="form-group">
              <label className="form-label">名称</label>
              <input
                type="text"
                className="form-input"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="输入 Agent 名称"
              />
            </div>
            <div className="form-group">
              <label className="form-label">类型</label>
              <select
                className="form-input"
                value={formData.type}
                onChange={(e) => setFormData({ ...formData, type: e.target.value })}
              >
                <option value="leader">Leader</option>
                <option value="domain">Domain</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">角色描述</label>
              <textarea
                className="form-input"
                rows={3}
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                placeholder="描述 Agent 的职责"
              />
            </div>
            <div className="form-group">
              <label className="form-label">模型</label>
              <select
                className="form-input"
                value={formData.model}
                onChange={(e) => setFormData({ ...formData, model: e.target.value })}
              >
                {availableModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name} ({model.id})
                  </option>
                ))}
              </select>
              <p style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                选择此 Agent 使用的 LLM 模型
              </p>
            </div>
            <div className="form-group">
              <label className="form-label">Temperature: {formData.temperature}</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={formData.temperature}
                onChange={(e) => setFormData({ ...formData, temperature: parseFloat(e.target.value) })}
                style={{ width: '100%' }}
              />
            </div>
            <button className="btn btn-primary" onClick={handleCreate}>
              创建
            </button>
          </div>
        )}

        {loading ? (
          <div className="loading"><div className="spinner"></div></div>
        ) : agents.length === 0 ? (
          <div className="empty-state">
            <h3>暂无 Agent</h3>
            <p>创建您的第一个 Agent</p>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left', padding: 12 }}>名称</th>
                <th style={{ textAlign: 'left', padding: 12 }}>类型</th>
                <th style={{ textAlign: 'left', padding: 12 }}>模型</th>
                <th style={{ textAlign: 'left', padding: 12 }}>状态</th>
                <th style={{ textAlign: 'right', padding: 12 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: 12 }}>
                    <div style={{ fontWeight: 500 }}>{agent.name}</div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{agent.role}</div>
                  </td>
                  <td style={{ padding: 12 }}>
                    <span className={`badge ${agent.type === 'leader' ? 'badge-info' : 'badge-success'}`}>
                      {agent.type}
                    </span>
                  </td>
                  <td style={{ padding: 12 }}>
                    <span>{agent.model}</span>
                  </td>
                  <td style={{ padding: 12 }}>
                    <span className={`badge ${agent.status === 'active' ? 'badge-success' : 'badge-warning'}`}>
                      {agent.status}
                    </span>
                  </td>
                  <td style={{ padding: 12, textAlign: 'right' }}>
                    <button
                      className="btn btn-secondary"
                      style={{ marginRight: 8, padding: '4px 8px' }}
                      onClick={() => handleTest(agent.id)}
                    >
                      测试
                    </button>
                    {!agent.isSystem && (
                      <button
                        className="btn btn-danger"
                        style={{ padding: '4px 8px' }}
                        onClick={() => handleDelete(agent.id)}
                      >
                        删除
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
