# 数据模型与迁移策略

## mapping_groups 表

替代现有 `model_mappings`，新增 `strategy` 和 `rule` 字段实现多策略路由。

```sql
CREATE TABLE mapping_groups (
  id         TEXT PRIMARY KEY,
  client_model TEXT NOT NULL UNIQUE,
  strategy   TEXT NOT NULL DEFAULT 'scheduled',  -- scheduled | round_robin | random | failover
  rule       TEXT NOT NULL,                       -- JSON，结构因 strategy 而异
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## rule JSON 结构

所有策略共用 `Target = { backend_model: string, provider_id: string }`。

| 策略 | rule 结构 |
|------|----------|
| **scheduled** | `{ default: Target, windows: TimeWindow[] }`，TimeWindow = `{ start: "HH:MM", end: "HH:MM", target: Target }` |
| **round_robin / random** | `{ targets: Target[] }` |
| **failover** | `{ targets: (Target & { priority: number })[] }` |

## 应用层约束

`rule` 内的 `provider_id` 不设外键约束（JSON 列无法建 FK）。改为应用层保障：

- **创建/更新 group** 时验证 rule 中所有 provider_id 存在且 `is_active = 1`
- **删除/禁用 provider** 时扫描全部 group 的 rule 检查引用，阻止或警告

## retry_rules 表

重试条件配置化，替代硬编码的 `isRetryable400Body`。

```sql
CREATE TABLE retry_rules (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  body_pattern TEXT NOT NULL,    -- 正则表达式
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
```

预置规则（迁移时 INSERT）：

| name | status_code | body_pattern |
|------|-------------|--------------|
| ZAI 网络错误 (1234) | 400 | `"type"\s*:\s*"error".*"code"\s*:\s*"1234"` |
| ZAI 临时不可用 | 400 | `"type"\s*:\s*"error".*请稍后重试` |
| ZAI 操作失败 (500) | 400 | `"type"\s*:\s*"error".*"code"\s*:\s*"500"` |

## 迁移策略

迁移文件 `011_create_mapping_groups.sql`：

1. 创建 `mapping_groups` 表和 `retry_rules` 表
2. 迁移 `model_mappings` 数据到 `mapping_groups`
3. 插入预置 `retry_rules` 记录
4. 保留 `model_mappings` 表不删除

## 扩展性

新增策略只需：定义新的 rule JSON schema + 实现对应的 `select()` 函数。表结构无需变更。新增重试条件只需在 `retry_rules` 表插入记录。
