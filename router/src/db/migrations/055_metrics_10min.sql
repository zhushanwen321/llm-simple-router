CREATE TABLE IF NOT EXISTS metrics_10min (
  bucket_time TEXT NOT NULL,
  router_key_id TEXT NOT NULL DEFAULT '',
  provider_id TEXT NOT NULL,
  backend_model TEXT NOT NULL,
  client_type TEXT NOT NULL DEFAULT 'unknown',
  api_type TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  sum_input_tokens INTEGER NOT NULL DEFAULT 0,
  sum_output_tokens INTEGER NOT NULL DEFAULT 0,
  sum_cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  sum_cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  sum_total_duration_ms INTEGER NOT NULL DEFAULT 0,
  sum_ttft_ms REAL NOT NULL DEFAULT 0,
  sum_thinking_tokens INTEGER NOT NULL DEFAULT 0,
  sum_text_tokens INTEGER NOT NULL DEFAULT 0,
  sum_tool_use_tokens INTEGER NOT NULL DEFAULT 0,
  sum_thinking_duration_ms INTEGER NOT NULL DEFAULT 0,
  sum_text_duration_ms INTEGER NOT NULL DEFAULT 0,
  sum_tool_use_duration_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_time, router_key_id, provider_id, backend_model, client_type, api_type)
);

CREATE INDEX IF NOT EXISTS idx_metrics_10min_time
  ON metrics_10min(bucket_time);
