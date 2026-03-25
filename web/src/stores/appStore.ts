import { create } from 'zustand';
import type { Task, Agent, Model, Message, AgentMetrics, ResourceMetrics } from '../types';
import { tasksApi, agentsApi, modelsApi, systemApi } from '../api';

interface AppState {
  tasks: Task[];
  currentTask: Task | null;
  agents: Agent[];
  currentAgent: Agent | null;
  models: Model[];
  messages: Message[];
  agentMetrics: AgentMetrics[];
  resourceMetrics: ResourceMetrics | null;
  sidebarOpen: boolean;
  currentView: 'chat' | 'agents' | 'knowledge' | 'settings';
  
  fetchTasks: () => Promise<void>;
  fetchAgents: () => Promise<void>;
  fetchModels: () => Promise<void>;
  fetchMetrics: () => Promise<void>;
  createTask: (content: string) => Promise<Task>;
  terminateTask: (id: string) => Promise<void>;
  selectTask: (task: Task | null) => void;
  selectAgent: (agent: Agent | null) => void;
  createAgent: (data: Partial<Agent>) => Promise<Agent>;
  updateAgent: (id: string, data: Partial<Agent>) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
  setSidebarOpen: (open: boolean) => void;
  setCurrentView: (view: 'chat' | 'agents' | 'knowledge' | 'settings') => void;
}

export const useAppStore = create<AppState>((set) => ({
  tasks: [],
  currentTask: null,
  agents: [],
  currentAgent: null,
  models: [],
  messages: [],
  agentMetrics: [],
  resourceMetrics: null,
  sidebarOpen: true,
  currentView: 'chat',

  fetchTasks: async () => {
    try {
      const response = await tasksApi.getAll();
      set({ tasks: response.data });
    } catch (error) {
      console.error('Failed to fetch tasks:', error);
    }
  },

  fetchAgents: async () => {
    try {
      const response = await agentsApi.getAll();
      set({ agents: response.data });
    } catch (error) {
      console.error('Failed to fetch agents:', error);
    }
  },

  fetchModels: async () => {
    try {
      const response = await modelsApi.getAll();
      set({ models: response.data });
    } catch (error) {
      console.error('Failed to fetch models:', error);
    }
  },

  fetchMetrics: async () => {
    try {
      const [agentMetrics, resourceMetrics] = await Promise.all([
        systemApi.getAgentMetrics(),
        systemApi.getResourceMetrics(),
      ]);
      set({
        agentMetrics: agentMetrics.data,
        resourceMetrics: resourceMetrics.data,
      });
    } catch (error) {
      console.error('Failed to fetch metrics:', error);
    }
  },

  createTask: async (content: string) => {
    try {
      const response = await tasksApi.create({ content });
      const task = response.data;
      set(state => ({ tasks: [task, ...state.tasks] }));
      return task;
    } catch (error) {
      console.error('Failed to create task:', error);
      throw error;
    }
  },

  terminateTask: async (id: string) => {
    try {
      await tasksApi.terminate(id);
      set(state => ({
        tasks: state.tasks.map(t => 
          t.id === id ? { ...t, status: 'TERMINATED' as const } : t
        ),
      }));
    } catch (error) {
      console.error('Failed to terminate task:', error);
    }
  },

  selectTask: (task: Task | null) => {
    set({ currentTask: task });
  },

  selectAgent: (agent: Agent | null) => {
    set({ currentAgent: agent });
  },

  createAgent: async (data: Partial<Agent>) => {
    try {
      const response = await agentsApi.create(data);
      const agent = response.data;
      set(state => ({ agents: [...state.agents, agent] }));
      return agent;
    } catch (error) {
      console.error('Failed to create agent:', error);
      throw error;
    }
  },

  updateAgent: async (id: string, data: Partial<Agent>) => {
    try {
      await agentsApi.update(id, data);
      set(state => ({
        agents: state.agents.map(a => 
          a.id === id ? { ...a, ...data } : a
        ),
      }));
    } catch (error) {
      console.error('Failed to update agent:', error);
    }
  },

  deleteAgent: async (id: string) => {
    try {
      await agentsApi.delete(id);
      set(state => ({
        agents: state.agents.filter(a => a.id !== id),
      }));
    } catch (error) {
      console.error('Failed to delete agent:', error);
    }
  },

  setSidebarOpen: (open: boolean) => {
    set({ sidebarOpen: open });
  },

  setCurrentView: (view: 'chat' | 'agents' | 'knowledge' | 'settings') => {
    set({ currentView: view });
  },
}));