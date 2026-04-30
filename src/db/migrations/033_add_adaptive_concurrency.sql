-- 033_add_adaptive_concurrency.sql
ALTER TABLE providers ADD COLUMN adaptive_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE providers ADD COLUMN adaptive_min INTEGER NOT NULL DEFAULT 1;
