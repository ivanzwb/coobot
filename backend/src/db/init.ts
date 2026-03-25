import Database from 'better-sqlite3';
import * as path from 'path';

const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data/biosbot.db');

const db = new Database(dbPath);

const schema = `
CREATE TABLE IF NOT EXISTS model_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_name TEXT NOT NULL,
  base_url TEXT,
  api_key TEXT,
  context_window INTEGER DEFAULT 4096,
  status TEXT DEFAULT 'offline',
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  model_config_id TEXT REFERENCES model_configs(id),
  prompt_template_id TEXT,
  temperature REAL,
  status TEXT DEFAULT 'IDLE',
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS agent_capabilities (
  agent_id TEXT PRIMARY KEY REFERENCES agents(id),
  skills_json TEXT NOT NULL,
  tools_json TEXT NOT NULL,
  description TEXT,
  constraints TEXT,
  last_heartbeat INTEGER,
  status TEXT DEFAULT 'OFFLINE',
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  version TEXT,
  author TEXT,
  runtime_language TEXT,
  detected_language TEXT,
  install_mode TEXT DEFAULT 'copy_only',
  root_dir TEXT NOT NULL,
  entrypoint TEXT,
  config_schema_json TEXT,
  tool_manifest_json TEXT,
  compatibility TEXT,
  installed_at INTEGER,
  updated_at INTEGER,
  enabled INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS agent_skills (
  agent_id TEXT NOT NULL REFERENCES agents(id),
  skill_id TEXT NOT NULL REFERENCES skills(id),
  config_json TEXT,
  PRIMARY KEY (agent_id, skill_id)
);

CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  variables_json TEXT,
  tags TEXT,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS agent_tool_permissions (
  agent_id TEXT NOT NULL REFERENCES agents(id),
  tool_name TEXT NOT NULL,
  policy TEXT NOT NULL,
  updated_at INTEGER,
  PRIMARY KEY (agent_id, tool_name)
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  parent_task_id TEXT,
  root_task_id TEXT NOT NULL,
  assigned_agent_id TEXT NOT NULL REFERENCES agents(id),
  status TEXT NOT NULL,
  trigger_mode TEXT DEFAULT 'immediate',
  input_payload TEXT,
  output_summary TEXT,
  error_msg TEXT,
  retry_count INTEGER DEFAULT 0,
  heartbeat INTEGER,
  created_at INTEGER,
  updated_at INTEGER,
  started_at INTEGER,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS task_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  step_index INTEGER NOT NULL,
  step_type TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_name TEXT,
  tool_args_json TEXT,
  timestamp INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS knowledge_files (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_hash TEXT,
  vector_partition TEXT NOT NULL,
  status TEXT,
  version INTEGER DEFAULT 1,
  meta_info_json TEXT,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS session_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT,
  content TEXT NOT NULL,
  attachments_json TEXT,
  related_task_id TEXT REFERENCES tasks(id),
  meta_json TEXT,
  summary TEXT,
  token_count INTEGER NOT NULL,
  importance REAL DEFAULT 0.5,
  created_at INTEGER,
  is_archived INTEGER DEFAULT 0,
  ltm_ref_id TEXT
);

CREATE TABLE IF NOT EXISTS long_term_memory (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  category TEXT,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  embedding_id TEXT NOT NULL,
  confidence REAL,
  access_count INTEGER DEFAULT 0,
  last_accessed INTEGER,
  is_active INTEGER DEFAULT 1,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  task_id TEXT,
  details_json TEXT,
  result TEXT,
  timestamp INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  cron_expression TEXT NOT NULL,
  timezone TEXT DEFAULT 'UTC',
  task_template_json TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  concurrency_policy TEXT DEFAULT 'FORBID',
  last_run_at INTEGER,
  next_run_at INTEGER NOT NULL,
  created_at INTEGER,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS job_execution_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL REFERENCES scheduled_jobs(id),
  scheduled_time INTEGER NOT NULL,
  actual_start_time INTEGER,
  actual_end_time INTEGER,
  triggered_task_id TEXT REFERENCES tasks(id),
  status TEXT NOT NULL,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0,
  created_at INTEGER
);

`;

db.exec(schema);
db.close();

console.log('Database tables created successfully!');
