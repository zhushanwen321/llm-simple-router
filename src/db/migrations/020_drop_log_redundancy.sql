-- 019_drop_log_redundancy.sql
-- 删除冗余大文本字段：request_body = client_request.body, response_body = upstream_response.body, client_response ≈ upstream_response
ALTER TABLE request_logs DROP COLUMN request_body;
ALTER TABLE request_logs DROP COLUMN response_body;
ALTER TABLE request_logs DROP COLUMN client_response;

-- 日志自动清理保留天数（默认 3 天，0 = 不自动清理）
INSERT OR IGNORE INTO settings (key, value) VALUES ('log_retention_days', '3');
