import { useNavigate } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../stores/appStore';
import { format } from 'date-fns';

const DEFAULT_VISIBLE_COUNT = 20;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const statusLabels: Record<string, string> = {
  pending: '等待中',
  TaskPending: '等待中',
  queued: '排队中',
  TaskQueued: '排队中',
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
  clarification_pending: '待澄清',
  intervention_required: '需人工介入'
};

function getStatusClass(status: string) {
  if (status === 'completed' || status === 'TaskCompleted' || status === 'arranged' || status === 'TaskArranged') {
    return 'status-completed';
  }

  if (status === 'failed' || status === 'TaskFailed' || status === 'intervention_required') {
    return 'status-failed';
  }

  if (status === 'running' || status === 'TaskExecuting' || status === 'planning' || status === 'TaskPlanning') {
    return 'status-running';
  }

  if (
    status === 'pending' ||
    status === 'TaskPending' ||
    status === 'queued' ||
    status === 'TaskQueued' ||
    status === 'clarification_pending'
  ) {
    return 'status-pending';
  }

  if (status === 'cancelled' || status === 'TaskCancelled') {
    return 'status-cancelled';
  }

  return 'status-default';
}

export function TaskList() {
  const navigate = useNavigate();
  const { tasks, isLoading, fetchTasks } = useAppStore();
  const [searchKeyword, setSearchKeyword] = useState('');
  const [visibleCount, setVisibleCount] = useState(DEFAULT_VISIBLE_COUNT);

  const sortedTasks = useMemo(() => {
    return [...tasks].sort((left, right) => {
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    });
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    if (!keyword) {
      return sortedTasks;
    }

    return sortedTasks.filter((task) => {
      const candidates = [
        task.id,
        statusLabels[task.status] || task.status,
        task.intakeInputSummary || '',
        task.triggerDecisionSummary || '',
        task.triggerMode || '',
        task.complexity || ''
      ].join(' ').toLowerCase();

      return candidates.includes(keyword);
    });
  }, [sortedTasks, searchKeyword]);

  const visibleTasks = filteredTasks.slice(0, visibleCount);
  const hasMore = visibleCount < filteredTasks.length;
  const normalizedKeyword = searchKeyword.trim().toLowerCase();

  const highlightText = (value: string) => {
    if (!normalizedKeyword || !value) {
      return value;
    }

    const pattern = new RegExp(`(${escapeRegExp(normalizedKeyword)})`, 'ig');
    const parts = value.split(pattern);
    if (parts.length === 1) {
      return value;
    }

    return parts.map((part, index) => {
      if (part.toLowerCase() === normalizedKeyword) {
        return (
          <mark key={`${part}-${index}`} className="task-highlight">
            {part}
          </mark>
        );
      }
      return <span key={`${part}-${index}`}>{part}</span>;
    });
  };

  useEffect(() => {
    void fetchTasks({ silent: true });

    const timer = window.setInterval(() => {
      void fetchTasks({ silent: true });
    }, 3000);

    return () => window.clearInterval(timer);
  }, [fetchTasks]);

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchKeyword(event.target.value);
    setVisibleCount(DEFAULT_VISIBLE_COUNT);
  };

  const handleLoadMore = () => {
    setVisibleCount((current) => current + DEFAULT_VISIBLE_COUNT);
  };

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
      </div>

      <div className="task-list-content">
        <div className="task-list-toolbar">
          <input
            className="search-input"
            type="text"
            placeholder="搜索任务（ID / 摘要 / 状态 / 触发模式 / 复杂度）"
            value={searchKeyword}
            onChange={handleSearchChange}
          />
          <span className="task-list-counter">已显示 {Math.min(visibleTasks.length, filteredTasks.length)} / {filteredTasks.length}</span>
        </div>

        <div className="task-list task-list-scroll">
          {filteredTasks.length === 0 ? (
            <div className="empty-state">
              <h3>{searchKeyword.trim() ? '未匹配到任务' : '暂无任务'}</h3>
              <p>{searchKeyword.trim() ? '请尝试更换关键词' : '在对话中输入任务需求，系统将为您创建任务'}</p>
            </div>
          ) : (
            visibleTasks.map((task) => (
              <div
                key={task.id}
                className="task-item"
                onClick={() => navigate(`/tasks/${task.id}`)}
              >
                <div className="task-item-header">
                  <span className={`status-badge ${getStatusClass(task.status)}`}>
                    {highlightText(statusLabels[task.status] || task.status)}
                  </span>
                  <span className="task-id">#{highlightText(task.id?.slice(0, 12) || '')}</span>
                </div>
                <div className="task-item-summary">
                  {highlightText(task.intakeInputSummary?.substring(0, 100) || task.triggerDecisionSummary?.substring(0, 100) || '任务')}
                </div>
                <div className="task-item-meta">
                  <span>触发模式: {highlightText(task.triggerMode)}</span>
                  <span>复杂度: {highlightText(task.complexity)}</span>
                  <span>{format(new Date(task.createdAt), 'yyyy-MM-dd HH:mm')}</span>
                </div>
              </div>
            ))
          )}
        </div>

        {hasMore && (
          <div className="task-list-footer">
            <button className="btn btn-secondary" onClick={handleLoadMore}>
              加载更多（20）
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default TaskList;
