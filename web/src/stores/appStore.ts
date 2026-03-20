import { create } from 'zustand';
import { api } from '../api/client';

const ACTIVE_CONVERSATION_STORAGE_KEY = 'coobot-active-conversation-id';
const MESSAGE_CACHE_STORAGE_KEY = 'coobot-message-cache';
let activeConversationRequestId = 0;

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  attachments?: Array<{
    id: string;
    type: string;
    url: string;
  }>;
}

export interface PendingAttachment {
  type: string;
  name: string;
  url: string;
  file?: File;
}

function normalizeMessageAttachments(message: Message): Message {
  if (!message.attachments) {
    return message;
  }

  if (Array.isArray(message.attachments)) {
    return message;
  }

  try {
    const parsed = JSON.parse(message.attachments as unknown as string);
    return {
      ...message,
      attachments: Array.isArray(parsed) ? parsed : []
    };
  } catch {
    return {
      ...message,
      attachments: []
    };
  }
}

function normalizeMessages(messages: Message[]): Message[] {
  return messages.map(normalizeMessageAttachments);
}

export interface Task {
  id: string;
  status: string;
  triggerMode: string;
  complexity: string;
  triggerDecisionSummary?: string;
  complexityDecisionSummary?: string;
  currentReasoningSummary?: string;
  arrangementStatus?: string;
  arrangementEta?: string;
  userNotificationStage?: string;
  outputStage?: string;
  finalOutputReady?: boolean;
  createdAt: string;
  completedAt?: string;
  intakeInputSummary?: string;
  subTasks?: Array<{
    id: string;
    name: string;
    status: string;
    agentName?: string;
    queuePosition?: number;
    outputSummary?: string;
    blocking?: boolean;
  }>;
  waitingAnomalySummary?: string;
  interventionRequiredReason?: string;
  waitingThresholdBasis?: string;
  reassessmentRequired?: boolean;
  reassessmentType?: string;
  previousMarkerValue?: string;
  newMarkerValue?: string;
  notifications?: Array<{
    stage: string;
    timestamp: string;
    content?: string;
  }>;
  parentTaskId?: string;
}

export interface TaskStep {
  id: string;
  taskId: string;
  name: string;
  status: string;
  stepOrder: number;
  reasoningSummary?: string;
  actionSummary?: string;
  observationSummary?: string;
  duration?: number;
  startedAt?: string;
  completedAt?: string;
}

interface TaskOutput {
  id: string;
  taskId: string;
  type: string;
  content?: string;
  summary?: string;
  createdAt: string;
}

interface RealtimeEvent {
  type: string;
  taskId?: string;
  conversationId?: string;
  data?: {
    task?: Task;
  };
  message?: Message;
}

type ViewType = 'chat' | 'tasks' | 'knowledge' | 'memory' | 'agents' | 'skills' | 'settings' | 'result';

interface FetchOptions {
  silent?: boolean;
}

function upsertTaskIntoList(tasks: Task[], nextTask: Task): Task[] {
  const existingIndex = tasks.findIndex((task) => task.id === nextTask.id);
  if (existingIndex === -1) {
    return [nextTask, ...tasks];
  }

  return tasks.map((task) => (task.id === nextTask.id ? { ...task, ...nextTask } : task));
}

function sortMessagesByCreatedAt(messages: Message[]) {
  return [...messages].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
}

function isTerminalTaskStatus(status: string) {
  return [
    'completed',
    'TaskCompleted',
    'failed',
    'TaskFailed',
    'cancelled',
    'TaskCancelled',
    'manually_closed',
    'timed_out',
    'partial_failed',
    'intervention_required'
  ].includes(status);
}

function selectFocusTask(tasks: Task[], preferredTaskId?: string | null): Task | null {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return null;
  }

  if (preferredTaskId) {
    const preferredTask = tasks.find((task) => task.id === preferredTaskId);
    if (preferredTask) {
      return preferredTask;
    }
  }

  const activeTask = tasks.find((task) => !isTerminalTaskStatus(task.status));
  if (activeTask) {
    return activeTask;
  }

  return tasks[0] || null;
}

function getStoredConversationId() {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.localStorage.getItem(ACTIVE_CONVERSATION_STORAGE_KEY);
}

function persistConversationId(conversationId: string | null | undefined) {
  if (typeof window === 'undefined') {
    return;
  }

  if (conversationId) {
    window.localStorage.setItem(ACTIVE_CONVERSATION_STORAGE_KEY, conversationId);
    return;
  }

  window.localStorage.removeItem(ACTIVE_CONVERSATION_STORAGE_KEY);
}

