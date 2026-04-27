CREATE TABLE IF NOT EXISTS mapping_groups (
  id TEXT PRIMARY KEY,
  client_model TEXT NOT NULL UNIQUE,
  strategy TEXT NOT NULL DEFAULT 'scheduled',
  rule TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS retry_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  body_pattern TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- 从现有 model_mappings 迁移数据：
-- 每条旧映射转为 scheduled 策略（含 is_active 状态）
-- default 指向原后端，windows 为空数组
INSERT INTO mapping_groups (id, client_model, strategy, rule, is_active, created_at)
SELECT
  lower(hex(randomblob(16))) AS id,
  client_model,
  'scheduled' AS strategy,
  json_object(
    'default', json_object('provider_id', provider_id, 'backend_model', backend_model),
    'windows', json_array()
  ) AS rule,
  is_active,
  created_at
FROM model_mappings;

-- 默认重试规则在首次启动时通过 seedDefaultRules() 自动插入，不在此处硬编码

-- 旧表 model_mappings 保留为空表（兼容现有测试），读写已全部迁移到 mapping_groups
