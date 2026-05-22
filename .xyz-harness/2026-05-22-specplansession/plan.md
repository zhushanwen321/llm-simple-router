---
verdict: pass
---

# Retry Rule Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use xyz-harness-subagent-driven-development or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) for tracking.

**Goal:** 实现 Retry Rule 的 Provider 隔离、JSON 字段匹配和上游错误日志功能，解决跨 Provider 正则误命中问题。

**Architecture:** 四层 proxy 架构（Handler → Orchestration → Routing → Transport）。RetryRuleMatcher 在 Orchestration 层负责规则匹配和缓存管理，新增 BodyMatcher 纯函数在底层处理结构化 JSON 匹配，upstream_error_logs 在 failover-loop 中写入。

**Tech Stack:** Fastify + better-sqlite3 + TypeScript（后端），Vue 3 + shadcn-vue + TypeScript（前端），Vitest（测试）

**Complexity:** L2

---

## Sub-documents

- Backend design: `plan-backend.md`
- API contract: `plan-api-contract.md`
- Frontend design: `plan-frontend.md`

## File Structure

| File | Type | Group | Description |
|------|------|-------|-------------|
| `router/src/db/migrations/049_add_provider_isolation_and_matchers.sql` | create | BG1 | DB migration: provider_id, body_matchers columns + upstream_error_logs table |
| `router/src/proxy/orchestration/body-matcher.ts` | create | BG1 | BodyMatcher 纯函数: matchBodyMatchers(), resolvePath() |
| `router/src/proxy/orchestration/retry-rules.ts` | modify | BG1 | RetryRuleMatcher 升级: 二级缓存结构, body_matchers + body_pattern 双路径匹配 |
| `router/src/db/retry-rules.ts` | modify | BG1 | DB layer: CRUD 新增 provider_id/body_matchers 字段 |
| `router/src/db/upstream-error-logs.ts` | create | BG1 | UpstreamErrorLogs DB layer: logUpstreamError(), extractErrorInfo(), cleanUpstreamErrorLogs() |
| `router/src/proxy/orchestration/resilience.ts` | modify | BG2 | ResilienceLayer.decide() 传入 providerId |
| `router/src/proxy/handler/failover-loop.ts` | modify | BG2 | 调用 logUpstreamError(), updateLogClientStatus() |
| `router/src/proxy/orchestration/orchestrator.ts` | modify | BG2 | sendResponse() stream_error 分支格式化响应 |
| `router/src/admin/retry-rules.ts` | modify | BG2 | Admin API: provider_id/body_matchers CRUD 适配 |
| `router/src/proxy/patch/retry-rule-matcher.ts` | modify | BG2 | load() 适配新缓存结构 |
| `frontend/src/views/RetryRules.vue` | modify | FG1 | UI: Provider 列 + Dialog 适配 |
| `frontend/src/components/retry-rules/BodyMatcherEditor.vue` | create | FG1 | JSON 匹配编辑器组件 |
| `frontend/src/i18n/locales/zh-CN/retryRules.json` | modify | FG1 | 新增 i18n key（Provider 列、JSON 匹配器等）|
| `frontend/src/i18n/locales/en/retryRules.json` | modify | FG1 | 新增 i18n key（同上，英文）|
| `tests/unit/body-matcher.test.ts` | create | BG1 | BodyMatcher 纯函数测试 |
| `tests/unit/retry-rule-matcher.test.ts` | modify | BG1 | RetryRuleMatcher 升级测试（provider 隔离） |
| `tests/integration/retry-rule-provider.test.ts` | create | BG2 | 集成测试: provider 隔离 + upstream_error_logs |
| `frontend/src/__tests__/RetryRules.test.ts` | create | FG1 | 前端组件测试 (vitest) |

## Task List

| # | Task | Type | Depends on | Group |
|---|------|------|-----------|-------|
| 1 | DB Migration + BodyMatcher 纯函数 | backend | — | BG1 |
| 2 | RetryRuleMatcher 升级 + DB layer 适配 | backend | 1 | BG1 |
| 3 | upstream_error_logs DB layer | backend | 1 | BG1 |
| 4 | Resilience/failover-loop/orchestrator 适配 | backend | 2,3 | BG2 |
| 5 | Admin API 适配 | backend | 2 | BG2 |
| 6 | 前端 RetryRules 页面适配 | frontend | 5 | FG1 |
| 7 | 集成测试 | test | 4 | BG2 |

## Execution Groups

### BG1: 后端基础（DB + Matcher + 日志层）

**Description:** DB migration、BodyMatcher 纯函数、RetryRuleMatcher 升级、upstream_error_logs DB layer。这四个 task 紧密关联——迁移创建列→Matcher 消费列→日志层依赖表。

**Tasks:** Task 1, Task 2, Task 3

**Files (预估):** 8 个文件（3 create + 3 modify + 2 test）

**Subagent 配置:**

| 配置项 | 值 |
|--------|-----|
| Agent | general-purpose → general-purpose → general-purpose |
| Model | 按 taskComplexity 自动选择（executor: high, tdd-coder: medium） |
| 注入上下文 | spec.md §FR1-FR3/FR7, plan-backend.md §3-5 |
| 读取文件 | `router/src/db/retry-rules.ts`, `router/src/proxy/orchestration/retry-rules.ts`, `router/src/db/migrations/048_add_stream_timeout.sql`, `router/src/db/helpers.ts`, `router/src/core/constants.ts` |
| 修改/创建文件 | DB migration 049, body-matcher.ts, retry-rules.ts, upstream-error-logs.ts, retry-rules.ts (DB), body-matcher.test.ts, retry-rule-matcher.test.ts |

**Execution Flow (BG1 内部):** 串行派遣，每个 Task 走完整 subagent 链。

