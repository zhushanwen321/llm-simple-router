-- 记录 router 实际发送给客户端的 HTTP status code
-- 当与 status_code（上游原始值）不同时有值，用于追溯 status 转换
ALTER TABLE request_logs ADD COLUMN client_status_code INTEGER;
