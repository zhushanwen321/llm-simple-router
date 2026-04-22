# Multi Router Keys 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为不同使用方提供独立的 Router API Key，支持模型白名单和按 key 筛选日志/指标

**Architecture:** 新增 router_keys 表管理多个 API Key（SHA-256 hash 存储），改造 auth middleware 从数据库匹配而非环境变量，在代理层增加模型白名单校验，日志和指标增加 router_key_id 维度用于筛选

**Tech Stack:** Fastify + better-sqlite3 + SQLite JSON1 + Vue 3 + shadcn-vue + Tailwind CSS

---

## 文件结构

| 操作 | 文件 | 职责 |
|------|------|------|
| Create | `src/db/migrations/008_create_router_keys.sql` | 数据库迁移 |
| Modify | `src/db/index.ts` | 新增 router_keys CRUD + 筛选扩展 |
| Modify | `src/middleware/auth.ts` | 改为 hash + DB 匹配 |
| Modify | `src/config.ts` | ROUTER_API_KEY 变为可选 |
| Modify | `src/index.ts` | 注入 db 到 auth middleware |
| Modify | `src/proxy/openai.ts` | 白名单校验 + 传递 router_key_id |
| Modify | `src/proxy/anthropic.ts` | 白名单校验 + 传递 router_key_id |
| Modify | `src/proxy/proxy-core.ts` | insertSuccessLog 新增 router_key_id |
| Create | `src/admin/router-keys.ts` | Router Keys Admin CRUD |
| Modify | `src/admin/routes.ts` | 注册新路由 |
| Modify | `src/admin/logs.ts` | 新增 router_key_id 筛选 |
| Modify | `src/admin/stats.ts` | 新增 router_key_id 筛选 |
| Modify | `src/admin/metrics.ts` | 新增 router_key_id 筛选 |
| Modify | `src/db/metrics.ts` | getMetricsSummary/Timeseries 新增 router_key_id |
| Create | `frontend/src/views/RouterKeys.vue` | API Keys 管理页面 |
| Modify | `frontend/src/router/index.ts` | 新增路由 |
| Modify | `frontend/src/api/client.ts` | 新增 API 方法 |
| Modify | `frontend/src/components/layout/Sidebar.vue` | 新增导航项 |
| Modify | `frontend/src/views/Logs.vue` | 新增 API Key 筛选 |
| Modify | `frontend/src/views/Metrics.vue` | 新增 API Key 筛选 |
| Create | `tests/router-keys.test.ts` | 集成测试 |
| Modify | `tests/auth.test.ts` | 适配新认证 |

## 子文档

- [Task 1-3: 后端数据层](plan-backend-data.md) — 迁移、DB 函数、配置
- [Task 4-5: 认证层](plan-auth.md) — auth middleware、Fastify 类型
- [Task 6-7: 代理层](plan-proxy.md) — 白名单校验、日志传递
- [Task 8-9: Admin API](plan-admin-api.md) — Router Keys CRUD、筛选扩展
- [Task 10: 前端](plan-frontend.md) — 管理页面、筛选栏、导航
