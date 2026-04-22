# 数据模型

## 新增 router_keys 表

```sql
CREATE TABLE router_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  allowed_models TEXT,           -- JSON array，null 或 "[]" = 全部允许
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_router_keys_hash ON router_keys(key_hash);
```

## request_logs 扩展

```sql
ALTER TABLE request_logs ADD COLUMN router_key_id TEXT REFERENCES router_keys(id);
CREATE INDEX idx_request_logs_router_key ON request_logs(router_key_id);
```

request_metrics 无需改动，通过 request_log_id JOIN 获取 router_key_id。

## Key 存储策略

- 格式：`sk-router-` + 32 字节随机 hex（总长 74 字符）
- 数据库存 SHA-256 hash（hex）+ key_prefix（取整个 key 的前 8 字符，即 `sk-router`），不存明文
- 明文仅在创建响应中返回一次

## 外键策略

- `request_logs.router_key_id` 引用 `router_keys(id)`，但 SQLite 不强制外键
- 删除 router_key 时保留关联日志，`router_key_id` 保持原值不做 CASCADE/SET NULL
- Admin API 中，删除 key 时给出"关联日志将保留"的提示
