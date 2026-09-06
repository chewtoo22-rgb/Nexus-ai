ALTER TABLE conversations ADD COLUMN user_id TEXT;
ALTER TABLE documents ADD COLUMN user_id TEXT;
ALTER TABLE projects ADD COLUMN user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
