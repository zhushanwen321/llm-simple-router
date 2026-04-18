# 代理增强页面改造 + Session 管理 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在代理增强页面添加 Tab 切换和 Session 管理，持久化 session-model 映射到数据库。

**Architecture:** 双写策略（内存 Map + SQLite），session 以 `(routerKeyId, sessionId)` 复合键标识。前端单页面 Tabs 布局。

**Tech Stack:** Fastify + better-sqlite3 + Vue 3 + shadcn-vue

**Spec:** [session-management-design.md](./session-management-design.md)

---

## File Structure & Ownership

| Action | File | Owner Task |
|--------|------|-----------|
| Create | `src/db/migrations/016_create_session_model_tables.sql` | Task 1 |
| Create | `src/db/session-states.ts` | Task 1 |
| Modify | `src/db/index.ts` | Task 1 |
| Modify | `tests/db.test.ts` | Task 1 |
| Modify | `src/proxy/model-state.ts` | Task 2 |
| Modify | `src/proxy/enhancement-handler.ts` | Task 2 |
| Modify | `src/proxy/proxy-core.ts` | Task 2 |
| Modify | `src/index.ts` | Task 2 |
| Modify | `tests/model-state.test.ts` | Task 2 |
| Modify | `src/admin/proxy-enhancement.ts` | Task 3 |
| Create | `tests/admin-session-states.test.ts` | Task 3 |
| Modify | `frontend/src/api/client.ts` | Task 4 |
| Modify | `frontend/src/views/ProxyEnhancement.vue` | Task 4 |
| Create | `frontend/src/components/proxy-enhancement/SessionTable.vue` | Task 4 |

---

## Tasks

按顺序执行，每个 Task 依赖前一个的产出：

1. [Task 1: 数据库迁移 + CRUD](./plan-task1-db-migration.md)
2. [Task 2: ModelStateManager + Enhancement Handler + Proxy Core](./plan-task2-model-state.md)
3. [Task 3: 后端 Session API](./plan-task3-admin-api.md)
4. [Task 4: 前端改造](./plan-task4-frontend.md)
