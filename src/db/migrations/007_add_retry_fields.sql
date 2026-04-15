ALTER TABLE request_logs ADD COLUMN is_retry INTEGER NOT NULL DEFAULT 0;
ALTER TABLE request_logs ADD COLUMN original_request_id TEXT;
