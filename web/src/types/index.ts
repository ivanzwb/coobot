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
}

export interface Agent {
  id: string;
  name: string;
  type: 'LEADER' | 'DOMAIN';
  modelConfigJson: string;
  promptTemplateId: string | null;
  status: AgentStatus;
  createdAt: string;
  updatedAt: string;
  capabilities?: {
    skills: string[];
    tools: string[];
    status: string;
  };
  skills?: string[];
}

export interface Model {
  id: string;
  name: string;
  type: 'local' | 'api';
  provider: string;
  modelName: string;
  status: 'ready' | 'loading' | 'error' | 'offline';
  contextWindow: number;
  configJson?: string;
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