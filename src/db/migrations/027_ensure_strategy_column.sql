-- Migration 027: 确保 mapping_groups 表存在 strategy 列（兼容旧代码）
-- 背景：旧版 026 曾重建表删除了 strategy 列，此迁移在缺失时加回，默认 'scheduled'
--
-- 安全策略：先测试列是否存在，不存在才添加。
-- SQLite 不支持条件 DDL，但支持在单个事务中根据 SELECT 结果执行不同操作。
-- 方案：创建临时表作为标记，根据 PRAGMA 结果决定是否执行 ALTER TABLE。

-- 使用触发器 + 临时表的 trick 不可行。改用最简单的方案：
-- 如果 strategy 列已存在，ALTER TABLE 会报 "duplicate column name" 错误。
-- migration runner 会捕获这个特定错误，忽略并继续。
ALTER TABLE mapping_groups ADD COLUMN strategy TEXT NOT NULL DEFAULT 'scheduled';
