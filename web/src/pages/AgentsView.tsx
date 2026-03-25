import React, { useEffect, useState } from 'react';
import { useAppStore } from '../stores/appStore';

const AgentsView: React.FC = () => {
  const { agents, fetchAgents, createAgent, deleteAgent, selectAgent } = useAppStore();
  const [showModal, setShowModal] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const handleCreateAgent = async () => {
    if (!newAgentName.trim()) return;
    
    try {
      await createAgent({
        name: newAgentName,
        type: 'DOMAIN',
        modelConfigJson: JSON.stringify({ provider: 'ollama', model: 'llama2' }),
      });
      setNewAgentName('');
      setShowModal(false);
    } catch (error) {
      console.error('Failed to create agent:', error);
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
              {agent.capabilities?.skills?.map((skill, i) => (
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
            <div className="modal-actions">
              <button className="btn" onClick={() => setShowModal(false)}>
                取消
              </button>
              <button className="btn btn-primary" onClick={handleCreateAgent}>
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AgentsView;