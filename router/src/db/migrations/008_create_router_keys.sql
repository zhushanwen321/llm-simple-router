CREATE TABLE IF NOT EXISTS router_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  allowed_models TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_router_keys_hash ON router_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_router_keys_active ON router_keys(is_active);

ALTER TABLE request_logs ADD COLUMN router_key_id TEXT;

CREATE INDEX IF NOT EXISTS idx_request_logs_router_key ON request_logs(router_key_id);
