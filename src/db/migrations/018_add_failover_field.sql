ALTER TABLE request_logs ADD COLUMN is_failover INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_request_logs_original_request_id ON request_logs(original_request_id);
