---
verdict: pass
complexity: L2
---

# Metrics 分层存储 + Dashboard 时间选择器重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use xyz-harness-subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task.

**Goal:** 将 request_metrics 拆分为明细表 + 10 分钟聚合表，Dashboard 查询按时间范围自动路由，消除全表扫描性能瓶颈。同时重构 Dashboard 时间选择器为可视化组件。

**Architecture:** 双写 UPSERT（insertMetrics 时同步写入 metrics_10min）+ 查询路由（≤detail_days 走明细、>detail_days 走聚合、跨分界线 UNION）。前端从 usage-window 时间线切换为快速按钮 + 可视化活动图 + Custom 日期选择器。

**Tech Stack:** SQLite (better-sqlite3) + Fastify + Vue 3 + shadcn-vue + Tailwind CSS + Chart.js

---

## Sub-documents

| 文件 | 职责 |
|------|------|
| `plan-backend.md` | 后端 Task 设计（BG1-BG4）、DB 迁移、双写改造、查询路由 |
| `plan-api-contract.md` | 新增/修改 API 端点契约、共享类型定义 |
| `plan-frontend.md` | 前端 Task 设计（FG1-FG3）、组件/composable 变更 |

---

## File Structure

| File | Type | Group | Description |
|------|------|-------|-------------|
| `router/src/db/migrations/055_metrics_10min.sql` | create | BG1 | 聚合表建表迁移 |
| `router/src/db/metrics-10min.ts` | create | BG1 | 聚合表 CRUD（upsertAggBucket、queryAgg 等） |
| `router/src/db/metrics.ts` | modify | BG2 | insertMetrics 双写 + 查询路由改造 |
| `router/src/db/stats.ts` | modify | BG2 | getStats 路由改造 |
| `router/src/db/settings.ts` | modify | BG1 | 新增 getMetricsDetailDays / setMetricsDetailDays |
| `router/src/db/log-cleaner.ts` | modify | BG2 | 扩展清理逻辑，增加 metrics 明细清理 |
| `router/src/admin/metrics.ts` | modify | BG3 | 新增 /metrics/activity 端点 |
| `router/src/admin/usage.ts` | modify | BG3 | getDailyUsage 路由改造 |
| `router/src/admin/settings.ts` | modify | BG1 | 新增 metrics-detail-days 端点 |
| `router/src/db/index.ts` | modify | BG1 | 导出新函数 |
| `frontend/src/composables/useTimeSelector.ts` | create | FG1 | 时间选择器 composable |
| `frontend/src/components/dashboard/ActivityTimeline.vue` | create | FG1 | 可视化活动图组件 |
| `frontend/src/composables/useDashboardTimeline.ts` | delete | FG1 | 被 useTimeSelector 替代 |
| `frontend/src/composables/useDashboard.ts` | modify | FG2 | facade 重构 |
| `frontend/src/composables/useDashboardData.ts` | modify | FG2 | 数据获取改造 |
| `frontend/src/composables/useDashboardFilters.ts` | modify | FG2 | 筛选参数合并 |
| `frontend/src/composables/useLogRetention.ts` | modify | FG3 | 扩展 metrics detail 配置 |
| `frontend/src/views/Dashboard.vue` | modify | FG2 | 时间选择器 UI 替换 |
| `frontend/src/views/Settings.vue` | modify | FG3 | 双栏保留策略 Card |
| `frontend/src/api/client.ts` | modify | FG2 | 新增 getMetricsActivity |
| `frontend/src/api/settings-api.ts` | modify | FG3 | 新增 metrics detail API |

---

## Task List

| # | Task | Type | Depends on | Group |
|---|------|------|-----------|-------|
| 1 | 创建 metrics_10min 聚合表 + CRUD + Settings 函数 | backend | — | BG1 |
| 2 | insertMetrics 双写 + metrics 明细清理 | backend | 1 | BG2 |
| 3 | 查询路由改造（metrics/stats/usage + 筛选参数透传） | backend | 1 | BG3 |
| 4 | 新增 API 端点（activity + metrics-detail-days） | backend | 1, 3 | BG4 |
| 5 | Dashboard 时间选择器重构 | frontend | 4 | FG1 |
| 6 | Dashboard 数据获取 + 筛选改造 | frontend | 5 | FG2 |
| 7 | Settings 保留策略 Card 改造 | frontend | 4 | FG3 |

---

## Spec Coverage Matrix

| Spec AC | Interface Method | Data Flow | Task |
|---------|-----------------|-----------|------|
| AC-1: 聚合表写入 | `upsertAggBucket()` | insertMetrics → upsertAggBucket | Task 1 + 2 |
| AC-2: Metrics 保留配置 | `getMetricsDetailDays()` / Settings API | Settings.vue → API → settings table | Task 1 + 4 + 7 |
| AC-3: 时间选择器 | useTimeSelector + ActivityTimeline | 快速按钮/Custom → timeSelection → API | Task 4 + 5 |
| AC-4: 查询路由 | `queryWithRoute()` | API handler → queryWithRoute → detail/agg table | Task 3 |
| AC-5: 清理 | `deleteMetricsBefore()` | log-cleaner → deleteMetricsBefore | Task 2 |
| AC-6: 向后兼容 | — | usage_windows 保留、API 签名不变 | 全部 |

---

## Spec Metrics Traceability

