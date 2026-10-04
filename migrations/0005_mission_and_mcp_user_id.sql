-- Scope missions and MCP connections to owning user
ALTER TABLE missions ADD COLUMN user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_missions_user ON missions(user_id);

ALTER TABLE mcp_connections ADD COLUMN user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_mcp_connections_user ON mcp_connections(user_id);
