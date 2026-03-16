import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../stores/appStore';
import { format } from 'date-fns';

export function ChatArea() {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { messages, isLoading, sendMessage, currentTask, tasks } = useAppStore();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    await sendMessage(input);
    setInput('');
  };

  const latestTask = tasks.find(t => t.id === currentTask?.id);

  return (
    <div className="chat-page">
      <ConversationTaskStatusBar 
        task={latestTask} 
        onViewTask={(id) => navigate(`/tasks/${id}`)}
        onViewResult={(id) => navigate(`/results/${id}`)}
      />
      
      <ConversationMessagePanel 
        messages={messages}
        isLoading={isLoading}
        messagesEndRef={messagesEndRef}
      />
      
      <ConversationComposer 
        input={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        isLoading={isLoading}
      />
    </div>
  );
}

interface ConversationMessagePanelProps {
  messages: any[];
  isLoading: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement>;
}

export function ConversationMessagePanel({ messages, isLoading, messagesEndRef }: ConversationMessagePanelProps) {
  return (
    <div className="message-panel">
      <div className="message-list">
        {messages.length === 0 ? (
          <div className="empty-state">
            <h3>欢迎使用 BiosBot</h3>
            <p>输入您的任务需求，AI Agent 将为您处理</p>
            <div className="command-hints">
              <p>快捷指令：</p>
              <ul>
                <li>查看任务详情</li>
                <li>重试任务</li>
                <li>取消任务</li>
              </ul>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div className="message" key={msg.id}>
              <div className="message-avatar">
                {msg.role === 'user' ? '👤' : '🤖'}
              </div>
              <div className="message-content">
                <div className={`message-bubble ${msg.role === 'assistant' ? 'assistant' : ''}`}>
                  {msg.content}
                </div>
                <div className="message-time">
                  {format(new Date(msg.createdAt), 'HH:mm:ss')}
                </div>
              </div>
            </div>
          ))
        )}
        {isLoading && (
          <div className="loading">
            <div className="spinner"></div>
            <span>处理中...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}

interface ConversationComposerProps {
  input: string;
  onChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
}

export function ConversationComposer({ input, onChange, onSubmit, isLoading }: ConversationComposerProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit(e);
    }
  };

  return (
    <div className="composer">
      <form onSubmit={onSubmit}>
        <div className="composer-input-wrapper">
          <button type="button" className="btn-attachment" title="上传附件">
            📎
          </button>
          <textarea
            value={input}
            onChange={(e) => onChange(e.target.value)}
            placeholder="输入任务描述或快捷指令..."
            disabled={isLoading}
            onKeyDown={handleKeyDown}
            rows={1}
          />
          <button 
            type="submit" 
            className="btn-send"
            disabled={isLoading || !input.trim()}
          >
            ➤
          </button>
        </div>
      </form>
    </div>
  );
}

interface ConversationTaskStatusBarProps {
  task?: any;
  onViewTask: (taskId: string) => void;
  onViewResult: (taskId: string) => void;
}

export function ConversationTaskStatusBar({ task, onViewTask, onViewResult }: ConversationTaskStatusBarProps) {
  if (!task) return null;

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      pending: '等待中',
      queued: '排队中',
      running: '执行中',
      completed: '已完成',
      failed: '失败',
      cancelled: '已取消'
    };
    return labels[status] || status;
  };

  return (
    <div className="task-status-bar">
      <div className="status-info">
        <span className={`status-badge status-${task.status}`}>
          {getStatusLabel(task.status)}
        </span>
        <span className="task-id">#{task.id?.slice(0, 12)}</span>
      </div>
      <div className="status-actions">
        <button className="btn-link" onClick={() => onViewTask(task.id)}>
          查看详情
        </button>
        {task.status === 'completed' && (
          <button className="btn-link" onClick={() => onViewResult(task.id)}>
            查看结果
          </button>
        )}
      </div>
    </div>
  );
}

interface TaskActionCardProps {
  task: any;
  onViewTask: (taskId: string) => void;
  onViewResult: (taskId: string) => void;
  onRetry?: () => void;
  onCancel?: () => void;
}

export function TaskActionCard({ 
  task, 
  onViewTask, 
  onViewResult, 
  onRetry, 
  onCancel 
}: TaskActionCardProps) {
  return (
    <div className="task-action-card">
      <div className="card-header">
        <span className="card-title">任务信息</span>
        <span className="card-task-id">{task.id}</span>
      </div>
      <div className="card-body">
        <div className="info-row">
          <span className="info-label">状态:</span>
          <span className="info-value">{task.status}</span>
        </div>
        <div className="info-row">
          <span className="info-label">输入摘要:</span>
          <span className="info-value">{task.intakeInputSummary || '-'}</span>
        </div>
      </div>
      <div className="card-actions">
        <button className="btn-secondary" onClick={() => onViewTask(task.id)}>
          查看详情
        </button>
        {task.status === 'completed' && (
          <button className="btn-primary" onClick={() => onViewResult(task.id)}>
            查看结果
          </button>
        )}
        {task.status === 'failed' && onRetry && (
          <button className="btn-primary" onClick={onRetry}>
            重试
          </button>
        )}
        {(task.status === 'pending' || task.status === 'running' || task.status === 'queued') && onCancel && (
          <button className="btn-danger" onClick={onCancel}>
            取消
          </button>
        )}
      </div>
    </div>
  );
}

export default ChatArea;
