import React, { useEffect, useState } from 'react';
import { systemApi } from '../api';

const MonitorView: React.FC = () => {
  const [agentMetrics, setAgentMetrics] = useState<any[]>([]);
  const [resourceMetrics, setResourceMetrics] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 5000);
    return () => clearInterval(interval);
  }, []);

  const fetchMetrics = async () => {
    try {
      const [agents, resources] = await Promise.all([
        systemApi.getAgentMetrics(),
        systemApi.getResourceMetrics(),
      ]);
      setAgentMetrics(agents.data);
      setResourceMetrics(resources.data);
    } catch (error) {
      console.error('Failed to fetch metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'IDLE': return '#52c41a';
      case 'RUNNING': return '#1890ff';
      case 'BUSY_WITH_QUEUE': return '#faad14';
      default: return '#999';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'IDLE': return '空闲';
      case 'RUNNING': return '运行中';
      case 'BUSY_WITH_QUEUE': return '忙碌(队列)';
      default: return status;
    }
  };

  if (loading) {
    return <div className="page-content">加载中...</div>;
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h1 className="page-title">监控面板</h1>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div className="settings-section">
          <h3 className="settings-section-title">资源使用</h3>
          
          {resourceMetrics && (
            <>
              <div className="settings-item">
                <span className="settings-label">CPU</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ 
                    width: 100, 
                    height: 8, 
                    background: '#e8e8e8', 
                    borderRadius: 4,
                    overflow: 'hidden',
                  }}>
                    <div style={{ 
                      width: `${resourceMetrics.cpu}%`, 
                      height: '100%', 
                      background: resourceMetrics.cpu > 80 ? '#ff4d4f' : '#1890ff',
                    }} />
                  </div>
                  <span>{resourceMetrics.cpu.toFixed(1)}%</span>
                </div>
              </div>

              <div className="settings-item">
                <span className="settings-label">内存</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ 
                    width: 100, 
                    height: 8, 
                    background: '#e8e8e8', 
                    borderRadius: 4,
                    overflow: 'hidden',
                  }}>
                    <div style={{ 
                      width: `${resourceMetrics.memory}%`, 
                      height: '100%', 
                      background: resourceMetrics.memory > 80 ? '#ff4d4f' : '#1890ff',
                    }} />
                  </div>
                  <span>{resourceMetrics.memory.toFixed(1)}%</span>
                </div>
              </div>

              <div className="settings-item">
                <span className="settings-label">进程内存</span>
                <span className="settings-value">
                  {(resourceMetrics.memoryUsed / 1024 / 1024).toFixed(0)} MB / {(resourceMetrics.memoryTotal / 1024 / 1024).toFixed(0)} MB
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">Agent 状态</h3>
        
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e8e8e8' }}>
              <th style={{ textAlign: 'left', padding: 12 }}>Agent</th>
              <th style={{ textAlign: 'left', padding: 12 }}>状态</th>
              <th style={{ textAlign: 'left', padding: 12 }}>队列长度</th>
              <th style={{ textAlign: 'left', padding: 12 }}>当前任务</th>
            </tr>
          </thead>
          <tbody>
            {agentMetrics.map(agent => (
              <tr key={agent.agentId} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: 12, fontWeight: 500 }}>{agent.name}</td>
                <td style={{ padding: 12 }}>
                  <span style={{ 
                    display: 'inline-flex', 
                    alignItems: 'center', 
                    gap: 6,
                    padding: '4px 12px',
                    borderRadius: 4,
                    background: getStatusColor(agent.status) + '20',
                    color: getStatusColor(agent.status),
                  }}>
                    <span style={{ 
                      width: 8, 
                      height: 8, 
                      borderRadius: '50%', 
                      background: getStatusColor(agent.status),
                    }} />
                    {getStatusText(agent.status)}
                  </span>
                </td>
                <td style={{ padding: 12 }}>
                  {agent.queueLength > 0 ? (
                    <span style={{ color: '#faad14', fontWeight: 500 }}>{agent.queueLength} 个任务</span>
                  ) : (
                    <span style={{ color: '#999' }}>0</span>
                  )}
                </td>
                <td style={{ padding: 12, fontFamily: 'monospace', fontSize: 12 }}>
                  {agent.currentTaskId ? (
                    <span style={{ color: '#1890ff' }}>{agent.currentTaskId.substring(0, 8)}...</span>
                  ) : (
                    <span style={{ color: '#999' }}>-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {agentMetrics.length === 0 && (
          <div style={{ textAlign: 'center', color: '#999', padding: 40 }}>
            暂无 Agent 数据
          </div>
        )}
      </div>
    </div>
  );
};

export default MonitorView;