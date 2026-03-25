import React, { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../stores/appStore';

const ChatView: React.FC = () => {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { createTask, tasks, fetchTasks } = useAppStore();

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

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
                         task.status === 'EXCEPTION' ? '#ff4d4f' : '#999' 
                }}>
                  {getStatusText(task.status)}
                </div>
                {task.outputSummary && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #eee' }}>
                    {task.outputSummary}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

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