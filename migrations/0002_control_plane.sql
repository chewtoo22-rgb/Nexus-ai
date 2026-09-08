-- Control-plane execution fabric.
-- Secrets must never be persisted in task payloads or event data.
CREATE TABLE IF NOT EXISTS orchestration_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  idempotency_key TEXT,
  parent_task_id TEXT,
  agent_id TEXT NOT NULL,
  model TEXT,
  capability TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','awaiting_tool','awaiting_agent','completed','failed','cancelled')),
  input_json TEXT NOT NULL,
  result_json TEXT,
  error_code TEXT,
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 2,
  timeout_ms INTEGER NOT NULL DEFAULT 120000,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_orchestration_tasks_user_updated ON orchestration_tasks(user_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_orchestration_tasks_status ON orchestration_tasks(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_orchestration_tasks_parent ON orchestration_tasks(parent_task_id);

CREATE TABLE IF NOT EXISTS orchestration_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  data_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orchestration_events_task ON orchestration_events(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orchestration_events_user ON orchestration_events(user_id, created_at);