function readMessageCache(): Record<string, Message[]> {
  if (typeof window === 'undefined') {
    return {};
  }

  const rawValue = window.localStorage.getItem(MESSAGE_CACHE_STORAGE_KEY);
  if (!rawValue) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawValue) as Record<string, Message[]>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function getCachedMessages(conversationId: string): Message[] {
  const cache = readMessageCache();
  const messages = cache[conversationId];
  return Array.isArray(messages) ? normalizeMessages(messages) : [];
}

function persistMessages(conversationId: string, messages: Message[]) {
  if (typeof window === 'undefined' || !conversationId) {
    return;
  }

  const cache = readMessageCache();
  cache[conversationId] = normalizeMessages(messages);
  window.localStorage.setItem(MESSAGE_CACHE_STORAGE_KEY, JSON.stringify(cache));
}

function beginConversationRequest() {
  activeConversationRequestId += 1;
  return activeConversationRequestId;
}

function isLatestConversationRequest(requestId: number) {
  return requestId === activeConversationRequestId;
}

interface AppState {
  activeView: ViewType;
  conversationId: string | null;
  messages: Message[];
  tasks: Task[];
  selectedTaskId: string | null;
  currentTask: Task | null;
  currentTaskEvents: any[];
  currentTaskSteps: TaskStep[];
  currentTaskOutputs: TaskOutput[];
  intakeInputSummary: string;
  isLoading: boolean;
  error: string | null;
  wsConnected: boolean;

  setActiveView: (view: ViewType) => void;
  setSelectedTaskId: (taskId: string | null) => void;
  init: (conversationId?: string) => Promise<void>;
  switchConversation: (conversationId: string) => Promise<void>;
  sendMessage: (content: string, attachments?: PendingAttachment[]) => Promise<void>;
  fetchMessages: (options?: FetchOptions) => Promise<void>;
  fetchTasks: (options?: FetchOptions) => Promise<void>;
  fetchTaskDetail: (taskId: string, options?: FetchOptions) => Promise<void>;
  cancelTask: (taskId: string) => Promise<void>;
  retryTask: (taskId: string) => Promise<void>;
  setWsConnected: (connected: boolean) => void;
  handleRealtimeEvent: (event: RealtimeEvent) => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  activeView: 'chat',
  conversationId: null,
  messages: [],
  tasks: [],
  selectedTaskId: null,
  currentTask: null,
  currentTaskEvents: [],
  currentTaskSteps: [],
  currentTaskOutputs: [],
  intakeInputSummary: '',
  isLoading: false,
  error: null,
  wsConnected: false,

  setActiveView: (view) => set({ activeView: view }),
  setWsConnected: (connected) => set({ wsConnected: connected }),

  setSelectedTaskId: (taskId) => {
    set({ selectedTaskId: taskId });
    if (taskId) {
      get().fetchTaskDetail(taskId);
    } else {
      set({ currentTaskSteps: [], currentTaskOutputs: [] });
    }
  },

  init: async (targetConversationId?: string) => {
    const requestId = beginConversationRequest();
    try {
      set({ isLoading: true });
      const preferredConversationId = targetConversationId || getStoredConversationId() || undefined;
      let conversation: { id: string };

      try {
        conversation = await api.getConversation(preferredConversationId) as { id: string };
      } catch (error) {
        if (!preferredConversationId) {
          throw error;
        }

        persistConversationId(null);
        conversation = await api.getConversation() as { id: string };
      }

      if (!isLatestConversationRequest(requestId)) {
        return;
      }

      persistConversationId(conversation.id);
      const cachedMessages = getCachedMessages(conversation.id);
      set({ conversationId: conversation.id, messages: cachedMessages });

      const messages = await api.getMessages(conversation.id) as Message[];
      if (!isLatestConversationRequest(requestId)) {
        return;
      }
      const normalizedMessages = normalizeMessages(messages);
      persistMessages(conversation.id, normalizedMessages);
      set({ messages: normalizedMessages });

      const tasks = await api.getTasks(conversation.id, 200, 0) as Task[];
      if (!isLatestConversationRequest(requestId)) {
        return;
      }

      const focusTask = selectFocusTask(tasks);
      set({
        tasks,
        currentTask: focusTask,
        selectedTaskId: focusTask?.id || null,
        currentTaskSteps: [],
        currentTaskOutputs: [],
        currentTaskEvents: []
      });

      if (!focusTask) {
        return;
      }

      const [task, steps, outputs, events] = await Promise.all([
        api.getTask(focusTask.id) as Promise<Task>,
        api.getTaskSteps(focusTask.id) as Promise<TaskStep[]>,
        api.getTaskOutputs(focusTask.id) as Promise<TaskOutput[]>,
        api.getTaskEvents(focusTask.id) as Promise<any[]>
      ]);

      if (!isLatestConversationRequest(requestId)) {
        return;
      }

      set((state) => ({
        currentTask: task,
        currentTaskSteps: steps,
        currentTaskOutputs: outputs,
        currentTaskEvents: events,
        tasks: upsertTaskIntoList(state.tasks, task)
      }));
    } catch (error: any) {
      if (isLatestConversationRequest(requestId)) {
        set({ error: error.message });
      }
    } finally {
      if (isLatestConversationRequest(requestId)) {
        set({ isLoading: false });
      }
    }
  },

