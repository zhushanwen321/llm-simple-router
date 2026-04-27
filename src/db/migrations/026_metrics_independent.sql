-- Metrics 独立化：request_metrics 增加路由维度列，解除级联删除依赖
-- usage_windows 增加 provider_id 支持按 provider 维度追踪使用量

-- 1. 重建 request_metrics：CASCADE -> SET NULL，同时新增 router_key_id / status_code
CREATE TABLE request_metrics_new (
  id TEXT PRIMARY KEY,
  request_log_id TEXT UNIQUE REFERENCES request_logs(id) ON DELETE SET NULL,
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
  router_key_id TEXT,
  status_code INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO request_metrics_new
  (id, request_log_id, provider_id, backend_model, api_type,
   input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
   ttft_ms, total_duration_ms, tokens_per_second, stop_reason,
   is_complete, created_at)
SELECT
  id, request_log_id, provider_id, backend_model, api_type,
  input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
  ttft_ms, total_duration_ms, tokens_per_second, stop_reason,
  is_complete, created_at
FROM request_metrics;

-- 回填 router_key_id 和 status_code 从 request_logs
UPDATE request_metrics_new
SET
  router_key_id = rl.router_key_id,
  status_code = rl.status_code
FROM request_logs rl
WHERE rl.id = request_metrics_new.request_log_id;

DROP TABLE request_metrics;
ALTER TABLE request_metrics_new RENAME TO request_metrics;

-- 重建原有索引
CREATE INDEX idx_metrics_time_provider_model ON request_metrics(created_at, provider_id, backend_model);
CREATE INDEX idx_metrics_api_type_created_at ON request_metrics(api_type, created_at);

-- 2. usage_windows 增加 provider_id 列
ALTER TABLE usage_windows ADD COLUMN provider_id TEXT;
CREATE INDEX IF NOT EXISTS idx_usage_windows_provider_id ON usage_windows(provider_id);
