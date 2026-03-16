import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore, Message, Task, TaskStep } from '../stores/appStore';
import { format } from 'date-fns';

interface Attachment {
  id: string;
  type: 'image' | 'file';
  name: string;
  url: string;
  preview?: string;
}

export function ChatArea() {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<Array<{ type: string; name: string; url: string }>>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { messages, isLoading, sendMessage, currentTask, tasks, currentTaskSteps } = useAppStore();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((!input.trim() && attachments.length === 0) || isLoading) return;
    await sendMessage(input, attachments.length > 0 ? attachments : undefined);
    setInput('');
    setAttachments([]);
  };

  const latestTask = tasks.find(t => t.id === currentTask?.id);

  return (
    <div className="chat-page">
      {latestTask && (
        <ConversationTaskStatusBar 
          task={latestTask} 
          steps={currentTaskSteps}
          onViewTask={(id) => navigate(`/tasks/${id}`)}
          onViewResult={(id) => navigate(`/results/${id}`)}
        />
      )}
      
      <ConversationMessagePanel 
        messages={messages}
        tasks={tasks}
        isLoading={isLoading}
        messagesEndRef={messagesEndRef}
        onViewTask={(id) => navigate(`/tasks/${id}`)}
        onViewResult={(id) => navigate(`/results/${id}`)}
      />
      
      <ConversationComposer 
        input={input}
        attachments={attachments}
        onChange={setInput}
        onAttachmentsChange={setAttachments}
        onSubmit={handleSubmit}
        isLoading={isLoading}
      />
    </div>
  );
}

interface ConversationMessagePanelProps {
  messages: Message[];
  tasks: Task[];
  isLoading: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement>;
  onViewTask: (taskId: string) => void;
  onViewResult: (taskId: string) => void;
}

