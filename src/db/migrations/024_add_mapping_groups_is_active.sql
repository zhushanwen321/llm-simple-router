-- is_active 列已在 migration 011 中创建。此处保留作为幂等安全网：
-- 若 DB 来自旧版（011 未含 is_active），此 ALTER 会补充该列。
-- 若已存在则触发 "duplicate column name" 错误，由 migration runner 捕获忽略。
ALTER TABLE mapping_groups ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
