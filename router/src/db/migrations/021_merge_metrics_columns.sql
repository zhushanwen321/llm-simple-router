-- V1 双写：将 request_metrics 列冗余到 request_logs，消除日志查询的 JOIN
-- request_metrics 表保留不动，聚合查询仍查它

ALTER TABLE request_logs ADD COLUMN input_tokens INTEGER;
ALTER TABLE request_logs ADD COLUMN output_tokens INTEGER;
ALTER TABLE request_logs ADD COLUMN cache_read_tokens INTEGER;
ALTER TABLE request_logs ADD COLUMN ttft_ms INTEGER;
ALTER TABLE request_logs ADD COLUMN tokens_per_second REAL;
ALTER TABLE request_logs ADD COLUMN stop_reason TEXT;
ALTER TABLE request_logs ADD COLUMN backend_model TEXT;
ALTER TABLE request_logs ADD COLUMN metrics_complete INTEGER NOT NULL DEFAULT 0;

-- 流式请求的累积文本内容（从 tracker.appendStreamChunk 中提取的纯文本）
ALTER TABLE request_logs ADD COLUMN stream_text_content TEXT;

-- 回填历史数据：把已有的 request_metrics 写入 request_logs 新列
UPDATE request_logs
SET
  input_tokens = rm.input_tokens,
  output_tokens = rm.output_tokens,
  cache_read_tokens = rm.cache_read_tokens,
  ttft_ms = rm.ttft_ms,
  tokens_per_second = rm.tokens_per_second,
  stop_reason = rm.stop_reason,
  backend_model = rm.backend_model,
  metrics_complete = rm.is_complete
FROM request_metrics rm
WHERE rm.request_log_id = request_logs.id;
