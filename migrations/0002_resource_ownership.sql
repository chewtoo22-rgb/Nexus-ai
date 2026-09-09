ALTER TABLE missions ADD COLUMN user_id TEXT;
ALTER TABLE mcp_connections ADD COLUMN user_id TEXT;
ALTER TABLE usage ADD COLUMN user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_missions_user ON missions(user_id);
CREATE INDEX IF NOT EXISTS idx_mcp_connections_user ON mcp_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_user ON usage(user_id);
CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
