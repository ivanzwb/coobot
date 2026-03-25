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
  const [selectedAgent, setSelectedAgent] = useState<any>(null);
  const [newAgentName, setNewAgentName] = useState('');
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [skills, setSkills] = useState<Skill[]>([]);
  const [agentSkills, setAgentSkills] = useState<string[]>([]);
  const [knowledgeFiles, setKnowledgeFiles] = useState<KnowledgeFile[]>([]);

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

  const handleCreateAgent = async () => {
    if (!newAgentName.trim() || !selectedModelId) return;

    try {
      await createAgent({
        name: newAgentName,
        type: 'DOMAIN',
        modelConfigId: selectedModelId,
      });
      setNewAgentName('');
      setSelectedModelId('');
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

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'IDLE': return 'idle';
      case 'RUNNING': return 'running';
      case 'BUSY_WITH_QUEUE': return 'busy';
      default: return '';
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
                  <span className={`status-dot ${getStatusClass(agent.status)}`}></span>
                  {agent.status === 'IDLE' ? '空闲' :
                   agent.status === 'RUNNING' ? '运行中' : '忙碌'}
                </span>
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
              {agent.capabilities?.skills?.map((skill: string, i: number) => (
                <span key={i} className="tag">{skill}</span>
              ))}
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
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">创建新 Agent</h2>
            <div className="form-group">
              <label className="form-label">Agent 名称</label>
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
              <label className="form-label">选择模型</label>
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
            <div className="modal-actions">
              <button className="btn" onClick={() => setShowModal(false)}>
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
    </div>
  );
};

export default AgentsView;