  switchConversation: async (nextConversationId: string) => {
    const { conversationId: currentConversationId } = get();
    if (!nextConversationId || nextConversationId === currentConversationId) {
      return;
    }

    const requestId = beginConversationRequest();

    try {
      await api.getConversation(nextConversationId);
      if (!isLatestConversationRequest(requestId)) {
        return;
      }
      persistConversationId(nextConversationId);
      const cachedMessages = getCachedMessages(nextConversationId);

      set({
        isLoading: true,
        conversationId: nextConversationId,
        messages: cachedMessages,
        selectedTaskId: null,
        currentTask: null,
        currentTaskSteps: [],
        currentTaskOutputs: [],
        currentTaskEvents: [],
        error: null
      });

      const [serverMessages, tasks] = await Promise.all([
        api.getMessages(nextConversationId) as Promise<Message[]>,
        api.getTasks(nextConversationId, 200, 0) as Promise<Task[]>
      ]);

      if (!isLatestConversationRequest(requestId)) {
        return;
      }

      const normalizedMessages = normalizeMessages(serverMessages);
      persistMessages(nextConversationId, normalizedMessages);

      const focusTask = selectFocusTask(tasks);

      set({
        messages: normalizedMessages,
        tasks,
        currentTask: focusTask,
        selectedTaskId: focusTask?.id || null,
        currentTaskSteps: [],
        currentTaskOutputs: [],
        currentTaskEvents: []
      });

      if (!focusTask) {
        return;
      }

      const [task, steps, outputs, events] = await Promise.all([
        api.getTask(focusTask.id) as Promise<Task>,
        api.getTaskSteps(focusTask.id) as Promise<TaskStep[]>,
        api.getTaskOutputs(focusTask.id) as Promise<TaskOutput[]>,
        api.getTaskEvents(focusTask.id) as Promise<any[]>
      ]);

      if (!isLatestConversationRequest(requestId)) {
        return;
      }

      set((state) => ({
        currentTask: task,
        currentTaskSteps: steps,
        currentTaskOutputs: outputs,
        currentTaskEvents: events,
        tasks: upsertTaskIntoList(state.tasks, task)
      }));
    } catch (error: any) {
      if (isLatestConversationRequest(requestId)) {
        set({ error: error.message });
      }
    } finally {
      if (isLatestConversationRequest(requestId)) {
        set({ isLoading: false });
      }
    }
  },

  sendMessage: async (content: string, attachments?: PendingAttachment[]) => {
    const { conversationId, messages } = get();
    if ((!content.trim() && (!attachments || attachments.length === 0)) || !conversationId) return;

    try {
      set({ isLoading: true });

      const userMessage: Message = {
        id: `temp-${Date.now()}`,
        conversationId,
        role: 'user',
        content,
        createdAt: new Date().toISOString()
      };

      let messageWithAttachments = { ...userMessage };
      if (attachments && attachments.length > 0) {
        messageWithAttachments = {
          ...userMessage,
          attachments: attachments.map(att => ({
            id: att.name,
            type: att.type,
            url: att.url
          }))
        };
      }

      set({ messages: [...messages, messageWithAttachments] });
      persistMessages(conversationId, [...messages, messageWithAttachments]);

      const result = await api.sendMessage(conversationId, content, attachments) as { taskId?: string; focusTaskId?: string };
      const focusTaskId = result.focusTaskId || result.taskId || null;

      const [serverMessages, tasks] = await Promise.all([
        api.getMessages(conversationId) as Promise<Message[]>,
        api.getTasks(conversationId, 200, 0) as Promise<Task[]>
      ]);

      persistConversationId(conversationId);
      const normalizedMessages = normalizeMessages(serverMessages);
      persistMessages(conversationId, normalizedMessages);

      set({
        messages: normalizedMessages,
        tasks,
        currentTask: focusTaskId ? tasks.find((task) => task.id === focusTaskId) || null : null,
        selectedTaskId: focusTaskId
      });

      if (focusTaskId) {
        await get().fetchTaskDetail(focusTaskId);
      }
    } catch (error: any) {
      set({ error: error.message });
    } finally {
      set({ isLoading: false });
    }
  },

