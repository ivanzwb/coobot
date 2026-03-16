const API_BASE = '/api';

async function fetchAPI<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers
    }
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }
  
  return response.json();
}

export const api = {
  getConversation: (clientId: string) => 
    fetchAPI(`${API_BASE}/conversation`, {
      headers: { 'X-Client-Id': clientId }
    }),

  getMessages: (conversationId: string, limit = 50, offset = 0) =>
    fetchAPI(`${API_BASE}/conversation/messages?conversationId=${conversationId}&limit=${limit}&offset=${offset}`),

  sendMessage: (conversationId: string, content: string, clientId: string) =>
    fetchAPI(`${API_BASE}/conversation/messages`, {
      method: 'POST',
      headers: { 'X-Client-Id': clientId, 'X-Entry-Point': 'web' },
      body: JSON.stringify({ conversationId, content })
    }),

  getTasks: (conversationId: string, limit = 50, offset = 0) =>
    fetchAPI(`${API_BASE}/tasks?conversationId=${conversationId}&limit=${limit}&offset=${offset}`),

  getTask: (taskId: string) =>
    fetchAPI(`${API_BASE}/tasks/${taskId}`),

  getTaskSteps: (taskId: string) =>
    fetchAPI(`${API_BASE}/tasks/${taskId}/steps`),

  getTaskEvents: (taskId: string, limit = 100) =>
    fetchAPI(`${API_BASE}/tasks/${taskId}/events?limit=${limit}`),

  getTaskOutputs: (taskId: string) =>
    fetchAPI(`${API_BASE}/tasks/${taskId}/output`),

  cancelTask: (taskId: string, reason?: string) =>
    fetchAPI(`${API_BASE}/tasks/${taskId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    }),

  getAgents: () =>
    fetchAPI(`${API_BASE}/agents`),

  getAgent: (agentId: string) =>
    fetchAPI(`${API_BASE}/agents/${agentId}`),

  getSkills: () =>
    fetchAPI(`${API_BASE}/skills`),

  getSkill: (skillId: string) =>
    fetchAPI(`${API_BASE}/skills/${skillId}`),

  getKnowledge: (limit = 50, offset = 0) =>
    fetchAPI(`${API_BASE}/knowledge?limit=${limit}&offset=${offset}`),

  searchKnowledge: (query: string) =>
    fetchAPI(`${API_BASE}/knowledge/search`, {
      method: 'POST',
      body: JSON.stringify({ query })
    }),

  getMemories: (agentId?: string, conversationId?: string) => {
    const params = new URLSearchParams();
    if (agentId) params.append('agentId', agentId);
    if (conversationId) params.append('conversationId', conversationId);
    return fetchAPI(`${API_BASE}/memories?${params}`);
  },

  getConfig: () =>
    fetchAPI(`${API_BASE}/config`),

  createKnowledgeDocument: (title: string, content: string, sourceType = 'manual') =>
    fetchAPI(`${API_BASE}/knowledge`, {
      method: 'POST',
      body: JSON.stringify({ title, content, sourceType })
    }),

  deleteKnowledgeDocument: (id: string) =>
    fetchAPI(`${API_BASE}/knowledge/${id}`, { method: 'DELETE' }),

  createAgent: (data: { name: string; type: string; role: string; model: string; temperature: number }) =>
    fetchAPI(`${API_BASE}/agents`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),

  deleteAgent: (id: string) =>
    fetchAPI(`${API_BASE}/agents/${id}`, { method: 'DELETE' }),

  createSkill: (data: { name: string; description: string; instructions: string }) =>
    fetchAPI(`${API_BASE}/skills`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),

  deleteSkill: (id: string) =>
    fetchAPI(`${API_BASE}/skills/${id}`, { method: 'DELETE' }),

  activateSkill: (id: string) =>
    fetchAPI(`${API_BASE}/skills/${id}/activate`, { method: 'POST' }),

  deleteMemory: (id: string) =>
    fetchAPI(`${API_BASE}/memories/${id}`, { method: 'DELETE' }),

  getTaskReport: (taskId: string) =>
    fetchAPI(`${API_BASE}/tasks/${taskId}/report`),

  getTaskTimeline: (taskId: string) =>
    fetchAPI(`${API_BASE}/tasks/${taskId}/timeline`),

  grantPermission: (id: string, reason?: string) =>
    fetchAPI(`${API_BASE}/permissions/${id}/grant`, {
      method: 'POST',
      body: JSON.stringify({ decidedBy: 'user', reason })
    }),

  denyPermission: (id: string, reason?: string) =>
    fetchAPI(`${API_BASE}/permissions/${id}/deny`, {
      method: 'POST',
      body: JSON.stringify({ decidedBy: 'user', reason })
    }),

  getPendingPermissions: () =>
    fetchAPI(`${API_BASE}/permission-requests?status=pending`),

  exportTasks: (conversationId?: string) =>
    fetchAPI(`${API_BASE}/export/tasks`, {
      method: 'POST',
      body: JSON.stringify({ conversationId, format: 'json' })
    }),

  exportKnowledge: () =>
    fetchAPI(`${API_BASE}/export/knowledge`, {
      method: 'POST',
      body: JSON.stringify({ format: 'json' })
    }),

  exportMemories: (agentId?: string) =>
    fetchAPI(`${API_BASE}/export/memories`, {
      method: 'POST',
      body: JSON.stringify({ agentId, format: 'json' })
    }),

  runDailyConsolidation: (agentId?: string) =>
    fetchAPI(`${API_BASE}/memory-consolidations/daily/rerun`, {
      method: 'POST',
      body: JSON.stringify({ agentId })
    }),

  getQueueStatus: (agentId: string) =>
    fetchAPI(`${API_BASE}/agents/${agentId}/queue`),

  getModels: () =>
    fetchAPI(`${API_BASE}/config/models`),

  createModel: (data: {
    id: string;
    name: string;
    provider: string;
    baseUrl?: string;
    apiKey?: string;
    defaultTemperature?: number;
    defaultMaxTokens?: number;
    timeout?: number;
    enabled?: boolean;
  }) =>
    fetchAPI(`${API_BASE}/config/models`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),

  updateModel: (id: string, data: Partial<{
    name: string;
    provider: string;
    baseUrl: string;
    apiKey: string;
    defaultTemperature: number;
    defaultMaxTokens: number;
    timeout: number;
    enabled: boolean;
  }>) =>
    fetchAPI(`${API_BASE}/config/models/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    }),

  deleteModel: (id: string) =>
    fetchAPI(`${API_BASE}/config/models/${id}`, { method: 'DELETE' }),

  setDefaultModel: (id: string) =>
    fetchAPI(`${API_BASE}/config/models/${id}/set-default`, { method: 'POST' }),

  testModel: (modelId: string) =>
    fetchAPI(`${API_BASE}/config/models/test`, {
      method: 'POST',
      body: JSON.stringify({ model: modelId })
    })
};