-- ADR 0007 优化2：thinking_level 列
-- 将查询时 json_extract(client_request) 改为写入时计算、存为独立列
ALTER TABLE request_logs ADD COLUMN thinking_level TEXT NOT NULL DEFAULT 'off';

-- 索引：支持按 thinking_level 筛选
CREATE INDEX idx_request_logs_thinking_level ON request_logs(thinking_level);
