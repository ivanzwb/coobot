import { useState, useEffect } from 'react';
import { api } from '../api/client';

interface Agent {
  id: string;
  name: string;
  type: string;
  model: string;
  temperature: number;
  skills?: string | null;
  status: string;
  isSystem: boolean;
  createdAt: string;
}

interface Skill {
  id: string;
  name: string;
  description?: string;
  permissions?: string | null;
  tools?: string | null;
  status: string;
}

type PermissionDecision = 'allow' | 'ask' | 'deny';

interface SkillToolDeclaration {
  name: string;
  description?: string;
  permissions?: {
    read?: PermissionDecision;
    write?: PermissionDecision;
    execute?: PermissionDecision;
  };
}

interface AgentSkillPermissionBinding {
  skillId: string;
  toolName: string;
  readAction: PermissionDecision;
  writeAction: PermissionDecision;
  executeAction: PermissionDecision;
}

interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  enabled?: boolean;
}

interface PromptTemplate {
  id: string;
  name: string;
  type: 'leader' | 'domain';
  currentVersion: number;
}

interface PromptVersion {
  id: string;
  templateId: string;
  version: number;
  changeLog?: string;
  system?: string;
  developer?: string;
  user?: string;
}

interface AgentPromptProfile {
  id: string;
  agentId: string;
  templateId?: string;
  templateVersion?: number;
}

function getAllowedPromptTemplateTypesByAgentType(agentType?: string): Array<'leader' | 'domain'> {
  if (agentType === 'leader') {
    return ['leader'];
  }
  if (agentType === 'domain') {
    return ['domain'];
  }
  return ['leader', 'domain'];
}

