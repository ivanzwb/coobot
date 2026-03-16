import { useState, useEffect } from 'react';
import { api } from '../api/client';

interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  baseUrl?: string;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
  timeout?: number;
  enabled?: boolean;
}

interface ModelsResponse {
  defaultModel: string;
  models: ModelConfig[];
}

export function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [defaultModel, setDefaultModel] = useState('gpt-4');
  const [showModelForm, setShowModelForm] = useState(false);
  const [editingModel, setEditingModel] = useState<ModelConfig | null>(null);
  const [modelForm, setModelForm] = useState({
    id: '',
    name: '',
    provider: 'openai',
    baseUrl: '',
    apiKey: '',
    defaultTemperature: 0.7,
    defaultMaxTokens: 4096,
    timeout: 120000,
    enabled: true
  });
  const [testingModel, setTestingModel] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    loadModels();
  }, []);

  const loadModels = async () => {
    try {
      setLoading(true);
      const data = await api.getModels() as ModelsResponse;
      setModels(data.models || []);
      setDefaultModel(data.defaultModel || 'gpt-4');
    } catch (error) {
      console.error('Failed to load models:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveModel = async () => {
    try {
      setSaving(true);
      if (editingModel) {
        await api.updateModel(modelForm.id, {
          name: modelForm.name,
          provider: modelForm.provider,
          baseUrl: modelForm.baseUrl || undefined,
          apiKey: modelForm.apiKey || undefined,
          defaultTemperature: modelForm.defaultTemperature,
          defaultMaxTokens: modelForm.defaultMaxTokens,
          timeout: modelForm.timeout,
          enabled: modelForm.enabled
        });
      } else {
        await api.createModel({
          id: modelForm.id,
          name: modelForm.name,
          provider: modelForm.provider,
          baseUrl: modelForm.baseUrl || undefined,
          apiKey: modelForm.apiKey || undefined,
          defaultTemperature: modelForm.defaultTemperature,
          defaultMaxTokens: modelForm.defaultMaxTokens,
          timeout: modelForm.timeout,
          enabled: modelForm.enabled
        });
      }
      setShowModelForm(false);
      setEditingModel(null);
      setModelForm({
        id: '',
        name: '',
        provider: 'openai',
        baseUrl: '',
        apiKey: '',
        defaultTemperature: 0.7,
        defaultMaxTokens: 4096,
        timeout: 120000,
        enabled: true
      });
      loadModels();
    } catch (error) {
      console.error('Failed to save model:', error);
      alert('保存模型失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteModel = async (id: string) => {
    if (!confirm('确定要删除这个模型吗?')) return;
    if (id === defaultModel) {
      alert('不能删除默认模型');
      return;
    }
    try {
      await api.deleteModel(id);
      loadModels();
    } catch (error) {
      console.error('Failed to delete model:', error);
      alert('删除模型失败');
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await api.setDefaultModel(id);
      setDefaultModel(id);
    } catch (error) {
      console.error('Failed to set default model:', error);
    }
  };

  const handleTestModel = async (id: string) => {
    try {
      setTestingModel(id);
      setTestResult(null);
      const result = await api.testModel(id) as { success: boolean; message: string };
      setTestResult(result);
    } catch (error: any) {
      setTestResult({ success: false, message: error.message });
    } finally {
      setTestingModel(null);
    }
  };

  const openEditModel = (model: ModelConfig) => {
    setEditingModel(model);
    setModelForm({
      id: model.id,
      name: model.name,
      provider: model.provider,
      baseUrl: model.baseUrl || '',
      apiKey: '',
      defaultTemperature: model.defaultTemperature || 0.7,
      defaultMaxTokens: model.defaultMaxTokens || 4096,
      timeout: model.timeout || 120000,
      enabled: model.enabled ?? true
    });
    setShowModelForm(true);
  };

  if (loading) {
    return (
      <div className="content">
        <div className="loading"><div className="spinner"></div></div>
      </div>
    );
  }

  return (
    <div className="content">
      <div className="card">
        <h2 className="card-title" style={{ marginBottom: 24 }}>系统设置</h2>

        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600 }}>LLM 模型配置</h3>
            <button
              className="btn btn-secondary"
              onClick={() => {
                setEditingModel(null);
                setModelForm({
                  id: '',
                  name: '',
                  provider: 'openai',
                  baseUrl: '',
                  apiKey: '',
                  defaultTemperature: 0.7,
                  defaultMaxTokens: 4096,
                  timeout: 120000,
                  enabled: true
                });
                setShowModelForm(true);
              }}
            >
              添加模型
            </button>
          </div>

          {showModelForm && (
            <div style={{ marginBottom: 24, padding: 16, background: '#f9fafb', borderRadius: 8 }}>
              <h4 style={{ marginBottom: 16 }}>{editingModel ? '编辑模型' : '添加新模型'}</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="form-group">
                  <label className="form-label">模型 ID</label>
                  <input
                    type="text"
                    className="form-input"
                    value={modelForm.id}
                    onChange={(e) => setModelForm({ ...modelForm, id: e.target.value })}
                    placeholder="如: gpt-4, claude-3-opus"
                    disabled={!!editingModel}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">显示名称</label>
                  <input
                    type="text"
                    className="form-input"
                    value={modelForm.name}
                    onChange={(e) => setModelForm({ ...modelForm, name: e.target.value })}
                    placeholder="如: GPT-4"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">供应商</label>
                  <select
                    className="form-input"
                    value={modelForm.provider}
                    onChange={(e) => setModelForm({ ...modelForm, provider: e.target.value })}
                  >
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="local">本地/自托管</option>
                    <option value="custom">自定义</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Base URL</label>
                  <input
                    type="text"
                    className="form-input"
                    value={modelForm.baseUrl}
                    onChange={(e) => setModelForm({ ...modelForm, baseUrl: e.target.value })}
                    placeholder="如: https://api.openai.com/v1 (可选)"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">API Key</label>
                  <input
                    type="password"
                    className="form-input"
                    value={modelForm.apiKey}
                    onChange={(e) => setModelForm({ ...modelForm, apiKey: e.target.value })}
                    placeholder="留空则使用全局配置"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">默认 Temperature</label>
                  <input
                    type="number"
                    className="form-input"
                    value={modelForm.defaultTemperature}
                    onChange={(e) => setModelForm({ ...modelForm, defaultTemperature: parseFloat(e.target.value) })}
                    min={0}
                    max={2}
                    step={0.1}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">默认 Max Tokens</label>
                  <input
                    type="number"
                    className="form-input"
                    value={modelForm.defaultMaxTokens}
                    onChange={(e) => setModelForm({ ...modelForm, defaultMaxTokens: parseInt(e.target.value) })}
                    min={1}
                    max={128000}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">超时时间 (ms)</label>
                  <input
                    type="number"
                    className="form-input"
                    value={modelForm.timeout}
                    onChange={(e) => setModelForm({ ...modelForm, timeout: parseInt(e.target.value) })}
                    min={5000}
                    max={300000}
                  />
                </div>
              </div>
              <div className="form-group" style={{ marginTop: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={modelForm.enabled}
                    onChange={(e) => setModelForm({ ...modelForm, enabled: e.target.checked })}
                  />
                  <span>启用此模型</span>
                </label>
              </div>
              <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={handleSaveModel} disabled={saving}>
                  {saving ? '保存中...' : '保存'}
                </button>
                <button className="btn btn-secondary" onClick={() => { setShowModelForm(false); setEditingModel(null); }}>
                  取消
                </button>
              </div>
            </div>
          )}

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ textAlign: 'left', padding: 12 }}>模型</th>
                <th style={{ textAlign: 'left', padding: 12 }}>供应商</th>
                <th style={{ textAlign: 'left', padding: 12 }}>Base URL</th>
                <th style={{ textAlign: 'left', padding: 12 }}>状态</th>
                <th style={{ textAlign: 'right', padding: 12 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {models.map((model) => (
                <tr key={model.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: 12 }}>
                    <div style={{ fontWeight: 500 }}>
                      {model.name}
                      {model.id === defaultModel && (
                        <span style={{ marginLeft: 8, fontSize: 12, color: '#10b981' }}>默认</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: '#6b7280' }}>{model.id}</div>
                  </td>
                  <td style={{ padding: 12 }}>{model.provider}</td>
                  <td style={{ padding: 12, fontSize: 12, color: '#6b7280' }}>
                    {model.baseUrl || '-'}
                  </td>
                  <td style={{ padding: 12 }}>
                    <span className={`badge ${model.enabled ? 'badge-success' : 'badge-warning'}`}>
                      {model.enabled ? '已启用' : '已禁用'}
                    </span>
                  </td>
                  <td style={{ padding: 12, textAlign: 'right' }}>
                    <button
                      className="btn btn-secondary"
                      style={{ marginRight: 8, padding: '4px 8px' }}
                      onClick={() => handleTestModel(model.id)}
                      disabled={testingModel === model.id}
                    >
                      {testingModel === model.id ? '测试中...' : '测试'}
                    </button>
                    <button
                      className="btn btn-secondary"
                      style={{ marginRight: 8, padding: '4px 8px' }}
                      onClick={() => openEditModel(model)}
                    >
                      编辑
                    </button>
                    {model.id !== defaultModel && (
                      <>
                        <button
                          className="btn btn-secondary"
                          style={{ marginRight: 8, padding: '4px 8px' }}
                          onClick={() => handleSetDefault(model.id)}
                        >
                          设为默认
                        </button>
                        <button
                          className="btn btn-danger"
                          style={{ padding: '4px 8px' }}
                          onClick={() => handleDeleteModel(model.id)}
                        >
                          删除
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {testResult && (
            <div style={{
              marginTop: 16,
              padding: 12,
              borderRadius: 8,
              background: testResult.success ? '#ecfdf5' : '#fef2f2',
              border: `1px solid ${testResult.success ? '#10b981' : '#ef4444'}`
            }}>
              <span style={{ color: testResult.success ? '#10b981' : '#ef4444', fontWeight: 500 }}>
                {testResult.success ? '连接成功' : '连接失败'}:
              </span>
              <span style={{ marginLeft: 8 }}>{testResult.message}</span>
            </div>
          )}
        </div>

        <div style={{ marginBottom: 32 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>调度器配置</h3>
          <div className="form-group">
            <label className="form-label">扫描间隔 (ms)</label>
            <input
              type="number"
              className="form-input"
              defaultValue={5000}
              min={1000}
              max={60000}
            />
            <p style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
              定时任务扫描间隔，建议 3000-10000 ms
            </p>
          </div>
        </div>

        <div style={{ marginBottom: 32 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>执行配置</h3>
          <div className="form-group">
            <label className="form-label">最大并发任务数</label>
            <input
              type="number"
              className="form-input"
              defaultValue={3}
              min={1}
              max={10}
            />
            <p style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
              同时执行的最大任务数量
            </p>
          </div>
        </div>

        <div style={{ marginBottom: 32 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>安全设置</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" defaultChecked />
              <span>启用工具执行权限确认</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" defaultChecked />
              <span>启用写入操作权限确认</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" />
              <span>允许执行系统命令</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
