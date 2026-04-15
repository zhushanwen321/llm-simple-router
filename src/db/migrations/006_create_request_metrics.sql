CREATE TABLE request_metrics (
  id TEXT PRIMARY KEY,
  request_log_id TEXT NOT NULL UNIQUE REFERENCES request_logs(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  backend_model TEXT NOT NULL,
  api_type TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_creation_tokens INTEGER,
  cache_read_tokens INTEGER,
  ttft_ms INTEGER,
  total_duration_ms INTEGER,
  tokens_per_second REAL,
  stop_reason TEXT,
  is_complete INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_metrics_time_provider_model ON request_metrics(created_at, provider_id, backend_model);
CREATE INDEX idx_metrics_api_type_created_at ON request_metrics(api_type, created_at);
