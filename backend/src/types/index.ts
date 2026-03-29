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

export type AgentType = 'LEADER' | 'DOMAIN';

export type TriggerMode = 'immediate' | 'scheduled' | 'event_triggered';

export type ToolPolicy = 'DENY' | 'ASK' | 'ALLOW';

export type MemoryCategory = 'preference' | 'fact' | 'project' | 'summary';

export type JobStatus = 'SUCCESS' | 'FAILED' | 'SKIPPED' | 'MISSED';

export type SkillInstallMode = 'copy_only' | 'managed';

export interface TaskInput {
  content: string;
  attachments?: Attachment[];
  triggerMode?: TriggerMode;
}

export interface Attachment {
  fileId: string;
  name: string;
  path: string;
  type: string;
}

export interface AgentConfig {
  id: string;
  name: string;
  type: AgentType;
  modelConfig: ModelConfig;
  temperature?: number;
  rolePrompt?: string;
  behaviorRules?: string;
  capabilityBoundary?: string;
  skills?: string[];
  knowledgeFiles?: string[];
  status: AgentStatus;
}

export interface ModelConfig {
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  contextWindow?: number;
}

export interface DomainAgentProfile {
  agentId: string;
  name: string;
  status: 'ONLINE' | 'BUSY' | 'OFFLINE';
  skills: string[];
  tools: string[];
  rolePrompt?: string;
  behaviorRules?: string;
  capabilityBoundary?: string;
}

export interface DAGNode {
  id: string;
  description: string;
  assignedAgentId: string;
  requiredSkills: string[];
  dependencies: string[];
  inputSources?: string[];
}

export interface ValidationReport {
  dag: DAGNode[];
  unassignableTasks: UnassignableIssue[];
}

export interface UnassignableIssue {
  nodeId: string;
  reason: string;
  missingSkill: string;
}

export interface IntentResult {
  status: 'READY_TO_PLAN' | 'CLARIFICATION_NEEDED';
  intent?: string;
  refinedGoal?: string;
  questions?: string[];
  reason?: string;
}

export interface LtmQueryResult {
  id: string;
  content: string;
  matchScore: number;
  timestamp: Date;
  type: 'fact' | 'preference' | 'session_summary';
}

export interface PermissionResult {
  policy: ToolPolicy;
  requiresUserConfirmation?: boolean;
}

export interface ScheduledJobConfig {
  prompt: string;
  targetAgentId: string;
  attachments: string[];
  clarificationData: Record<string, unknown> | null;
}

export interface AuditEvent {
  eventType: string;
  actorId: string;
  taskId?: string;
  details: Record<string, unknown>;
  result: string;
  timestamp?: Date;
}

export interface ResourceMetrics {
  cpu: number;
  memory: number;
  disk: number;
}

export interface AgentMatrixDTO {
  agentId: string;
  name: string;
  status: AgentStatus;
  currentTaskId?: string;
  queueLength: number;
}

export interface TaskTimelineNode {
  taskId: string;
  agentId: string;
  status: TaskStatus;
  startTime: Date;
  endTime?: Date;
  children?: TaskTimelineNode[];
}