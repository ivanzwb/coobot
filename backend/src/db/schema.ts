import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const modelConfigs = sqliteTable('model_configs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  provider: text('provider').notNull(),
  modelName: text('model_name').notNull(),
  baseUrl: text('base_url'),
  apiKey: text('api_key'),
  contextWindow: integer('context_window'),
  status: text('status').default('offline'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

export const agents = sqliteTable('agents', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  modelConfigId: text('model_config_id').references(() => modelConfigs.id),
  promptTemplateId: text('prompt_template_id'),
  status: text('status').default('IDLE'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

export const agentCapabilities = sqliteTable('agent_capabilities', {
  agentId: text('agent_id').primaryKey().references(() => agents.id),
  skillsJson: text('skills_json').notNull(),
  toolsJson: text('tools_json').notNull(),
  description: text('description'),
  constraints: text('constraints'),
  lastHeartbeat: integer('last_heartbeat', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  status: text('status').default('OFFLINE'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

export const skills = sqliteTable('skills', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  version: text('version'),
  author: text('author'),
  runtimeLanguage: text('runtime_language'),
  detectedLanguage: text('detected_language'),
  installMode: text('install_mode').default('copy_only'),
  rootDir: text('root_dir').notNull(),
  entrypoint: text('entrypoint'),
  configSchemaJson: text('config_schema_json'),
  toolManifestJson: text('tool_manifest_json'),
  compatibility: text('compatibility'),
  installedAt: integer('installed_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
});

export const agentSkills = sqliteTable('agent_skills', {
  agentId: text('agent_id').notNull().references(() => agents.id),
  skillId: text('skill_id').notNull().references(() => skills.id),
  configJson: text('config_json'),
});

export const prompts = sqliteTable('prompts', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  content: text('content').notNull(),
  variablesJson: text('variables_json'),
  tags: text('tags'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

export const agentToolPermissions = sqliteTable('agent_tool_permissions', {
  agentId: text('agent_id').notNull().references(() => agents.id),
  toolName: text('tool_name').notNull(),
  policy: text('policy').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  parentTaskId: text('parent_task_id'),
  rootTaskId: text('root_task_id').notNull(),
  assignedAgentId: text('assigned_agent_id').notNull().references(() => agents.id),
  status: text('status').notNull(),
  triggerMode: text('trigger_mode').default('immediate'),
  inputPayload: text('input_payload'),
  outputSummary: text('output_summary'),
  errorMsg: text('error_msg'),
  retryCount: integer('retry_count').default(0),
  heartbeat: integer('heartbeat', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  startedAt: integer('started_at', { mode: 'timestamp' }),
  finishedAt: integer('finished_at', { mode: 'timestamp' }),
});

export const taskLogs = sqliteTable('task_logs', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  taskId: text('task_id').notNull().references(() => tasks.id),
  stepIndex: integer('step_index').notNull(),
  stepType: text('step_type').notNull(),
  content: text('content').notNull(),
  toolName: text('tool_name'),
  toolArgsJson: text('tool_args_json'),
  timestamp: integer('timestamp', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

export const knowledgeFiles = sqliteTable('knowledge_files', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agents.id),
  fileName: text('file_name').notNull(),
  filePath: text('file_path').notNull(),
  fileHash: text('file_hash'),
  vectorPartition: text('vector_partition').notNull(),
  status: text('status'),
  version: integer('version').default(1),
  metaInfoJson: text('meta_info_json'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

export const sessionMemory = sqliteTable('session_memory', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  role: text('role'),
  content: text('content').notNull(),
  attachmentsJson: text('attachments_json'),
  relatedTaskId: text('related_task_id').references(() => tasks.id),
  metaJson: text('meta_json'),
  summary: text('summary'),
  tokenCount: integer('token_count').notNull(),
  importance: real('importance').default(0.5),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  isArchived: integer('is_archived', { mode: 'boolean' }).default(false),
  ltmRefId: text('ltm_ref_id'),
});

export const longTermMemory = sqliteTable('long_term_memory', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agents.id),
  category: text('category'),
  key: text('key').notNull(),
  value: text('value').notNull(),
  embeddingId: text('embedding_id').notNull(),
  confidence: real('confidence'),
  accessCount: integer('access_count').default(0),
  lastAccessed: integer('last_accessed', { mode: 'timestamp' }),
  isActive: integer('is_active', { mode: 'boolean' }).default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

export const permissionRequests = sqliteTable('permission_requests', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  agentId: text('agent_id').notNull(),
  toolName: text('tool_name').notNull(),
  toolArgsJson: text('tool_args_json'),
  policy: text('policy').notNull(),
  status: text('status').default('PENDING'),
  requestedAt: integer('requested_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  respondedAt: integer('responded_at', { mode: 'timestamp' }),
  response: text('response'),
});

export const auditLogs = sqliteTable('audit_logs', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  eventType: text('event_type').notNull(),
  actorId: text('actor_id').notNull(),
  taskId: text('task_id'),
  detailsJson: text('details_json'),
  result: text('result'),
  timestamp: integer('timestamp', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

export const scheduledJobs = sqliteTable('scheduled_jobs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  cronExpression: text('cron_expression').notNull(),
  timezone: text('timezone').default('UTC'),
  taskTemplateJson: text('task_template_json').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  concurrencyPolicy: text('concurrency_policy').default('FORBID'),
  lastRunAt: integer('last_run_at', { mode: 'timestamp' }),
  nextRunAt: integer('next_run_at', { mode: 'timestamp' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});

export const jobExecutionLogs = sqliteTable('job_execution_logs', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  jobId: text('job_id').notNull().references(() => scheduledJobs.id),
  scheduledTime: integer('scheduled_time', { mode: 'timestamp' }).notNull(),
  actualStartTime: integer('actual_start_time', { mode: 'timestamp' }),
  actualEndTime: integer('actual_end_time', { mode: 'timestamp' }),
  triggeredTaskId: text('triggered_task_id').references(() => tasks.id),
  status: text('status').notNull(),
  errorMessage: text('error_message'),
  retryCount: integer('retry_count').default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`CURRENT_TIMESTAMP`),
});


