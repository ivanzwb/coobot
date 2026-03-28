import React, { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import { tasksApi, chatApi, type ChatMessage } from '../api';
import { useWebSocket, useTaskEvents } from '../hooks/useWebSocket';

const ChatView: React.FC = () => {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [clarificationTask, setClarificationTask] = useState<any>(null);
  const [clarificationQuestions, setClarificationQuestions] = useState<string[]>([]);
  const [clarificationAnswer, setClarificationAnswer] = useState('');
  const [isClarificationSubmitting, setIsClarificationSubmitting] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { createTask, tasks, fetchTasks } = useAppStore();
  useWebSocket();
  const { lastMessage } = useTaskEvents();

  const fetchChatHistory = async () => {
    try {
      const response = await chatApi.getHistory(50, 0);
      setChatHistory(response.data.filter(m => m.role === 'user' && !m.isArchived));
    } catch (error) {
      console.error('Failed to fetch chat history:', error);
    }
  };

  useEffect(() => {
    if (!lastMessage) return;

    const { type, data } = lastMessage as { type: string; data: any };

    if (type === 'clarification_needed') {
      setClarificationQuestions(data.questions || []);
      fetchTasks();
      fetchChatHistory();
    } else if (type === 'task_status_changed') {
      fetchTasks();
      fetchChatHistory();
    } else if (type === 'task_completed') {
      fetchTasks();
      fetchChatHistory();
    } else if (type === 'task_failed') {
      fetchTasks();
      fetchChatHistory();
    }
  }, [lastMessage, fetchTasks]);

  useEffect(() => {
    if (isClarificationSubmitting) return;
    const pendingTask = tasks.find(t => t.status === 'CLARIFICATION_PENDING');
    if (pendingTask && !clarificationTask) {
      setClarificationTask(pendingTask);
    }
  }, [tasks, clarificationTask, isClarificationSubmitting]);

  useEffect(() => {
    fetchTasks();
    fetchChatHistory();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [tasks, chatHistory]);

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getTaskById = (taskId: string | null) => {
    if (!taskId) return null;
    return tasks.find(t => t.id === taskId) || null;
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    setIsLoading(true);
    try {
      await chatApi.send({ content: input });
      setInput('');
      fetchChatHistory();
      fetchTasks();
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClarificationSubmit = async () => {
    if (!clarificationTask || !clarificationAnswer.trim() || isClarificationSubmitting) return;

    setIsClarificationSubmitting(true);
    try {
      await tasksApi.clarify(clarificationTask.id, { content: clarificationAnswer });
      setClarificationTask(null);
      setClarificationAnswer('');
      setClarificationQuestions([]);
    } catch (error) {
      console.error('Failed to submit clarification:', error);
    } finally {
      setIsClarificationSubmitting(false);
    }
  };

  const handleClarificationCancel = async () => {
    if (!clarificationTask) return;

    setIsClarificationSubmitting(true);
    try {
      setClarificationTask(null);
      setClarificationAnswer('');
      setClarificationQuestions([]);
    } catch (error) {
      console.error('Failed to cancel clarification:', error);
    } finally {
      setIsClarificationSubmitting(false);
    }
  };

  const handleRetry = async (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) {
      console.log('[handleRetry] Task not found:', taskId);
      return;
    }

    console.log('[handleRetry] Retrying task:', taskId);

    try {
      const inputPayload = JSON.parse(task.inputPayload);
      const content = inputPayload.content || inputPayload.description || task.inputPayload;
      console.log('[handleRetry] Content:', content);
      await chatApi.send({ content });
      fetchTasks();
      fetchChatHistory();
    } catch (error) {
      console.error('[handleRetry] Failed to retry task:', error);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleExport = async (format: 'markdown' | 'txt') => {
    try {
      const res = await chatApi.exportChat({ format, includeArchived: false });
      const blob = res.data as Blob;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat_export_${Date.now()}.${format === 'markdown' ? 'md' : 'txt'}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export failed:', e);
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
      <header className="chat-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>对话</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-sm" onClick={() => handleExport('markdown')}>导出 Markdown</button>
          <button type="button" className="btn btn-sm" onClick={() => handleExport('txt')}>导出 TXT</button>
        </div>
      </header>

      <div className="chat-messages">
        {chatHistory.length === 0 && tasks.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#999', marginTop: 40 }}>
            <p>开始一个新对话吧</p>
          </div>
        ) : (
          chatHistory.map(chatMsg => {
            const task = getTaskById(chatMsg.taskId);
            return (
              <div key={chatMsg.id} className="message">
                <div className="message-content">
                  <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>
                    {formatTime(chatMsg.timestamp)}
                  </div>
                  <div style={{ marginBottom: 8, fontWeight: 500 }}>
                    {chatMsg.content}
                  </div>
                  {task && (
                    <>
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
                          <div>❌ 错误: {task.errorMsg}</div>
                          <button
                            className="btn btn-sm"
                            style={{ marginTop: 8 }}
                            onClick={() => handleRetry(task.id)}
                          >
                            重试
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })
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
          {clarificationQuestions.length > 0 ? (
            <div style={{ marginBottom: 12, color: '#666' }}>
              {clarificationQuestions.map((q, i) => (
                <div key={i} style={{ marginBottom: 8 }}>• {q}</div>
              ))}
            </div>
          ) : (
            <div style={{ marginBottom: 12, color: '#666' }}>
              您的请求不够明确，请补充信息：
            </div>
          )}
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