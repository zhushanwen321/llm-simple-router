-- 052: Add upstream endpoint fields to request_logs for multi-API-type logging
ALTER TABLE request_logs ADD COLUMN upstream_api_type TEXT DEFAULT NULL;
ALTER TABLE request_logs ADD COLUMN upstream_base_url TEXT DEFAULT NULL;
