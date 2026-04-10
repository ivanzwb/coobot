import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useAppStore } from '../stores/appStore';
import { tasksApi, chatApi, authApi, type ChatMessage } from '../api';
import type { Task } from '../types';
import {
  useWebSocket,
  useTaskEvents,
  useAuthRequests,
  useBrainInputRequests,
  type AuthRequestPayload,
  type BrainInputRequestPayload,
} from '../hooks/useWebSocket';

function clarificationQuestionsFromTask(task: Task | null): string[] {
  if (!task?.inputPayload) return [];
  try {
    const p = JSON.parse(task.inputPayload) as Record<string, unknown>;
    const q = p.clarificationQuestions;
    if (!Array.isArray(q)) return [];
    return q.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
  } catch {
    return [];
  }
}

function formatLlmTokensForTaskDisplay(task: Task, allTasks: Task[]): string | null {
  const p = task.llmPromptTokens;
  const c = task.llmCompletionTokens;
  const t = task.llmTotalTokens;
  if (t == null && p == null && c == null) return null;
  const total = t ?? (p ?? 0) + (c ?? 0);
  const parts: string[] = [
    `本任务约 ${total.toLocaleString()} tokens（提示 ${(p ?? 0).toLocaleString()} · 生成 ${(c ?? 0).toLocaleString()}）`,
  ];
  const children = allTasks.filter((x) => x.parentTaskId === task.id);
  const childSum = children.reduce((s, ch) => s + (ch.llmTotalTokens ?? 0), 0);
  if (childSum > 0) {
    parts.push(`子任务合计约 ${childSum.toLocaleString()} tokens；会话总计约 ${(total + childSum).toLocaleString()} tokens`);
  }
  return parts.join(' ');
}

function taskSnippetFromPayload(inputPayload: string): string {
  try {
    const p = JSON.parse(inputPayload) as Record<string, unknown>;
    const c = p.content ?? p.description;
    if (typeof c === 'string' && c.trim()) {
      const s = c.trim();
      return s.length > 180 ? `${s.slice(0, 180)}…` : s;
    }
  } catch {
    /* ignore */
  }
  const raw = inputPayload.trim();
  return raw.length > 120 ? `${raw.slice(0, 120)}…` : raw;
}

function ganttColorForStatus(status: string): string {
  switch (status) {
    case 'COMPLETED':
      return '#52c41a';
    case 'RUNNING':
    case 'PARSING':
    case 'DISPATCHING':
    case 'AGGREGATING':
      return '#1890ff';
    case 'QUEUED':
    case 'QUEUED_WAITING_RESOURCE':
    case 'WAITING_FOR_LEADER':
      return '#d9d9d9';
    case 'CLARIFICATION_PENDING':
      return '#adc6ff';
    case 'EXCEPTION':
    case 'TERMINATED':
      return '#ff4d4f';
    default:
      return '#bfbfbf';
  }
}

