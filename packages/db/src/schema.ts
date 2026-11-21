export const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  instructions TEXT DEFAULT '',
  is_private INTEGER DEFAULT 0,
  allowed_providers TEXT DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'smart',
  pinned_model_id TEXT,
  pinned_provider_id TEXT,
  active_branch_head_id TEXT,
  draft_text TEXT DEFAULT '',
  deleted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  parent_id TEXT,
  branch_id TEXT,
  version_index INTEGER DEFAULT 0,
  role TEXT NOT NULL,
  author_json TEXT NOT NULL,
  parts_json TEXT NOT NULL,
  artifacts_json TEXT DEFAULT '[]',
  usage_json TEXT,
  pinned INTEGER DEFAULT 0,
  compare_group_id TEXT,
  selected_compare INTEGER DEFAULT 0,
  plain_text TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_parent ON messages(parent_id);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  message_id UNINDEXED,
  thread_id UNINDEXED,
  plain_text
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  message_id TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  mime TEXT NOT NULL,
  language TEXT,
  current_version INTEGER NOT NULL DEFAULT 1,
  versions_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_artifacts_thread ON artifacts(thread_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_project ON artifacts(project_id);

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  display_name TEXT NOT NULL,
  auth TEXT NOT NULL,
  base_url TEXT,
  alias TEXT,
  badge_color TEXT NOT NULL,
  badge_letter TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  encrypted_key TEXT,
  masked_key TEXT,
  models_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_roles (
  id TEXT NOT NULL,
  project_id TEXT NOT NULL DEFAULT '',
  data_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (id, project_id)
);

CREATE TABLE IF NOT EXISTS tools (
  id TEXT PRIMARY KEY,
  manifest_json TEXT NOT NULL,
  installed INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  policy TEXT NOT NULL DEFAULT 'ask_every_time',
  encrypted_secrets_json TEXT DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_permissions (
  id TEXT PRIMARY KEY,
  tool_id TEXT NOT NULL,
  scope TEXT NOT NULL, -- 'thread' | 'project' | 'global'
  scope_id TEXT NOT NULL,
  policy TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS flows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT DEFAULT 'custom',
  definition_json TEXT NOT NULL,
  yaml_source TEXT DEFAULT '',
  is_template INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS flow_runs (
  id TEXT PRIMARY KEY,
  flow_id TEXT NOT NULL,
  flow_name TEXT NOT NULL,
  thread_id TEXT,
  project_id TEXT NOT NULL,
  status TEXT NOT NULL,
  inputs_json TEXT NOT NULL DEFAULT '{}',
  step_states_json TEXT NOT NULL DEFAULT '[]',
  current_step_index INTEGER NOT NULL DEFAULT 0,
  total_cost_usd REAL NOT NULL DEFAULT 0,
  outputs_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL, -- 'project' | 'personal'
  project_id TEXT,
  content TEXT NOT NULL,
  source_message_id TEXT,
  approved INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  content_text TEXT NOT NULL DEFAULT '',
  artifact_id TEXT,
  created_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS project_files_fts USING fts5(
  file_id UNINDEXED,
  project_id UNINDEXED,
  name,
  content_text
);

CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  scope TEXT NOT NULL, -- 'workspace' | 'project' | 'provider'
  scope_id TEXT,
  type TEXT NOT NULL, -- 'soft' | 'hard'
  limit_usd REAL NOT NULL,
  period TEXT NOT NULL, -- 'daily' | 'monthly'
  warn_at_percent INTEGER NOT NULL DEFAULT 80,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_records (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  thread_id TEXT,
  message_id TEXT,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  tool_id TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_records(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_project ON usage_records(project_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  masked_token TEXT NOT NULL,
  scopes_json TEXT NOT NULL DEFAULT '["*"]',
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS webhooks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  encrypted_secret TEXT NOT NULL,
  events_json TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  meta_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quotas (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  plan_name TEXT NOT NULL DEFAULT 'Varsayılan',
  metric TEXT NOT NULL DEFAULT 'requests',
  limit_amount REAL,
  reset_interval TEXT NOT NULL DEFAULT 'monthly',
  reset_anchor_iso TEXT,
  live_remaining REAL,
  live_limit REAL,
  live_reset_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(target_type, target_id)
);
`;
