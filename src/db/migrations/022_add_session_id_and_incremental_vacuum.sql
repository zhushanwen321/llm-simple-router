ALTER TABLE request_logs ADD COLUMN session_id TEXT;
PRAGMA auto_vacuum = 2;