const ChatView: React.FC = () => {
  const [input, setInput] = useState('');
  const [clarifyDrafts, setClarifyDrafts] = useState<Record<string, string>>({});
  const [clarifySubmittingId, setClarifySubmittingId] = useState<string | null>(null);
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

  const [brainAwait, setBrainAwait] = useState<BrainInputRequestPayload | null>(null);
  const brainTaskIdRef = useRef<string | null>(null);
  useBrainInputRequests(
    useCallback((p: BrainInputRequestPayload) => {
      brainTaskIdRef.current = p.taskId;
      setBrainAwait(p);
    }, []),
    useCallback((taskId: string) => {
      if (brainTaskIdRef.current === taskId) brainTaskIdRef.current = null;
      setBrainAwait((cur) => (cur?.taskId === taskId ? null : cur));
    }, [])
  );

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

  const pendingClarificationCount = useMemo(
    () => tasks.filter((t) => t.status === 'CLARIFICATION_PENDING').length,
    [tasks]
  );

  /** 同一 taskId 可能对应多条消息（如用户消息 + 系统澄清说明）；任务卡片只挂在最后一条上，避免重复澄清表单。 */
  const lastChatMsgIdForTask = useMemo(() => {
    const m = new Map<string, number>();
    for (const msg of chatHistory) {
      if (!msg.taskId) continue;
      if (msg.role !== 'user' && msg.role !== 'system') continue;
      m.set(msg.taskId, msg.id);
    }
    return m;
  }, [chatHistory]);

  /** 子任务在会话里会单独写一条 user 消息，避免与根任务重复展示错误/重试，整段折叠进根任务卡片。 */
  const hiddenChatMessageIds = useMemo(() => {
    const set = new Set<number>();
    const byId = new Map(tasks.map((t) => [t.id, t]));
    for (const msg of chatHistory) {
      if (!msg.taskId) continue;
      if (msg.role !== 'user' && msg.role !== 'system') continue;
      const t = byId.get(msg.taskId);
      if (t?.parentTaskId) set.add(msg.id);
    }
    return set;
  }, [chatHistory, tasks]);

  const childTasksByRootId = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
      if (!t.parentTaskId) continue;
      const root = t.rootTaskId;
      const list = m.get(root) ?? [];
      list.push(t);
      m.set(root, list);
    }
    for (const list of m.values()) {
      list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    }
    return m;
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
  }, [tasks, chatHistory, authPrompt, brainAwait]);

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
      const text = input.trim();
      const brainId = brainAwait?.taskId ?? brainTaskIdRef.current;
      const res = await chatApi.send(
        brainId
          ? { content: text, brainReplyTaskId: brainId }
          : { content: text }
      );
      const data = res.data as { deliveredBrainInput?: boolean };
      if (data?.deliveredBrainInput || res.status === 201) {
        brainTaskIdRef.current = null;
        setBrainAwait(null);
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

  const submitTaskClarification = async (taskId: string) => {
    const text = clarifyDrafts[taskId]?.trim();
    if (!text || clarifySubmittingId) return;
    setClarifySubmittingId(taskId);
    try {
      await tasksApi.clarify(taskId, { clarificationReply: text });
      setClarifyDrafts((d) => {
        const next = { ...d };
        delete next[taskId];
        return next;
      });
      fetchChatHistory();
      fetchTasks();
    } catch (e) {
      console.error('Clarification submit failed:', e);
      alert('提交澄清失败，请稍后重试');
    } finally {
      setClarifySubmittingId(null);
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
            if (hiddenChatMessageIds.has(chatMsg.id)) return null;
            const st = roleStyle(chatMsg.role);
            const task =
              chatMsg.taskId && (chatMsg.role === 'user' || chatMsg.role === 'system')
                ? getTaskById(chatMsg.taskId)
                : null;
            const showTaskCard =
              task &&
              !task.parentTaskId &&
              (task.status !== 'CLARIFICATION_PENDING' ||
                lastChatMsgIdForTask.get(chatMsg.taskId!) === chatMsg.id);
            const subtasks = task && !task.parentTaskId ? childTasksByRootId.get(task.id) ?? [] : [];
            const childErrors = subtasks.filter(
              (s) =>
                s.errorMsg &&
                (s.status === 'EXCEPTION' || s.status === 'TERMINATED')
            );
            const showRootRetry =
              !!task &&
              !task.parentTaskId &&
              (!!task.errorMsg || childErrors.length > 0);
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
                  {showTaskCard && (
                    <>
                      <div
                        style={{
                          fontSize: 12,
                          color:
                            task.status === 'COMPLETED'
                              ? '#52c41a'
                              : task.status === 'EXCEPTION'
                                ? '#ff4d4f'
                                : task.status === 'CLARIFICATION_PENDING'
                                  ? '#2f54eb'
                                  : '#999',
                          marginBottom: 8,
                        }}
                      >
                        {getStatusText(task.status)}
                      </div>

                      {subtasks.length > 0 && (
                        <div style={{ marginTop: 10 }}>
                          <div style={{ fontSize: 11, color: '#8c8c8c', marginBottom: 4 }}>任务层级（主流程 + 子任务）</div>
                          <div style={{ display: 'flex', gap: 4, alignItems: 'stretch' }}>
                            <div
                              title={`主任务 / Leader：${task.status}`}
                              style={{
                                flex: 1,
                                minHeight: 12,
                                borderRadius: 4,
                                background: ganttColorForStatus(task.status),
                              }}
                            />
                            {subtasks.map((s) => (
                              <div
                                key={s.id}
                                title={`${getStatusText(s.status)} · ${taskSnippetFromPayload(s.inputPayload)}`}
                                style={{
                                  flex: 1,
                                  minHeight: 12,
                                  borderRadius: 4,
                                  background: ganttColorForStatus(s.status),
                                }}
                              />
                            ))}
                          </div>
                        </div>
                      )}

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

                      {task.status === 'CLARIFICATION_PENDING' && (() => {
                        const qs = clarificationQuestionsFromTask(task);
                        /** 最后一条关联消息多为系统说明，正文已含编号问题，卡片内不再重复列表。 */
                        const skipRepeatQuestions =
                          chatMsg.role === 'system' && qs.length > 0;
                        return (
                        <div
                          style={{
                            background: '#f0f5ff',
                            border: '1px solid #adc6ff',
                            padding: 12,
                            borderRadius: 4,
                            marginTop: 8,
                          }}
                        >
                          <div style={{ fontWeight: 600, marginBottom: 8, color: '#2f54eb' }}>
                            需要您补充说明（仅针对本任务）
                          </div>
                          {skipRepeatQuestions ? (
                            <div style={{ fontSize: 13, color: '#595959' }}>
                              请根据<strong>上方系统消息</strong>中的问题，在下方输入框作答。
                            </div>
                          ) : qs.length > 0 ? (
                            <ol style={{ margin: 0, paddingLeft: 20, color: '#434343' }}>
                              {qs.map((q, idx) => (
                                <li key={idx} style={{ marginTop: 4 }}>
                                  {q}
                                </li>
                              ))}
                            </ol>
                          ) : (
                            <div style={{ fontSize: 13, color: '#595959' }}>
                              请根据上方系统消息补充信息。
                            </div>
                          )}
                          <textarea
                            className="chat-input"
                            style={{
                              width: '100%',
                              marginTop: 10,
                              minHeight: 56,
                              fontSize: 13,
                              boxSizing: 'border-box',
                            }}
                            placeholder="在此输入对本任务的补充说明…"
                            value={clarifyDrafts[task.id] ?? ''}
                            onChange={(e) =>
                              setClarifyDrafts((d) => ({ ...d, [task.id]: e.target.value }))
                            }
                            rows={2}
                          />
                          <button
                            type="button"
                            className="btn btn-sm btn-primary"
                            style={{ marginTop: 8 }}
                            disabled={
                              !clarifyDrafts[task.id]?.trim() || clarifySubmittingId === task.id
                            }
                            onClick={() => void submitTaskClarification(task.id)}
                          >
                            {clarifySubmittingId === task.id ? '提交中…' : '提交澄清'}
                          </button>
                        </div>
                        );
                      })()}

                      {task.outputSummary && (
                        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #eee' }}>
                          <div style={{ marginBottom: 4, fontWeight: 500 }}>💡 结果:</div>
                          <div style={{ whiteSpace: 'pre-wrap' }}>{task.outputSummary}</div>
                        </div>
                      )}

                      {task.status !== 'CLARIFICATION_PENDING' &&
                        (() => {
                          const tokenLine = formatLlmTokensForTaskDisplay(task, tasks);
                          if (!tokenLine) return null;
                          return (
                            <div style={{ marginTop: 8, fontSize: 12, color: '#595959' }}>📊 {tokenLine}</div>
                          );
                        })()}

                      {subtasks.length > 0 && (
                        <div
                          style={{
                            marginTop: 10,
                            padding: 10,
                            background: '#fafafa',
                            borderRadius: 6,
                            border: '1px solid #f0f0f0',
                          }}
                        >
                          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: '#434343' }}>
                            子任务
                          </div>
                          <ol style={{ margin: 0, paddingLeft: 18, color: '#595959', fontSize: 13 }}>
                            {subtasks.map((s, idx) => (
                              <li key={s.id} style={{ marginTop: idx === 0 ? 0 : 10 }}>
                                <div style={{ color: '#8c8c8c', fontSize: 11, marginBottom: 2 }}>
                                  {getStatusText(s.status)}
                                </div>
                                <div style={{ whiteSpace: 'pre-wrap' }}>{taskSnippetFromPayload(s.inputPayload)}</div>
                                {s.outputSummary && (
                                  <div style={{ marginTop: 6, fontSize: 12, color: '#389e0d' }}>
                                    结果:{' '}
                                    {s.outputSummary.length > 400
                                      ? `${s.outputSummary.slice(0, 400)}…`
                                      : s.outputSummary}
                                  </div>
                                )}
                                {s.errorMsg && (
                                  <div style={{ marginTop: 6, fontSize: 12, color: '#ff4d4f' }}>❌ {s.errorMsg}</div>
                                )}
                                {(() => {
                                  const line = formatLlmTokensForTaskDisplay(s, tasks);
                                  if (!line) return null;
                                  return (
                                    <div style={{ marginTop: 4, fontSize: 11, color: '#8c8c8c' }}>📊 {line}</div>
                                  );
                                })()}
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}

                      {showRootRetry && (
                        <div
                          style={{
                            marginTop: 8,
                            padding: 8,
                            background: '#fff2f0',
                            borderRadius: 4,
                            color: '#ff4d4f',
                          }}
                        >
                          {task.errorMsg && (
                            <div style={{ marginBottom: childErrors.length ? 6 : 0 }}>
                              <strong>根任务</strong>：{task.errorMsg}
                            </div>
                          )}
                          {childErrors.length > 0 && (
                            <div style={{ fontSize: 12, color: '#cf1322' }}>
                              {task.errorMsg ? '另有' : '有'}
                              {childErrors.length} 个子任务异常，详情见上方「子任务」列表。
                            </div>
                          )}
                          <button
                            type="button"
                            className="btn btn-sm"
                            style={{ marginTop: 8 }}
                            onClick={() => handleRetry(task.id)}
                          >
                            {subtasks.length > 0 ? '重试整条请求' : '重试'}
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

        {authPrompt && (() => {
          const authArgs =
            authPrompt.args && typeof authPrompt.args === 'object' && authPrompt.args !== null
              ? (authPrompt.args as Record<string, unknown>)
              : {};
          const fromAgentBrain = authArgs.source === 'agent_brain';
          return (
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
                {fromAgentBrain
                  ? 'AgentBrain 内置工具沙箱请求执行操作（已与后台工具策略对齐）。请确认是否允许本次调用。'
                  : 'Agent 请求执行下列工具（策略为询问），请在本对话中直接选择是否允许本次调用。'}
              </div>
              {fromAgentBrain && typeof authArgs.brainTool === 'string' && authArgs.brainTool && (
                <div style={{ marginBottom: 10, fontSize: 12, color: '#614700' }}>
                  大脑工具：<code>{authArgs.brainTool}</code>
                  {typeof authArgs.action === 'string' && (
                    <span style={{ marginLeft: 8, color: '#8c6e00' }}>（{authArgs.action}）</span>
                  )}
                </div>
              )}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: '#8c6e00', marginBottom: 4 }}>策略工具名</div>
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
          );
        })()}

        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-container">
        {brainAwait && (
          <div
            style={{
              fontSize: 13,
              color: '#006d75',
              marginBottom: 8,
              padding: '10px 14px',
              background: '#e6fffb',
              borderRadius: 6,
              border: '1px solid #87e8de',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Agent 正在等待您的回复</div>
            <div style={{ color: '#434343', whiteSpace: 'pre-wrap' }}>{brainAwait.question}</div>
            <div style={{ fontSize: 12, color: '#595959', marginTop: 8 }}>
              在下方输入并发送，将交给当前运行中的任务（<strong>不会新建任务</strong>）。任务 ID：
              <code style={{ marginLeft: 4 }}>{brainAwait.taskId.slice(0, 8)}…</code>
            </div>
          </div>
        )}
        {pendingClarificationCount > 0 && (
          <div
            style={{
              fontSize: 13,
              color: '#2f54eb',
              marginBottom: 8,
              padding: '10px 14px',
              background: '#f0f5ff',
              borderRadius: 6,
              border: '1px solid #adc6ff',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 6 }}>
              有 {pendingClarificationCount} 个任务正在等待澄清：请到对话里<strong>对应任务卡片</strong>
              内的「提交澄清」发送回复。
            </div>
            <div style={{ color: '#595959', fontSize: 12 }}>
              底部输入框仅用于<strong>新的用户消息</strong>，不会自动关联到某条澄清任务，避免与正在执行的子任务抢答。
            </div>
          </div>
        )}
        <div className="chat-input-wrapper">
          <textarea
            className="chat-input"
            placeholder={
              brainAwait
                ? '输入对该问题的回复…（将交给当前 Agent 任务）'
                : '输入新指令或对话…（澄清请在上方对应任务卡片内提交）'
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
