import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  title: text('title').notNull().default('新会话'),
  status: text('status').notNull().default('active'),
  lastActiveClientId: text('last_active_client_id'),
  latestTaskId: text('latest_task_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  lastMessageAt: integer('last_message_at', { mode: 'timestamp' })
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id),
  taskId: text('task_id'),
  entryPoint: text('entry_point').notNull().default('web'),
  originClientId: text('origin_client_id'),
  syncPolicy: text('sync_policy').default('synced_clients'),
  visibleClientIds: text('visible_client_ids'),
  role: text('role').notNull(),
  content: text('content').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
});

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  parentTaskId: text('parent_task_id'),
  conversationId: text('conversation_id').notNull().references(() => conversations.id),
  status: text('status').notNull().default('pending'),
  triggerMode: text('trigger_mode').notNull().default('immediate'),
  triggerStatus: text('trigger_status').default('ready'),
  scheduledAt: integer('scheduled_at', { mode: 'timestamp' }),
  triggerRule: text('trigger_rule'),
  triggerDecisionSummary: text('trigger_decision_summary'),
  complexity: text('complexity').default('simple'),
  complexityDecisionSummary: text('complexity_decision_summary'),
  clarificationRequiredFields: text('clarification_required_fields'),
  clarificationResolutionSummary: text('clarification_resolution_summary'),
  clarificationClosedReason: text('clarification_closed_reason'),
  nextTriggerCheckAt: integer('next_trigger_check_at', { mode: 'timestamp' }),
  intakeInputSummary: text('intake_input_summary'),
  entryPoint: text('entry_point').notNull().default('web'),
  originClientId: text('origin_client_id'),
  syncPolicy: text('sync_policy').default('synced_clients'),
  visibleClientIds: text('visible_client_ids'),
  displayScope: text('display_scope').default('origin_only'),
  queuePosition: integer('queue_position'),
  assignedDomainAgentId: text('assigned_domain_agent_id'),
  arrangementStatus: text('arrangement_status'),
  arrangementSummary: text('arrangement_summary'),
  estimatedCompletionAt: integer('estimated_completion_at', { mode: 'timestamp' }),
  estimatedDurationMinutes: integer('estimated_duration_minutes'),
  userNotificationStage: text('user_notification_stage').default('none'),
  outputStage: text('output_stage').default('none'),
  finalOutputReady: integer('final_output_ready', { mode: 'boolean' }).default(false),
  waitingAnomalyCode: text('waiting_anomaly_code'),
  waitingAnomalySummary: text('waiting_anomaly_summary'),
  lastTriggerEvaluationSummary: text('last_trigger_evaluation_summary'),
  waitingThresholdMode: text('waiting_threshold_mode'),
  waitingThresholdBasisSummary: text('waiting_threshold_basis_summary'),
  interventionRequiredReason: text('intervention_required_reason'),
  currentStepId: text('current_step_id'),
  assignedLeaderAgentId: text('assigned_leader_agent_id'),
  routeDecisionSummary: text('route_decision_summary'),
  currentReasoningSummary: text('current_reasoning_summary'),
  lastObservationSummary: text('last_observation_summary'),
  nextActionSummary: text('next_action_summary'),
  selectedAgentIds: text('selected_agent_ids'),
  selectedSkillIds: text('selected_skill_ids'),
  memoryScope: text('memory_scope').default('conversation'),
  selectedMemoryEntryIdsSnapshot: text('selected_memory_entry_ids_snapshot'),
  invalidMemoryEntryIds: text('invalid_memory_entry_ids'),
  snapshotResolution: text('snapshot_resolution'),
  memoryLoadSummary: text('memory_load_summary'),
  memoryWriteSummary: text('memory_write_summary'),
  aggregateVersion: text('aggregate_version'),
  pendingWriteCommandCount: integer('pending_write_command_count').default(0),
  lastAcceptedWriteCommandId: text('last_accepted_write_command_id'),
  lastEventSequence: integer('last_event_sequence').default(0),
  lastEventCursor: text('last_event_cursor'),
  permissionStatus: text('permission_status').default('not_required'),
  permissionSummary: text('permission_summary'),
  permissionDecisionTrace: text('permission_decision_trace'),
  terminalSummary: text('terminal_summary'),
  closeReason: text('close_reason'),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  retryable: integer('retryable', { mode: 'boolean' }).default(false),
  retryCount: integer('retry_count').default(0),
  lastRetrySource: text('last_retry_source'),
  degradeReason: text('degrade_reason'),
  degradeAction: text('degrade_action'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  completedAt: integer('completed_at', { mode: 'timestamp' })
});