export function ConversationMessagePanel({ 
  messages, 
  tasks, 
  isLoading, 
  messagesEndRef,
  onViewTask,
  onViewResult 
}: ConversationMessagePanelProps) {
  const renderTaskCard = (task: Task) => {
    if (task.complexityDecisionSummary) {
      return (
        <div className="message-card complex-task-card">
          <div className="card-icon">🤖</div>
          <div className="card-content">
            <div className="card-title">复杂任务判定</div>
            <div className="card-summary">{task.complexityDecisionSummary}</div>
            <button className="btn-link" onClick={() => onViewTask(task.id)}>
              查看详情
            </button>
          </div>
        </div>
      );
    }

    if (task.arrangementStatus === 'TaskArrangementCompleted') {
      return (
        <div className="message-card arranged-card">
          <div className="card-icon">✅</div>
          <div className="card-content">
            <div className="card-title">任务已安排好</div>
            <div className="card-summary">
              父任务: {task.intakeInputSummary || '任务'}
            </div>
            {task.arrangementEta && (
              <div className="card-eta">📊 ETA: {task.arrangementEta}</div>
            )}
            <button className="btn-link" onClick={() => onViewTask(task.id)}>
              查看详情
            </button>
          </div>
        </div>
      );
    }

    if (task.status === 'running' || task.status === 'TaskExecuting') {
      return (
        <div className="message-card running-card">
          <div className="card-icon">🔄</div>
          <div className="card-content">
            <div className="card-title">任务执行中</div>
            <div className="card-progress">
              <div className="progress-bar">
                <div className="progress-fill" style={{ width: '60%' }}></div>
              </div>
              <span className="progress-text">60%</span>
            </div>
            <button className="btn-link" onClick={() => onViewTask(task.id)}>
              查看详情
            </button>
          </div>
        </div>
      );
    }

    if (task.status === 'failed') {
      return (
        <div className="message-card failed-card">
          <div className="card-icon">❌</div>
          <div className="card-content">
            <div className="card-title">任务执行失败</div>
            <div className="card-summary">{task.intakeInputSummary || '-'}</div>
            <div className="card-actions">
              <button className="btn-secondary" onClick={() => onViewTask(task.id)}>
                查看详情
              </button>
              <button className="btn-primary" onClick={() => onViewResult(task.id)}>
                查看结果摘要
              </button>
            </div>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="message-panel">
      <div className="message-list">
        {messages.length === 0 ? (
          <div className="empty-state">
            <h3>欢迎使用 BiosBot</h3>
            <p>请问有什么可以为你效劳的</p>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <div className="message" key={msg.id}>
                <div className="message-avatar">
                  {msg.role === 'user' ? '👤' : '🤖'}
                </div>
                <div className="message-content">
                  <div className={`message-bubble ${msg.role === 'assistant' ? 'assistant' : ''}`}>
                    {msg.content}
                  </div>
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="message-attachments">
                      {msg.attachments.map((att, idx) => (
                        <div key={idx} className="message-attachment">
                          {att.type === 'image' ? (
                            <img src={att.url} alt={att.id} className="attachment-img" />
                          ) : (
                            <div className="attachment-file">
                              <span className="file-icon">📎</span>
                              <span className="file-name">{att.id}</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="message-time">
                    {format(new Date(msg.createdAt), 'HH:mm:ss')}
                  </div>
                </div>
              </div>
            ))}
            
            {tasks.filter(t => t.complexityDecisionSummary || 
              t.arrangementStatus === 'TaskArrangementCompleted' || 
              t.status === 'running' || 
              t.status === 'TaskExecuting' ||
              t.status === 'failed'
            ).map((task) => (
              <div className="message" key={task.id}>
                {renderTaskCard(task)}
              </div>
            ))}
          </>
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
  attachments: Array<{ type: string; name: string; url: string }>;
  onChange: (value: string) => void;
  onAttachmentsChange: (attachments: Array<{ type: string; name: string; url: string }>) => void;
  onSubmit: (e: React.FormEvent) => void;
  isLoading: boolean;
}

export function ConversationComposer({ 
  input, 
  attachments: propAttachments,
  onChange, 
  onAttachmentsChange,
  onSubmit, 
  isLoading 
}: ConversationComposerProps) {
  const [localAttachments, setLocalAttachments] = useState<Attachment[]>(
    (propAttachments || []).map(a => ({ 
      ...a, 
      id: a.name, 
      type: (a.type === 'image' ? 'image' : 'file') as 'image' | 'file',
      preview: a.type === 'image' ? a.url : undefined 
    }))
  );
  const [isDragging, setIsDragging] = useState(false);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (propAttachments.length === 0 && localAttachments.length > 0) {
      localAttachments.forEach(att => {
        if (att.url) URL.revokeObjectURL(att.url);
        if (att.preview) URL.revokeObjectURL(att.preview);
      });
      setLocalAttachments([]);
    }
  }, [propAttachments]);

  const attachments = propAttachments.length > 0 
    ? propAttachments.map(a => ({ ...a, id: a.name, preview: a.type === 'image' ? a.url : undefined }))
    : localAttachments;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit(e);
    }
  };

  const handleFileSelect = (files: FileList | null) => {
    if (!files) return;
    
    const newAttachments: Attachment[] = [];
    
    Array.from(files).forEach((file) => {
      const isImage = file.type.startsWith('image/');
      const attachment: Attachment = {
        id: `att-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: isImage ? 'image' : 'file',
        name: file.name,
        url: URL.createObjectURL(file),
        preview: isImage ? URL.createObjectURL(file) : undefined
      };
      newAttachments.push(attachment);
    });
    
    const newAtts = [...localAttachments, ...newAttachments];
    setLocalAttachments(newAtts);
    onAttachmentsChange(newAtts.map(a => ({ type: a.type, name: a.name, url: a.url })));
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileSelect(e.target.files);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleImageInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    handleFileSelect(e.target.files);
    if (imageInputRef.current) {
      imageInputRef.current.value = '';
    }
  };

  const handleRemoveAttachment = (id: string) => {
    const newLocal = localAttachments.filter(a => a.id !== id);
    setLocalAttachments(newLocal);
    onAttachmentsChange(newLocal.map(a => ({ type: a.type, name: a.name, url: a.url })));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const files: File[] = [];
    
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) files.push(file);
      }
    }
    
    if (files.length > 0) {
      const dataTransfer = new DataTransfer();
      files.forEach(f => dataTransfer.items.add(f));
      handleFileSelect(dataTransfer.files);
    }
  };

  const canSubmit = (input.trim() || attachments.length > 0) && !isLoading;

  const handleSubmit = (e: React.FormEvent) => {
    if (!canSubmit) return;
    
    const formData = new FormData();
    formData.append('message', input);
    attachments.forEach(att => {
      if (att.type === 'image') {
        formData.append('images', att.url);
      } else {
        formData.append('files', att.url);
      }
    });
    
    onSubmit(e);
  };

  return (
    <div 
      className={`composer ${isDragging ? 'dragging' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="drop-overlay">
          <div className="drop-message">
            <span className="drop-icon">📥</span>
            <span>拖放文件到此处上传</span>
          </div>
        </div>
      )}
      
      {attachments.length > 0 && (
        <div className="attachment-preview-list">
          {attachments.map((att) => (
            <div key={att.id} className="attachment-preview-item">
              {att.type === 'image' && att.preview ? (
                <img src={att.preview} alt={att.name} className="attachment-image-preview" />
              ) : (
                <div className="attachment-file-preview">
                  <span className="file-icon">📄</span>
                  <span className="file-name">{att.name}</span>
                </div>
              )}
              <button 
                type="button" 
                className="attachment-remove"
                onClick={() => handleRemoveAttachment(att.id)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      
      <form onSubmit={handleSubmit}>
        <div className="composer-input-wrapper">
          <div className="attachment-buttons">
            <button 
              type="button" 
              className="btn-attachment" 
              title="上传图片"
              onClick={() => imageInputRef.current?.click()}
            >
              📷
            </button>
            <button 
              type="button" 
              className="btn-attachment" 
              title="上传附件"
              onClick={() => fileInputRef.current?.click()}
            >
              📎
            </button>
            <button 
              type="button" 
              className="btn-attachment" 
              title="更多"
              onClick={() => setShowAttachmentMenu(!showAttachmentMenu)}
            >
              ➕
            </button>
            
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageInputChange}
              style={{ display: 'none' }}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.doc,.docx,.txt,.md,.xlsx,.xls,.ppt,.pptx"
              multiple
              onChange={handleFileInputChange}
              style={{ display: 'none' }}
            />
          </div>
          
          <textarea
            value={input}
            onChange={(e) => onChange(e.target.value)}
            placeholder="输入任务描述或快捷指令..."
            disabled={isLoading}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            rows={1}
          />
          <button 
            type="submit" 
            className="btn-send"
            disabled={!canSubmit}
          >
            ➤
          </button>
        </div>
      </form>
    </div>
  );
}

interface ConversationTaskStatusBarProps {
  task: Task;
  steps: TaskStep[];
  onViewTask: (taskId: string) => void;
  onViewResult: (taskId: string) => void;
}

export function ConversationTaskStatusBar({ task, steps, onViewTask, onViewResult }: ConversationTaskStatusBarProps) {
  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      pending: '等待中',
      queued: '排队中',
      scheduled: '定时等待',
      event_triggered: '事件等待',
      clarification_pending: '待澄清',
      running: '执行中',
      TaskExecuting: '执行中',
      TaskArrangementCompleted: '已安排',
      completed: '已完成',
      failed: '失败',
      cancelled: '已取消',
      TaskFailed: '失败',
      intervention_required: '需人工介入'
    };
    return labels[status] || status;
  };

  const getStatusClass = (status: string) => {
    if (status === 'completed' || status === 'TaskArrangementCompleted') return 'status-completed';
    if (status === 'failed' || status === 'TaskFailed') return 'status-failed';
    if (status === 'running' || status === 'TaskExecuting') return 'status-running';
    if (status === 'queued' || status === 'pending') return 'status-pending';
    if (status === 'clarification_pending') return 'status-pending';
    if (status === 'intervention_required') return 'status-failed';
    return 'status-default';
  };

  if (task.arrangementStatus === 'TaskArrangementCompleted') {
    return (
      <div className="task-status-bar arranged">
        <div className="status-info">
          <span className={`status-badge ${getStatusClass(task.arrangementStatus)}`}>
            已安排完成
          </span>
          <span className="task-id">#{task.id?.slice(0, 12)}</span>
        </div>
        {task.arrangementEta && (
          <div className="eta-info">📊 ETA: {task.arrangementEta}</div>
        )}
        <div className="status-actions">
          <button className="btn-link" onClick={() => onViewTask(task.id)}>
            查看详情
          </button>
          <button className="btn-link" onClick={() => onViewResult(task.id)}>
            查看结果
          </button>
        </div>
      </div>
    );
  }

  if (task.status === 'running' || task.status === 'TaskExecuting') {
    const currentStep = steps.find(s => s.status === 'running' || s.status === 'TaskStepExecuting');
    const completedSteps = steps.filter(s => s.status === 'completed' || s.status === 'TaskStepCompleted').length;
    const progress = steps.length > 0 ? Math.round((completedSteps / steps.length) * 100) : 0;

    return (
      <div className="task-status-bar running">
        <div className="status-info">
          <span className={`status-badge ${getStatusClass(task.status)}`}>
            {getStatusLabel(task.status)}
          </span>
          <span className="task-id">#{task.id?.slice(0, 12)}</span>
        </div>
        <div className="progress-info">
          {currentStep && <span className="current-step">步骤{currentStep.stepOrder}: {currentStep.name}</span>}
          <div className="progress-bar-small">
            <div className="progress-fill" style={{ width: `${progress}%` }}></div>
          </div>
          <span className="progress-text">{progress}%</span>
        </div>
        <div className="status-actions">
          <button className="btn-link" onClick={() => onViewTask(task.id)}>
            查看详情
          </button>
        </div>
      </div>
    );
  }

  if (task.status === 'failed' || task.status === 'TaskFailed') {
    return (
      <div className="task-status-bar failed">
        <div className="status-info">
          <span className={`status-badge ${getStatusClass(task.status)}`}>
            {getStatusLabel(task.status)}
          </span>
          <span className="task-id">#{task.id?.slice(0, 12)}</span>
        </div>
        <div className="status-actions">
          <button className="btn-link" onClick={() => onViewTask(task.id)}>
            查看详情
          </button>
          <button className="btn-link" onClick={() => onViewResult(task.id)}>
            查看结果摘要
          </button>
        </div>
      </div>
    );
  }

  if (task.waitingAnomalySummary || task.interventionRequiredReason) {
    return (
      <div className="task-status-bar warning">
        <div className="status-info">
          <span className="status-badge status-failed">
            {task.interventionRequiredReason ? '需人工介入' : '等待异常'}
          </span>
          <span className="task-id">#{task.id?.slice(0, 12)}</span>
        </div>
        <div className="status-summary">
          {task.waitingAnomalySummary || task.interventionRequiredReason}
        </div>
        <div className="status-actions">
          <button className="btn-link" onClick={() => onViewTask(task.id)}>
            查看详情
          </button>
        </div>
      </div>
    );
  }

  return null;
}

export default ChatArea;
