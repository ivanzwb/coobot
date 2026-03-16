import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../stores/appStore';
import { format } from 'date-fns';

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

export function TaskList() {
  const navigate = useNavigate();
  const { tasks, isLoading, fetchTasks } = useAppStore();

  if (isLoading && tasks.length === 0) {
    return (
      <div className="task-list-page">
        <div className="loading">
          <div className="spinner"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="task-list-page">
      <div className="page-header">
        <h2>任务列表</h2>
        <button className="btn btn-secondary" onClick={() => fetchTasks()}>
          刷新
        </button>
      </div>
      
      <div className="task-list">
        {tasks.length === 0 ? (
          <div className="empty-state">
            <h3>暂无任务</h3>
            <p>在对话中输入任务需求，系统将为您创建任务</p>
          </div>
        ) : (
          tasks.map((task) => (
            <div 
              key={task.id} 
              className="task-item"
              onClick={() => navigate(`/tasks/${task.id}`)}
            >
              <div className="task-item-header">
                <span className={`status-badge status-${task.status}`}>
                  {statusLabels[task.status] || task.status}
                </span>
                <span className="task-id">#{task.id?.slice(0, 12)}</span>
              </div>
              <div className="task-item-summary">
                {task.intakeInputSummary?.substring(0, 100) || task.triggerDecisionSummary?.substring(0, 100) || '任务'}
              </div>
              <div className="task-item-meta">
                <span>触发模式: {task.triggerMode}</span>
                <span>复杂度: {task.complexity}</span>
                <span>{format(new Date(task.createdAt), 'yyyy-MM-dd HH:mm')}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default TaskList;
