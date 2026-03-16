import { useState, useEffect } from 'react';
import { api } from '../api/client';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastCheck: string;
}

interface TaskMetrics {
  total: number;
  running: number;
  completed: number;
  failed: number;
  successRate: number;
}

interface ModelMetrics {
  totalCalls: number;
  avgResponseTime: number;
  errorRate: number;
  providerSwitches: number;
}

interface ResourceMetrics {
  cpu: number;
  memory: number;
  disk: number;
  slots: { used: number; total: number };
}

interface Alert {
  id: string;
  level: 'critical' | 'warning' | 'info';
  message: string;
  timestamp: string;
  threshold: string;
}

interface DashboardData {
  health: HealthStatus;
  tasks: TaskMetrics;
  models: ModelMetrics;
  resources: ResourceMetrics;
  alerts: Alert[];
  taskTrend: number[];
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  useEffect(() => {
    loadDashboard();
    const interval = setInterval(loadDashboard, 30000);
    return () => clearInterval(interval);
  }, []);

  const loadDashboard = async () => {
    setLoading(true);
    try {
      const dashboardData = await api.getDashboard() as DashboardData;
      setData(dashboardData);
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Failed to load dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  };

  const getHealthStatus = () => {
    if (!data) return { label: '加载中', color: '#6b7280' };
    switch (data.health.status) {
      case 'healthy': return { label: '🟢 正常', color: '#10b981' };
      case 'degraded': return { label: '🟡 降级', color: '#f59e0b' };
      case 'unhealthy': return { label: '🔴 异常', color: '#ef4444' };
    }
  };

  const getAlertIcon = (level: string) => {
    switch (level) {
      case 'critical': return '🔴';
      case 'warning': return '🟡';
      default: return '🔵';
    }
  };

  if (loading && !data) {
    return (
      <div className="dashboard-page">
        <div className="loading"><div className="spinner"></div></div>
      </div>
    );
  }

  const health = getHealthStatus();

  return (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <h1>监控仪表盘</h1>
        <button className="btn btn-secondary" onClick={loadDashboard}>
          🔄 刷新
        </button>
      </div>

      <div className="health-status">
        <span style={{ color: health.color, fontSize: 18 }}>{health.label}</span>
        <span className="last-updated">最后更新: {formatTime(lastUpdated)}</span>
      </div>

      <div className="metrics-grid">
        <MetricsCard title="📊 任务统计" data={data?.tasks} type="tasks" />
        <MetricsCard title="📈 模型指标" data={data?.models} type="models" />
        <MetricsCard title="💻 资源" data={data?.resources} type="resources" />
      </div>

      <div className="trend-chart">
        <h3>📉 任务趋势 (过去7天)</h3>
        <div className="chart-placeholder">
          <div className="bar-chart">
            {(data?.taskTrend || [30, 45, 60, 80, 55, 70, 90]).map((value, index) => (
              <div key={index} className="bar-container">
                <div className="bar" style={{ height: `${value}%` }}></div>
                <span className="bar-label">{(['M', 'T', 'W', 'T', 'F', 'S', 'S'])[index]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="alerts-section">
        <h3>⚠️ 告警列表</h3>
        <div className="alerts-list">
          {data?.alerts && data.alerts.length > 0 ? (
            data.alerts.map((alert) => (
              <div key={alert.id} className={`alert-item alert-${alert.level}`}>
                <span className="alert-icon">{getAlertIcon(alert.level)}</span>
                <span className="alert-message">{alert.message}</span>
                <span className="alert-threshold">{alert.threshold}</span>
                <span className="alert-time">{alert.timestamp}</span>
                <button className="btn-link">查看</button>
              </div>
            ))
          ) : (
            <div className="empty-state">
              <p>暂无告警</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface MetricsCardProps {
  title: string;
  data?: TaskMetrics | ModelMetrics | ResourceMetrics;
  type: 'tasks' | 'models' | 'resources';
}

function MetricsCard({ title, data, type }: MetricsCardProps) {
  const renderTasks = (data: TaskMetrics) => (
    <>
      <div className="metric-item">
        <span className="metric-value">{data.total}</span>
        <span className="metric-label">总任务</span>
      </div>
      <div className="metric-item">
        <span className="metric-value">{data.running}</span>
        <span className="metric-label">进行中</span>
      </div>
      <div className="metric-item">
        <span className="metric-value">{data.completed}</span>
        <span className="metric-label">完成</span>
      </div>
      <div className="metric-item">
        <span className="metric-value">{data.failed}</span>
        <span className="metric-label">失败</span>
      </div>
    </>
  );

  const renderModels = (data: ModelMetrics) => (
    <>
      <div className="metric-item">
        <span className="metric-value">{data.totalCalls.toLocaleString()}</span>
        <span className="metric-label">调用</span>
      </div>
      <div className="metric-item">
        <span className="metric-value">{data.avgResponseTime}s</span>
        <span className="metric-label">响应</span>
      </div>
      <div className="metric-item">
        <span className="metric-value">{data.errorRate}%</span>
        <span className="metric-label">错误率</span>
      </div>
      <div className="metric-item">
        <span className="metric-value">{data.providerSwitches}</span>
        <span className="metric-label">切换</span>
      </div>
    </>
  );

  const renderResources = (data: ResourceMetrics) => (
    <>
      <div className="metric-item">
        <span className="metric-value">{data.cpu}%</span>
        <span className="metric-label">CPU</span>
      </div>
      <div className="metric-item">
        <span className="metric-value">{data.memory}%</span>
        <span className="metric-label">内存</span>
      </div>
      <div className="metric-item">
        <span className="metric-value">{data.disk}%</span>
        <span className="metric-label">磁盘</span>
      </div>
      <div className="metric-item">
        <span className="metric-value">{data.slots.used}/{data.slots.total}</span>
        <span className="metric-label">槽位</span>
      </div>
    </>
  );

  return (
    <div className="metrics-card">
      <h3>{title}</h3>
      <div className="metrics-content">
        {data && type === 'tasks' && renderTasks(data as TaskMetrics)}
        {data && type === 'models' && renderModels(data as ModelMetrics)}
        {data && type === 'resources' && renderResources(data as ResourceMetrics)}
      </div>
    </div>
  );
}

export default DashboardPage;
