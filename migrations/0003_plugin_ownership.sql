ALTER TABLE plugins ADD COLUMN user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_plugins_user ON plugins(user_id);
