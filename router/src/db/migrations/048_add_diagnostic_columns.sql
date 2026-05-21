-- 048: Add diagnostic columns to request_logs for runtime observability
ALTER TABLE request_logs ADD COLUMN transport_kind TEXT;
ALTER TABLE request_logs ADD COLUMN abort_reason TEXT;
ALTER TABLE request_logs ADD COLUMN error_code TEXT;
ALTER TABLE request_logs ADD COLUMN headers_sent INTEGER;
ALTER TABLE request_logs ADD COLUMN resilience_action TEXT;
ALTER TABLE request_logs ADD COLUMN resilience_reason TEXT;
ALTER TABLE request_logs ADD COLUMN mapping_reason TEXT;
ALTER TABLE request_logs ADD COLUMN failover_trigger TEXT;
