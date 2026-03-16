import { create } from 'zustand';
import { api } from '../api/client';

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

export interface Task {
  id: string;
  status: string;
  triggerMode: string;
  complexity: string;
  triggerDecisionSummary?: string;
  complexityDecisionSummary?: string;
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

type ViewType = 'chat' | 'tasks' | 'knowledge' | 'memory' | 'agents' | 'skills' | 'settings' | 'result';

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
  init: () => Promise<void>;
  sendMessage: (content: string, attachments?: Array<{ type: string; name: string; url: string }>) => Promise<void>;
  fetchTasks: () => Promise<void>;
  fetchTaskDetail: (taskId: string) => Promise<void>;
  cancelTask: (taskId: string) => Promise<void>;
}

const generateClientId = () => {
  return `web-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

const clientId = generateClientId();

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
  
  setSelectedTaskId: (taskId) => {
    set({ selectedTaskId: taskId });
    if (taskId) {
      get().fetchTaskDetail(taskId);
    } else {
      set({ currentTaskSteps: [], currentTaskOutputs: [] });
    }
  },

  init: async () => {
    try {
      set({ isLoading: true });
      const conversation = await api.getConversation(clientId) as { id: string };
      set({ conversationId: conversation.id });
      
      const messages = await api.getMessages(conversation.id) as Message[];
      set({ messages });
      
      const tasks = await api.getTasks(conversation.id) as Task[];
      set({ tasks });
    } catch (error: any) {
      set({ error: error.message });
    } finally {
      set({ isLoading: false });
    }
  },

  sendMessage: async (content: string, attachments?: Array<{ type: string; name: string; url: string }>) => {
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

      const result = await api.sendMessage(conversationId, content, clientId, attachments) as { taskId: string };
      
      const assistantMessage: Message = {
        id: `temp-${Date.now()}-1`,
        conversationId,
        role: 'assistant',
        content: `任务已创建: ${result.taskId}`,
        createdAt: new Date().toISOString()
      };
      
      const updatedMessages = [...messages, messageWithAttachments, assistantMessage];
      set({ messages: updatedMessages });
      
      const tasks = await api.getTasks(conversationId) as Task[];
      set({ tasks });
    } catch (error: any) {
      set({ error: error.message });
    } finally {
      set({ isLoading: false });
    }
  },

  fetchTasks: async () => {
    const { conversationId } = get();
    if (!conversationId) return;
    
    try {
      const tasks = await api.getTasks(conversationId) as Task[];
      set({ tasks });
    } catch (error: any) {
      set({ error: error.message });
    }
  },

  fetchTaskDetail: async (taskId: string) => {
    try {
      set({ isLoading: true });
      const [steps, outputs] = await Promise.all([
        api.getTaskSteps(taskId) as Promise<TaskStep[]>,
        api.getTaskOutputs(taskId) as Promise<TaskOutput[]>
      ]);
      set({ currentTaskSteps: steps, currentTaskOutputs: outputs });
    } catch (error: any) {
      set({ error: error.message });
    } finally {
      set({ isLoading: false });
    }
  },

  cancelTask: async (taskId: string) => {
    try {
      await api.cancelTask(taskId);
      await get().fetchTasks();
    } catch (error: any) {
      set({ error: error.message });
    }
  }
}));