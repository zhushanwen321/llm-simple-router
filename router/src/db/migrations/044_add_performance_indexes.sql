-- 覆盖 provider_id 过滤 + 时间范围分页
CREATE INDEX IF NOT EXISTS idx_request_logs_provider_id ON request_logs(provider_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_created_at_provider ON request_logs(created_at DESC, provider_id);
CREATE INDEX IF NOT EXISTS idx_request_logs_created_at_router_key ON request_logs(created_at DESC, router_key_id);

-- 覆盖按密钥过滤的聚合查询
CREATE INDEX IF NOT EXISTS idx_metrics_router_key ON request_metrics(router_key_id);
CREATE INDEX IF NOT EXISTS idx_metrics_created_at_router_key ON request_metrics(created_at, router_key_id);
