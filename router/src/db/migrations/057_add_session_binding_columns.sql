-- 重建 session_model_states：新增 provider_id + group_id 列，联合唯一约束改为 (router_key_id, session_id, group_id)
-- 表当前零消费者（grep 确认无引用），DROP+CREATE 无迁移成本（SQLite 无法 ALTER 删除既有 UNIQUE 约束）
-- 注意：不碰同 migration 016 创建的 session_model_history 表
DROP TABLE IF EXISTS session_model_states;
CREATE TABLE session_model_states (
  id TEXT PRIMARY KEY,
  router_key_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  current_model TEXT NOT NULL,
  original_model TEXT,
  provider_id TEXT,
  last_active_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(router_key_id, session_id, group_id),
  FOREIGN KEY (router_key_id) REFERENCES router_keys(id)
);
CREATE INDEX idx_sms_router_key ON session_model_states(router_key_id);