**Task 1 (DB Migration + BodyMatcher):**
  1. general-purpose (TDD + backend-dev) → 写 body-matcher 失败测试
  2. general-purpose (backend-dev) → 迁移 049 + body-matcher.ts 实现
  3. general-purpose (expert-reviewer) → spec 合规检查

**Task 2 (RetryRuleMatcher 升级):**
  1. general-purpose (TDD + backend-dev) → 写 retry-rule-matcher 失败测试
  2. general-purpose (backend-dev) → RetryRuleMatcher 升级 + DB layer 适配
  3. general-purpose (expert-reviewer) → spec 合规检查

**Task 3 (upstream_error_logs DB layer):**
  1. general-purpose (TDD + backend-dev) → 写上游错误日志测试
  2. general-purpose (backend-dev) → upstream-error-logs.ts 实现
  3. general-purpose (expert-reviewer) → spec 合规检查

**Dependencies:** 无

**设计细节:** 见 plan-backend.md §3-5

### BG2: 后端集成（Resilience + Admin API）

**Description:** Resilience 层传参适配、failover-loop 写入日志、orchestrator stream_error 响应修复、Admin API 适配、StateRegistry 刷新。

**Tasks:** Task 4, Task 5, Task 7

**Files (预估):** 6 个文件（5 modify + 1 test）

**Subagent 配置:**

| 配置项 | 值 |
|--------|-----|
| Agent | general-purpose → general-purpose → general-purpose |
| Model | 按 taskComplexity 自动选择（executor: high, tdd-coder: medium） |
| 注入上下文 | spec.md §FR4/FR5/FR8/FR9, plan-backend.md §6-8, plan-api-contract.md |
| 读取文件 | `router/src/proxy/orchestration/resilience.ts`, `router/src/proxy/handler/failover-loop.ts`, `router/src/proxy/orchestration/orchestrator.ts`, `router/src/admin/retry-rules.ts`, `router/src/proxy/patch/retry-rule-matcher.ts` |
| 修改/创建文件 | resilience.ts, failover-loop.ts, orchestrator.ts, admin/retry-rules.ts, retry-rule-matcher.ts, retry-rule-provider.test.ts |

**Execution Flow (BG2 内部):**

**Task 4 (Resilience/Orchestrator 适配):**
  1. general-purpose (TDD + backend-dev) → 写集成测试
  2. general-purpose (backend-dev) → resilience/failover-loop/orchestrator 适配
  3. general-purpose (expert-reviewer) → spec 合规检查

**Task 5 (Admin API 适配):**
  1. general-purpose (backend-dev) → admin/retry-rules.ts CRUD 适配
  2. general-purpose (expert-reviewer) → spec 合规检查

**Task 7 (集成测试):**
  1. general-purpose (TDD + backend-dev) → 补写集成测试覆盖

**Dependencies:** BG1

**设计细节:** 见 plan-backend.md §6-8

### FG1: 前端 RetryRules 适配

**Description:** RetryRules.vue 添加 Provider 列 + Dialog 适配（Provider 选择 + JSON 字段匹配编辑器）。

**Tasks:** Task 6

**Files (预估):** 5 个文件（1 create + 4 modify + 1 test）

**Subagent 配置:**

| 配置项 | 值 |
|--------|-----|
| Agent | general-purpose → general-purpose |
| Model | 按 taskComplexity 自动选择（前端: medium） |
| 注入上下文 | spec.md §FR6, plan-frontend.md, plan-api-contract.md, spec.md AC6/AC7 |
| 读取文件 | `frontend/src/views/RetryRules.vue`, `frontend/src/components/ui/badge.vue`, `frontend/src/components/ui/select.vue`, `frontend/src/components/ui/tabs.vue`, `frontend/src/types/mapping.ts`, `frontend/src/api/client.ts`, `frontend/src/i18n/locales/zh-CN/retryRules.json`, `frontend/src/i18n/locales/en/retryRules.json` |
| 修改/创建文件 | RetryRules.vue, BodyMatcherEditor.vue, RetryRules.test.ts, zh-CN/retryRules.json, en/retryRules.json |

**Execution Flow (FG1 内部):**

**Task 6:**
  1. general-purpose (frontend-dev) → 骨架→功能→美化
  2. general-purpose (expert-reviewer) → spec 合规检查

**Dependencies:** BG2 (Admin API must be ready)

**设计细节:** 见 plan-frontend.md

## Dependency Graph & Wave Schedule

```
BG1 (基础) ──→ BG2 (集成) ──→ FG1 (前端)
```

| Wave | Groups | 说明 |
|------|--------|------|
| Wave 1 | BG1 | DB 迁移 + Matcher + 日志层，无依赖 |
| Wave 2 | BG2 | 依赖 BG1（需要 migration 和 matcher 就绪） |
| Wave 3 | FG1 | 依赖 BG2（需要 Admin API 就绪，前端才能对接调用） |

**并行约束:**
- 同一 Wave 内最多 3 个 subagent 并行（Semaphore 限制）
- 同一文件不允许多个 subagent 同时修改
- BG1 到 BG2 串行（BG2 依赖 BG1 的 migration 和 matcher 就绪）

## ADR 评估

**已有 ADR:**
- `0005-retry-rule-body-matchers.md`: 已覆盖 body_matchers 的设计决策

**新决策评估:**
1. **provider_id = NULL 作为通用规则标识** → 在 ADR 0005 中已隐含说明，无需新增 ADR
2. **body_matchers AND 逻辑** → ADR 0005 中已覆盖
3. **upstream_error_logs 表结构** → 存储设计，非架构决策，无需 ADR
4. **stream_error 响应格式化** → 修复行为，非架构决策，无需 ADR

**结论：** 无需新增 ADR。所有重要决策已在 ADR 0005 中覆盖。
