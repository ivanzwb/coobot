import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAppStore } from '../stores/appStore';
import { format } from 'date-fns';

const stepStatusLabels: Record<string, string> = {
  pending: '等待',
  TaskStepPending: '等待',
  running: '执行中',
  TaskStepRunning: '执行中',
  waiting: '等待中',
  TaskStepWaiting: '等待中',
  completed: '完成',
  TaskStepCompleted: '完成',
  failed: '失败',
  TaskStepFailed: '失败',
  skipped: '跳过',
  TaskStepSkipped: '跳过'
};

const statusLabels: Record<string, string> = {
  pending: '等待中',
  TaskPending: '等待中',
  queued: '排队中',
  TaskQueued: '排队中',
  scheduled: '定时等待',
  TaskScheduled: '定时等待',
  event_triggered: '事件等待',
  TaskEventTriggered: '事件等待',
  clarification_pending: '待澄清',
  TaskClarificationPending: '待澄清',
  planning: '规划中',
  TaskPlanning: '规划中',
  arranged: '已安排',
  TaskArranged: '已安排',
  running: '执行中',
  TaskExecuting: '执行中',
  completed: '已完成',
  TaskCompleted: '已完成',
  failed: '失败',
  TaskFailed: '失败',
  cancelled: '已取消',
  TaskCancelled: '已取消',
  intervention_required: '需人工介入',
  TaskInterventionRequired: '需人工介入',
  TaskArrangementCompleted: '已安排完成'
};

