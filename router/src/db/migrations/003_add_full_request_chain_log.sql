ALTER TABLE request_logs ADD COLUMN client_request TEXT;
ALTER TABLE request_logs ADD COLUMN upstream_request TEXT;
ALTER TABLE request_logs ADD COLUMN upstream_response TEXT;
ALTER TABLE request_logs ADD COLUMN client_response TEXT;
