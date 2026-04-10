export type TaskStatus = 
  | 'WAITING_FOR_LEADER'
  | 'CLARIFICATION_PENDING'
  | 'PARSING'
  | 'DISPATCHING'
  | 'QUEUED'
  | 'QUEUED_WAITING_RESOURCE'
  | 'RUNNING'
  | 'AGGREGATING'
  | 'COMPLETED'
  | 'EXCEPTION'
  | 'TERMINATED';

export type AgentStatus = 'IDLE' | 'RUNNING' | 'BUSY_WITH_QUEUE';

export interface Task {
  id: string;
  parentTaskId: string | null;
  rootTaskId: string;
  assignedAgentId: string;
  status: TaskStatus;
  triggerMode: 'immediate' | 'scheduled' | 'event_triggered';
  inputPayload: string;
  outputSummary: string | null;
  errorMsg: string | null;
  retryCount: number;
  heartbeat: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** OpenAI-style LLM usage for this task row (Leader planning and/or AgentBrain execution). */
  llmPromptTokens?: number | null;
  llmCompletionTokens?: number | null;
  llmTotalTokens?: number | null;
}

export interface TokenDailyStat {
  date: string;
  totalTokens: number;
  taskCount: number;
  promptTokens: number;
  completionTokens: number;
}

export interface TokenMetricsResponse {
  days: number;
  since: string;
  daily: TokenDailyStat[];
  totals: {
    tasksWithLlmUsage: number;
    totalTokens: number;
    avgTokensPerTask: number;
  };
}

export interface Agent {
  id: string;
  name: string;
  type: 'LEADER' | 'DOMAIN';
  modelConfigId: string | null;
  modelConfig: ModelConfig | null;
  temperature: number | null;
  status: AgentStatus;
  createdAt: string;
  updatedAt: string;
  rolePrompt?: string;
  behaviorRules?: string;
  capabilityBoundary?: string;
  capabilities?: {
    skills: string[];
    tools: string[];
    status: string;
  };
  skills?: string[];
}

export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  modelName: string;
  baseUrl: string | null;
  apiKey: string | null;
  contextWindow: number | null;
  temperature: number | null;
  status: 'ready' | 'loading' | 'error' | 'offline';
}

export interface Model extends ModelConfig {
  type: 'local' | 'api';
}

export interface KnowledgeFile {
  id: string;
  agentId: string;
  fileName: string;
  filePath: string;
  status: 'PROCESSING' | 'READY' | 'ERROR';
  version: number;
  createdAt: string;
}

export interface Message {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachmentsJson: string | null;
  relatedTaskId: string | null;
  metaJson: string | null;
  summary: string | null;
  tokenCount: number;
  createdAt: string;
  isArchived: boolean;
}

export interface LongTermMemory {
  id: string;
  agentId: string;
  category: 'preference' | 'fact' | 'project' | 'summary';
  key: string;
  value: string;
  confidence: number;
  accessCount: number;
  lastAccessed: string;
  isActive: boolean;
  createdAt: string;
}

/** 合并 Coobot Drizzle LTM 与 `@biosbot/agent-memory` 长期记忆（记忆管理列表）。 */
export interface UnifiedLtmItem {
  id: string;
  store: 'agent-memory' | 'coobot';
  category: string;
  key: string;
  value: string;
  agentId?: string | null;
  confidence?: number;
  accessCount?: number;
  lastAccessed?: string | null;
  isActive?: boolean;
  createdAt?: string | null;
  score?: number;
}

export interface MemoryDashboardData {
  stm: {
    activeCount: number;
    archivedCount: number;
    recentMessages: { role: string; content: string; timestamp: string }[];
  };
  ltm: {
    totalCount: number;
    byCategory: Record<string, number>;
    coobotTotal: number;
    brainLtmActive: number;
    brainLtmDormant: number;
  };
  agentMemory: {
    stats: {
      conversation: { activeCount: number; archivedCount: number };
      longTerm: { activeCount: number; dormantCount: number; deletedCount: number };
      knowledge: { chunkCount: number; sourceCount: number };
      storage: { sqliteBytes: number; vectorIndexBytes: number };
    };
    recentMessages: { conversationId: string; role: string; content: string; createdAt: string }[];
    knowledgePreview: { id: string; source: string; title: string; preview: string }[];
  } | null;
}

export type CreateLtmPayload = {
  store?: 'agent-memory' | 'coobot';
  agentId?: string;
  category: string;
  key: string;
  value: string;
  confidence?: number;
};

export interface ScheduledJob {
  id: string;
  name: string;
  description: string;
  cronExpression: string;
  timezone: string;
  taskTemplateJson: string;
  enabled: boolean;
  concurrencyPolicy: 'FORBID' | 'ALLOW' | 'REPLACE';
  lastRunAt: string | null;
  nextRunAt: string;
  createdAt: string;
}

/** Cron jobs created in chat via AgentBrain `cron_add` (CoobotCronHub). */
export interface AgentBrainCronJob {
  id: string;
  name: string;
  cronExpression: string;
  command: string;
  status: string;
  nextRunTime?: string;
  lastRunTime?: string;
  lastStatus?: string;
  lastError?: string;
  createdAt: string;
}

export interface AgentMetrics {
  agentId: string;
  name: string;
  status: AgentStatus;
  currentTaskId: string | null;
  queueLength: number;
}

export interface ResourceMetrics {
  cpu: number;
  memory: number;
  memoryUsed: number;
  memoryTotal: number;
}

export interface SystemConfig {
  workspacePath: string;
  systemName: string;
  contextRetentionRounds: number;
  resourceThresholds: {
    cpu: number;
    memory: number;
  };
  authTimeoutMinutes: number;
  backupEnabled: boolean;
  backupPath: string;
}