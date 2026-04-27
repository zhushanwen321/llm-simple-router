-- Migration 026: 创建 schedules 表，简化 mapping_groups rule 格式
-- 变更概要：
--   1. 创建 schedules 表（周循环调度层）
--   2. 迁移 scheduled 策略的 windows 数据到 schedules
--   3. 统一 mapping_groups.rule 为 { targets: [...] } 格式
--   4. 保留 strategy 列（兼容旧代码），默认 'scheduled'

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
-- Step 3: 更新 rule 格式（in-place，不重建表以保留 strategy 列）
-- ============================================================
-- scheduled: rule 从 { default, windows } 简化为 { targets: [default] }
-- failover/round-robin/random: rule 已经是 { targets: [...] }，保持不变
-- 安全过滤：只处理仍有 $.default 的旧格式，避免覆盖已存在的 {targets} 格式
UPDATE mapping_groups SET rule = json_object('targets', json_array(json_extract(rule, '$.default')))
WHERE strategy = 'scheduled' AND json_extract(rule, '$.default') IS NOT NULL;
