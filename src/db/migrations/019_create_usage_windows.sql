CREATE TABLE IF NOT EXISTS usage_windows (
  id TEXT PRIMARY KEY,
  router_key_id TEXT,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_usage_windows_start ON usage_windows(start_time);
CREATE INDEX IF NOT EXISTS idx_usage_windows_router_key ON usage_windows(router_key_id);
CREATE INDEX IF NOT EXISTS idx_usage_windows_end_time ON usage_windows(end_time);
