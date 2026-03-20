import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';

interface AgentInfo {
  id: string;
  name: string;
  type: string;
  role?: string;
}

interface PromptTemplate {
  id: string;
  name: string;
  type: 'leader' | 'domain';
  currentVersion: number;
  description?: string;
}

interface PromptVersion {
  id: string;
  templateId: string;
  version: number;
  changeLog?: string;
  createdAt: string;
}

interface AgentPromptProfile {
  id: string;
  agentId: string;
  templateId?: string;
  templateVersion?: number;
  roleDefinition?: string;
  behaviorNorm?: string;
  capabilityBoundary?: string;
}

function getAllowedTemplateTypesByAgentType(agentType?: string): Array<'leader' | 'domain'> {
  if (agentType === 'leader') {
    return ['leader'];
  }
  if (agentType === 'domain') {
    return ['domain'];
  }
  return ['leader', 'domain'];
}

export function AgentPromptsPage() {
  const { agentId = '' } = useParams<{ agentId: string }>();
  const navigate = useNavigate();

  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [profile, setProfile] = useState<AgentPromptProfile | null>(null);

  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const selectedTemplate = useMemo(
    () => templates.find((item) => item.id === selectedTemplateId) || null,
    [templates, selectedTemplateId]
  );

  const allowedTemplates = useMemo(() => {
    const allowedTypes = getAllowedTemplateTypesByAgentType(agent?.type);
    return templates.filter((item) => allowedTypes.includes(item.type));
  }, [templates, agent?.type]);

  useEffect(() => {
    const loadPage = async () => {
      if (!agentId) {
        setLoading(false);
        return;
      }

      try {
        const [agentData, templateData] = await Promise.all([
          api.getAgent(agentId),
          api.getPromptTemplates()
        ]);

        const nextAgent = agentData as AgentInfo;
        const nextTemplates = templateData as PromptTemplate[];

        setAgent(nextAgent);
        setTemplates(nextTemplates);

        try {
          const profileData = await api.getAgentPromptProfile(agentId) as AgentPromptProfile;
          setProfile(profileData);
          if (profileData.templateId) {
            setSelectedTemplateId(profileData.templateId);
            setSelectedVersion(profileData.templateVersion || null);
          }
        } catch {
          const preferred = nextTemplates.find((item) => item.type === nextAgent.type)
            || nextTemplates.find((item) => getAllowedTemplateTypesByAgentType(nextAgent.type).includes(item.type));
          if (preferred) {
            setSelectedTemplateId(preferred.id);
          }
        }
      } catch (loadError: any) {
        setError(loadError?.message || '加载 Agent Prompt 配置失败');
      } finally {
        setLoading(false);
      }
    };

    void loadPage();
  }, [agentId]);

  useEffect(() => {
    if (allowedTemplates.length === 0) {
      setSelectedTemplateId('');
      return;
    }

    if (!allowedTemplates.some((item) => item.id === selectedTemplateId)) {
      setSelectedTemplateId(allowedTemplates[0].id);
      setSelectedVersion(null);
    }
  }, [allowedTemplates, selectedTemplateId]);

  useEffect(() => {
    const loadVersions = async () => {
      if (!selectedTemplateId) {
        setVersions([]);
        setSelectedVersion(null);
        return;
      }

      try {
        setLoadingVersions(true);
        const data = await api.getPromptTemplateVersions(selectedTemplateId) as PromptVersion[];
        setVersions(data);

        if (data.length > 0) {
          const keepCurrent = selectedVersion != null && data.some((item) => item.version === selectedVersion);
          const nextVersion = keepCurrent ? selectedVersion : data[0].version;
          setSelectedVersion(nextVersion);
        } else {
          setSelectedVersion(null);
        }
      } catch (loadError: any) {
        setError(loadError?.message || '加载模板版本失败');
      } finally {
        setLoadingVersions(false);
      }
    };

    void loadVersions();
  }, [selectedTemplateId]);

  const handleSaveBinding = async () => {
    if (!agentId || !selectedTemplateId || !selectedVersion) {
      setError('请选择模板和版本');
      return;
    }

    setError('');
    setMessage('');

    try {
      setSaving(true);

      if (profile) {
        const updated = await api.updateAgentPromptProfile(agentId, {
          templateId: selectedTemplateId,
          templateVersion: selectedVersion
        }) as AgentPromptProfile;
        setProfile(updated);
      } else {
        const created = await api.createAgentPromptProfile(agentId, {
          templateId: selectedTemplateId,
          templateVersion: selectedVersion,
          roleDefinition: agent?.role || `${agent?.name || 'Agent'} 的默认角色定义`,
          behaviorNorm: '遵循模板约束并输出结构化结果',
          capabilityBoundary: '仅在授权范围内执行动作'
        }) as AgentPromptProfile;
        setProfile(created);
      }

      setMessage(`已绑定模板 ${selectedTemplate?.name || ''} v${selectedVersion}`);
    } catch (saveError: any) {
      setError(saveError?.message || '保存模板版本失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="content"><div className="card">加载中...</div></div>;
  }

  return (
    <div className="content agent-prompts-page">
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Agent Prompt 版本选择</h2>
          <button className="btn btn-secondary" onClick={() => navigate('/agents')}>返回 Agent 列表</button>
        </div>

        <div style={{ marginBottom: 16, color: '#475569' }}>
          Agent: <strong>{agent?.name || agentId}</strong>
          {' · '}
          类型: <strong>{agent?.type || '-'}</strong>
        </div>

        {(message || error) && (
          <div className={`agent-prompts-banner ${error ? 'error' : 'success'}`} style={{ marginBottom: 16 }}>
            {error || message}
          </div>
        )}

        <div className="form-group">
          <label className="form-label">Prompt 模板</label>
          <select
            className="form-input"
            value={selectedTemplateId}
            onChange={(event) => setSelectedTemplateId(event.target.value)}
            disabled={allowedTemplates.length === 0}
          >
            {allowedTemplates.map((item) => (
              <option key={item.id} value={item.id}>{item.name} ({item.type})</option>
            ))}
          </select>
          {allowedTemplates.length === 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#b91c1c' }}>
              当前 Agent 类型没有可用的 Prompt 模板，请先创建对应类型模板。
            </div>
          )}
        </div>

        <div className="form-group">
          <label className="form-label">版本</label>
          <select
            className="form-input"
            value={selectedVersion || ''}
            onChange={(event) => setSelectedVersion(Number(event.target.value))}
            disabled={loadingVersions || versions.length === 0}
          >
            {versions.map((item) => (
              <option key={item.id} value={item.version}>
                v{item.version} · {item.changeLog || '无变更记录'}
              </option>
            ))}
          </select>
        </div>

        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
          当前生效：{profile?.templateId ? `${profile.templateId} v${profile.templateVersion || '-'}` : '未绑定'}
        </div>

        <button className="btn btn-primary" onClick={handleSaveBinding} disabled={saving || !selectedTemplateId || !selectedVersion || allowedTemplates.length === 0}>
          {saving ? '保存中...' : '保存版本选择'}
        </button>
      </div>
    </div>
  );
}