| Spec 指标 | 采纳状态 | 对应 Task |
|-----------|---------|----------|
| AC-1 聚合表 UPSERT | adopted | Task 1, 2 |
| AC-2 metrics_detail_days 配置 | adopted | Task 1, 4, 7 |
| AC-3 时间选择器交互 | adopted | Task 4, 5 |
| AC-4 查询响应 < 100ms | adopted | Task 3 |
| AC-5 清理逻辑 | adopted | Task 2 |
| AC-6 向后兼容 | adopted | 全部（无破坏性变更） |

---

## Execution Groups

#### BG1: 聚合表基础 + Settings

**Description:** 创建 metrics_10min 表、CRUD 函数、settings 读写函数。后续所有 Group 的基础。

**Tasks:** Task 1

**Files (预估):** 5 个（3 create + 2 modify）

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| Agent | general-purpose → general-purpose → general-purpose |
| Model | 按 taskComplexity 自动选择 |
| 注入上下文 | spec FR-1 §1 + FR-2、CLAUDE.md DB 迁移规范 |
| 读取文件 | `src/db/metrics.ts`、`src/db/settings.ts`、`src/db/index.ts`、`src/db/migrations/054_*.sql` |
| 修改/创建文件 | `migrations/055_create_metrics_10min.sql`、`metrics-10min.ts`、`settings.ts`、`index.ts`、`admin/settings.ts` |

#### BG2: 双写 + 清理

**Description:** 改造 insertMetrics 为双写，扩展 log-cleaner 清理 metrics 明细。

**Tasks:** Task 2

**Dependencies:** BG1（聚合表必须存在）

**Files (预估):** 4 个（0 create + 4 modify）

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| 读取文件 | `src/db/metrics.ts`（insertMetrics 签名）、`src/db/log-cleaner.ts`、`src/proxy/proxy-logging.ts`（调用点）、`src/db/metrics-10min.ts`（BG1 产出） |

#### BG3: 查询路由

**Description:** 改造 6 个查询函数，根据时间范围分流到明细表或聚合表。

**Tasks:** Task 3

**Dependencies:** BG1（聚合表查询函数必须存在）

**Files (预估):** 4 个（0 create + 4 modify）

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| 读取文件 | `src/db/metrics.ts`（全部查询函数）、`src/db/stats.ts`、`src/admin/usage.ts`、`src/db/usage-windows.ts`、`src/db/settings.ts`（getMetricsDetailDays）、`src/db/metrics-10min.ts`（BG1 产出） |

#### BG4: API 端点

**Description:** 新增 /metrics/activity 和 /settings/metrics-detail-days 端点。

**Tasks:** Task 4

**Dependencies:** BG1 + BG3（查询函数和路由机制就绪）

**Files (预估):** 2 个（0 create + 2 modify）

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| 读取文件 | `src/admin/metrics.ts`、`src/admin/settings.ts`、`src/db/metrics-10min.ts`、`src/db/settings.ts` |

#### FG1: 时间选择器

**Description:** 新建 useTimeSelector composable + ActivityTimeline 组件，替代 useDashboardTimeline。

**Tasks:** Task 5

**Dependencies:** BG4（/metrics/activity API 必须就绪）

**Files (预估):** 4 个（2 create + 1 modify + 1 delete）

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| Agent | general-purpose → general-purpose |
| 注入上下文 | spec FR-3、demo-dashboard-v2.html 设计稿、前端编码规范 |
| 读取文件 | `useDashboardTimeline.ts`（被替代）、`useDashboard.ts`（facade）、`api/client.ts`、`design-tokens.ts` |

#### FG2: 数据获取 + 筛选

**Description:** 改造 useDashboardData + useDashboardFilters，统一时间范围参数。

**Tasks:** Task 6

**Dependencies:** FG1（时间选择器 composable 就绪）

**Files (预估):** 5 个（0 create + 5 modify）

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| 读取文件 | `useDashboardData.ts`、`useDashboardFilters.ts`、`useDashboard.ts`、`Dashboard.vue`、`api/client.ts` |

#### FG3: Settings 保留策略

**Description:** Settings 页面 Log Retention Card 改为双栏，新增 metrics_detail_days 配置。

**Tasks:** Task 7

**Dependencies:** BG4（metrics-detail-days API 必须就绪）

**Files (预估):** 3 个（0 create + 3 modify）

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| 注入上下文 | spec FR-2、demo-settings-retention.html 设计稿 |
| 读取文件 | `Settings.vue`、`useLogRetention.ts`、`settings-api.ts` |

---

## Dependency Graph & Wave Schedule

```
BG1 (基础) ──┬──→ BG2 (双写+清理)
             ├──→ BG3 (查询路由) ──→ BG4 (API端点) ──┬──→ FG1 (时间选择器) ──→ FG2 (数据获取)
             │                                         └──→ FG3 (Settings)
             └──→ FG3 (Settings)  ← 也可在 BG4 后执行
```

| Wave | Groups | 说明 |
|------|--------|------|
| Wave 1 | BG1 | 后端基础，无依赖 |
| Wave 2 | BG2, BG3 | 并行：双写 + 查询路由，都依赖 BG1 |
| Wave 3 | BG4 | 依赖 BG1 + BG3 |
| Wave 4 | FG1, FG3 | 并行：前端时间选择器 + Settings，都依赖 BG4 |
| Wave 5 | FG2 | 依赖 FG1 |