export const taskSteps = sqliteTable('task_steps', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => tasks.id),
  agentId: text('agent_id').notNull(),
  stepOrder: integer('step_order').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull().default('pending'),
  reasoningSummary: text('reasoning_summary'),
  actionSummary: text('action_summary'),
  observationSummary: text('observation_summary'),
  parallelGroupId: text('parallel_group_id'),
  waitingReason: text('waiting_reason'),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  duration: integer('duration').default(0),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
});

export const taskOutputs = sqliteTable('task_outputs', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => tasks.id),
  type: text('type').notNull(),
  content: text('content'),
  summary: text('summary'),
  references: text('references'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
});

export const taskEvents = sqliteTable('task_events', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => tasks.id),
  sequence: integer('sequence').notNull(),
  eventType: text('event_type').notNull(),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  summary: text('summary'),
  payload: text('payload'),
  stepId: text('step_id'),
  agentId: text('agent_id')
});

export const attachments = sqliteTable('attachments', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').references(() => conversations.id),
  taskId: text('task_id').references(() => tasks.id),
  messageId: text('message_id').references(() => messages.id),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type'),
  fileSize: integer('file_size').notNull(),
  pageCount: integer('page_count'),
  storagePath: text('storage_path').notNull(),
  uploadStatus: text('upload_status').notNull().default('pending'),
  parseStatus: text('parse_status').notNull().default('pending'),
  parseMethod: text('parse_method'),
  parseSummary: text('parse_summary'),
  parseConfidence: real('parse_confidence'),
  persistedToKnowledgeBase: integer('persisted_to_knowledge_base', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
});

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  name: text('name').notNull(),
  role: text('role'),
  model: text('model').notNull(),
  temperature: real('temperature').default(0.7),
  maxTokens: integer('max_tokens'),
  skills: text('skills'),
  knowledgeBases: text('knowledge_bases'),
  status: text('status').notNull().default('active'),
  isSystem: integer('is_system', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
});

export const skills = sqliteTable('skills', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').notNull().default('active'),
  permissions: text('permissions'),
  tools: text('tools'),
  instructions: text('instructions'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
});

export const knowledgeDocuments = sqliteTable('knowledge_documents', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  content: text('content'),
  vectorIds: text('vector_ids'),
  sourceType: text('source_type').notNull(),
  sourceTaskId: text('source_task_id'),
  agentId: text('agent_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
});

export const memoryEntries = sqliteTable('memory_entries', {
  id: text('id').primaryKey(),
  agentId: text('agent_id'),
  conversationId: text('conversation_id'),
  taskId: text('task_id'),
  type: text('type').notNull(),
  content: text('content').notNull(),
  summary: text('summary'),
  sourceType: text('source_type'),
  importance: text('importance').default('medium'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  expiresAt: integer('expires_at', { mode: 'timestamp' })
});

export const permissionPolicies = sqliteTable('permission_policies', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  priority: integer('priority').default(0),
  agentId: text('agent_id'),
  skillId: text('skill_id'),
  toolName: text('tool_name'),
  resourcePattern: text('resource_pattern'),
  readAction: text('read_action').default('allow'),
  writeAction: text('write_action').default('ask'),
  executeAction: text('execute_action').default('deny'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
});

export const permissionRequests = sqliteTable('permission_requests', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => tasks.id),
  stepId: text('step_id'),
  action: text('action').notNull(),
  target: text('target').notNull(),
  description: text('description'),
  status: text('status').notNull().default('pending'),
  decidedBy: text('decided_by'),
  decidedAt: integer('decided_at', { mode: 'timestamp' }),
  reason: text('reason'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
});

