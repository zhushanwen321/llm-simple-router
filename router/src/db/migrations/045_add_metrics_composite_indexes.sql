-- request_metrics 核心聚合索引（Dashboard getMetricsSummary + getMetricsTimeseries）
CREATE INDEX IF NOT EXISTS idx_metrics_agg
  ON request_metrics(is_complete, created_at DESC, provider_id, backend_model);

-- request_logs 子请求+时间排序复合索引
-- 注：018 已有 idx_request_logs_original_request_id(original_request_id)，本索引额外覆盖时间排序
CREATE INDEX IF NOT EXISTS idx_logs_original_time
  ON request_logs(original_request_id, created_at DESC);
