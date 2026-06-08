-- request_logs 增加 backend_model 列（第一阶段：写入，第二阶段：读取）
ALTER TABLE request_logs ADD COLUMN backend_model TEXT;

-- backend_model 精确过滤索引（logs 页面筛选 + metrics summary GROUP BY）
CREATE INDEX IF NOT EXISTS idx_metrics_backend_model ON request_metrics(backend_model);
