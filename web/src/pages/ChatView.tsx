import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useAppStore } from '../stores/appStore';
import { tasksApi, chatApi, authApi, type ChatMessage } from '../api';
import { useWebSocket, useTaskEvents, useAuthRequests, type AuthRequestPayload } from '../hooks/useWebSocket';

const ChatView: React.FC = () => {
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { tasks, fetchTasks } = useAppStore();
  useWebSocket();
  const { lastMessage } = useTaskEvents();

  const authQueueRef = useRef<AuthRequestPayload[]>([]);
  const [authPrompt, setAuthPrompt] = useState<AuthRequestPayload | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  const enqueueAuth = useCallback((p: AuthRequestPayload) => {
    setAuthPrompt((current) => {
      if (current) {
        authQueueRef.current.push(p);
        return current;
      }
      return p;
    });
  }, []);

  useAuthRequests(enqueueAuth);

  const showNextAuth = () => {
    const next = authQueueRef.current.shift();
    setAuthPrompt(next ?? null);
  };

  const handleAuthDecision = async (allow: boolean) => {
    if (!authPrompt || authBusy) return;
    setAuthBusy(true);
    try {
      await authApi.submitDecision({ authId: authPrompt.authId, allow });
      showNextAuth();
      fetchTasks();
    } catch (e: unknown) {
      console.error('Auth decision failed:', e);
      const msg =
        typeof e === 'object' && e !== null && 'response' in e
          ? String((e as { response?: { data?: { error?: string } } }).response?.data?.error)
          : e instanceof Error
            ? e.message
            : '授权提交失败';
      alert(msg);
    } finally {
      setAuthBusy(false);
    }
  };

  const clarificationPendingTask = useMemo(() => {
    const pending = tasks.filter((t) => t.status === 'CLARIFICATION_PENDING');
    if (pending.length === 0) return null;
    return pending.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )[0];
  }, [tasks]);

  const fetchChatHistory = async () => {
    try {
      const response = await chatApi.getHistory(50, 0);
      setChatHistory(
        response.data.filter((m) => ['user', 'system', 'assistant'].includes(m.role) && !m.isArchived)
      );
    } catch (error) {
      console.error('Failed to fetch chat history:', error);
    }
  };

  useEffect(() => {
    if (!lastMessage) return;

    const { type } = lastMessage as { type: string };

    if (
      type === 'clarification_needed' ||
      type === 'task_status_changed' ||
      type === 'task_completed' ||
      type === 'task_failed'
    ) {
      fetchTasks();
      fetchChatHistory();
    }
  }, [lastMessage, fetchTasks]);

  useEffect(() => {
    fetchTasks();
    fetchChatHistory();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [tasks, chatHistory, authPrompt]);

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getTaskById = (taskId: string | null) => {
    if (!taskId) return null;
    return tasks.find((t) => t.id === taskId) || null;
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    setIsLoading(true);
    try {
      if (clarificationPendingTask) {
        await tasksApi.clarify(clarificationPendingTask.id, {
          clarificationReply: input.trim(),
        });
      } else {
        await chatApi.send({ content: input });
      }
      setInput('');
      fetchChatHistory();
      fetchTasks();
    } catch (error) {
      console.error('Failed to send message:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRetry = async (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) {
      console.log('[handleRetry] Task not found:', taskId);
      return;
    }

    try {
      const inputPayload = JSON.parse(task.inputPayload);
      const content = inputPayload.content || inputPayload.description || task.inputPayload;
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

  const roleStyle = (role: string) => {
    if (role === 'system') {
      return {
        label: '系统',
        bubbleBg: '#f0f5ff',
        border: '1px solid #adc6ff',
        labelColor: '#2f54eb',
      };
    }
    if (role === 'assistant') {
      return {
        label: '助手',
        bubbleBg: '#f6ffed',
        border: '1px solid #b7eb8f',
        labelColor: '#389e0d',
      };
    }
    return {
      label: '你',
      bubbleBg: '#fff',
      border: '1px solid #eee',
      labelColor: '#666',
    };
  };

  return (
    <div className="chat-container">
      <header
        className="chat-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <h1 style={{ margin: 0 }}>对话</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-sm" onClick={() => handleExport('markdown')}>
            导出 Markdown
          </button>
          <button type="button" className="btn btn-sm" onClick={() => handleExport('txt')}>
            导出 TXT
          </button>
        </div>
      </header>

      <div className="chat-messages">
        {chatHistory.length === 0 && tasks.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#999', marginTop: 40 }}>
            <p>开始一个新对话吧</p>
          </div>
        ) : (
          chatHistory.map((chatMsg) => {
            const st = roleStyle(chatMsg.role);
            const task = chatMsg.role === 'user' ? getTaskById(chatMsg.taskId) : null;
            return (
              <div key={chatMsg.id} className="message">
                <div
                  className="message-content"
                  style={{
                    background: st.bubbleBg,
                    border: st.border,
                    borderRadius: 8,
                    padding: 12,
                    marginBottom: 8,
                  }}
                >
                  <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>
                    <span style={{ color: st.labelColor, fontWeight: 600, marginRight: 8 }}>{st.label}</span>
                    {formatTime(chatMsg.timestamp)}
                  </div>
                  <div style={{ marginBottom: 8, whiteSpace: 'pre-wrap' }}>{chatMsg.content}</div>
                  {task && (
                    <>
                      <div
                        style={{
                          fontSize: 12,
                          color:
                            task.status === 'COMPLETED'
                              ? '#52c41a'
                              : task.status === 'EXCEPTION'
                                ? '#ff4d4f'
                                : '#999',
                          marginBottom: 8,
                        }}
                      >
                        {getStatusText(task.status)}
                      </div>

                      {task.status === 'RUNNING' && (
                        <div
                          style={{
                            background: '#f5f5f5',
                            padding: 12,
                            borderRadius: 4,
                            marginTop: 8,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <span style={{ fontSize: 16 }}>🤔</span>
                            <span style={{ fontWeight: 500 }}>正在执行...</span>
                          </div>
                          <div style={{ fontSize: 12, color: '#666' }}>Agent 正在处理您的请求</div>
                        </div>
                      )}

                      {(task.status === 'PARSING' || task.status === 'DISPATCHING') && (
                        <div
                          style={{
                            background: '#e6f7ff',
                            padding: 12,
                            borderRadius: 4,
                            marginTop: 8,
                          }}
                        >
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
                        <div
                          style={{
                            marginTop: 8,
                            padding: 8,
                            background: '#fff2f0',
                            borderRadius: 4,
                            color: '#ff4d4f',
                          }}
                        >
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

        {authPrompt && (
          <div className="message" style={{ marginBottom: 12 }}>
            <div
              className="message-content"
              style={{
                background: '#fffbe6',
                border: '1px solid #ffe58f',
                borderRadius: 8,
                padding: 14,
              }}
              role="region"
              aria-label="工具执行授权"
            >
              <div style={{ fontSize: 12, color: '#ad6800', marginBottom: 8, fontWeight: 600 }}>
                系统 · 需要您授权
              </div>
              <div style={{ fontSize: 13, color: '#614700', marginBottom: 10 }}>
                Agent 请求执行下列工具（策略为询问），请在本对话中直接选择是否允许本次调用。
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: '#8c6e00', marginBottom: 4 }}>工具名</div>
                <code
                  style={{
                    display: 'block',
                    padding: '6px 8px',
                    background: 'rgba(255,255,255,0.7)',
                    borderRadius: 4,
                    fontSize: 12,
                    wordBreak: 'break-all',
                  }}
                >
                  {authPrompt.toolName || authPrompt.tool}
                </code>
              </div>
              {authPrompt.taskId && (
                <div style={{ marginBottom: 10, fontSize: 12, color: '#614700' }}>
                  任务 ID：<code>{authPrompt.taskId}</code>
                </div>
              )}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: '#8c6e00', marginBottom: 4 }}>参数（已脱敏）</div>
                <pre
                  style={{
                    margin: 0,
                    padding: 8,
                    background: 'rgba(255,255,255,0.7)',
                    borderRadius: 4,
                    fontSize: 11,
                    maxHeight: 160,
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {JSON.stringify(authPrompt.args ?? {}, null, 2)}
                </pre>
              </div>
              <div style={{ fontSize: 11, color: '#8c6e00', marginBottom: 12 }}>
                截止时间：{authPrompt.expiresAt}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={authBusy}
                  onClick={() => handleAuthDecision(false)}
                >
                  拒绝
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={authBusy}
                  onClick={() => handleAuthDecision(true)}
                >
                  {authBusy ? '提交中…' : '允许'}
                </button>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-container">
        {clarificationPendingTask && (
          <div
            style={{
              fontSize: 13,
              color: '#2f54eb',
              marginBottom: 8,
              padding: '8px 12px',
              background: '#f0f5ff',
              borderRadius: 6,
            }}
          >
            当前任务需要澄清：请直接在输入框中回复补充说明（将作为同一条对话继续）。
          </div>
        )}
        <div className="chat-input-wrapper">
          <textarea
            className="chat-input"
            placeholder={
              clarificationPendingTask ? '输入补充说明，按 Enter 发送…' : '输入指令或拖入文件...'
            }
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