  fetchMessages: async (options) => {
    const { conversationId } = get();
    if (!conversationId) return;
    const requestedConversationId = conversationId;

    try {
      if (!options?.silent) {
        set({ isLoading: true });
      }

      if (options?.silent) {
        const cachedMessages = getCachedMessages(conversationId);
        if (cachedMessages.length > 0) {
          set({ messages: cachedMessages });
        }
      }

      const messages = await api.getMessages(requestedConversationId) as Message[];
      if (get().conversationId !== requestedConversationId) {
        return;
      }
      const normalizedMessages = normalizeMessages(messages);
      persistMessages(requestedConversationId, normalizedMessages);
      set({ messages: normalizedMessages });
    } catch (error: any) {
      set({ error: error.message });
    } finally {
      if (!options?.silent) {
        set({ isLoading: false });
      }
    }
  },

  fetchTasks: async (options) => {
    const { conversationId, currentTask } = get();
    if (!conversationId) return;
    const requestedConversationId = conversationId;

    try {
      if (!options?.silent) {
        set({ isLoading: true });
      }

      const tasks = await api.getTasks(requestedConversationId, 200, 0) as Task[];
      if (get().conversationId !== requestedConversationId) {
        return;
      }
      const refreshedCurrentTask = currentTask
        ? tasks.find((task) => task.id === currentTask.id) || currentTask
        : null;

      set({
        tasks,
        currentTask: refreshedCurrentTask
      });
    } catch (error: any) {
      set({ error: error.message });
    } finally {
      if (!options?.silent) {
        set({ isLoading: false });
      }
    }
  },

  fetchTaskDetail: async (taskId: string, options) => {
    try {
      if (!options?.silent) {
        set({ isLoading: true });
      }

      const [task, steps, outputs, events] = await Promise.all([
        api.getTask(taskId) as Promise<Task>,
        api.getTaskSteps(taskId) as Promise<TaskStep[]>,
        api.getTaskOutputs(taskId) as Promise<TaskOutput[]>,
        api.getTaskEvents(taskId) as Promise<any[]>
      ]);

      set((state) => ({
        currentTask: task,
        currentTaskSteps: steps,
        currentTaskOutputs: outputs,
        currentTaskEvents: events,
        tasks: upsertTaskIntoList(state.tasks, task)
      }));
    } catch (error: any) {
      set({ error: error.message });
    } finally {
      if (!options?.silent) {
        set({ isLoading: false });
      }
    }
  },

  cancelTask: async (taskId: string) => {
    try {
      await api.cancelTask(taskId);
      await get().fetchTasks({ silent: true });
      await get().fetchTaskDetail(taskId, { silent: true });
    } catch (error: any) {
      set({ error: error.message });
    }
  },

  retryTask: async (taskId: string) => {
    try {
      await api.retryTask(taskId);
      await get().fetchTasks({ silent: true });
      await get().fetchTaskDetail(taskId, { silent: true });
    } catch (error: any) {
      set({ error: error.message });
    }
  },

  handleRealtimeEvent: async (event) => {
    const { conversationId, currentTask, selectedTaskId, messages } = get();

    switch (event.type) {
      case 'connected':
        set({ wsConnected: true });
        return;
      case 'message.new': {
        if (!event.message || event.conversationId !== conversationId) {
          return;
        }

        const nextMessage = normalizeMessageAttachments(event.message);
        const deduped = messages.filter((message) => message.id !== nextMessage.id);
        const nextMessages = sortMessagesByCreatedAt([...deduped, nextMessage]);
        if (conversationId) {
          persistMessages(conversationId, nextMessages);
        }
        set({ messages: nextMessages });
        return;
      }
      case 'task.created':
      case 'task.updated':
      case 'task.completed':
      case 'task.failed': {
        if (event.data?.task) {
          set((state) => ({
            tasks: upsertTaskIntoList(state.tasks, event.data!.task!),
            currentTask: state.currentTask?.id === event.data!.task!.id ? event.data!.task! : state.currentTask
          }));
        } else {
          await get().fetchTasks({ silent: true });
        }

        if (event.taskId && (event.taskId === currentTask?.id || event.taskId === selectedTaskId)) {
          await get().fetchTaskDetail(event.taskId, { silent: true });
        }
        return;
      }
      case 'task.event':
      case 'step.updated':
      case 'arrangement.completed':
      case 'trigger.activated':
        await get().fetchTasks({ silent: true });
        if (event.taskId && (event.taskId === currentTask?.id || event.taskId === selectedTaskId)) {
          await get().fetchTaskDetail(event.taskId, { silent: true });
        }
        return;
      default:
        return;
    }
  }
}));