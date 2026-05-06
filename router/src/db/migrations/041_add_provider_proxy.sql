-- 041_add_provider_proxy.sql
-- Add per-provider proxy support (SOCKS5 / HTTP CONNECT)

ALTER TABLE providers ADD COLUMN proxy_type TEXT DEFAULT NULL;
ALTER TABLE providers ADD COLUMN proxy_url TEXT DEFAULT NULL;
ALTER TABLE providers ADD COLUMN proxy_username TEXT DEFAULT NULL;
ALTER TABLE providers ADD COLUMN proxy_password TEXT DEFAULT NULL;
