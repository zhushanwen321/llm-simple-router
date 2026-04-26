-- Migration 026: 创建 schedules 表，简化 mapping_groups 表结构
-- 变更概要：
--   1. 创建 schedules 表（周循环调度层）
--   2. 迁移 scheduled 策略的 windows 数据到 schedules
--   3. 统一 mapping_groups.rule 为 { targets: [...] } 格式
--   4. 删除 strategy 列（SQLite 重建表）

-- ============================================================
-- Step 1: 创建 schedules 表
-- ============================================================
CREATE TABLE IF NOT EXISTS schedules (
  id TEXT PRIMARY KEY,
  mapping_group_id TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  week TEXT NOT NULL DEFAULT '[]',
  start_hour INTEGER NOT NULL DEFAULT 0,
  end_hour INTEGER NOT NULL DEFAULT 24,
  mapping_rule TEXT NOT NULL DEFAULT '{}',
  concurrency_rule TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (mapping_group_id) REFERENCES mapping_groups(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_schedules_group ON schedules(mapping_group_id);
CREATE INDEX IF NOT EXISTS idx_schedules_enabled ON schedules(enabled);

-- ============================================================
-- Step 2: 迁移 scheduled 策略的 windows 数据
-- ============================================================
-- 从 strategy='scheduled' 的 mapping_groups 中提取 windows 数组，
-- 每个 window 生成一条 schedule 记录。
-- rule 格式: { "default": { "provider_id": "...", "backend_model": "..." },
--               "windows": [{ "start": "09:00", "end": "18:00",
--                              "target": { "provider_id": "...", "backend_model": "..." } }] }
-- json_each 展开数组时，key 是数组索引（从 0 开始），value 是元素本身
INSERT INTO schedules (id, mapping_group_id, name, enabled, week, start_hour, end_hour,
                       mapping_rule, priority, created_at, updated_at)
SELECT
  lower(hex(randomblob(16))) AS id,
  mg.id AS mapping_group_id,
  'Schedule ' || (win.key + 1) AS name,
  1 AS enabled,
  '[0,1,2,3,4,5,6]' AS week,
  -- "09:00" -> 9, "18:30" -> 18（CAST 会自动截取整数部分）
  CAST(json_extract(win.value, '$.start') AS INTEGER) AS start_hour,
  CAST(json_extract(win.value, '$.end') AS INTEGER) AS end_hour,
  json_object('targets', json_array(json_extract(win.value, '$.target'))) AS mapping_rule,
  0 AS priority,
  mg.created_at,
  mg.created_at AS updated_at
FROM mapping_groups mg, json_each(json_extract(mg.rule, '$.windows')) AS win
WHERE mg.strategy = 'scheduled';

-- ============================================================
-- Step 3: 创建 mapping_groups_new（去掉 strategy 列）
-- ============================================================
CREATE TABLE IF NOT EXISTS mapping_groups_new (
  id TEXT PRIMARY KEY,
  client_model TEXT NOT NULL UNIQUE,
  rule TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- ============================================================
-- Step 4: 迁移数据到新表，同时统一 rule 格式
-- ============================================================
-- 三种情况：
--   scheduled: rule 从 { default, windows } 简化为 { targets: [default] }
--   failover/round-robin/random: rule 已经是 { targets: [...] }，保持不变
INSERT INTO mapping_groups_new (id, client_model, rule, is_active, created_at)
SELECT
  id,
  client_model,
  CASE
    WHEN strategy = 'scheduled' THEN
      json_object('targets', json_array(json_extract(rule, '$.default')))
    ELSE
      rule
  END AS rule,
  is_active,
  created_at
FROM mapping_groups;

-- ============================================================
-- Step 5: 替换旧表
-- ============================================================
DROP TABLE mapping_groups;
ALTER TABLE mapping_groups_new RENAME TO mapping_groups;
