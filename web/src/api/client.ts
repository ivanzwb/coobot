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

export class ApiError extends Error {
  code?: string;
  details?: unknown;

  constructor(message: string, code?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

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
    const error = await response.json().catch(() => null as any);
    const code = error?.code || error?.error?.code;
    const details = error?.details || error?.validation || error;
    const errorMessage =
      (typeof error?.message === 'string' && error.message)
      || (typeof error?.error === 'string' && error.error)
      || (typeof error?.error?.message === 'string' && error.error.message)
      || `HTTP ${response.status}`;
    throw new ApiError(errorMessage, code, details);
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

  uploadKnowledgeFile: (file: File, agentId?: string) => {
    return api.uploadKnowledgeFiles([file], agentId);
  },

  uploadKnowledgeFiles: (files: File[], agentId?: string) => {
    const body = new FormData();
    files.forEach((file) => {
      body.append('files', file, file.name);
    });
    if (agentId) {
      body.append('agentId', agentId);
    }

    return fetchAPI(`${API_BASE}/knowledge/upload`, {
      method: 'POST',
      body
    });
  },

  updateKnowledgeDocumentTitle: (id: string, title: string) =>
    fetchAPI(`${API_BASE}/knowledge/${id}/title`, {
      method: 'PATCH',
      body: JSON.stringify({ title })
    }),

  deleteKnowledgeDocument: (id: string) =>
    fetchAPI(`${API_BASE}/knowledge/${id}`, { method: 'DELETE' }),

  createAgent: (data: {
    name: string;
    model: string;
    temperature: number;
    skills?: string[];
    skillPermissionBindings?: Array<{
      skillId: string;
      toolName: string;
      readAction: 'allow' | 'ask' | 'deny';
      writeAction: 'allow' | 'ask' | 'deny';
      executeAction: 'allow' | 'ask' | 'deny';
    }>;
    promptProfile?: {
      templateId: string;
      templateVersion: number;
    };
  }) =>
    fetchAPI(`${API_BASE}/agents`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),

  updateAgent: (
    id: string,
    data: Partial<{
      name: string;
      model: string;
      temperature: number;
      status: string;
      skills: string[];
      skillPermissionBindings: Array<{
        skillId: string;
        toolName: string;
        readAction: 'allow' | 'ask' | 'deny';
        writeAction: 'allow' | 'ask' | 'deny';
        executeAction: 'allow' | 'ask' | 'deny';
      }>;
      promptProfile: {
        templateId: string;
        templateVersion: number;
      };
    }>
  ) =>
    fetchAPI(`${API_BASE}/agents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    }),

  deleteAgent: (id: string) =>
    fetchAPI(`${API_BASE}/agents/${id}`, { method: 'DELETE' }),

  deactivateAgent: (id: string) =>
    fetchAPI(`${API_BASE}/agents/${id}/deactivate`, { method: 'POST' }),

  activateAgent: (id: string) =>
    fetchAPI(`${API_BASE}/agents/${id}/activate`, { method: 'POST' }),

  getAgentSkillPermissions: (id: string) =>
    fetchAPI(`${API_BASE}/agents/${id}/skill-permissions`),

  createSkill: (data: {
    name: string;
    description: string;
    instructions: string;
    runtimeLanguage?: 'javascript' | 'python' | 'ruby' | 'bash' | 'powershell' | null;
    version?: string;
    permissions?: {
      read: 'allow' | 'ask' | 'deny';
      write: 'allow' | 'ask' | 'deny';
      execute: 'allow' | 'ask' | 'deny';
    };
    tools?: Array<{
      name: string;
      description: string;
      permissions: {
        read: 'allow' | 'ask' | 'deny';
        write: 'allow' | 'ask' | 'deny';
        execute: 'allow' | 'ask' | 'deny';
      };
    }>;
  }) =>
    fetchAPI(`${API_BASE}/skills`, {
      method: 'POST',
      body: JSON.stringify(data)
    }),

  importSkillPackage: (file: File) => {
    const body = new FormData();
    body.append('file', file, file.name);
    return fetchAPI(`${API_BASE}/skills/import`, {
      method: 'POST',
      body
    });
  },

  previewSkillPackage: (file: File) => {
    const body = new FormData();
    body.append('file', file, file.name);
    return fetchAPI(`${API_BASE}/skills/preview`, {
      method: 'POST',
      body
    });
  },

  deleteSkill: (id: string) =>
    fetchAPI(`${API_BASE}/skills/${id}`, { method: 'DELETE' }),

  getSkillStatus: (id: string) =>
    fetchAPI(`${API_BASE}/skills/${id}/status`),

  installSkill: (id: string) =>
    fetchAPI(`${API_BASE}/skills/${id}/install`, { method: 'POST' }),

  uninstallSkill: (id: string) =>
    fetchAPI(`${API_BASE}/skills/${id}/uninstall`, { method: 'POST' }),

  updateSkill: (id: string, data: Partial<{
    name: string;
    description: string;
    instructions: string;
    runtimeLanguage: 'javascript' | 'python' | 'ruby' | 'bash' | 'powershell' | null;
    version: string;
    status: string;
    permissions: {
      read: 'allow' | 'ask' | 'deny';
      write: 'allow' | 'ask' | 'deny';
      execute: 'allow' | 'ask' | 'deny';
    };
    tools: Array<{
      name: string;
      description: string;
      permissions: {
        read: 'allow' | 'ask' | 'deny';
        write: 'allow' | 'ask' | 'deny';
        execute: 'allow' | 'ask' | 'deny';
      };
    }>;
  }>) =>
    fetchAPI(`${API_BASE}/skills/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    }),

