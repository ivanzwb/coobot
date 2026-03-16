import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAppStore } from '../stores/appStore';
import { format } from 'date-fns';

const stepStatusLabels: Record<string, string> = {
  pending: '等待',
  running: '执行中',
  waiting: '等待中',
  completed: '完成',
  failed: '失败',
  skipped: '跳过'
};

const statusLabels: Record<string, string> = {
  pending: '等待中',
  queued: '排队中',
  planning: '规划中',
  arranged: '已安排',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消'
};

interface TaskDetailProps {
  taskId?: string;
}

export function TaskDetail({ taskId: propTaskId }: TaskDetailProps) {
  const params = useParams<{ taskId: string }>();
  const taskId = propTaskId || params.taskId || '';
  const navigate = useNavigate();
  const { currentTask, currentTaskSteps, currentTaskOutputs, currentTaskEvents, cancelTask, fetchTaskDetail } = useAppStore();
  const [activeTab, setActiveTab] = useState<'steps' | 'timeline' | 'outputs'>('steps');

  useEffect(() => {
    if (taskId) {
      fetchTaskDetail(taskId);
    }
  }, [taskId, fetchTaskDetail]);

  const handleCancel = async () => {
    if (confirm('确定要取消这个任务吗?')) {
      await cancelTask(taskId);
    }
  };

  const task = currentTask;

  return (
    <div className="task-detail-page">
      <div className="page-header">
        <div className="header-left">
          <button className="btn-back" onClick={() => navigate('/tasks')}>
            ← 返回
          </button>
          <h2>任务详情</h2>
        </div>
        <div className="header-actions">
          {task?.status === 'failed' && (
            <button className="btn btn-primary">重试</button>
          )}
          {(task?.status === 'pending' || task?.status === 'running' || task?.status === 'queued') && (
            <button className="btn btn-danger" onClick={handleCancel}>取消任务</button>
          )}
        </div>
      </div>

      <TaskOverviewSection task={task} />
      
      <TaskStepsSection 
        steps={currentTaskSteps} 
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <TaskTimelineSection events={currentTaskEvents} />

      {currentTaskOutputs.length > 0 && (
        <TaskOutputSection outputs={currentTaskOutputs} />
      )}
    </div>
  );
}

function TaskOverviewSection({ task }: { task?: any }) {
  if (!task) return null;

  const getDuration = () => {
    if (task.completedAt && task.createdAt) {
      const duration = new Date(task.completedAt).getTime() - new Date(task.createdAt).getTime();
      const minutes = Math.floor(duration / 60000);
      const seconds = Math.floor((duration % 60000) / 1000);
      return `${minutes}分${seconds}秒`;
    }
    return '-';
  };

  return (
    <div className="task-overview-section">
      <div className="overview-card">
        <div className="overview-row">
          <div className="overview-item">
            <span className="overview-label">任务状态</span>
            <span className={`status-badge status-${task.status}`}>
              {statusLabels[task.status] || task.status}
            </span>
          </div>
          <div className="overview-item">
            <span className="overview-label">触发模式</span>
            <span className="overview-value">{task.triggerMode}</span>
          </div>
        </div>
        
        <div className="overview-row">
          <div className="overview-item full-width">
            <span className="overview-label">入口判定</span>
            <span className="overview-value">{task.triggerDecisionSummary || '-'}</span>
          </div>
        </div>

        <div className="overview-row">
          <div className="overview-item">
            <span className="overview-label">创建时间</span>
            <span className="overview-value">
              {format(new Date(task.createdAt), 'yyyy-MM-dd HH:mm:ss')}
            </span>
          </div>
          <div className="overview-item">
            <span className="overview-label">耗时</span>
            <span className="overview-value">{getDuration()}</span>
          </div>
        </div>
      </div>

      {task.complexityDecisionSummary && (
        <div className="overview-card">
          <div className="section-title">复杂任务判定</div>
          <p>{task.complexityDecisionSummary}</p>
        </div>
      )}
    </div>
  );
}

function TaskStepsSection({ 
  steps, 
  activeTab, 
  onTabChange 
}: { 
  steps: any[]; 
  activeTab: string;
  onTabChange: (tab: 'steps' | 'timeline' | 'outputs') => void;
}) {
  return (
    <div className="task-steps-section">
      <div className="section-header">
        <h3>📋 步骤进度</h3>
        <div className="tabs">
          <button 
            className={`tab ${activeTab === 'steps' ? 'active' : ''}`}
            onClick={() => onTabChange('steps')}
          >
            步骤
          </button>
          <button 
            className={`tab ${activeTab === 'timeline' ? 'active' : ''}`}
            onClick={() => onTabChange('timeline')}
          >
            时间线
          </button>
          <button 
            className={`tab ${activeTab === 'outputs' ? 'active' : ''}`}
            onClick={() => onTabChange('outputs')}
          >
            输出
          </button>
        </div>
      </div>

      {activeTab === 'steps' && (
        <div className="steps-progress">
          <div className="progress-line">
            {steps.map((step, index) => (
              <div key={step.id} className={`progress-step ${step.status}`}>
                <div className="step-dot">
                  {step.status === 'completed' ? '✓' : 
                   step.status === 'running' ? '●' : 
                   step.status === 'failed' ? '✕' : index + 1}
                </div>
                {index < steps.length - 1 && <div className="step-connector"></div>}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="step-list">
        {steps.length === 0 ? (
          <div className="empty-state">
            <p>暂无步骤信息</p>
          </div>
        ) : (
          steps.map((step) => (
            <div key={step.id} className="step-item">
              <div className={`step-icon ${step.status}`}>
                {step.status === 'completed' ? '✓' : 
                 step.status === 'running' ? '●' : 
                 step.status === 'failed' ? '✕' : step.stepOrder}
              </div>
              <div className="step-info">
                <div className="step-name">{step.name}</div>
                <div className="step-status">{stepStatusLabels[step.status] || step.status}</div>
                {step.reasoningSummary && (
                  <div className="step-reasoning">{step.reasoningSummary}</div>
                )}
                {step.actionSummary && (
                  <div className="step-action">动作: {step.actionSummary}</div>
                )}
                {step.observationSummary && (
                  <div className="step-observation">观察: {step.observationSummary}</div>
                )}
              </div>
              {step.duration && (
                <div className="step-duration">{step.duration}ms</div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function TaskTimelineSection({ events }: { events: any[] }) {
  return (
    <div className="task-timeline-section">
      <h3>📜 时间线</h3>
      <div className="timeline-list">
        {events.length === 0 ? (
          <div className="empty-state">
            <p>暂无事件</p>
          </div>
        ) : (
          events.map((event) => (
            <div key={event.id} className="timeline-item">
              <div className="timeline-time">
                {format(new Date(event.timestamp), 'HH:mm:ss')}
              </div>
              <div className="timeline-content">
                <div className="timeline-event-type">{event.eventType}</div>
                {event.summary && <div className="timeline-summary">{event.summary}</div>}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function TaskOutputSection({ outputs }: { outputs: any[] }) {
  return (
    <div className="task-output-section">
      <h3>📖 输出物</h3>
      <div className="output-list">
        {outputs.map((output) => (
          <div key={output.id} className="output-item">
            <div className="output-header">
              <span className="output-type">{output.type}</span>
              <span className="output-time">
                {format(new Date(output.createdAt), 'yyyy-MM-dd HH:mm:ss')}
              </span>
            </div>
            {output.summary && <div className="output-summary">{output.summary}</div>}
            {output.content && <div className="output-content">{output.content}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default TaskDetail;
