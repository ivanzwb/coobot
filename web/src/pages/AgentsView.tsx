import React, { useEffect, useState } from 'react';
import { useAppStore } from '../stores/appStore';
import { modelsApi, knowledgeApi } from '../api';
import type { Model } from '../types';

interface Skill {
  id: string;
  name: string;
  description: string;
  version?: string;
}

interface KnowledgeFile {
  id: string;
  fileName: string;
  status: string;
}

const AgentsView: React.FC = () => {
  const { agents, fetchAgents, createAgent, deleteAgent, selectAgent, updateAgent } = useAppStore();
  const [showModal, setShowModal] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showSkillsModal, setShowSkillsModal] = useState(false);
  const [showKnowledgeModal, setShowKnowledgeModal] = useState(false);
  const [showToolsModal, setShowToolsModal] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<any>(null);
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentTemperature, setNewAgentTemperature] = useState<number>(0.7);
  const [newRolePrompt, setNewRolePrompt] = useState('');
  const [newBehaviorRules, setNewBehaviorRules] = useState('');
  const [newCapabilityBoundary, setNewCapabilityBoundary] = useState('');
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [agentSkills, setAgentSkills] = useState<string[]>([]);
  const [knowledgeFiles, setKnowledgeFiles] = useState<KnowledgeFile[]>([]);
  const [toolPermissions, setToolPermissions] = useState<{toolName: string; description: string; policy: string}[]>([]);
  const [editRolePrompt, setEditRolePrompt] = useState('');
  const [editBehaviorRules, setEditBehaviorRules] = useState('');
  const [editCapabilityBoundary, setEditCapabilityBoundary] = useState('');
  const [editTemperature, setEditTemperature] = useState<number>(0.7);

  useEffect(() => {
    fetchAgents();
    loadModels();
    loadSkills();
  }, [fetchAgents]);

  const loadModels = async () => {
    try {
      const response = await modelsApi.getAll();
      setModels(response.data);
    } catch (error) {
      console.error('Failed to load models:', error);
    }
  };

  const loadSkills = async () => {
    try {
      const response = await fetch('/api/v1/skills');
      const data = await response.json();
      setSkills(data);
    } catch (error) {
      console.error('Failed to load skills:', error);
    }
  };

  const loadAgentSkills = async (agentId: string) => {
    try {
      const response = await fetch(`/api/v1/agents/${agentId}`);
      const data = await response.json();
      setAgentSkills(data.skills || []);
    } catch (error) {
      console.error('Failed to load agent skills:', error);
    }
  };

  const loadKnowledgeFiles = async (agentId: string) => {
    try {
      const response = await knowledgeApi.getFiles(agentId);
      setKnowledgeFiles(response.data);
    } catch (error) {
      console.error('Failed to load knowledge files:', error);
    }
  };

  const loadToolPermissions = async (agentId: string) => {
    try {
      const response = await fetch(`/api/v1/tools/permissions/${agentId}`);
      const data = await response.json();
      setToolPermissions(data);
    } catch (error) {
      console.error('Failed to load tool permissions:', error);
    }
  };

  const handleToolPermissionChange = async (toolName: string, policy: string) => {
    if (!selectedAgent) return;
    try {
      await fetch(`/api/v1/tools/permissions/${selectedAgent.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolName, policy }),
      });
      loadToolPermissions(selectedAgent.id);
    } catch (error) {
      console.error('Failed to update tool permission:', error);
    }
  };

  const handleManageTools = (agent: any, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedAgent(agent);
    loadToolPermissions(agent.id);
    setShowToolsModal(true);
  };

  const handleCreateAgent = async () => {
    if (!newAgentName.trim() || !selectedModelId) return;

    try {
      const agent = await createAgent({
        name: newAgentName,
        type: 'DOMAIN',
        modelConfigId: selectedModelId,
        temperature: newAgentTemperature,
        rolePrompt: newRolePrompt,
        behaviorRules: newBehaviorRules,
        capabilityBoundary: newCapabilityBoundary,
      });

      if (selectedSkillIds.length > 0 && agent?.id) {
        for (const skillId of selectedSkillIds) {
          await fetch(`/api/v1/agents/${agent.id}/skills`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ skillId })
          });
        }
      }

      setNewAgentName('');
      setNewAgentTemperature(0.7);
      setNewRolePrompt('');
      setNewBehaviorRules('');
      setNewCapabilityBoundary('');
      setSelectedModelId('');
      setSelectedSkillIds([]);
      setShowModal(false);
      fetchAgents();
    } catch (error) {
      console.error('Failed to create agent:', error);
    }
  };

  const handleEditAgent = (agent: any, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedAgent(agent);
    const modelId = getCurrentModelId(agent);
    setSelectedModelId(modelId);
    setEditRolePrompt(agent.rolePrompt || '');
    setEditBehaviorRules(agent.behaviorRules || '');
    setEditCapabilityBoundary(agent.capabilityBoundary || '');
    setEditTemperature(agent.temperature || 0.7);
    loadAgentSkills(agent.id);
    loadKnowledgeFiles(agent.id);
    setShowConfigModal(true);
  };

  const handleManageSkills = (agent: any, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedAgent(agent);
    loadAgentSkills(agent.id);
    setShowSkillsModal(true);
  };

  const handleManageKnowledge = (agent: any, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedAgent(agent);
    loadKnowledgeFiles(agent.id);
    setShowKnowledgeModal(true);
  };

  const handleSaveConfig = async () => {
    if (!selectedAgent || !selectedModelId) return;

    try {
      await updateAgent(selectedAgent.id, {
        name: selectedAgent.name,
        modelConfigId: selectedModelId,
        temperature: editTemperature,
        rolePrompt: editRolePrompt,
        behaviorRules: editBehaviorRules,
        capabilityBoundary: editCapabilityBoundary,
      });
      await fetchAgents();
      setShowConfigModal(false);
      setSelectedAgent(null);
      setSelectedModelId('');
    } catch (error) {
      console.error('Failed to update agent:', error);
    }
  };

  const handleToggleSkill = async (skillId: string) => {
    if (!selectedAgent) return;

    const isAssigned = agentSkills.includes(skillId);
    try {
      if (isAssigned) {
        await fetch(`/api/v1/agents/${selectedAgent.id}/skills/${skillId}`, { method: 'DELETE' });
      } else {
        await fetch(`/api/v1/agents/${selectedAgent.id}/skills`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ skillId })
        });
      }
      loadAgentSkills(selectedAgent.id);
    } catch (error) {
      console.error('Failed to toggle skill:', error);
    }
  };

  const handleDeleteAgent = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('确定要删除这个 Agent 吗？')) {
      await deleteAgent(id);
    }
  };

  const handleToggleAgent = async (agent: any, e: React.MouseEvent) => {
    e.stopPropagation();
    const isEnabled = agent.capabilities?.status === 'ONLINE';
    const endpoint = isEnabled ? 'disable' : 'enable';
    try {
      await fetch(`/api/v1/agents/${agent.id}/${endpoint}`, { method: 'POST' });
      fetchAgents();
    } catch (error) {
      console.error(`Failed to ${endpoint} agent:`, error);
    }
  };

  const getCurrentModelId = (agent: any): string => {
    return agent.modelConfigId || '';
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">Agent 管理</h1>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          + 创建 Agent
        </button>
      </div>

      <div>
        {agents.map(agent => (
          <div
            key={agent.id}
            className="agent-card"
            onClick={() => selectAgent(agent)}
          >
            <div className="agent-card-header">
              <span className="agent-name">{agent.name}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span className="agent-status">
                  <span className={`status-dot ${agent.capabilities?.status === 'ONLINE' ? 'idle' : ''}`}></span>
                  {agent.capabilities?.status === 'ONLINE' ? '在线' : '离线'}
                </span>
                {agent.type !== 'LEADER' && (
                  <button
                    className={`btn btn-sm ${agent.capabilities?.status === 'ONLINE' ? 'btn-warning' : 'btn-success'}`}
                    onClick={(e) => handleToggleAgent(agent, e)}
                    style={{ padding: '4px 8px', fontSize: 12 }}
                  >
                    {agent.capabilities?.status === 'ONLINE' ? '禁用' : '启用'}
                  </button>
                )}
                <button
                  className="btn btn-sm"
                  onClick={(e) => handleEditAgent(agent, e)}
                  style={{ padding: '4px 8px', fontSize: 12 }}
                >
                  配置
                </button>
                <button
                  className="btn btn-sm"
                  onClick={(e) => handleManageSkills(agent, e)}
                  style={{ padding: '4px 8px', fontSize: 12 }}
                >
                  Skills
                </button>
                <button
                  className="btn btn-sm"
                  onClick={(e) => handleManageTools(agent, e)}
                  style={{ padding: '4px 8px', fontSize: 12 }}
                >
                  工具权限
                </button>
                <button
                  className="btn btn-sm"
                  onClick={(e) => handleManageKnowledge(agent, e)}
                  style={{ padding: '4px 8px', fontSize: 12 }}
                >
                  知识库
                </button>
                {agent.type !== 'LEADER' && (
                  <button
                    className="btn btn-danger"
                    onClick={(e) => handleDeleteAgent(agent.id, e)}
                    style={{ padding: '4px 8px', fontSize: 12 }}
                  >
                    删除
                  </button>
                )}
              </div>
            </div>
            <div className="agent-tags">
              <span className="tag">{agent.type === 'LEADER' ? 'Leader' : 'Domain'}</span>
              {agent.modelConfig ? (
                <span className="tag" style={{ background: '#52c41a' }}>模型✓</span>
              ) : (
                <span className="tag" style={{ background: '#ff4d4f' }}>模型✗</span>
              )}
              {agent.rolePrompt || agent.behaviorRules || agent.capabilityBoundary ? (
                <span className="tag" style={{ background: '#52c41a' }}>Prompt✓</span>
              ) : null}
              {agent.capabilities?.skills?.length ? (
                <span className="tag" style={{ background: '#52c41a' }}>Skill({agent.capabilities.skills.length})✓</span>
              ) : null}
            </div>
            <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
              模型: {agent.modelConfig?.name || '未配置'}
            </div>
          </div>
        ))}

        {agents.length === 0 && (
          <div style={{ textAlign: 'center', color: '#999', padding: 40 }}>
            暂无 Agent，点击上方按钮创建
          </div>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 600 }}>
            <h2 className="modal-title">创建新 Agent</h2>

            <div className="form-group">
              <label className="form-label">Agent 名称 *</label>
              <input
                type="text"
                className="form-input"
                value={newAgentName}
                onChange={(e) => setNewAgentName(e.target.value)}
                placeholder="输入 Agent 名称"
                autoFocus
              />
            </div>

            <div className="form-group">
              <label className="form-label">Temperature: {newAgentTemperature}</label>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={newAgentTemperature}
                onChange={(e) => setNewAgentTemperature(parseFloat(e.target.value))}
                style={{ width: '100%' }}
              />
              <div style={{ fontSize: 12, color: '#666' }}>较低的值产生更确定性的输出，较高的值产生更多样化的输出</div>
            </div>

            <div className="form-group">
              <label className="form-label">选择模型 *</label>
              <select
                className="form-input"
                value={selectedModelId}
                onChange={(e) => setSelectedModelId(e.target.value)}
              >
                <option value="">选择已配置的模型</option>
                {models.filter(m => m.status === 'ready').map(model => (
                  <option key={model.id} value={model.id}>
                    {model.name} ({model.provider} / {model.modelName})
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">角色定位（Prompt）</label>
              <textarea
                className="form-input"
                value={newRolePrompt}
                onChange={(e) => setNewRolePrompt(e.target.value)}
                placeholder="定义 Agent 的角色定位，例如：你是一位专业的股票投资顾问"
                rows={3}
              />
            </div>

            <div className="form-group">
              <label className="form-label">行为规范</label>
              <textarea
                className="form-input"
                value={newBehaviorRules}
                onChange={(e) => setNewBehaviorRules(e.target.value)}
                placeholder="定义 Agent 的行为规范，例如：1. 提供投资建议时必须说明风险 2. 不提供具体的买卖时机建议"
                rows={3}
              />
            </div>

            <div className="form-group">
              <label className="form-label">能力边界</label>
              <textarea
                className="form-input"
                value={newCapabilityBoundary}
                onChange={(e) => setNewCapabilityBoundary(e.target.value)}
                placeholder="定义 Agent 的能力边界，例如：不能提供实时的股价数据，不能执行金融交易"
                rows={3}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Skills（可选）</label>
              <div style={{ maxHeight: 120, overflowY: 'auto', border: '1px solid #ddd', padding: 8, borderRadius: 4 }}>
                {skills.length === 0 ? (
                  <div style={{ color: '#999' }}>暂无可用 Skills</div>
                ) : (
                  skills.map(skill => (
                    <label key={skill.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <input
                        type="checkbox"
                        checked={selectedSkillIds.includes(skill.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedSkillIds([...selectedSkillIds, skill.id]);
                          } else {
                            setSelectedSkillIds(selectedSkillIds.filter(id => id !== skill.id));
                          }
                        }}
                      />
                      {skill.name}
                    </label>
                  ))
                )}
              </div>
            </div>

            <div className="modal-actions">
              <button className="btn" onClick={() => {
                setShowModal(false);
                setSelectedSkillIds([]);
              }}>
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreateAgent}
                disabled={!newAgentName.trim() || !selectedModelId}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {showConfigModal && selectedAgent && (
        <div className="modal-overlay" onClick={() => setShowConfigModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <h2 className="modal-title">配置 Agent</h2>
            <div className="form-group">
              <label className="form-label">Agent 名称</label>
              <input
                type="text"
                className="form-input"
                value={selectedAgent.name}
                onChange={(e) => setSelectedAgent({ ...selectedAgent, name: e.target.value })}
              />
            </div>
            <div className="form-group">
              <label className="form-label">角色定位（Prompt）</label>
              <textarea
                className="form-input"
                value={editRolePrompt}
                onChange={(e) => setEditRolePrompt(e.target.value)}
                placeholder="定义 Agent 的角色定位"
                rows={3}
              />
            </div>
            <div className="form-group">
              <label className="form-label">行为规范</label>
              <textarea
                className="form-input"
                value={editBehaviorRules}
                onChange={(e) => setEditBehaviorRules(e.target.value)}
                placeholder="定义 Agent 的行为规范"
                rows={3}
              />
            </div>
            <div className="form-group">
              <label className="form-label">能力边界</label>
              <textarea
                className="form-input"
                value={editCapabilityBoundary}
                onChange={(e) => setEditCapabilityBoundary(e.target.value)}
                placeholder="定义 Agent 的能力边界"
                rows={3}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Temperature: {editTemperature}</label>
              <input
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={editTemperature}
                onChange={(e) => setEditTemperature(parseFloat(e.target.value))}
                style={{ width: '100%' }}
              />
              <div style={{ fontSize: 12, color: '#666' }}>较低的值产生更确定性的输出，较高的值产生更多样化的输出</div>
            </div>
            <div className="form-group">
              <label className="form-label">选择模型</label>
              <select
                className="form-input"
                value={selectedModelId || getCurrentModelId(selectedAgent)}
                onChange={(e) => setSelectedModelId(e.target.value)}
              >
                <option value="">选择已配置的模型</option>
                {models.filter(m => m.status === 'ready').map(model => (
                  <option key={model.id} value={model.id}>
                    {model.name} ({model.provider} / {model.modelName})
                  </option>
                ))}
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => {
                setShowConfigModal(false);
                setSelectedAgent(null);
                setSelectedModelId('');
              }}>
                取消
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSaveConfig}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {showSkillsModal && selectedAgent && (
        <div className="modal-overlay" onClick={() => setShowSkillsModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <h2 className="modal-title">管理 Skills - {selectedAgent.name}</h2>
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              {skills.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#999', padding: 20 }}>
                  暂无可用 Skills，请先在 Skill 市场安装
                </div>
              ) : (
                skills.map(skill => (
                  <div key={skill.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 0',
                    borderBottom: '1px solid #eee'
                  }}>
                    <div>
                      <div style={{ fontWeight: 'bold' }}>{skill.name}</div>
                      <div style={{ fontSize: 12, color: '#666' }}>{skill.description}</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={agentSkills.includes(skill.id)}
                      onChange={() => handleToggleSkill(skill.id)}
                    />
                  </div>
                ))
              )}
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setShowSkillsModal(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {showKnowledgeModal && selectedAgent && (
        <div className="modal-overlay" onClick={() => setShowKnowledgeModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <h2 className="modal-title">知识库 - {selectedAgent.name}</h2>
            <div style={{ marginBottom: 16 }}>
              <button className="btn btn-primary btn-sm">
                + 上传文件
              </button>
            </div>
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              {knowledgeFiles.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#999', padding: 20 }}>
                  暂无知识文件，请上传文档
                </div>
              ) : (
                knowledgeFiles.map(file => (
                  <div key={file.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 0',
                    borderBottom: '1px solid #eee'
                  }}>
                    <div>
                      <div style={{ fontWeight: 'bold' }}>{file.fileName}</div>
                      <div style={{ fontSize: 12, color: '#666' }}>{file.status}</div>
                    </div>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => {
                        if (confirm('确定删除此文件吗？')) {
                          knowledgeApi.delete(selectedAgent.id, file.id).then(() => {
                            loadKnowledgeFiles(selectedAgent.id);
                          });
                        }
                      }}
                    >
                      删除
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setShowKnowledgeModal(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {showToolsModal && selectedAgent && (
        <div className="modal-overlay" onClick={() => setShowToolsModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 500 }}>
            <h2 className="modal-title">工具权限 - {selectedAgent.name}</h2>
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              {toolPermissions.map(tool => (
                <div key={tool.toolName} style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 0',
                  borderBottom: '1px solid #eee'
                }}>
                  <div>
                    <div style={{ fontWeight: 'bold' }}>{tool.toolName}</div>
                    <div style={{ fontSize: 12, color: '#666' }}>{tool.description}</div>
                  </div>
                  <select
                    value={tool.policy}
                    onChange={(e) => handleToolPermissionChange(tool.toolName, e.target.value)}
                    style={{ padding: '4px 8px' }}
                  >
                    <option value="ALLOW">允许</option>
                    <option value="ASK">询问</option>
                    <option value="DENY">拒绝</option>
                  </select>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setShowToolsModal(false)}>
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AgentsView;