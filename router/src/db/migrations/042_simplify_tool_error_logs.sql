-- 042_simplify_tool_error_logs.sql
-- 精简 tool_error_logs：去掉 tool_input / error_content 大字段，
-- 改为通过 request_log_id + tool_use_id 从 request_logs 回溯完整数据。
-- SQLite 不支持 DROP COLUMN（需 3.35+），重建表。

DROP TABLE IF EXISTS tool_error_logs;

CREATE TABLE tool_error_logs (
  id TEXT PRIMARY KEY,
  request_log_id TEXT REFERENCES request_logs(id) ON DELETE SET NULL,
  tool_use_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  backend_model TEXT NOT NULL,
  client_agent_type TEXT NOT NULL DEFAULT 'unknown'
    CHECK(client_agent_type IN ('claude-code', 'pi', 'unknown')),
  tool_name TEXT NOT NULL,
  router_key_id TEXT,
  session_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_tool_error_logs_time
  ON tool_error_logs(created_at);
CREATE INDEX idx_tool_error_logs_provider
  ON tool_error_logs(provider_id, created_at);
CREATE INDEX idx_tool_error_logs_tool
  ON tool_error_logs(tool_name);
