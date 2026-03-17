import type { PendingAttachment } from '../stores/appStore';

const API_BASE = '/api';

const CLIENT_ID_STORAGE_KEY = 'coobot-client-id';
const ENTRY_POINT = 'web';

function generateClientId() {
  return `web-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function getClientContext() {
  if (typeof window === 'undefined') {
    return { clientId: 'server-render', entryPoint: ENTRY_POINT };
  }

  let clientId = window.localStorage.getItem(CLIENT_ID_STORAGE_KEY);
  if (!clientId) {
    clientId = generateClientId();
    window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, clientId);
  }

  return { clientId, entryPoint: ENTRY_POINT };
}

function buildClientHeaders(headers?: HeadersInit): HeadersInit {
  const { clientId, entryPoint } = getClientContext();

  return {
    'X-Client-Id': clientId,
    'X-Entry-Point': entryPoint,
    ...(headers || {})
  };
}

export { buildClientHeaders };

async function fetchAPI<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers || {});

  if (!(options?.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
}

export const api = {
  getConversation: (conversationId?: string) =>
    fetchAPI(`${API_BASE}${conversationId ? `/conversation/${conversationId}` : '/conversation'}`, {
      headers: buildClientHeaders()
    }),

  getMessages: (conversationId: string, limit = 50, offset = 0) =>
    fetchAPI(`${API_BASE}/conversation/messages?conversationId=${conversationId}&limit=${limit}&offset=${offset}`, {
      headers: buildClientHeaders()
    }),

  sendMessage: (conversationId: string, content: string, attachments?: PendingAttachment[]) => {
    const body = new FormData();
    body.append('conversationId', conversationId);
    body.append('content', content);
    if (attachments) {
      attachments.forEach((att, idx) => {
        if (att.file) {
          body.append('files', att.file, att.name);
        } else {
          body.append(`attachment_${idx}_type`, att.type);
          body.append(`attachment_${idx}_name`, att.name);
          body.append(`attachment_${idx}_url`, att.url);
        }
      });
    }

    return fetchAPI(`${API_BASE}/conversation/messages`, {
      method: 'POST',
      headers: buildClientHeaders(),
      body
    });
  },

  getTasks: (conversationId: string, limit = 50, offset = 0) =>
    fetchAPI(`${API_BASE}/tasks?conversationId=${conversationId}&limit=${limit}&offset=${offset}`, {
      headers: buildClientHeaders()
    }),

  getTask: (taskId: string) =>
    fetchAPI(`${API_BASE}/tasks/${taskId}`, {
      headers: buildClientHeaders()
    }),

  getTaskSteps: (taskId: string) =>
    fetchAPI(`${API_BASE}/tasks/${taskId}/steps`, {
      headers: buildClientHeaders()
    }),

  getTaskEvents: (taskId: string, limit = 100) =>
    fetchAPI(`${API_BASE}/tasks/${taskId}/events?limit=${limit}`, {
      headers: buildClientHeaders()
    }),

  getTaskOutputs: (taskId: string) =>
    fetchAPI(`${API_BASE}/tasks/${taskId}/output`, {
      headers: buildClientHeaders()
    }),

  cancelTask: (taskId: string, reason?: string) =>
    fetchAPI(`${API_BASE}/tasks/${taskId}/cancel`, {
      method: 'POST',
      headers: buildClientHeaders(),
      body: JSON.stringify({ reason })
    }),

  retryTask: (taskId: string) =>
    fetchAPI(`${API_BASE}/tasks/${taskId}/retry`, {
      method: 'POST',
      headers: buildClientHeaders()
    }),

  confirmTrigger: (taskId: string, triggerMode: string) =>
    fetchAPI(`${API_BASE}/tasks/${taskId}/confirm-trigger`, {
      method: 'POST',
      headers: buildClientHeaders(),
      body: JSON.stringify({ triggerMode })
    }),

  clarifyTask: (taskId: string, providedInputs: Record<string, unknown>) =>
    fetchAPI(`${API_BASE}/tasks/${taskId}/clarify`, {
      method: 'POST',
      headers: buildClientHeaders(),
      body: JSON.stringify({ providedInputs })
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
    fetchAPI(`${API_BASE}/tasks/${taskId}/report`, {
      headers: buildClientHeaders()
    }),

  getMemoryEntrySource: (memoryEntryId: string) =>
    fetchAPI(`${API_BASE}/memory-entries/${memoryEntryId}/source`, {
      headers: buildClientHeaders()
    }),

  getTaskTimeline: (taskId: string) =>
    fetchAPI(`${API_BASE}/tasks/${taskId}/timeline`, {
      headers: buildClientHeaders()
    }),

  grantPermission: (id: string, reason?: string) =>
    fetchAPI(`${API_BASE}/permissions/${id}/grant`, {
      method: 'POST',
      headers: buildClientHeaders(),
      body: JSON.stringify({ decidedBy: 'user', reason })
    }),

  approvePermissionRequest: (id: string, reason?: string) =>
    fetchAPI(`${API_BASE}/permission-requests/${id}/approve`, {
      method: 'POST',
      headers: buildClientHeaders(),
      body: JSON.stringify({ decidedBy: 'user', reason })
    }),

  denyPermission: (id: string, reason?: string) =>
    fetchAPI(`${API_BASE}/permissions/${id}/deny`, {
      method: 'POST',
      headers: buildClientHeaders(),
      body: JSON.stringify({ decidedBy: 'user', reason })
    }),

  rejectPermissionRequest: (id: string, reason?: string) =>
    fetchAPI(`${API_BASE}/permission-requests/${id}/reject`, {
      method: 'POST',
      headers: buildClientHeaders(),
      body: JSON.stringify({ decidedBy: 'user', reason })
    }),

  getPendingPermissions: () =>
    fetchAPI(`${API_BASE}/permission-requests?status=pending`, {
      headers: buildClientHeaders()
    }),

  exportTasks: (conversationId?: string) =>
    fetchAPI(`${API_BASE}/export/tasks`, {
      method: 'POST',
      body: JSON.stringify({ conversationId, format: 'json' })
    }),

  addKnowledgeDocument: (agentId: string, data: {
    title: string;
    content: string;
    sourceType?: string;
    sourceTaskId?: string;
    sourceOutputId?: string;
    documentType?: string;
  }) =>
    fetchAPI(`${API_BASE}/knowledge-bases/${agentId}/documents`, {
      method: 'POST',
      body: JSON.stringify(data)
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

  runDailyConsolidation: (agentId?: string, date?: string) =>
    fetchAPI(`${API_BASE}/memory-consolidations/daily/rerun`, {
      method: 'POST',
      body: JSON.stringify({ agentId, date })
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
    }),

  getDashboard: () =>
    fetchAPI(`${API_BASE}/monitoring/dashboard`),

  getHealthStatus: () =>
    fetchAPI(`${API_BASE}/monitoring/health`),

  getAlerts: (level?: string) =>
    fetchAPI(`${API_BASE}/monitoring/alerts${level ? `?level=${level}` : ''}`),

  getTaskMetrics: (timeRange?: string) =>
    fetchAPI(`${API_BASE}/monitoring/tasks${timeRange ? `?range=${timeRange}` : ''}`),

  getModelMetrics: (timeRange?: string) =>
    fetchAPI(`${API_BASE}/monitoring/models${timeRange ? `?range=${timeRange}` : ''}`),

  getResourceMetrics: () =>
    fetchAPI(`${API_BASE}/monitoring/resources`),

  acknowledgeAlert: (alertId: string) =>
    fetchAPI(`${API_BASE}/monitoring/alerts/${alertId}/acknowledge`, { method: 'POST' }),

  getImportHistory: () =>
    fetchAPI(`${API_BASE}/knowledge/import-history`),

  getDailyConsolidationHistory: (agentId?: string) =>
    fetchAPI(`${API_BASE}/memory-consolidations/daily/history${agentId ? `?agentId=${agentId}` : ''}`)

};