import React, { useEffect, useState } from 'react';
import { systemApi, modelsApi } from '../api';
import type { SystemConfig, Model } from '../types';

interface ModelFormData {
  name: string;
  provider: string;
  modelName: string;
  type: 'local' | 'api';
  apiKey?: string;
  baseUrl?: string;
  contextWindow: number;
}

interface HealthStatus {
  status: string;
  database: string;
  vectorDb: string;
  timestamp: string;
}

const SettingsView: React.FC = () => {
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [showModelForm, setShowModelForm] = useState(false);
  const [editingModel, setEditingModel] = useState<Model | null>(null);
  const [modelForm, setModelForm] = useState<ModelFormData>({
    name: '',
    provider: '',
    modelName: '',
    type: 'api',
    apiKey: '',
    baseUrl: '',
    contextWindow: 4096,
  });
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string }>>({});

  useEffect(() => {
    loadConfig();
    loadModels();
    loadHealth();
  }, []);

  const loadConfig = async () => {
    try {
      const response = await systemApi.getConfig();
      setConfig(response.data);
    } catch (error) {
      console.error('Failed to load config:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadModels = async () => {
    try {
      const response = await modelsApi.getAll();
      setModels(response.data);
    } catch (error) {
      console.error('Failed to load models:', error);
    }
  };

  const loadHealth = async () => {
    try {
      const response = await systemApi.health();
      setHealth(response.data);
    } catch (error) {
      console.error('Failed to load health:', error);
    }
  };

  const handleSaveConfig = async () => {
    if (!config) return;
    try {
      await systemApi.updateConfig(config);
      alert('保存成功');
    } catch (error) {
      console.error('Failed to save config:', error);
    }
  };

  const handleSaveModel = async () => {
    try {
      if (editingModel) {
        await modelsApi.update(editingModel.id, {
          name: modelForm.name,
          provider: modelForm.provider,
          modelName: modelForm.modelName,
          type: modelForm.type,
          contextWindow: modelForm.contextWindow,
          apiKey: modelForm.apiKey,
          baseUrl: modelForm.baseUrl,
        });
      } else {
        await modelsApi.create({
          name: modelForm.name,
          provider: modelForm.provider,
          modelName: modelForm.modelName,
          type: modelForm.type,
          contextWindow: modelForm.contextWindow,
          apiKey: modelForm.apiKey,
          baseUrl: modelForm.baseUrl,
        });
      }
      setShowModelForm(false);
      setEditingModel(null);
      setModelForm({
        name: '',
        provider: '',
        modelName: '',
        type: 'api',
        apiKey: '',
        baseUrl: '',
        contextWindow: 4096,
      });
      loadModels();
    } catch (error) {
      console.error('Failed to save model:', error);
    }
  };

  const handleTestModel = async (modelId: string) => {
    setTestingModelId(modelId);
    try {
      const response = await modelsApi.test(modelId);
      setTestResults(prev => ({
        ...prev,
        [modelId]: {
          success: response.data.success,
          message: response.data.errorMessage || (response.data.success ? '连接成功' : '连接失败'),
        },
      }));
    } catch (error: any) {
      setTestResults(prev => ({
        ...prev,
        [modelId]: {
          success: false,
          message: error.response?.data?.errorMessage || '测试失败',
        },
      }));
    } finally {
      setTestingModelId(null);
    }
  };

  const handleDeleteModel = async (modelId: string) => {
    if (!confirm('确定要删除这个模型吗？')) return;
    try {
      await modelsApi.delete(modelId);
      loadModels();
    } catch (error) {
      console.error('Failed to delete model:', error);
    }
  };

  const handleEditModel = (model: Model) => {
    const config = model.configJson ? JSON.parse(model.configJson) : {};
    setEditingModel(model);
    setModelForm({
      name: model.name,
      provider: model.provider,
      modelName: model.modelName,
      type: model.type,
      apiKey: config.apiKey || '',
      baseUrl: config.baseUrl || '',
      contextWindow: model.contextWindow || 4096,
    });
    setShowModelForm(true);
  };

  if (loading || !config) {
    return <div className="page-content">加载中...</div>;
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">系统设置</h1>
        <button className="btn btn-primary" onClick={handleSaveConfig}>
          保存设置
        </button>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">基本信息</h3>
        
        <div className="settings-item">
          <span className="settings-label">系统名称</span>
          <input
            type="text"
            className="form-input"
            value={config.systemName}
            onChange={(e) => setConfig({ ...config, systemName: e.target.value })}
            style={{ width: 200 }}
          />
        </div>

        <div className="settings-item">
          <span className="settings-label">工作目录</span>
          <span className="settings-value">{config.workspacePath}</span>
        </div>

        <div className="settings-item">
          <span className="settings-label">上下文保留轮数</span>
          <input
            type="number"
            className="form-input"
            value={config.contextRetentionRounds}
            onChange={(e) => setConfig({ ...config, contextRetentionRounds: parseInt(e.target.value) })}
            style={{ width: 100 }}
          />
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">资源监控</h3>
        
        <div className="settings-item">
          <span className="settings-label">CPU 告警阈值 (%)</span>
          <input
            type="number"
            className="form-input"
            value={config.resourceThresholds.cpu}
            onChange={(e) => setConfig({ 
              ...config, 
              resourceThresholds: { ...config.resourceThresholds, cpu: parseInt(e.target.value) } 
            })}
            style={{ width: 100 }}
          />
        </div>

        <div className="settings-item">
          <span className="settings-label">内存告警阈值 (%)</span>
          <input
            type="number"
            className="form-input"
            value={config.resourceThresholds.memory}
            onChange={(e) => setConfig({ 
              ...config, 
              resourceThresholds: { ...config.resourceThresholds, memory: parseInt(e.target.value) } 
            })}
            style={{ width: 100 }}
          />
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">安全设置</h3>
        
        <div className="settings-item">
          <span className="settings-label">授权等待超时（分钟）</span>
          <input
            type="number"
            className="form-input"
            value={config.authTimeoutMinutes}
            onChange={(e) => setConfig({ ...config, authTimeoutMinutes: parseInt(e.target.value) })}
            style={{ width: 100 }}
          />
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">备份设置</h3>
        
        <div className="settings-item">
          <span className="settings-label">启用自动备份</span>
          <input
            type="checkbox"
            checked={config.backupEnabled}
            onChange={(e) => setConfig({ ...config, backupEnabled: e.target.checked })}
          />
        </div>
      </div>

      <div className="settings-section">
        <div className="section-header">
          <h3 className="settings-section-title">模型配置</h3>
          <button className="btn btn-primary" onClick={() => setShowModelForm(true)}>
            添加模型
          </button>
        </div>
        
        <div className="model-list">
          {models.length === 0 ? (
            <p style={{ color: '#999', padding: '20px 0' }}>暂无模型，请添加</p>
          ) : (
            models.map(model => (
              <div key={model.id} className="model-item">
                <div className="model-info">
                  <span className="model-name">{model.name}</span>
                  <span className="model-provider">{model.provider} / {model.modelName}</span>
                  <span className={`model-status model-status-${model.status}`}>
                    {model.status === 'ready' ? '在线' : '离线'}
                  </span>
                </div>
                <div className="model-actions">
                  {testResults[model.id] && (
                    <span className={`test-result ${testResults[model.id].success ? 'success' : 'error'}`}>
                      {testResults[model.id].message}
                    </span>
                  )}
                  <button 
                    className="btn btn-sm"
                    onClick={() => handleTestModel(model.id)}
                    disabled={testingModelId === model.id}
                  >
                    {testingModelId === model.id ? '测试中...' : '测试连接'}
                  </button>
                  <button 
                    className="btn btn-sm"
                    onClick={() => handleEditModel(model)}
                  >
                    编辑
                  </button>
                  <button 
                    className="btn btn-sm btn-danger"
                    onClick={() => handleDeleteModel(model.id)}
                  >
                    删除
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">健康检查</h3>
        
        <div className="health-panel">
          <div className="health-item">
            <span className="health-label">数据库</span>
            <span className={`health-status ${health?.database === 'ok' ? 'ok' : 'error'}`}>
              {health?.database || 'unknown'}
            </span>
          </div>
          <div className="health-item">
            <span className="health-label">向量库</span>
            <span className={`health-status ${health?.vectorDb === 'ok' ? 'ok' : 'error'}`}>
              {health?.vectorDb || 'unknown'}
            </span>
          </div>
          <div className="health-item">
            <span className="health-label">最后检查</span>
            <span className="health-value">
              {health?.timestamp ? new Date(health.timestamp).toLocaleString() : '-'}
            </span>
          </div>
          <button className="btn btn-sm" onClick={loadHealth}>
            刷新
          </button>
        </div>
      </div>

      {showModelForm && (
        <div className="modal-overlay" onClick={() => setShowModelForm(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>{editingModel ? '编辑模型' : '添加模型'}</h3>
            
            <div className="form-group">
              <label>模型名称</label>
              <input
                type="text"
                className="form-input"
                value={modelForm.name}
                onChange={(e) => setModelForm({ ...modelForm, name: e.target.value })}
                placeholder="例如: GPT-4"
              />
            </div>

            <div className="form-group">
              <label>模型类型</label>
              <select
                className="form-input"
                value={modelForm.type}
                onChange={(e) => setModelForm({ ...modelForm, type: e.target.value as 'api' | 'local' })}
              >
                <option value="api">API</option>
                <option value="local">本地</option>
              </select>
            </div>

            <div className="form-group">
              <label>提供商</label>
              <input
                type="text"
                className="form-input"
                value={modelForm.provider}
                onChange={(e) => setModelForm({ ...modelForm, provider: e.target.value })}
                placeholder="例如: openai, anthropic"
              />
            </div>

            <div className="form-group">
              <label>模型名</label>
              <input
                type="text"
                className="form-input"
                value={modelForm.modelName}
                onChange={(e) => setModelForm({ ...modelForm, modelName: e.target.value })}
                placeholder="例如: gpt-4, claude-3-opus"
              />
            </div>

            {modelForm.type === 'api' && (
              <>
                <div className="form-group">
                  <label>API Key</label>
                  <input
                    type="password"
                    className="form-input"
                    value={modelForm.apiKey}
                    onChange={(e) => setModelForm({ ...modelForm, apiKey: e.target.value })}
                    placeholder="sk-..."
                  />
                </div>

                <div className="form-group">
                  <label>Base URL</label>
                  <input
                    type="text"
                    className="form-input"
                    value={modelForm.baseUrl}
                    onChange={(e) => setModelForm({ ...modelForm, baseUrl: e.target.value })}
                    placeholder="https://api.openai.com/v1"
                  />
                </div>
              </>
            )}

            <div className="form-group">
              <label>上下文窗口</label>
              <input
                type="number"
                className="form-input"
                value={modelForm.contextWindow}
                onChange={(e) => setModelForm({ ...modelForm, contextWindow: parseInt(e.target.value) })}
              />
            </div>

            <div className="modal-actions">
              <button className="btn" onClick={() => setShowModelForm(false)}>取消</button>
              <button className="btn btn-primary" onClick={handleSaveModel}>保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SettingsView;