  activateSkill: (id: string) =>
    fetchAPI(`${API_BASE}/skills/${id}/activate`, { method: 'POST' }),

  deleteMemory: (id: string) =>
    fetchAPI(`${API_BASE}/memories/${id}`, { method: 'DELETE' }),

  updateMemory: (id: string, payload: { content?: string; summary?: string; importance?: 'low' | 'medium' | 'high' }) =>
    fetchAPI(`${API_BASE}/memories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    }),

  getTaskReport: (taskId: string) =>
    fetchAPI(`${API_BASE}/tasks/${taskId}/report`, {
      headers: buildClientHeaders()
    }),

  getTaskExecutionView: (taskId: string) =>
    fetchAPI(`${API_BASE}/tasks/${taskId}/execution-view`, {
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

  getImportHistory: (agentId?: string, limit = 50) => {
    const params = new URLSearchParams();
    params.append('limit', String(limit));
    if (agentId) {
      params.append('agentId', agentId);
    }

    return fetchAPI(`${API_BASE}/knowledge/import-history?${params.toString()}`);
  },

  getDailyConsolidationHistory: (agentId?: string) =>
    fetchAPI(`${API_BASE}/memory-consolidations/daily/history${agentId ? `?agentId=${agentId}` : ''}`),

  getPromptTemplates: async () => {
    const response = await fetchAPI<{ success: boolean; data: unknown[] }>(`${API_BASE}/prompts/templates`);
    return response.data || [];
  },

  getPromptTemplateVersions: async (templateId: string) => {
    const response = await fetchAPI<{ success: boolean; data: unknown[] }>(`${API_BASE}/prompts/templates/${templateId}/versions`);
    return response.data || [];
  },

  getPromptTemplate: async (templateId: string) => {
    const response = await fetchAPI<{ success: boolean; data: unknown }>(`${API_BASE}/prompts/templates/${templateId}`);
    return response.data;
  },

  getPromptTemplateVersion: async (templateId: string, version: number) => {
    const response = await fetchAPI<{ success: boolean; data: unknown }>(`${API_BASE}/prompts/templates/${templateId}/versions/${version}`);
    return response.data;
  },

  createPromptTemplate: async (payload: {
    name: string;
    type: 'leader' | 'domain';
    description?: string;
    changeLog?: string;
    system?: string;
    developer?: string;
    user?: string;
    context?: string;
    toolResult?: string;
    slots?: Array<{ name: string; description: string; required: boolean; defaultValue?: string }>;
  }) => {
    const response = await fetchAPI<{ success: boolean; data: unknown }>(`${API_BASE}/prompts/templates`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    return response.data;
  },

  updatePromptTemplate: async (templateId: string, payload: {
    name?: string;
    type?: 'leader' | 'domain';
    description?: string;
    promptContent?: string;
    changeLog?: string;
  }) => {
    const response = await fetchAPI<{ success: boolean; data: unknown }>(`${API_BASE}/prompts/templates/${templateId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
    return response.data;
  },

  deletePromptTemplate: async (templateId: string) => {
    await fetchAPI<{ success: boolean }>(`${API_BASE}/prompts/templates/${templateId}`, {
      method: 'DELETE'
    });
  },

  createPromptTemplateVersion: async (templateId: string, payload: {
    system?: string;
    developer?: string;
    user?: string;
    context?: string;
    toolResult?: string;
    slots?: Array<{ name: string; description: string; required: boolean; defaultValue?: string }>;
    changeLog: string;
  }) => {
    const response = await fetchAPI<{ success: boolean; data: unknown }>(`${API_BASE}/prompts/templates/${templateId}/versions`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    return response.data;
  },

  rollbackPromptTemplateVersion: async (templateId: string, version: number, reason?: string) => {
    const response = await fetchAPI<{ success: boolean; data: unknown }>(`${API_BASE}/prompts/templates/${templateId}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ version, reason })
    });
    return response.data;
  },

  getAgentPromptProfile: async (agentId: string) => {
    const response = await fetchAPI<{ success: boolean; data: unknown }>(`${API_BASE}/prompts/profiles/${agentId}`);
    return response.data;
  },

  createAgentPromptProfile: async (agentId: string, payload: {
    templateId?: string;
    templateVersion?: number;
    roleDefinition: string;
    behaviorNorm: string;
    capabilityBoundary: string;
    customSlots?: Record<string, string>;
  }) => {
    const response = await fetchAPI<{ success: boolean; data: unknown }>(`${API_BASE}/prompts/profiles/${agentId}`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    return response.data;
  },

  updateAgentPromptProfile: async (agentId: string, payload: {
    templateId?: string;
    templateVersion?: number;
    roleDefinition?: string;
    behaviorNorm?: string;
    capabilityBoundary?: string;
    customSlots?: Record<string, string>;
  }) => {
    const response = await fetchAPI<{ success: boolean; data: unknown }>(`${API_BASE}/prompts/profiles/${agentId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
    return response.data;
  },

  migrateAgentPromptProfile: async (agentId: string, targetTemplateId: string, targetVersion: number) => {
    const response = await fetchAPI<{ success: boolean; data: unknown }>(`${API_BASE}/prompts/profiles/${agentId}/migrate`, {
      method: 'POST',
      body: JSON.stringify({ targetTemplateId, targetVersion })
    });
    return response.data;
  },

  getAgentPromptMigrations: async (agentId: string) => {
    const response = await fetchAPI<{ success: boolean; data: unknown[] }>(`${API_BASE}/prompts/profiles/${agentId}/migrations`);
    return response.data || [];
  }

};