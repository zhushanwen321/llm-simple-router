# 模型映射策略 + 重试规则配置化 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 client_model 从 1:1 映射改造为 1:N（定时切换），并将重试判断逻辑配置化。

**Architecture:** 新增 `mapping_groups` 表替代 `model_mappings`，JSON rule 字段描述策略规则。统一 `resolveMapping` 入口供 openai/anthropic 代理共用。`retry_rules` 表存储可重试条件（状态码 + 正则），启动时加载到内存。

**Tech Stack:** Fastify, SQLite (better-sqlite3), TypeScript, Vue 3 + shadcn-vue, Vitest

---

## 文件变更总览

### 新建文件

| 文件 | 职责 |
|------|------|
| `src/db/migrations/011_create_mapping_groups.sql` | 建表 + 数据迁移 |
| `src/proxy/strategy/types.ts` | 策略接口定义 |
| `src/proxy/strategy/scheduled.ts` | 定时切换策略实现 |
| `src/proxy/strategy/round-robin.ts` | 骨架 |
| `src/proxy/strategy/random.ts` | 骨架 |
| `src/proxy/strategy/failover.ts` | 骨架 |
| `src/proxy/mapping-resolver.ts` | 统一映射解析入口 |
| `src/proxy/retry-rules.ts` | 重试规则内存匹配器 |
| `src/admin/groups.ts` | mapping_groups Admin 路由 |
| `src/admin/retry-rules.ts` | retry_rules Admin 路由 |
| `tests/mapping-resolver.test.ts` | 解析层单元测试 |
| `tests/scheduled-strategy.test.ts` | 定时策略测试 |
| `tests/admin-groups.test.ts` | groups CRUD 测试 |
| `tests/admin-retry-rules.test.ts` | retry rules CRUD 测试 |
| `tests/retry-rules-matcher.test.ts` | 规则匹配器测试 |
| `frontend/src/views/RetryRules.vue` | 重试规则管理页面 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/db/index.ts` | 新增 MappingGroup, RetryRule 类型和 CRUD 函数 |
| `src/proxy/retry.ts` | 移除 isRetryableBody，改用 RetryRuleMatcher |
| `src/proxy/openai.ts` | 用 resolveMapping 替代 getModelMapping |
| `src/proxy/anthropic.ts` | 同上 |
| `src/admin/mappings.ts` | 旧 API 兼容层 |
| `src/admin/routes.ts` | 注册新路由 |
| `src/index.ts` | 启动时加载 retry rules，注入 matcher |
| `frontend/src/api/client.ts` | 新增 API 方法 |
| `frontend/src/views/ModelMappings.vue` | 分组卡片视图重写 |
| `frontend/src/router/index.ts` | 添加 RetryRules 路由 |

---

## 任务索引

| Task | 标题 | 子文档 |
|------|------|--------|
| 1 | 数据库迁移 + DB 函数 | [plan-phase1-db.md](plan-phase1-db.md) |
| 2 | 策略接口 + scheduled 实现 | [plan-phase2-resolver.md](plan-phase2-resolver.md) |
| 3 | 映射解析器 + 代理集成 | [plan-phase3-proxy.md](plan-phase3-proxy.md) |
| 4 | 重试规则匹配器 | [plan-phase4-retry.md](plan-phase4-retry.md) |
| 5 | Admin API（groups + retry-rules） | [plan-phase5-admin.md](plan-phase5-admin.md) |
| 6 | 前端 | [plan-phase6-frontend.md](plan-phase6-frontend.md) |

### 依赖关系

```
Task 1 (DB) → Task 2 (策略) → Task 3 (解析器+代理)
                            → Task 4 (重试匹配器)
Task 1 → Task 5 (Admin API) → Task 6 (前端)
Task 4 → Task 5
```

Task 2/4 可并行。Task 3 依赖 2。Task 5 依赖 1+4。Task 6 依赖 5。
