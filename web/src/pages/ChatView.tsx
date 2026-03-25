import React, { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import { tasksApi } from '../api';

const ChatView: React.FC = () => {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [clarificationTask, setClarificationTask] = useState<any>(null);
  const [clarificationAnswer, setClarificationAnswer] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { createTask, tasks, fetchTasks } = useAppStore();

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    const pendingTask = tasks.find(t => t.status === 'CLARIFICATION_PENDING');
    setClarificationTask(pendingTask || null);
  }, [tasks]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [tasks]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    setIsLoading(true);
    try {
      await createTask(input);
      setInput('');
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClarificationSubmit = async () => {
    if (!clarificationTask || !clarificationAnswer.trim()) return;
    
    try {
      await tasksApi.clarify(clarificationTask.id);
      setClarificationTask(null);
      setClarificationAnswer('');
    } catch (error) {
      console.error('Failed to submit clarification:', error);
    }
  };

  const handleClarificationCancel = async () => {
    if (!clarificationTask) return;
    
    try {
      setClarificationTask(null);
      setClarificationAnswer('');
    } catch (error) {
      console.error('Failed to cancel clarification:', error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const getStatusText = (status: string) => {
    const statusMap: Record<string, string> = {
      WAITING_FOR_LEADER: '等待处理',
      CLARIFICATION_PENDING: '等待澄清',
      PARSING: '分析中',
      DISPATCHING: '分发中',
      QUEUED: '排队中',
      RUNNING: '执行中',
      AGGREGATING: '汇总中',
      COMPLETED: '已完成',
      EXCEPTION: '异常',
      TERMINATED: '已终止',
    };
    return statusMap[status] || status;
  };

  return (
    <div className="chat-container">
      <header className="chat-header">
        <h1>对话</h1>
      </header>
      
      <div className="chat-messages">
        {tasks.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#999', marginTop: 40 }}>
            <p>开始一个新对话吧</p>
          </div>
        ) : (
          tasks.map(task => (
            <div key={task.id} className="message">
              <div className="message-content">
                <div style={{ marginBottom: 8, fontWeight: 500 }}>
                  {JSON.parse(task.inputPayload).content || task.inputPayload}
                </div>
                <div style={{ 
                  fontSize: 12, 
                  color: task.status === 'COMPLETED' ? '#52c41a' : 
                         task.status === 'EXCEPTION' ? '#ff4d4f' : '#999',
                  marginBottom: 8
                }}>
                  {getStatusText(task.status)}
                </div>
                
                {task.status === 'RUNNING' && (
                  <div style={{ 
                    background: '#f5f5f5', 
                    padding: 12, 
                    borderRadius: 4,
                    marginTop: 8 
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 16 }}>🤔</span>
                      <span style={{ fontWeight: 500 }}>正在执行...</span>
                    </div>
                    <div style={{ fontSize: 12, color: '#666' }}>
                      Agent 正在处理您的请求
                    </div>
                  </div>
                )}

                {(task.status === 'PARSING' || task.status === 'DISPATCHING') && (
                  <div style={{ 
                    background: '#e6f7ff', 
                    padding: 12, 
                    borderRadius: 4,
                    marginTop: 8 
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 16 }}>📋</span>
                      <span>
                        {task.status === 'PARSING' ? '正在分析意图...' : '正在分发任务...'}
                      </span>
                    </div>
                  </div>
                )}

                {task.outputSummary && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #eee' }}>
                    <div style={{ marginBottom: 4, fontWeight: 500 }}>💡 结果:</div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{task.outputSummary}</div>
                  </div>
                )}
                
                {task.errorMsg && (
                  <div style={{ 
                    marginTop: 8, 
                    padding: 8, 
                    background: '#fff2f0', 
                    borderRadius: 4,
                    color: '#ff4d4f'
                  }}>
                    ❌ 错误: {task.errorMsg}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {clarificationTask && (
        <div style={{
          position: 'fixed',
          bottom: 100,
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#fff',
          border: '1px solid #1890ff',
          borderRadius: 8,
          padding: 16,
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          maxWidth: 500,
          width: '90%',
          zIndex: 1000,
        }}>
          <div style={{ fontWeight: 500, marginBottom: 8 }}>⚠️ 需要澄清</div>
          <div style={{ marginBottom: 12, color: '#666' }}>
            您的请求不够明确，请补充信息：
          </div>
          <textarea
            value={clarificationAnswer}
            onChange={(e) => setClarificationAnswer(e.target.value)}
            placeholder="请补充更多信息..."
            style={{
              width: '100%',
              minHeight: 80,
              padding: 8,
              border: '1px solid #ddd',
              borderRadius: 4,
              marginBottom: 12,
            }}
          />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button 
              className="btn" 
              onClick={handleClarificationCancel}
            >
              取消
            </button>
            <button 
              className="btn btn-primary" 
              onClick={handleClarificationSubmit}
              disabled={!clarificationAnswer.trim()}
            >
              提交
            </button>
          </div>
        </div>
      )}

      <div className="chat-input-container">
        <div className="chat-input-wrapper">
          <textarea
            className="chat-input"
            placeholder="输入指令或拖入文件..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
          />
          <button 
            className="send-button" 
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
          >
            {isLoading ? '发送中...' : '发送'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatView;