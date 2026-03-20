export enum TaskStatus {
  PENDING = 'pending',
  CLARIFICATION_PENDING = 'clarification_pending',
  PLANNING = 'planning',
  WAITING = 'waiting',
  READY_FOR_PLANNING = 'ready_for_planning',
  PLANNED = 'planned',
  ARRANGED = 'arranged',
  RUNNING = 'running',
  COMPLETED = 'completed',
  PARTIAL_FAILED = 'partial_failed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  TIMED_OUT = 'timed_out',
  MANUALLY_CLOSED = 'manually_closed',
  INTERVENTION_REQUIRED = 'intervention_required'
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
  PLANNING = 'planning',
  QUEUED_CONFIRMED = 'queued_confirmed',
  TRIGGER_REGISTERED = 'trigger_registered',
  ARRANGED = 'arranged',
  ARRANGED_COMPLETED = 'arranged_completed',
  INTERVENTION_REQUIRED = 'intervention_required'
}

export enum UserNotificationStage {
  NONE = 'none',
  ARRANGED = 'arranged',
  INTERVENTION_NOTIFIED = 'intervention_notified',
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

export enum AttachmentParseStatus {
  PENDING = 'pending',
  PARSING = 'parsing',
  SLICING = 'slicing',
  PARSED = 'parsed',
  PARSE_FAILED = 'parse_failed',
  ACCEPTED = 'accepted',
  SKIPPED = 'skipped'
}

export enum AttachmentUploadStatus {
  PENDING = 'pending',
  UPLOADING = 'uploading',
  COMPLETED = 'completed',
  FAILED = 'failed'
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

export const TASK_STATUS_GROUPS = {
  ENTRY_STATES: [
    TaskStatus.CLARIFICATION_PENDING,
    TaskStatus.WAITING,
    TaskStatus.READY_FOR_PLANNING
  ],
  PLANNING_STATES: [
    TaskStatus.PLANNING,
    TaskStatus.PLANNED,
    TaskStatus.ARRANGED
  ],
  EXECUTION_STATES: [
    TaskStatus.RUNNING
  ],
  TERMINAL_STATES: [
    TaskStatus.COMPLETED,
    TaskStatus.PARTIAL_FAILED,
    TaskStatus.FAILED,
    TaskStatus.CANCELLED,
    TaskStatus.TIMED_OUT,
    TaskStatus.MANUALLY_CLOSED,
    TaskStatus.INTERVENTION_REQUIRED
  ]
} as const;

export function isTerminalState(status: string): boolean {
  const terminalStatuses = [
    'completed',
    'partial_failed',
    'failed',
    'cancelled',
    'timed_out',
    'manually_closed',
    'intervention_required'
  ];
  return terminalStatuses.includes(status);
}

export function isExecutableState(status: string): boolean {
  return status === TaskStatus.RUNNING || status === TaskStatus.PLANNED || status === TaskStatus.ARRANGED;
}

export function canCancelState(status: string): boolean {
  return !isTerminalState(status);
}

export function canRetryState(status: string): boolean {
  return status === TaskStatus.FAILED || status === TaskStatus.PARTIAL_FAILED;
}

export function getTerminalStateLabel(status: TaskStatus): string {
  const labels: Record<TaskStatus, string> = {
    [TaskStatus.COMPLETED]: '已完成',
    [TaskStatus.PARTIAL_FAILED]: '部分完成',
    [TaskStatus.FAILED]: '失败',
    [TaskStatus.CANCELLED]: '已取消',
    [TaskStatus.TIMED_OUT]: '超时',
    [TaskStatus.MANUALLY_CLOSED]: '人工关闭',
    [TaskStatus.INTERVENTION_REQUIRED]: '需人工介入',
    [TaskStatus.PENDING]: '待处理',
    [TaskStatus.CLARIFICATION_PENDING]: '待澄清',
    [TaskStatus.PLANNING]: '规划中',
    [TaskStatus.WAITING]: '等待中',
    [TaskStatus.READY_FOR_PLANNING]: '准备规划',
    [TaskStatus.PLANNED]: '已规划',
    [TaskStatus.ARRANGED]: '已安排',
    [TaskStatus.RUNNING]: '执行中'
  };
  return labels[status] || '未知状态';
}
