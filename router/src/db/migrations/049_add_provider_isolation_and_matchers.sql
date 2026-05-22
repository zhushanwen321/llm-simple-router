-- BG1: Provider isolation for retry rules + upstream error logs table

ALTER TABLE retry_rules ADD COLUMN provider_id TEXT NULL DEFAULT NULL;
ALTER TABLE retry_rules ADD COLUMN body_matchers TEXT NULL DEFAULT NULL;

CREATE TABLE upstream_error_logs (
  id TEXT PRIMARY KEY,
  request_log_id TEXT REFERENCES request_logs(id) ON DELETE SET NULL,
  provider_id TEXT NOT NULL,
  backend_model TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  error_type TEXT,
  error_message TEXT,
  client_agent_type TEXT NOT NULL DEFAULT 'unknown',
  router_key_id TEXT,
  session_id TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_upstream_error_logs_time ON upstream_error_logs(created_at);
CREATE INDEX idx_upstream_error_logs_provider ON upstream_error_logs(provider_id, created_at);
CREATE INDEX idx_upstream_error_logs_status ON upstream_error_logs(status_code, created_at);
