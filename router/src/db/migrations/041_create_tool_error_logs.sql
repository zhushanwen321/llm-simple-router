CREATE TABLE IF NOT EXISTS tool_error_logs (
  id TEXT PRIMARY KEY,
  request_log_id TEXT REFERENCES request_logs(id) ON DELETE SET NULL,
  provider_id TEXT NOT NULL,
  backend_model TEXT NOT NULL,
  client_agent_type TEXT NOT NULL DEFAULT 'unknown'
    CHECK(client_agent_type IN ('claude-code', 'pi', 'unknown')),
  tool_name TEXT NOT NULL,
  tool_use_id TEXT,
  tool_input TEXT,
  error_content TEXT,
  router_key_id TEXT,
  session_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tool_error_logs_time
  ON tool_error_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_tool_error_logs_provider
  ON tool_error_logs(provider_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tool_error_logs_model
  ON tool_error_logs(backend_model, created_at);
CREATE INDEX IF NOT EXISTS idx_tool_error_logs_tool
  ON tool_error_logs(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_error_logs_agent
  ON tool_error_logs(client_agent_type);
CREATE INDEX IF NOT EXISTS idx_tool_error_logs_session
  ON tool_error_logs(session_id);