export function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [loadingPromptBinding, setLoadingPromptBinding] = useState(false);
  const [loadingCreatePromptBinding, setLoadingCreatePromptBinding] = useState(false);
  const [promptTemplates, setPromptTemplates] = useState<PromptTemplate[]>([]);
  const [promptVersions, setPromptVersions] = useState<PromptVersion[]>([]);
  const [selectedPromptTemplateId, setSelectedPromptTemplateId] = useState('');
  const [selectedPromptVersion, setSelectedPromptVersion] = useState<number | null>(null);
  const [createPromptTemplates, setCreatePromptTemplates] = useState<PromptTemplate[]>([]);
  const [createPromptVersions, setCreatePromptVersions] = useState<PromptVersion[]>([]);
  const [selectedCreatePromptTemplateId, setSelectedCreatePromptTemplateId] = useState('');
  const [selectedCreatePromptVersion, setSelectedCreatePromptVersion] = useState<number | null>(null);
  const [actioningAgentId, setActioningAgentId] = useState<string | null>(null);
  const [agentRoleSummaryById, setAgentRoleSummaryById] = useState<Record<string, string>>({});
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [editSelectedSkillIds, setEditSelectedSkillIds] = useState<string[]>([]);
  const [skillPermissionBindings, setSkillPermissionBindings] = useState<AgentSkillPermissionBinding[]>([]);
  const [editSkillPermissionBindings, setEditSkillPermissionBindings] = useState<AgentSkillPermissionBinding[]>([]);
  const [formData, setFormData] = useState({
    name: '',
    model: '',
    temperature: 0.7
  });

  const [editFormData, setEditFormData] = useState({
    name: '',
    model: '',
    temperature: 0.7,
    status: 'active'
  });

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    setSkillPermissionBindings((current) => mergeWithExistingBindings(selectedSkillIds, current));
  }, [selectedSkillIds, skills]);

  useEffect(() => {
    setEditSkillPermissionBindings((current) => mergeWithExistingBindings(editSelectedSkillIds, current));
  }, [editSelectedSkillIds, skills]);

  const extractRoleSummaryFromPromptVersion = (version?: PromptVersion | null) => {
    const candidates = [version?.system, version?.developer, version?.user]
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0);

    if (candidates.length === 0) {
      return '';
    }

    const firstLine = candidates[0].split('\n').map((line) => line.trim()).find((line) => line.length > 0) || '';
    if (!firstLine) {
      return '';
    }

    return firstLine.length > 80 ? `${firstLine.slice(0, 80)}...` : firstLine;
  };

  const parseToolsFromSkill = (skill?: Skill): SkillToolDeclaration[] => {
    if (!skill?.tools) {
      return [];
    }

    try {
      const parsed = JSON.parse(skill.tools);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .filter((item) => typeof item?.name === 'string' && item.name.length > 0)
        .map((item) => ({
          name: item.name,
          description: typeof item.description === 'string' ? item.description : undefined,
          permissions: {
            read: (item.permissions?.read as PermissionDecision) || 'ask',
            write: (item.permissions?.write as PermissionDecision) || 'ask',
            execute: (item.permissions?.execute as PermissionDecision) || 'ask'
          }
        }));
    } catch {
      return [];
    }
  };

  const buildDefaultSkillPermissionBindings = (skillIds: string[]) => {
    const bindings: AgentSkillPermissionBinding[] = [];

    for (const skillId of skillIds) {
      const skill = skills.find((item) => item.id === skillId);
      const toolsInSkill = parseToolsFromSkill(skill);

      for (const tool of toolsInSkill) {
        bindings.push({
          skillId,
          toolName: tool.name,
          readAction: tool.permissions?.read || 'ask',
          writeAction: tool.permissions?.write || 'ask',
          executeAction: tool.permissions?.execute || 'ask'
        });
      }
    }

    return bindings;
  };

  const mergeWithExistingBindings = (
    skillIds: string[],
    existingBindings: AgentSkillPermissionBinding[]
  ) => {
    const defaults = buildDefaultSkillPermissionBindings(skillIds);
    return defaults.map((item) => {
      const existing = existingBindings.find((binding) => binding.skillId === item.skillId && binding.toolName === item.toolName);
      return existing || item;
    });
  };

  const loadAgentRoleSummaries = async (agentList: Agent[]) => {
    const entries = await Promise.all(agentList.map(async (agent) => {
      try {
        const profile = await api.getAgentPromptProfile(agent.id) as AgentPromptProfile;
        if (!profile?.templateId || !profile?.templateVersion) {
          return [agent.id, ''] as const;
        }

        const version = await api.getPromptTemplateVersion(profile.templateId, profile.templateVersion) as PromptVersion;
        return [agent.id, extractRoleSummaryFromPromptVersion(version)] as const;
      } catch {
        return [agent.id, ''] as const;
      }
    }));

    setAgentRoleSummaryById(Object.fromEntries(entries));
  };

  const loadPromptVersions = async (templateId: string) => {
    if (!templateId) {
      setPromptVersions([]);
      setSelectedPromptVersion(null);
      return;
    }

    try {
      const versions = await api.getPromptTemplateVersions(templateId) as PromptVersion[];
      setPromptVersions(versions);
      setSelectedPromptVersion((current) => (
        current && versions.some((item) => item.version === current)
          ? current
          : (versions[0]?.version ?? null)
      ));
    } catch (error) {
      console.error('Failed to load prompt versions:', error);
      setPromptVersions([]);
      setSelectedPromptVersion(null);
    }
  };

  const loadCreatePromptVersions = async (templateId: string) => {
    if (!templateId) {
      setCreatePromptVersions([]);
      setSelectedCreatePromptVersion(null);
      return;
    }

    try {
      const versions = await api.getPromptTemplateVersions(templateId) as PromptVersion[];
      setCreatePromptVersions(versions);
      setSelectedCreatePromptVersion((current) => (
        current && versions.some((item) => item.version === current)
          ? current
          : (versions[0]?.version ?? null)
      ));
    } catch (error) {
      console.error('Failed to load create prompt versions:', error);
      setCreatePromptVersions([]);
      setSelectedCreatePromptVersion(null);
    }
  };

  useEffect(() => {
    if (!editingAgent) {
      return;
    }

    const allowedTemplates = promptTemplates.filter((item) =>
      getAllowedPromptTemplateTypesByAgentType(editingAgent.type).includes(item.type)
    );

    if (allowedTemplates.length === 0) {
      setSelectedPromptTemplateId('');
      setPromptVersions([]);
      setSelectedPromptVersion(null);
      return;
    }

    if (!allowedTemplates.some((item) => item.id === selectedPromptTemplateId)) {
      const nextTemplateId = allowedTemplates[0].id;
      setSelectedPromptTemplateId(nextTemplateId);
      void loadPromptVersions(nextTemplateId);
    }
  }, [editingAgent, promptTemplates, selectedPromptTemplateId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [agentsData, modelsData] = await Promise.all([
        api.getAgents(),
        api.getModels()
      ]);
      const skillsData = await api.getSkills();
      const typedAgents = agentsData as Agent[];
      setAgents(typedAgents);
      await loadAgentRoleSummaries(typedAgents);
      const modelsResponse = modelsData as { models: ModelConfig[] };
      setModels(modelsResponse.models || []);
      setSkills((skillsData as Skill[]).filter((item) => item.status === 'active'));
      const enabledModels = (modelsResponse.models || []).filter((model) => model.enabled !== false);
      if (enabledModels.length > 0) {
        setFormData((prev) => ({ ...prev, model: prev.model || enabledModels[0].id }));
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenCreate = async () => {
    setShowForm(true);
    setErrorMessage('');
    setSelectedSkillIds([]);
    setSkillPermissionBindings([]);

    try {
      setLoadingCreatePromptBinding(true);
      const templates = await api.getPromptTemplates() as PromptTemplate[];
      const domainTemplates = templates.filter((item) => item.type === 'domain');
      setCreatePromptTemplates(domainTemplates);

      const preferredTemplateId = domainTemplates[0]?.id || '';
      setSelectedCreatePromptTemplateId(preferredTemplateId);

      if (preferredTemplateId) {
        await loadCreatePromptVersions(preferredTemplateId);
      } else {
        setCreatePromptVersions([]);
        setSelectedCreatePromptVersion(null);
      }
    } catch (error) {
      console.error('Failed to load create prompt binding:', error);
      setCreatePromptTemplates([]);
      setCreatePromptVersions([]);
      setSelectedCreatePromptTemplateId('');
      setSelectedCreatePromptVersion(null);
    } finally {
      setLoadingCreatePromptBinding(false);
    }
  };

  const handleCloseCreate = () => {
    if (submitting) {
      return;
    }
    setShowForm(false);
  };

  const handleCreate = async () => {
    const selectedModel = availableModels.find((model) => model.id === formData.model);
    if (!selectedModel) {
      setErrorMessage('请选择已启用的模型');
      return;
    }

    try {
      setSubmitting(true);
      setErrorMessage('');
      await api.createAgent({
        ...formData,
        skills: selectedSkillIds,
        skillPermissionBindings,
        promptProfile: selectedCreatePromptTemplateId && selectedCreatePromptVersion
          ? {
              templateId: selectedCreatePromptTemplateId,
              templateVersion: selectedCreatePromptVersion
            }
          : undefined
      });
      setShowForm(false);
      setFormData({
        name: '',
        model: availableModels[0]?.id || '',
        temperature: 0.7
      });
      setCreatePromptTemplates([]);
      setCreatePromptVersions([]);
      setSelectedCreatePromptTemplateId('');
      setSelectedCreatePromptVersion(null);
      setSelectedSkillIds([]);
      setSkillPermissionBindings([]);
      await loadData();
    } catch (error) {
      console.error('Failed to create agent:', error);
      setErrorMessage(error instanceof Error ? error.message : '创建 Agent 失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenEdit = async (agent: Agent) => {
    setErrorMessage('');
    setEditingAgent(agent);
    setEditFormData({
      name: agent.name,
      model: agent.model,
      temperature: agent.temperature,
      status: agent.status
    });
    const parsedSkillIds = (() => {
      if (!agent.skills) {
        return [] as string[];
      }

      try {
        const value = JSON.parse(agent.skills);
        return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
      } catch {
        return [] as string[];
      }
    })();
    setEditSelectedSkillIds(parsedSkillIds);

    try {
      setLoadingPromptBinding(true);
      const templates = await api.getPromptTemplates() as PromptTemplate[];
      const allowedTypes = getAllowedPromptTemplateTypesByAgentType(agent.type);
      const allowedTemplates = templates.filter((item) => allowedTypes.includes(item.type));
      setPromptTemplates(allowedTemplates);

      let profile: AgentPromptProfile | null = null;
      try {
        profile = await api.getAgentPromptProfile(agent.id) as AgentPromptProfile;
      } catch {
      }

      const preferredTemplateId = profile?.templateId && allowedTemplates.some((item) => item.id === profile?.templateId)
        ? profile.templateId
        : (allowedTemplates[0]?.id || '');

      setSelectedPromptTemplateId(preferredTemplateId);

      const existingBindings = await api.getAgentSkillPermissions(agent.id) as AgentSkillPermissionBinding[];
      setEditSkillPermissionBindings(mergeWithExistingBindings(parsedSkillIds, existingBindings || []));

      if (preferredTemplateId) {
        const versions = await api.getPromptTemplateVersions(preferredTemplateId) as PromptVersion[];
        setPromptVersions(versions);
        setSelectedPromptVersion(
          profile?.templateVersion && versions.some((item) => item.version === profile?.templateVersion)
            ? profile.templateVersion
            : (versions[0]?.version ?? null)
        );
      } else {
        setPromptVersions([]);
        setSelectedPromptVersion(null);
      }
    } catch (error) {
      console.error('Failed to load prompt binding:', error);
      setPromptTemplates([]);
      setPromptVersions([]);
      setSelectedPromptTemplateId('');
      setSelectedPromptVersion(null);
      setEditSkillPermissionBindings(mergeWithExistingBindings(parsedSkillIds, []));
    } finally {
      setLoadingPromptBinding(false);
    }
  };

  const handleCloseEdit = () => {
    if (submitting) {
      return;
    }
    setEditingAgent(null);
    setEditSelectedSkillIds([]);
    setEditSkillPermissionBindings([]);
  };

  const handleUpdate = async () => {
    if (!editingAgent) {
      return;
    }

    try {
      setSubmitting(true);
      setErrorMessage('');

      const payload: Parameters<typeof api.updateAgent>[1] = {
        name: editFormData.name,
        temperature: editFormData.temperature,
        status: editFormData.status,
        skills: editSelectedSkillIds,
        skillPermissionBindings: editSkillPermissionBindings,
        promptProfile: selectedPromptTemplateId && selectedPromptVersion
          ? {
              templateId: selectedPromptTemplateId,
              templateVersion: selectedPromptVersion
            }
          : undefined
      };

      // Keep historical model untouched unless user explicitly changes it.
      if (editFormData.model !== editingAgent.model) {
        payload.model = editFormData.model;
      }

      await api.updateAgent(editingAgent.id, {
        ...payload
      });

      setEditingAgent(null);
      await loadData();
    } catch (error) {
      console.error('Failed to update agent:', error);
      setErrorMessage(error instanceof Error ? error.message : '更新 Agent 失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (agent: Agent) => {
    const confirmed = confirm(`确认彻底删除 Agent「${agent.name}」吗？该操作不可恢复。`);
    if (!confirmed) {
      return;
    }

    try {
      setActioningAgentId(agent.id);
      await api.deleteAgent(agent.id);
      await loadData();
    } catch (error) {
      console.error('Failed to delete:', error);
      setErrorMessage(error instanceof Error ? error.message : '删除 Agent 失败');
    } finally {
      setActioningAgentId(null);
    }
  };

  const handleDeactivate = async (agent: Agent) => {
    const confirmed = confirm(`确认停职 Agent「${agent.name}」吗？停职后该 Agent 将不可用于新任务执行。`);
    if (!confirmed) {
      return;
    }

    try {
      setActioningAgentId(agent.id);
      await api.deactivateAgent(agent.id);
      await loadData();
      setErrorMessage('');
    } catch (error) {
      console.error('Failed to deactivate agent:', error);
      setErrorMessage(error instanceof Error ? error.message : '停职 Agent 失败');
    } finally {
      setActioningAgentId(null);
    }
  };

  const handleActivate = async (agent: Agent) => {
    const confirmed = confirm(`确认重新启用 Agent「${agent.name}」吗？启用后该 Agent 可再次参与新任务执行。`);
    if (!confirmed) {
      return;
    }

    try {
      setActioningAgentId(agent.id);
      await api.activateAgent(agent.id);
      await loadData();
      setErrorMessage('');
    } catch (error) {
      console.error('Failed to activate agent:', error);
      setErrorMessage(error instanceof Error ? error.message : '启用 Agent 失败');
    } finally {
      setActioningAgentId(null);
    }
  };

  const availableModels = models.filter(m => m.enabled !== false);
  const allowedPromptTemplates = promptTemplates.filter((item) =>
    getAllowedPromptTemplateTypesByAgentType(editingAgent?.type).includes(item.type)
  );
  const isEditModelEnabled = availableModels.some((m) => m.id === editFormData.model);
  const canCreate = formData.name.trim() !== ''
    && formData.model !== ''
    && availableModels.some((m) => m.id === formData.model)
    && (createPromptTemplates.length === 0 || (selectedCreatePromptTemplateId !== '' && selectedCreatePromptVersion !== null));
  const canUpdate = editFormData.name.trim() !== ''
    && editFormData.model !== ''
    && (allowedPromptTemplates.length === 0 || (selectedPromptTemplateId !== '' && selectedPromptVersion !== null));

  return (
    <div className="content">
      <div className="card">
        <div className="card-header">
          <h2 className="card-title">Agent 管理</h2>
          <button className="btn btn-primary" onClick={() => void (showForm ? handleCloseCreate() : handleOpenCreate())}>
            {showForm ? '取消' : '创建 Agent'}
          </button>
        </div>

        {errorMessage && (
          <div style={{ marginBottom: 12, color: '#b91c1c', fontSize: 13 }}>{errorMessage}</div>
        )}

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
              <input className="form-input" value="domain" readOnly />
              <p style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                创建 Agent 仅支持 Domain 类型
              </p>
            </div>
            <div className="form-group">
              <label className="form-label">模型</label>
              <select
                className="form-input"
                value={formData.model}
                onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                disabled={availableModels.length === 0}
              >
                {availableModels.length === 0 && <option value="">暂无可用模型</option>}
                {availableModels.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name} ({model.id})
                  </option>
                ))}
              </select>
              <p style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
            <div className="form-group">
              <label className="form-label">绑定 Skills</label>
              <div style={{ display: 'grid', gap: 6 }}>
                {skills.length === 0 && <span style={{ fontSize: 12, color: '#6b7280' }}>暂无可用 Skill</span>}
                {skills.map((skill) => (
                  <label key={skill.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={selectedSkillIds.includes(skill.id)}
                      onChange={(e) => {
                        setSelectedSkillIds((current) => (
                          e.target.checked
                            ? [...current, skill.id]
                            : current.filter((item) => item !== skill.id)
                        ));
                      }}
                    />
                    <span>{skill.name}</span>
                  </label>
                ))}
              </div>
            </div>
            {skillPermissionBindings.length > 0 && (
              <div className="form-group">
                <label className="form-label">Skill 工具权限声明（默认 ask）</label>
                <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: '#f9fafb' }}>
                        <th style={{ textAlign: 'left', padding: 8 }}>Skill</th>
                        <th style={{ textAlign: 'left', padding: 8 }}>工具</th>
                        <th style={{ textAlign: 'left', padding: 8 }}>读</th>
                        <th style={{ textAlign: 'left', padding: 8 }}>写</th>
                        <th style={{ textAlign: 'left', padding: 8 }}>执行</th>
                      </tr>
                    </thead>
                    <tbody>
                      {skillPermissionBindings.map((binding, index) => (
                        <tr key={`${binding.skillId}-${binding.toolName}`} style={{ borderTop: '1px solid #f3f4f6' }}>
                          <td style={{ padding: 8 }}>{skills.find((item) => item.id === binding.skillId)?.name || binding.skillId}</td>
                          <td style={{ padding: 8 }}>{binding.toolName}</td>
                          <td style={{ padding: 8 }}>
                            <select
                              value={binding.readAction}
                              onChange={(e) => {
                                const value = e.target.value as PermissionDecision;
                                setSkillPermissionBindings((current) => current.map((item, idx) => idx === index ? { ...item, readAction: value } : item));
                              }}
                            >
                              <option value="allow">allow</option>
                              <option value="ask">ask</option>
                              <option value="deny">deny</option>
                            </select>
                          </td>
                          <td style={{ padding: 8 }}>
                            <select
                              value={binding.writeAction}
                              onChange={(e) => {
                                const value = e.target.value as PermissionDecision;
                                setSkillPermissionBindings((current) => current.map((item, idx) => idx === index ? { ...item, writeAction: value } : item));
                              }}
                            >
                              <option value="allow">allow</option>
                              <option value="ask">ask</option>
                              <option value="deny">deny</option>
                            </select>
                          </td>
                          <td style={{ padding: 8 }}>
                            <select
                              value={binding.executeAction}
                              onChange={(e) => {
                                const value = e.target.value as PermissionDecision;
                                setSkillPermissionBindings((current) => current.map((item, idx) => idx === index ? { ...item, executeAction: value } : item));
                              }}
                            >
                              <option value="allow">allow</option>
                              <option value="ask">ask</option>
                              <option value="deny">deny</option>
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
                选择此 Agent 使用的 LLM 模型
              </p>
              {availableModels.length === 0 && (
                <p style={{ fontSize: 12, color: '#b91c1c', marginTop: 4 }}>
                  暂无可用模型，请先到设置页启用模型
                </p>
              )}
            </div>
            <div className="form-group">
              <label className="form-label">Prompt 模板</label>
              <select
                className="form-input"
                value={selectedCreatePromptTemplateId}
                onChange={async (e) => {
                  const nextTemplateId = e.target.value;
                  setSelectedCreatePromptTemplateId(nextTemplateId);
                  setSelectedCreatePromptVersion(null);
                  await loadCreatePromptVersions(nextTemplateId);
                }}
                disabled={loadingCreatePromptBinding || createPromptTemplates.length === 0}
              >
                {createPromptTemplates.length === 0 && <option value="">暂无可用模板</option>}
                {createPromptTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name} ({template.type})
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Prompt 版本</label>
              <select
                className="form-input"
                value={selectedCreatePromptVersion ?? ''}
                onChange={(e) => setSelectedCreatePromptVersion(Number(e.target.value))}
                disabled={loadingCreatePromptBinding || createPromptVersions.length === 0}
              >
                {createPromptVersions.length === 0 && <option value="">暂无可用版本</option>}
                {createPromptVersions.map((version) => (
                  <option key={version.id} value={version.version}>
                    v{version.version}{version.changeLog ? ` · ${version.changeLog}` : ''}
                  </option>
                ))}
              </select>
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
            <button className="btn btn-primary" onClick={handleCreate} disabled={!canCreate || submitting}>
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
                    {agentRoleSummaryById[agent.id] && (
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2, maxWidth: 650 }}>
                        {agentRoleSummaryById[agent.id]}
                      </div>
                    )}
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
                      onClick={() => void handleOpenEdit(agent)}
                      disabled={actioningAgentId === agent.id}
                    >
                      编辑
                    </button>
                    {agent.type !== 'leader' && (
                      <>
                        {agent.status === 'active' && (
                          <button
                            className="btn btn-secondary"
                            style={{ marginRight: 8, padding: '4px 8px' }}
                            onClick={() => void handleDeactivate(agent)}
                            disabled={actioningAgentId === agent.id}
                          >
                            停职
                          </button>
                        )}
                        {agent.status !== 'active' && (
                          <button
                            className="btn btn-primary"
                            style={{ marginRight: 8, padding: '4px 8px' }}
                            onClick={() => void handleActivate(agent)}
                            disabled={actioningAgentId === agent.id}
                          >
                            启用
                          </button>
                        )}
                        <button
                          className="btn btn-danger"
                          style={{ padding: '4px 8px' }}
                          onClick={() => void handleDelete(agent)}
                          disabled={actioningAgentId === agent.id}
                        >
                          删除 Agent
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editingAgent && (
        <div className="modal-overlay" onClick={handleCloseEdit}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">编辑 Agent：{editingAgent.name}</div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">名称</label>
                <input
                  type="text"
                  className="form-input"
                  value={editFormData.name}
                  onChange={(e) => setEditFormData({ ...editFormData, name: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">类型</label>
                <input className="form-input" value={editingAgent.type} readOnly />
                <p style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                  Agent 类型创建后不可修改
                </p>
              </div>
              <div className="form-group">
                <label className="form-label">模型</label>
                <select
                  className="form-input"
                  value={editFormData.model}
                  onChange={(e) => setEditFormData({ ...editFormData, model: e.target.value })}
                  disabled={availableModels.length === 0}
                >
                  {!isEditModelEnabled && editFormData.model && (
                    <option value={editFormData.model}>{editFormData.model} (当前已停用)</option>
                  )}
                  {availableModels.length === 0 && <option value="">暂无可用模型</option>}
                  {availableModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name} ({model.id})
                    </option>
                  ))}
                </select>
                {!isEditModelEnabled && editFormData.model && (
                  <p style={{ fontSize: 12, color: '#92400e', marginTop: 4 }}>
                    当前模型已停用，仍可保存其它字段；如需切换，请从下拉中选择已启用模型。
                  </p>
                )}
                {availableModels.length === 0 && (
                  <p style={{ fontSize: 12, color: '#b91c1c', marginTop: 4 }}>
                    暂无可用模型，请先到设置页启用模型
                  </p>
                )}
              </div>
              <div className="form-group">
                <label className="form-label">绑定 Skills</label>
                <div style={{ display: 'grid', gap: 6 }}>
                  {skills.length === 0 && <span style={{ fontSize: 12, color: '#6b7280' }}>暂无可用 Skill</span>}
                  {skills.map((skill) => (
                    <label key={skill.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input
                        type="checkbox"
                        checked={editSelectedSkillIds.includes(skill.id)}
                        onChange={(e) => {
                          setEditSelectedSkillIds((current) => (
                            e.target.checked
                              ? [...current, skill.id]
                              : current.filter((item) => item !== skill.id)
                          ));
                        }}
                      />
                      <span>{skill.name}</span>
                    </label>
                  ))}
                </div>
              </div>
              {editSkillPermissionBindings.length > 0 && (
                <div className="form-group">
                  <label className="form-label">Skill 工具权限声明（默认 ask）</label>
                  <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: '#f9fafb' }}>
                          <th style={{ textAlign: 'left', padding: 8 }}>Skill</th>
                          <th style={{ textAlign: 'left', padding: 8 }}>工具</th>
                          <th style={{ textAlign: 'left', padding: 8 }}>读</th>
                          <th style={{ textAlign: 'left', padding: 8 }}>写</th>
                          <th style={{ textAlign: 'left', padding: 8 }}>执行</th>
                        </tr>
                      </thead>
                      <tbody>
                        {editSkillPermissionBindings.map((binding, index) => (
                          <tr key={`${binding.skillId}-${binding.toolName}`} style={{ borderTop: '1px solid #f3f4f6' }}>
                            <td style={{ padding: 8 }}>{skills.find((item) => item.id === binding.skillId)?.name || binding.skillId}</td>
                            <td style={{ padding: 8 }}>{binding.toolName}</td>
                            <td style={{ padding: 8 }}>
                              <select
                                value={binding.readAction}
                                onChange={(e) => {
                                  const value = e.target.value as PermissionDecision;
                                  setEditSkillPermissionBindings((current) => current.map((item, idx) => idx === index ? { ...item, readAction: value } : item));
                                }}
                              >
                                <option value="allow">allow</option>
                                <option value="ask">ask</option>
                                <option value="deny">deny</option>
                              </select>
                            </td>
                            <td style={{ padding: 8 }}>
                              <select
                                value={binding.writeAction}
                                onChange={(e) => {
                                  const value = e.target.value as PermissionDecision;
                                  setEditSkillPermissionBindings((current) => current.map((item, idx) => idx === index ? { ...item, writeAction: value } : item));
                                }}
                              >
                                <option value="allow">allow</option>
                                <option value="ask">ask</option>
                                <option value="deny">deny</option>
                              </select>
                            </td>
                            <td style={{ padding: 8 }}>
                              <select
                                value={binding.executeAction}
                                onChange={(e) => {
                                  const value = e.target.value as PermissionDecision;
                                  setEditSkillPermissionBindings((current) => current.map((item, idx) => idx === index ? { ...item, executeAction: value } : item));
                                }}
                              >
                                <option value="allow">allow</option>
                                <option value="ask">ask</option>
                                <option value="deny">deny</option>
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Prompt 模板</label>
                <select
                  className="form-input"
                  value={selectedPromptTemplateId}
                  onChange={async (e) => {
                    const nextTemplateId = e.target.value;
                    setSelectedPromptTemplateId(nextTemplateId);
                    setSelectedPromptVersion(null);
                    await loadPromptVersions(nextTemplateId);
                  }}
                  disabled={loadingPromptBinding || allowedPromptTemplates.length === 0}
                >
                  {allowedPromptTemplates.length === 0 && <option value="">暂无可用模板</option>}
                  {allowedPromptTemplates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name} ({template.type})
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Prompt 版本</label>
                <select
                  className="form-input"
                  value={selectedPromptVersion ?? ''}
                  onChange={(e) => setSelectedPromptVersion(Number(e.target.value))}
                  disabled={loadingPromptBinding || promptVersions.length === 0}
                >
                  {promptVersions.length === 0 && <option value="">暂无可用版本</option>}
                  {promptVersions.map((version) => (
                    <option key={version.id} value={version.version}>
                      v{version.version}{version.changeLog ? ` · ${version.changeLog}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Temperature: {editFormData.temperature}</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={editFormData.temperature}
                  onChange={(e) => setEditFormData({ ...editFormData, temperature: parseFloat(e.target.value) })}
                  style={{ width: '100%' }}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={handleCloseEdit} disabled={submitting}>
                取消
              </button>
              <button className="btn btn-primary" onClick={handleUpdate} disabled={!canUpdate || submitting}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
