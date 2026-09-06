-- D1 schema for nexus-ai
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  agent_type TEXT NOT NULL DEFAULT 'nexus',
  title TEXT,
  model TEXT,
  project_id TEXT,
  user_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_conversations_agent ON conversations(agent_type);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at);
CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id);
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant','system','tool')),
  content TEXT NOT NULL,
  model TEXT,
  agent_type TEXT,
  tool_calls TEXT,
  tool_result TEXT,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  images TEXT,
  artifacts TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_key TEXT,
  title TEXT,
  chunk_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  project_id TEXT,
  user_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'code',
  title TEXT,
  language TEXT,
  content TEXT,
  r2_key TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_artifacts_conv ON artifacts(conversation_id);

CREATE TABLE IF NOT EXISTS mcp_connections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  status TEXT DEFAULT 'disconnected',
  tools TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  tools TEXT,
  enabled INTEGER DEFAULT 1,
  installed_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT,
  agent_type TEXT,
  model TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  cached INTEGER DEFAULT 0,
  tool_calls INTEGER DEFAULT 0,
  browser_actions INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_usage_agent ON usage(agent_type);
CREATE INDEX IF NOT EXISTS idx_usage_created ON usage(created_at);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  system_prompt TEXT,
  user_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS missions (
  id TEXT PRIMARY KEY,
  goal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','planning','running','completed','failed','cancelled')),
  orchestrator TEXT NOT NULL DEFAULT 'sirius',
  project_id TEXT,
  result TEXT,
  error TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_missions_status ON missions(status);
CREATE INDEX IF NOT EXISTS idx_missions_updated ON missions(updated_at);

CREATE TABLE IF NOT EXISTS mission_steps (
  id TEXT PRIMARY KEY,
  mission_id TEXT NOT NULL,
  step_index INTEGER NOT NULL,
  agent TEXT NOT NULL,
  title TEXT NOT NULL,
  task TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed')),
  result TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(mission_id, step_index)
);
CREATE INDEX IF NOT EXISTS idx_mission_steps_mission ON mission_steps(mission_id, step_index);
