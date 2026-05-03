-- 034_drop_redundant_log_columns.sql
-- request_logs 与 request_metrics 双写冗余清理：
-- metrics 字段统一由 request_metrics 承载，日志列表查询改用 LEFT JOIN。

ALTER TABLE request_logs DROP COLUMN input_tokens;
ALTER TABLE request_logs DROP COLUMN output_tokens;
ALTER TABLE request_logs DROP COLUMN cache_read_tokens;
ALTER TABLE request_logs DROP COLUMN ttft_ms;
ALTER TABLE request_logs DROP COLUMN tokens_per_second;
ALTER TABLE request_logs DROP COLUMN stop_reason;
ALTER TABLE request_logs DROP COLUMN backend_model;
ALTER TABLE request_logs DROP COLUMN metrics_complete;
ALTER TABLE request_logs DROP COLUMN input_tokens_estimated;
