ALTER TABLE request_logs ADD COLUMN session_id TEXT;

-- NOTE: PRAGMA auto_vacuum only takes effect after VACUUM for existing databases.
-- Run scripts/vacuum-migrate.js for existing deployments.
PRAGMA auto_vacuum = 2;
