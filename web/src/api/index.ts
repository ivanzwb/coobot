import axios from 'axios';
import type { Task, Agent, Model, KnowledgeFile, Message, LongTermMemory, ScheduledJob, AgentMetrics, ResourceMetrics, SystemConfig } from '../types';

const api = axios.create({
  baseURL: '/api/v1',
});

export const tasksApi = {
  getAll: () => api.get<Task[]>('/tasks'),
  getById: (id: string) => api.get<Task>(`/tasks/${id}`),
  getTree: (id: string) => api.get(`/tasks/${id}/tree`),
  create: (data: { content: string; attachments?: unknown[] }) => 
    api.post<Task>('/tasks', data),
  terminate: (id: string) => api.post(`/tasks/${id}/terminate`),
  clarify: (id: string) => api.post(`/tasks/${id}/clarify`),
};

export const agentsApi = {
  getAll: () => api.get<Agent[]>('/agents'),
  getById: (id: string) => api.get<Agent>(`/agents/${id}`),
  create: (data: Partial<Agent>) => api.post<Agent>('/agents', data),
  update: (id: string, data: Partial<Agent>) => api.put<Agent>(`/agents/${id}`, data),
  delete: (id: string) => api.delete(`/agents/${id}`),
  addSkill: (agentId: string, skillId: string, config?: unknown) =>
    api.post(`/agents/${agentId}/skills`, { skillId, config }),
  removeSkill: (agentId: string, skillId: string) =>
    api.delete(`/agents/${agentId}/skills/${skillId}`),
};

export const modelsApi = {
  getAll: () => api.get<Model[]>('/models'),
  create: (data: { name: string; provider: string; modelName: string; type: string; contextWindow?: number; apiKey?: string; baseUrl?: string }) =>
    api.post<Model>('/models', data),
  update: (id: string, data: { name?: string; provider?: string; modelName?: string; type?: string; contextWindow?: number; apiKey?: string; baseUrl?: string }) =>
    api.put<Model>(`/models/${id}`, data),
  test: (id: string) => api.post(`/models/${id}/test`),
  delete: (id: string) => api.delete(`/models/${id}`),
};

export const knowledgeApi = {
  getFiles: (agentId: string) => api.get<KnowledgeFile[]>(`/knowledge/${agentId}/files`),
  upload: (agentId: string, file: unknown) => api.post<KnowledgeFile>(`/knowledge/${agentId}/upload`, { file }),
  delete: (agentId: string, fileId: string, deletePhysical?: boolean) =>
    api.delete(`/knowledge/${agentId}/files/${fileId}`, { params: { deletePhysical } }),
  reindex: (agentId: string, fileId: string) =>
    api.post(`/knowledge/${agentId}/files/${fileId}/reindex`),
  search: (agentId: string, query: string, topK?: number) =>
    api.get(`/knowledge/${agentId}/search`, { params: { query, topK } }),
};

export const memoryApi = {
  getHistory: (limit?: number, offset?: number) =>
    api.get<Message[]>('/memory/history', { params: { limit, offset } }),
  getStm: (limit?: number) => api.get<Message[]>('/memory/stm', { params: { limit } }),
  getLtm: (agentId?: string) => api.get<LongTermMemory[]>('/memory/ltm', { params: { agentId } }),
  createLtm: (data: Partial<LongTermMemory>) => api.post('/memory/ltm', data),
  deleteLtm: (id: string) => api.delete(`/memory/ltm/${id}`),
  searchLtm: (query: string, agentId: string, topK?: number) =>
    api.get('/memory/ltm/search', { params: { query, agentId, topK } }),
};

export const systemApi = {
  getConfig: () => api.get<SystemConfig>('/system/config'),
  updateConfig: (data: Partial<SystemConfig>) => api.put('/system/config', data),
  initWorkspace: () => api.post('/system/workspace/init'),
  changeWorkspace: (newPath: string, migrate: boolean) =>
    api.post('/system/workspace/change', { newPath, migrate }),
  health: () => api.get('/system/health'),
  getAgentMetrics: () => api.get<AgentMetrics[]>('/system/metrics/agents'),
  getResourceMetrics: () => api.get<ResourceMetrics>('/system/metrics/resources'),
};

export const schedulerApi = {
  getJobs: () => api.get<ScheduledJob[]>('/scheduler/jobs'),
  createJob: (data: Partial<ScheduledJob>) => api.post('/scheduler/jobs', data),
  updateJob: (id: string, data: Partial<ScheduledJob>) => api.put(`/scheduler/jobs/${id}`, data),
  deleteJob: (id: string) => api.delete(`/scheduler/jobs/${id}`),
  triggerNow: (id: string) => api.post(`/scheduler/jobs/${id}/trigger`),
  getLogs: (jobId: string) => api.get(`/scheduler/jobs/${jobId}/logs`),
};

export default api;