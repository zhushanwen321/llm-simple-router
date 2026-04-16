# Phase 1: 数据库迁移 + DB 函数

## 概述

新增 `mapping_groups` 和 `retry_rules` 两张表，迁移现有 `model_mappings` 数据，添加对应 TypeScript 接口和 CRUD 函数。

## Step 1: 迁移文件

**文件**: `src/db/migrations/011_create_mapping_groups.sql`

要点：
- `mapping_groups` 替代 `model_mappings`，字段 `strategy`（默认 `'scheduled'`）和 `rule`（JSON 字符串）
- `retry_rules` 存储重试匹配规则（status_code + body_pattern 正则）
- `INSERT INTO mapping_groups ... SELECT` 从现有 `model_mappings` 迁移数据，每条旧映射转为 scheduled 策略（default 指向原后端，windows 为空数组）
- ID 使用 `lower(hex(randomblob(16)))` 生成（SQL 中无法调用 `randomUUID`）
- 预置 3 条 ZAI 相关重试规则

迁移完成后 `model_mappings` 表保留不删，保证向后兼容直到代理层完全切换。

## Step 2: 验证迁移

```bash
npm test
```

`initDatabase` 自动执行新迁移文件。现有测试使用内存数据库，会触发迁移。确认全部通过。

## Step 3: DB 类型与函数

在 `src/db/index.ts` 添加：

**接口**：`MappingGroup`（id, client_model, strategy, rule, created_at）、`RetryRule`（id, name, status_code, body_pattern, is_active, created_at）

**函数**（参照 `createModelMapping` / `updateModelMapping` / `updateProvider` 模式）：

| 函数 | 说明 |
|------|------|
| `getMappingGroup(db, clientModel)` | 按客户端模型查询，用于代理层路由 |
| `getAllMappingGroups(db)` | 管理后台列表 |
| `createMappingGroup(db, ...)` | INSERT，JS 端用 `randomUUID()` 生成 ID |
| `updateMappingGroup(db, id, fields)` | 动态 UPDATE，白名单字段 |
| `deleteMappingGroup(db, id)` | DELETE |
| `getActiveRetryRules(db)` | 查询启用的重试规则，用于代理层匹配 |
| `getAllRetryRules(db)` | 管理后台列表 |
| `createRetryRule(db, ...)` | INSERT |
| `updateRetryRule(db, id, fields)` | 动态 UPDATE |
| `deleteRetryRule(db, id)` | DELETE |

`update*` 函数沿用 `ALLOWED` Set 白名单模式，防止注入非法字段。

## Step 4: 测试 DB 函数

```bash
npx vitest run tests/db.test.ts
```

## Step 5: 提交

```bash
git add src/db/migrations/011_create_mapping_groups.sql src/db/index.ts
git commit -m "feat: add mapping_groups and retry_rules tables with migration"
```

## 风险与注意

- 迁移 SQL 中 `INSERT INTO mapping_groups ... SELECT` 依赖 `model_mappings` 表存在，旧部署环境必然有此表
- `rule` 字段是 JSON 字符串，应用层读写时需 `JSON.parse` / `JSON.stringify`
- `body_pattern` 是正则字符串，使用时用 `new RegExp(pattern).test(body)` 匹配
- 暂不修改代理层代码，新旧表共存
