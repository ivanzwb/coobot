export enum TaskStatus {
  PENDING = 'pending',
  PLANNING = 'planning',
  ARRANGED = 'arranged',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled'
}

export enum TriggerMode {
  IMMEDIATE = 'immediate',
  QUEUED = 'queued',
  SCHEDULED = 'scheduled',
  EVENT_TRIGGERED = 'event_triggered',
  CLARIFICATION_PENDING = 'clarification_pending'
}

export enum TriggerStatus {
  READY = 'ready',
  QUEUED = 'queued',
  WAITING_SCHEDULE = 'waiting_schedule',
  WAITING_EVENT = 'waiting_event',
  TRIGGERED = 'triggered'
}

export enum TaskComplexity {
  SIMPLE = 'simple',
  COMPLEX = 'complex'
}

export enum ArrangementStatus {
  WAITING_FOR_ARRANGEMENT = 'waiting_for_arrangement',
  ARRANGED = 'arranged'
}

export enum UserNotificationStage {
  NONE = 'none',
  ARRANGED = 'arranged',
  FINAL_NOTIFIED = 'final_notified'
}

export enum OutputStage {
  NONE = 'none',
  ARRANGED_ONLY = 'arranged_only',
  FINAL = 'final'
}

export enum StepStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  WAITING = 'waiting',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped'
}

export enum AgentType {
  LEADER = 'leader',
  DOMAIN = 'domain'
}

export enum AgentStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive'
}

export enum MemoryType {
  SHORT_TERM = 'short_term',
  AGENT = 'agent',
  PERSISTENT = 'persistent'
}

export enum Importance {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high'
}

export enum WaitSubscriptionType {
  QUEUED = 'queued',
  SCHEDULED = 'scheduled',
  EVENT_TRIGGERED = 'event_triggered'
}

export enum WaitSubscriptionStatus {
  ACTIVE = 'active',
  RELEASED = 'released',
  CANCELLED = 'cancelled'
}

export enum PermissionAction {
  READ = 'read',
  WRITE = 'write',
  EXECUTE = 'execute'
}

export enum PermissionDecision {
  ALLOW = 'allow',
  ASK = 'ask',
  DENY = 'deny'
}

export enum PermissionRequestStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  DENIED = 'denied'
}

export const WAIT_ANOMALY_CODES = {
  WAIT_TIMEOUT: 'WAIT_TIMEOUT',
  TRIGGER_INVALIDATED: 'TRIGGER_INVALIDATED',
  SNAPSHOT_INVALIDATED: 'SNAPSHOT_INVALIDATED',
  MAX_RETRY_EXCEEDED: 'MAX_RETRY_EXCEEDED'
} as const;

export const SNAPSHOT_RESOLUTIONS = {
  UNCHANGED: 'unchanged',
  DEGRADED_CONTINUE: 'degraded_continue',
  MANUAL_INTERVENTION_REQUIRED: 'manual_intervention_required',
  TERMINATED: 'terminated'
} as const;