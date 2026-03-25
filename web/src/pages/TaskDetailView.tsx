import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';

interface Task {
  id: string;
  parentTaskId: string | null;
  rootTaskId: string;
  assignedAgentId: string;
  status: string;
  triggerMode: string;
  inputPayload: string;
  outputSummary: string | null;
  errorMsg: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

interface TaskLog {
  stepIndex: number;
  stepType: 'THOUGHT' | 'ACTION' | 'OBSERVATION';
  content: string;
  toolName?: string;
  toolArgsJson?: string;
}

interface TaskTree {
  root: Task;
  children: Task[];
}

const TaskDetailView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [task, setTask] = useState<Task | null>(null);
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [tree, setTree] = useState<TaskTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'logs' | 'tree'>('logs');

  useEffect(() => {
    if (id) {
      fetchTask();
      fetchLogs();
      fetchTree();
    }
  }, [id]);

  const fetchTask = async () => {
    try {
      const response = await axios.get(`/api/v1/tasks/${id}`);
      setTask(response.data);
    } catch (error) {
      console.error('Failed to fetch task:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchLogs = async () => {
    try {
      const response = await axios.get(`/api/v1/tasks/${id}/logs`);
      setLogs(response.data);
    } catch (error) {
      console.error('Failed to fetch logs:', error);
    }
  };

  const fetchTree = async () => {
    try {
      const response = await axios.get(`/api/v1/tasks/${id}/tree`);
      setTree(response.data);
    } catch (error) {
      console.error('Failed to fetch tree:', error);
    }
  };

  const handleTerminate = async () => {
    if (!confirm('确定要终止这个任务吗？')) return;
    try {
      await axios.post(`/api/v1/tasks/${id}/terminate`);
      fetchTask();
    } catch (error) {
      console.error('Failed to terminate task:', error);
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      COMPLETED: '#52c41a',
      RUNNING: '#1890ff',
      EXCEPTION: '#ff4d4f',
      TERMINATED: '#faad14',
      QUEUED: '#faad14',
    };
    return colors[status] || '#999';
  };

  const getStepIcon = (type: string) => {
    switch (type) {
      case 'THOUGHT': return '💡';
      case 'ACTION': return '🛠️';
      case 'OBSERVATION': return '👀';
      default: return '•';
    }
  };

  if (loading) {
    return <div className="page-content">加载中...</div>;
  }

  if (!task) {
    return <div className="page-content">任务不存在</div>;
  }

  const payload = JSON.parse(task.inputPayload);

  return (
    <div className="page-content">
      <div style={{ marginBottom: 16 }}>
        <button className="btn" onClick={() => navigate(-1)} style={{ marginRight: 12 }}>
          ← 返回
        </button>
        <button 
          className="btn btn-danger" 
          onClick={handleTerminate}
          disabled={!['RUNNING', 'QUEUED', 'PARSING', 'DISPATCHING'].includes(task.status)}
        >
          终止任务
        </button>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">任务详情</h3>
        
        <div className="settings-item">
          <span className="settings-label">任务 ID</span>
          <span className="settings-value" style={{ fontFamily: 'monospace' }}>{task.id}</span>
        </div>

        <div className="settings-item">
          <span className="settings-label">状态</span>
          <span style={{ 
            padding: '4px 12px', 
            borderRadius: 4, 
            background: getStatusColor(task.status),
            color: 'white',
            fontWeight: 500,
          }}>
            {task.status}
          </span>
        </div>

        <div className="settings-item">
          <span className="settings-label">执行 Agent</span>
          <span className="settings-value">{task.assignedAgentId}</span>
        </div>

        <div className="settings-item">
          <span className="settings-label">触发方式</span>
          <span className="settings-value">{task.triggerMode}</span>
        </div>

        <div className="settings-item">
          <span className="settings-label">输入内容</span>
          <span className="settings-value" style={{ maxWidth: 400 }}>
            {typeof payload === 'string' ? payload : payload.content || JSON.stringify(payload)}
          </span>
        </div>

        {task.outputSummary && (
          <div className="settings-item">
            <span className="settings-label">输出摘要</span>
            <span className="settings-value">{task.outputSummary}</span>
          </div>
        )}

        {task.errorMsg && (
          <div className="settings-item">
            <span className="settings-label">错误信息</span>
            <span className="settings-value" style={{ color: '#ff4d4f' }}>{task.errorMsg}</span>
          </div>
        )}

        <div className="settings-item">
          <span className="settings-label">创建时间</span>
          <span className="settings-value">{new Date(task.createdAt).toLocaleString()}</span>
        </div>

        {task.startedAt && (
          <div className="settings-item">
            <span className="settings-label">开始时间</span>
            <span className="settings-value">{new Date(task.startedAt).toLocaleString()}</span>
          </div>
        )}

        {task.finishedAt && (
          <div className="settings-item">
            <span className="settings-label">结束时间</span>
            <span className="settings-value">{new Date(task.finishedAt).toLocaleString()}</span>
          </div>
        )}
      </div>

      <div className="settings-section">
        <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
          <button 
            className={`btn ${activeTab === 'logs' ? 'btn-primary' : ''}`}
            onClick={() => setActiveTab('logs')}
          >
            执行日志
          </button>
          <button 
            className={`btn ${activeTab === 'tree' ? 'btn-primary' : ''}`}
            onClick={() => setActiveTab('tree')}
          >
            任务树
          </button>
        </div>

        {activeTab === 'logs' && (
          <div>
            {logs.length === 0 ? (
              <div style={{ color: '#999', textAlign: 'center', padding: 20 }}>
                暂无执行日志
              </div>
            ) : (
              logs.map((log, i) => (
                <div 
                  key={i} 
                  style={{ 
                    display: 'flex', 
                    gap: 12, 
                    padding: '12px 0',
                    borderBottom: '1px solid #f0f0f0',
                  }}
                >
                  <span style={{ fontSize: 18 }}>{getStepIcon(log.stepType)}</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500, marginBottom: 4 }}>
                      {log.stepType}
                      {log.toolName && <span style={{ fontWeight: 400, color: '#666' }}> - {log.toolName}</span>}
                    </div>
                    <div style={{ color: '#333', whiteSpace: 'pre-wrap', fontSize: 14 }}>
                      {log.content}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'tree' && tree && (
          <div>
            <div style={{ fontWeight: 500, marginBottom: 12 }}>根任务: {tree.root.id}</div>
            {tree.children.map(child => (
              <div 
                key={child.id}
                style={{ 
                  padding: 12, 
                  marginLeft: 24, 
                  background: '#f5f5f5', 
                  borderRadius: 8,
                  marginBottom: 8,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 500 }}>子任务</span>
                  <span style={{ color: getStatusColor(child.status) }}>{child.status}</span>
                </div>
                <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
                  Agent: {child.assignedAgentId}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default TaskDetailView;