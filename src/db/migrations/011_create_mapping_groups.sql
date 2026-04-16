CREATE TABLE IF NOT EXISTS mapping_groups (
  id TEXT PRIMARY KEY,
  client_model TEXT NOT NULL UNIQUE,
  strategy TEXT NOT NULL DEFAULT 'scheduled',
  rule TEXT NOT NULL,
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
-- 每条旧映射转为 scheduled 策略，default 指向原后端，windows 为空数组
INSERT INTO mapping_groups (id, client_model, strategy, rule, created_at)
SELECT
  lower(hex(randomblob(16))) AS id,
  client_model,
  'scheduled' AS strategy,
  json_object(
    'default', json_object('provider_id', provider_id, 'backend_model', backend_model),
    'windows', json_array()
  ) AS rule,
  created_at
FROM model_mappings
WHERE is_active = 1;

-- 预置 ZAI 相关重试规则
INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, created_at)
VALUES
  (lower(hex(randomblob(16))), 'ZAI 429', 429, '.*', 1, datetime('now')),
  (lower(hex(randomblob(16))), 'ZAI 500', 500, '.*', 1, datetime('now')),
  (lower(hex(randomblob(16))), 'ZAI 503', 503, '.*', 1, datetime('now'));
