export interface CreateConversationDTO {
  clientId: string;
  title?: string;
  metadata?: Record<string, any>;
}

export interface CreateMessageDTO {
  conversationId: string;
  entryPoint: string;
  originClientId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  parentMessageId?: string;
}

export interface CreateTaskDTO {
  conversationId?: string;
  triggerMode: 'immediate' | 'wait' | 'confirm';
  entryPoint: string;
  originClientId: string;
  intakeInputSummary: string;
  input?: string;
}

export interface TaskFilterDTO {
  conversationId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface CreateAgentDTO {
  name: string;
  type: 'coordinator' | 'executor';
  role?: string;
  model?: string;
  temperature?: number;
  skills?: string[];
  knowledgeBases?: string[];
}

export interface UpdateAgentDTO {
  name?: string;
  role?: string;
  model?: string;
  temperature?: number;
  skills?: string[];
  knowledgeBases?: string[];
  enabled?: boolean;
}

export interface CreateSkillDTO {
  name: string;
  description?: string;
  instructions?: string;
  permissions?: string[];
  tools?: string[];
}

export interface UpdateSkillDTO {
  name?: string;
  description?: string;
  instructions?: string;
  permissions?: string[];
  tools?: string[];
  enabled?: boolean;
}

export interface CreateKnowledgeDocumentDTO {
  title: string;
  content: string;
  sourceType?: 'manual' | 'file' | 'web';
  metadata?: Record<string, any>;
}

export interface SearchKnowledgeDTO {
  query: string;
  limit?: number;
  agentId?: string;
}

export interface CreateMemoryDTO {
  agentId?: string;
  conversationId?: string;
  taskId?: string;
  type: 'task' | 'conversation' | 'user';
  content: string;
  summary?: string;
  sourceType?: string;
  importance?: number;
}

export interface CreatePolicyDTO {
  name: string;
  priority?: number;
  agentId?: string;
  skillId?: string;
  toolName?: string;
  resourcePattern?: string;
  readAction?: 'allow' | 'deny' | 'prompt';
  writeAction?: 'allow' | 'deny' | 'prompt';
  executeAction?: 'allow' | 'deny' | 'prompt';
}

export interface UpdatePolicyDTO {
  name?: string;
  priority?: number;
  readAction?: 'allow' | 'deny' | 'prompt';
  writeAction?: 'allow' | 'deny' | 'prompt';
  executeAction?: 'allow' | 'deny' | 'prompt';
}

export interface PermissionDecisionDTO {
  decidedBy: string;
  reason?: string;
}

export interface CancelTaskDTO {
  reason?: string;
}

export interface ConfirmTriggerDTO {
  triggerMode: 'immediate' | 'wait' | 'confirm';
}

export interface ClarifyInputsDTO {
  providedInputs: Record<string, any>;
}

export interface BatchDeleteDTO {
  ids: string[];
}

export interface ExportDTO {
  conversationId?: string;
  agentId?: string;
  format?: 'json' | 'csv';
}

export interface MemoryConsolidationDTO {
  agentId?: string;
  date?: string;
}

export interface ConfigUpdateDTO {
  llm?: {
    defaultModel?: string;
    apiKey?: string;
    baseUrl?: string;
  };
  scheduler?: {
    scanIntervalMs?: number;
  };
  execution?: {
    maxConcurrentTasks?: number;
  };
}

export interface ModelTestDTO {
  model: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface AttachmentUploadDTO {
  conversationId: string;
  name: string;
  size: number;
  mimeType: string;
  buffer: string;
}

export interface PaginationParams {
  limit?: number;
  offset?: number;
}

export interface PaginationResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  };
}

export interface ApiResponse<T = any> {
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}

export interface TaskTimelineDTO {
  taskId: string;
  events: TaskEventDTO[];
}

export interface TaskEventDTO {
  id: string;
  taskId: string;
  type: string;
  data: Record<string, any>;
  timestamp: string;
}

export interface TaskReportDTO {
  task: any;
  steps: any[];
  outputs: any[];
  events: any[];
  summary: {
    totalSteps: number;
    completedSteps: number;
    failedSteps: number;
    finalOutputReady: boolean;
  };
}

export interface QueueStatusDTO {
  agentId: string;
  waiting: number;
  running: number;
  completed: number;
  failed: number;
}