interface SubTask {
  id: string;
  name: string;
  status: string;
  agentName?: string;
  queuePosition?: number;
  outputSummary?: string;
  blocking?: boolean;
}

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
          {(task?.status === 'pending' || task?.status === 'running' || 
            task?.status === 'queued' || task?.status === 'TaskPending' ||
            task?.status === 'TaskExecuting' || task?.status === 'TaskQueued') && (
            <button className="btn btn-danger" onClick={handleCancel}>取消任务</button>
          )}
        </div>
      </div>

      <TaskOverviewSection task={task} />
      
      {(task?.complexityDecisionSummary || task?.arrangementStatus === 'TaskArrangementCompleted') && (
        <TaskHierarchySection 
          task={task}
          subTasks={task?.subTasks || []}
        />
      )}
      
      {(task?.waitingAnomalySummary || task?.interventionRequiredReason) && (
        <TaskWaitingAnomalySection 
          anomalySummary={task?.waitingAnomalySummary}
          interventionReason={task?.interventionRequiredReason}
          thresholdBasis={task?.waitingThresholdBasis}
        />
      )}
      
      {task?.reassessmentRequired && (
        <TaskReassessmentSection 
          reassessmentType={task?.reassessmentType}
          previousValue={task?.previousMarkerValue}
          newValue={task?.newMarkerValue}
        />
      )}
      
      <TaskStepsSection 
        steps={currentTaskSteps} 
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <TaskTimelineSection events={currentTaskEvents} />

      {currentTaskOutputs.length > 0 && (
        <TaskOutputSection outputs={currentTaskOutputs} />
      )}
      
      {task?.notifications && task.notifications.length > 0 && (
        <TaskNotificationSection notifications={task.notifications} />
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

  const getStatusClass = (status: string) => {
    if (status === 'completed' || status === 'TaskCompleted') return 'status-completed';
    if (status === 'failed' || status === 'TaskFailed') return 'status-failed';
    if (status === 'running' || status === 'TaskExecuting') return 'status-running';
    if (status === 'queued' || status === 'pending' || status === 'TaskQueued' || status === 'TaskPending') return 'status-pending';
    return 'status-default';
  };

  return (
    <div className="task-overview-section">
      <div className="overview-card">
        <div className="overview-row">
          <div className="overview-item">
            <span className="overview-label">任务状态</span>
            <span className={`status-badge ${getStatusClass(task.status)}`}>
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
            <span className="overview-value">{task.triggerDecisionSummary || task.intakeInputSummary || '-'}</span>
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
          {task.type && (
            <div className="overview-item">
              <span className="overview-label">任务类型</span>
              <span className="overview-value">{task.type === 'Leader' ? '父任务' : '子任务'}</span>
            </div>
          )}
          {task.targetAgentName && (
            <div className="overview-item">
              <span className="overview-label">目标Agent</span>
              <span className="overview-value">{task.targetAgentName}</span>
            </div>
          )}
        </div>
        
        {task.arrangementEta && (
          <div className="overview-row eta-row">
            <span className="overview-label">📊 ETA</span>
            <span className="overview-value eta-value">{task.arrangementEta}</span>
          </div>
        )}
      </div>

      {task.complexityDecisionSummary && (
        <div className="overview-card complexity-card">
          <div className="section-title">📋 复杂任务判定</div>
          <p>{task.complexityDecisionSummary}</p>
        </div>
      )}
    </div>
  );
}

interface TaskHierarchySectionProps {
  task?: any;
  subTasks: SubTask[];
}

function TaskHierarchySection({ task, subTasks }: TaskHierarchySectionProps) {
  if (!task || task.arrangementStatus !== 'TaskArrangementCompleted') return null;

  return (
    <div className="task-hierarchy-section">
      <div className="section-card">
        <div className="section-title">📋 子任务列表</div>
        <div className="subtask-list">
          {subTasks.map((subtask) => (
            <div key={subtask.id} className={`subtask-item ${subtask.blocking ? 'blocking' : ''}`}>
              <div className="subtask-status">
                {subtask.status === 'TaskStepCompleted' || subtask.status === 'completed' ? '✓' :
                 subtask.status === 'TaskStepRunning' || subtask.status === 'running' ? '●' :
                 subtask.status === 'TaskStepFailed' || subtask.status === 'failed' ? '✕' : '○'}
              </div>
              <div className="subtask-info">
                <div className="subtask-name">{subtask.name}</div>
                <div className="subtask-meta">
                  {subtask.agentName && <span className="subtask-agent">{subtask.agentName}</span>}
                  {subtask.queuePosition !== undefined && (
                    <span className="subtask-queue">队列: {subtask.queuePosition}</span>
                  )}
                  {subtask.blocking !== undefined && (
                    <span className={`subtask-blocking ${subtask.blocking ? 'blocking' : 'non-blocking'}`}>
                      {subtask.blocking ? '🔒 Blocking' : '🔓 Non-blocking'}
                    </span>
                  )}
                </div>
              </div>
              <div className="subtask-summary">{subtask.outputSummary || '-'}</div>
            </div>
          ))}
        </div>
        {task.arrangementEta && (
          <div className="arrangement-eta">
            <span className="eta-label">📊 预计完成时间:</span>
            <span className="eta-value">{task.arrangementEta}</span>
          </div>
        )}
      </div>
    </div>
  );
}

interface TaskWaitingAnomalySectionProps {
  anomalySummary?: string;
  interventionReason?: string;
  thresholdBasis?: string;
}

function TaskWaitingAnomalySection({ anomalySummary, interventionReason, thresholdBasis }: TaskWaitingAnomalySectionProps) {
  if (!anomalySummary && !interventionReason) return null;

  return (
    <div className="task-anomaly-section">
      <div className="section-card warning">
        <div className="section-title">
          {interventionReason ? '⚠️ 需人工介入' : '⚠️ 等待异常'}
        </div>
        {anomalySummary && <p className="anomaly-summary">{anomalySummary}</p>}
        {interventionReason && <p className="intervention-reason">{interventionReason}</p>}
        {thresholdBasis && (
          <div className="threshold-basis">
            <span className="basis-label">阈值依据:</span>
            <span className="basis-value">{thresholdBasis}</span>
          </div>
        )}
        <div className="anomaly-actions">
          <button className="btn btn-primary">查看详情</button>
          <button className="btn btn-secondary">执行建议动作</button>
        </div>
      </div>
    </div>
  );
}

interface TaskReassessmentSectionProps {
  reassessmentType?: string;
  previousValue?: string;
  newValue?: string;
}

function TaskReassessmentSection({ reassessmentType, previousValue, newValue }: TaskReassessmentSectionProps) {
  if (!reassessmentType) return null;

  return (
    <div className="task-reassessment-section">
      <div className="section-card info">
        <div className="section-title">🔄 标记变更 - 需重评估</div>
        <p className="reassessment-type">变更类型: {reassessmentType}</p>
        <div className="marker-change">
          <span className="marker-previous">{previousValue || '-'}</span>
          <span className="marker-arrow">→</span>
          <span className="marker-new">{newValue || '-'}</span>
        </div>
      </div>
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

      {activeTab === 'steps' && steps.length > 0 && (
        <div className="steps-progress">
          <div className="progress-line">
            {steps.map((step, index) => (
              <div key={step.id} className={`progress-step ${step.status}`}>
                <div className="step-dot">
                  {step.status === 'TaskStepCompleted' || step.status === 'completed' ? '✓' : 
                   step.status === 'TaskStepRunning' || step.status === 'running' ? '●' : 
                   step.status === 'TaskStepFailed' || step.status === 'failed' ? '✕' : index + 1}
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
            <div key={step.id} className={`step-item ${step.status}`}>
              <div className="step-icon">
                {step.status === 'TaskStepCompleted' || step.status === 'completed' ? '✓' : 
                 step.status === 'TaskStepRunning' || step.status === 'running' ? '●' : 
                 step.status === 'TaskStepFailed' || step.status === 'failed' ? '✕' : step.stepOrder}
              </div>
              <div className="step-info">
                <div className="step-name">{step.name}</div>
                <div className="step-status">{stepStatusLabels[step.status] || step.status}</div>
                {step.reasoningSummary && (
                  <div className="step-reasoning">推理: {step.reasoningSummary}</div>
                )}
                {step.actionSummary && (
                  <div className="step-action">动作: {step.actionSummary}</div>
                )}
                {step.observationSummary && (
                  <div className="step-observation">观察: {step.observationSummary}</div>
                )}
                {step.agentName && (
                  <div className="step-agent">Agent: {step.agentName}</div>
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

interface TaskNotificationSectionProps {
  notifications: Array<{
    stage: string;
    timestamp: string;
    content?: string;
  }>;
}

function TaskNotificationSection({ notifications }: TaskNotificationSectionProps) {
  return (
    <div className="task-notification-section">
      <h3>🔔 通知记录</h3>
      <div className="notification-list">
        {notifications.map((notification, idx) => (
          <div key={idx} className={`notification-item ${notification.stage}`}>
            <div className="notification-stage">
              {notification.stage === 'TaskArrangementCompleted' ? '📋 已安排完成' : 
               notification.stage === 'TaskCompleted' ? '✅ 最终完成' : notification.stage}
            </div>
            <div className="notification-time">
              {format(new Date(notification.timestamp), 'yyyy-MM-dd HH:mm:ss')}
            </div>
            {notification.content && <div className="notification-content">{notification.content}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default TaskDetail;