export const waitSubscriptions = sqliteTable('wait_subscriptions', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => tasks.id),
  type: text('type').notNull(),
  domainAgentId: text('domain_agent_id'),
  queuePosition: integer('queue_position'),
  scheduledAt: integer('scheduled_at', { mode: 'timestamp' }),
  triggerRule: text('trigger_rule'),
  nextCheckAt: integer('next_check_at', { mode: 'timestamp' }).notNull(),
  lastEvaluatedAt: integer('last_evaluated_at', { mode: 'timestamp' }),
  thresholdConfig: text('threshold_config'),
  status: text('status').notNull().default('active'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
});

export const systemConfigs = sqliteTable('system_configs', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  value: text('value').notNull(),
  description: text('description'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
});

export const auditLogs = sqliteTable('audit_logs', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  action: text('action').notNull(),
  resourceType: text('resource_type'),
  resourceId: text('resource_id'),
  details: text('details'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
});

export const taskWriteCommands = sqliteTable('task_write_commands', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => tasks.id),
  commandType: text('command_type').notNull(),
  payload: text('payload'),
  status: text('status').notNull().default('pending'),
  submittedAt: integer('submitted_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  processedAt: integer('processed_at', { mode: 'timestamp' }),
  result: text('result'),
  error: text('error')
});

export const taskInputSlices = sqliteTable('task_input_slices', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => tasks.id),
  sliceIndex: integer('slice_index').notNull(),
  sourceType: text('source_type').notNull(),
  sourceId: text('source_id'),
  content: text('content').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
});

export const taskOutputRefs = sqliteTable('task_output_refs', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => tasks.id),
  stepId: text('step_id'),
  outputId: text('output_id').references(() => taskOutputs.id),
  refType: text('ref_type').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
});

export const agentParticipations = sqliteTable('agent_participations', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => tasks.id),
  agentId: text('agent_id').notNull().references(() => agents.id),
  role: text('role').notNull(),
  joinedAt: integer('joined_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date()),
  leftAt: integer('left_at', { mode: 'timestamp' })
});

export const taskMemoryLinks = sqliteTable('task_memory_links', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => tasks.id),
  memoryId: text('memory_id').notNull().references(() => memoryEntries.id),
  linkType: text('link_type').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
});

export const permissionDecisionLogs = sqliteTable('permission_decision_logs', {
  id: text('id').primaryKey(),
  requestId: text('request_id').notNull().references(() => permissionRequests.id),
  policyId: text('policy_id').references(() => permissionPolicies.id),
  action: text('action').notNull(),
  decision: text('decision').notNull(),
  reason: text('reason'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
});

export const modelCallLogs = sqliteTable('model_call_logs', {
  id: text('id').primaryKey(),
  taskId: text('task_id').references(() => tasks.id),
  stepId: text('step_id'),
  agentId: text('agent_id'),
  model: text('model').notNull(),
  promptTokens: integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  totalTokens: integer('total_tokens'),
  duration: integer('duration'),
  status: text('status').notNull(),
  error: text('error'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
});

export const toolInvocationLogs = sqliteTable('tool_invocation_logs', {
  id: text('id').primaryKey(),
  taskId: text('task_id').references(() => tasks.id),
  stepId: text('step_id'),
  agentId: text('agent_id'),
  toolName: text('tool_name').notNull(),
  input: text('input'),
  output: text('output'),
  status: text('status').notNull(),
  duration: integer('duration'),
  error: text('error'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
});

export const knowledgeHitLogs = sqliteTable('knowledge_hit_logs', {
  id: text('id').primaryKey(),
  taskId: text('task_id').references(() => tasks.id),
  query: text('query').notNull(),
  documentId: text('document_id').references(() => knowledgeDocuments.id),
  score: real('score'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
});

export const attachmentEvents = sqliteTable('attachment_events', {
  id: text('id').primaryKey(),
  attachmentId: text('attachment_id').notNull().references(() => attachments.id),
  eventType: text('event_type').notNull(),
  details: text('details'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(() => new Date())
});