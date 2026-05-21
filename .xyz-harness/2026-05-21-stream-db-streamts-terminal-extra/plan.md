---
verdict: pass
---

# 运行时诊断数据持久化 + 模型超时 UI 修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use xyz-harness-subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将代理层运行时已区分但未持久化的 8 类诊断数据写入 request_logs 表，并修复前端模型超时 UI 缺陷。

**Architecture:** 数据流为 `TransportResult/ResilienceAttempt → logResilienceResult() → insertRequestLog() → SQLite`。在现有类型上扩展可选字段，沿数据流逐层传递，最终写入 DB。前端仅修改 ModelCard.vue 的 v-if 条件。

**Tech Stack:** TypeScript (Fastify + better-sqlite3), Vue 3 (shadcn-vue), Vitest

**Complexity:** L1 — 扩展现有表、同步短路径数据流、无新 API

---

## File Structure

| File | Type | Group | Description |
|------|------|-------|-------------|
| `router/src/db/migrations/048_add_diagnostic_columns.sql` | create | BG1 | 新增 8 个 nullable 列到 request_logs |
| `router/src/core/types.ts` | modify | BG1 | TransportResult stream_abort 新增 abortReason；ResilienceAttempt 新增 error_code, headers_sent |
| `router/src/proxy/transport/stream.ts` | modify | BG1 | 三条 abort 路径传入 abortReason |
| `router/src/proxy/orchestration/resilience.ts` | modify | BG1 | decide() 返回值传递到 attempts；attempt 填充 error_code, headers_sent |
| `router/src/proxy/handler/failover-loop.ts` | modify | BG1 | 提取 mappingReason/failover_trigger/resilience decision，传给 logResilienceResult |
| `router/src/proxy/proxy-logging.ts` | modify | BG1 | logResilienceResult 参数扩展，传递新字段到 insertRequestLog |
| `router/src/proxy/log-helpers.ts` | modify | BG1 | RequestLogParams 扩展，insertSuccessLog 传递新字段 |
| `router/src/db/logs.ts` | modify | BG1 | RequestLogInsert 扩展，rawInsertRequestLog SQL 添加 8 列 |
| `tests/proxy/diagnostic-fields.test.ts` | create | BG1 | 验证 8 个新字段的端到端测试 |
| `frontend/src/components/quick-setup/ModelCard.vue` | modify | FG1 | 移除 v-if 条件，始终显示超时输入框 |

## Task List

| # | Task | Type | Depends on | Group |
|---|------|------|-----------|-------|
| 1 | Migration + DB 类型扩展 | backend | — | BG1 |
| 2 | TransportResult/ResilienceAttempt 类型扩展 | backend | 1 | BG1 |
| 3 | 数据流串联（stream → resilience → failover-loop → logging → DB） | backend | 2 | BG1 |
| 4 | 端到端测试 | backend | 3 | BG1 |
| 5 | ModelCard.vue 超时 UI 修复 | frontend | — | FG1 |

## Execution Groups

### BG1: 后端诊断数据持久化

**Description:** Migration + 类型扩展 + 数据流串联 + 测试。所有后端文件高度耦合（类型变更沿调用链传播），必须作为一个原子单元实现。

**Tasks:** Task 1, Task 2, Task 3, Task 4

**Files (预估):** 10 个文件（2 create + 8 modify）

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| Agent | general-purpose → general-purpose → general-purpose |
| Model | `router-openai/glm-5.1`（executor）、`router-openai/glm-5-turbo`（tdd-coder） |
| 注入上下文 | spec 全文、CLAUDE.md 架构约束、本 plan Task 1-4 |
| 读取文件 | `router/src/core/types.ts`, `router/src/proxy/transport/stream.ts`, `router/src/proxy/orchestration/resilience.ts`, `router/src/proxy/handler/failover-loop.ts`, `router/src/proxy/proxy-logging.ts`, `router/src/proxy/log-helpers.ts`, `router/src/db/logs.ts`, `router/src/db/migrations/047_*.sql` |
| 修改/创建文件 | 见 File Structure 表 BG1 行 |

**Execution Flow (BG1 内部):** 串行派遣

  Task 1:
    1. general-purpose (read xyz-harness-test-driven-development + xyz-harness-backend-dev) → 写失败测试（migration 执行验证 + 类型编译）
    2. general-purpose (read xyz-harness-backend-dev) → 写 migration + 类型扩展
    3. general-purpose (read xyz-harness-expert-reviewer) → spec 合规检查

  Task 2 (depends on Task 1):
    1. general-purpose (read xyz-harness-test-driven-development) → 写失败测试（ResilienceAttempt 新字段断言）
    2. general-purpose (read xyz-harness-backend-dev) → 实现 ResilienceAttempt 扩展
    3. general-purpose (read xyz-harness-expert-reviewer) → spec 合规检查

  Task 3 (depends on Task 2):
    1. general-purpose (read xyz-harness-test-driven-development) → 写失败测试（数据流端到端）
    2. general-purpose (read xyz-harness-backend-dev) → 实现数据流串联
    3. general-purpose (read xyz-harness-expert-reviewer) → spec 合规检查

  Task 4 (depends on Task 3):
    1. general-purpose (read xyz-harness-test-driven-development) → 补充边缘场景测试（abort_reason 三种原因、throw error_code、headers_sent）
    2. general-purpose (read xyz-harness-expert-reviewer) → 最终 spec 合规检查

**Dependencies:** 无

### FG1: 前端模型超时 UI 修复

**Description:** 修改 ModelCard.vue 的 v-if 条件，使未配置超时的模型也显示超时输入框。

**Tasks:** Task 5

**Files (预估):** 1 个文件（1 modify）

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| Agent | general-purpose → general-purpose |
| Model | `router-anthropic/kimi-for-coding` |
| 注入上下文 | spec FR8 + AC8、本 plan Task 5 |
| 读取文件 | `frontend/src/components/quick-setup/ModelCard.vue` |
| 修改/创建文件 | `frontend/src/components/quick-setup/ModelCard.vue` |

**Execution Flow (FG1 内部):**

  Task 5:
    1. general-purpose (read xyz-harness-frontend-dev) → 修改 v-if 条件
    2. general-purpose (read xyz-harness-expert-reviewer) → spec 合规检查

**Dependencies:** 无（前后端完全独立）

## Dependency Graph & Wave Schedule

```
BG1 (backend 全链路)  ──────────────────────→ 完成
FG1 (frontend ModelCard) ──→ 完成
```

| Wave | Groups | 说明 |
|------|--------|------|
| Wave 1 | BG1, FG1 | 前后端完全独立，可并行 |

---

## Task Details

### Task 1: Migration + DB 类型扩展

**Type:** backend

**Files:**
- Create: `router/src/db/migrations/048_add_diagnostic_columns.sql`
- Modify: `router/src/db/logs.ts:48-112` (RequestLogInsert 接口 + rawInsertRequestLog SQL)

- [ ] **Step 1: 创建 migration 文件**

```sql
-- 048_add_diagnostic_columns.sql
ALTER TABLE request_logs ADD COLUMN transport_kind TEXT;
ALTER TABLE request_logs ADD COLUMN abort_reason TEXT;
ALTER TABLE request_logs ADD COLUMN error_code TEXT;
ALTER TABLE request_logs ADD COLUMN headers_sent INTEGER;
ALTER TABLE request_logs ADD COLUMN resilience_action TEXT;
ALTER TABLE request_logs ADD COLUMN resilience_reason TEXT;
ALTER TABLE request_logs ADD COLUMN mapping_reason TEXT;
ALTER TABLE request_logs ADD COLUMN failover_trigger TEXT;
```

- [ ] **Step 2: 扩展 RequestLogInsert 接口**

在 `router/src/db/logs.ts` 的 `RequestLogInsert` 接口末尾添加：

```typescript
transport_kind?: string | null;
abort_reason?: string | null;
error_code?: string | null;
headers_sent?: number | null;
resilience_action?: string | null;
resilience_reason?: string | null;
mapping_reason?: string | null;
failover_trigger?: string | null;
```

- [ ] **Step 3: 更新 rawInsertRequestLog SQL**

INSERT 语句添加 8 列。`getCachedStmt` 的 SQL 字符串和 `.run()` 参数列表都需要扩展：

```sql
INSERT INTO request_logs (id, api_type, model, provider_id, status_code, client_status_code, latency_ms,
  is_stream, error_message, created_at, client_request, upstream_request, upstream_response,
  is_retry, is_failover, original_request_id, router_key_id, original_model, session_id, pipeline_snapshot,
  transport_kind, abort_reason, error_code, headers_sent, resilience_action, resilience_reason, mapping_reason, failover_trigger)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
  ?, ?, ?, ?, ?, ?, ?, ?)
```

`.run()` 参数列表末尾添加：

```typescript
log.transport_kind ?? null,
log.abort_reason ?? null,
log.error_code ?? null,
log.headers_sent ?? null,
log.resilience_action ?? null,
log.resilience_reason ?? null,
log.mapping_reason ?? null,
log.failover_trigger ?? null,
```

- [ ] **Step 4: 运行构建确认编译通过**

Run: `cd router && npx tsc --noEmit`
Expected: 0 errors（新字段均为可选，不影响现有调用）

- [ ] **Step 5: Commit**

```bash
git add router/src/db/migrations/048_add_diagnostic_columns.sql router/src/db/logs.ts
git commit -m "feat(db): add 8 diagnostic columns to request_logs"
```

### Task 2: TransportResult / ResilienceAttempt 类型扩展

**Type:** backend

**Files:**
- Modify: `router/src/core/types.ts:103-107` (stream_abort 新增 abortReason)
- Modify: `router/src/core/types.ts:138-152` (ResilienceAttempt 新增 error_code, headers_sent)

- [ ] **Step 1: TransportResult stream_abort 变体新增 abortReason**

在 `router/src/core/types.ts` 的 `stream_abort` 变体中添加 `abortReason` 可选字段：

```typescript
| {
    kind: "stream_abort";
    statusCode: number;
    metrics?: MetricsResult;
    upstreamResponseHeaders?: Record<string, string>;
    sentHeaders: Record<string, string>;
    timeoutContext?: { modelId: string; providerId: string };
    timeoutMs?: number;
    abortReason?: "idle_timeout" | "client_disconnect" | "loop_detection";
  }
```

- [ ] **Step 2: ResilienceAttempt 新增 error_code 和 headers_sent**

在 `ResilienceAttempt` 接口末尾添加：

```typescript
/** error.code（如 ETIMEDOUT / ECONNRESET / ECONNREFUSED），仅 throw 时有值 */
error_code?: string | null;
/** response headers 是否已发送，影响重试/failover 决策 */
headers_sent?: boolean | null;
```

- [ ] **Step 3: 运行构建确认编译通过**

Run: `cd router && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add router/src/core/types.ts
git commit -m "feat(types): add abortReason to TransportResult, error_code/headers_sent to ResilienceAttempt"
```

### Task 3: 数据流串联

**Type:** backend

**Files:**
- Modify: `router/src/proxy/transport/stream.ts:159,178-180,209,281-282` (三条 abort 路径传入 abortReason)
- Modify: `router/src/proxy/orchestration/resilience.ts` (attempt 填充 error_code, headers_sent; decide() 返回 action/reason 传递到外部)
- Modify: `router/src/proxy/handler/failover-loop.ts` (提取 mappingReason, failover_trigger, resilience decision; 传给 logResilienceResult)
- Modify: `router/src/proxy/proxy-logging.ts` (logResilienceResult 参数扩展, insertRequestLog 调用传递新字段)
- Modify: `router/src/proxy/log-helpers.ts` (RequestLogParams 扩展, insertSuccessLog 传递新字段)

- [ ] **Step 1: stream.ts — 三条 abort 路径传入 abortReason**

在 `terminal()` 调用中传入 `abortReason`：

1. Idle timeout（约第 159 行）：`this.terminal("stream_abort", { ..., abortReason: "idle_timeout" })`
2. Client disconnect（约第 209 行 close handler）：`this.terminal("stream_abort", { ..., abortReason: "client_disconnect" })`
3. Loop detection（约第 281-282 行）：`this.terminal("stream_abort", { ..., abortReason: "loop_detection" })`

需要在 `terminal()` 方法的 extra 参数类型中接受 `abortReason`，并在构建 `stream_abort` result 时传入。

- [ ] **Step 2: resilience.ts — attempt 填充 error_code 和 headers_sent**

在 `executeWithResilience()` 中构建 `ResilienceAttempt` 时：

```typescript
error_code: result.kind === "throw" ? (result.error as NodeJS.ErrnoException).code ?? null : null,
headers_sent: result.kind === "throw" ? result.headersSent ?? null
  : result.kind === "stream_error" ? result.headersSent ?? null
  : null,
```

同时，`decide()` 函数的返回值 `ResilienceDecision` 已经包含 action 和 reason（对 abort 类型），需要在 failover-loop 中提取。

- [ ] **Step 3: proxy-logging.ts — logResilienceResult 参数扩展**

在 `logResilienceResult()` 的 `params` 中添加可选字段：

```typescript
resilienceAction?: string | null;
resilienceReason?: string | null;
mappingReason?: string | null;
failoverTrigger?: string | null;
```

在所有 `insertRequestLog()` 调用中传递新字段：

```typescript
transport_kind: attempt.resultKind,
abort_reason: attempt.resultKind === "stream_abort"
  ? ("abortReason" in result && result.kind === "stream_abort" ? result.abortReason ?? null : null)
  : null,
error_code: attempt.error_code ?? null,
headers_sent: attempt.headers_sent != null ? (attempt.headers_sent ? 1 : 0) : null,
resilience_action: params.resilienceAction ?? null,
resilience_reason: params.resilienceReason ?? null,
mapping_reason: params.mappingReason ?? null,
failover_trigger: params.failoverTrigger ?? null,
```

在 `insertSuccessLog()` 调用路径中，也需要传递这些字段。需要扩展 `RequestLogParams`（log-helpers.ts）：

```typescript
transport_kind?: string | null;
abort_reason?: string | null;
error_code?: string | null;
headers_sent?: number | null;
resilience_action?: string | null;
resilience_reason?: string | null;
mapping_reason?: string | null;
failover_trigger?: string | null;
```

并在 `insertSuccessLog()` 的 `insertRequestLog()` 调用中传递。

- [ ] **Step 4: failover-loop.ts — 提取并传递所有诊断字段**

在调用 `logResilienceResult()` 时传入新字段：

1. **mappingReason**: 从 `resolveResult.mappingReason` 提取（已在 iterationSnapshot 中使用，直接复用 `effectiveMappingReason`）
2. **failoverTrigger**: 在 `catch (e)` 块中，当 `e instanceof ProviderSwitchNeeded` 时传 `"ProviderSwitchNeeded"`，`e instanceof SemaphoreQueueFullError` 时传 `"SemaphoreQueueFullError"` 等
3. **resilienceAction / resilienceReason**: 从 `decide()` 返回值提取（需在调用 `logResilienceResult` 之前保存 decision）

注意：`logResilienceResult` 在循环中被调用两次（约第 427 行成功路径和第 509 行 ProviderSwitchNeeded 路径），两处都需要传递。

- [ ] **Step 5: 运行构建确认编译通过**

Run: `cd router && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 6: 运行现有测试确认无回归**

Run: `cd router && npm test`
Expected: 全部通过（新字段 nullable，不影响现有断言）

- [ ] **Step 7: Commit**

```bash
git add router/src/proxy/transport/stream.ts router/src/proxy/orchestration/resilience.ts router/src/proxy/handler/failover-loop.ts router/src/proxy/proxy-logging.ts router/src/proxy/log-helpers.ts
git commit -m "feat(proxy): wire diagnostic fields through transport→resilience→failover→logging pipeline"
```

### Task 4: 端到端测试

**Type:** backend

**Files:**
- Create: `tests/proxy/diagnostic-fields.test.ts`

- [ ] **Step 1: 编写 transport_kind 测试**

测试场景：
1. 非流式请求成功 → `transport_kind = "success"`
2. 流式请求成功 → `transport_kind = "stream_success"`
3. 上游返回 500（非流式）→ `transport_kind = "error"`
4. 流式上游返回错误状态码 → `transport_kind = "stream_error"`
5. 上游连接超时（throw）→ `transport_kind = "throw"`

每个测试使用 `buildTestApp` + mock backend，查询 `request_logs` 验证字段值。

- [ ] **Step 2: 编写 abort_reason 测试**

测试场景：
1. idle timeout 触发 → `abort_reason = "idle_timeout"`（mock backend 设置短超时）
2. 客户端断连 → `abort_reason = "client_disconnect"`（abort request）
3. 非 abort 请求 → `abort_reason IS NULL`

- [ ] **Step 3: 编写 error_code / headers_sent / resilience decision / mapping_reason / failover_trigger 测试**

覆盖 spec AC3-AC7 中的关键场景。使用现有测试模式（createMockBackend + buildTestApp）。

- [ ] **Step 4: 运行全部测试**

Run: `cd router && npm test`
Expected: 全部通过

- [ ] **Step 5: Commit**

```bash
git add tests/proxy/diagnostic-fields.test.ts
git commit -m "test(proxy): add diagnostic fields end-to-end tests"
```

### Task 5: ModelCard.vue 超时 UI 修复

**Type:** frontend

**Files:**
- Modify: `frontend/src/components/quick-setup/ModelCard.vue:175` (移除内层 v-if)

- [ ] **Step 1: 移除 v-if 条件**

在 `ModelCard.vue` 约第 175 行，将：

```html
<div
  v-if="streamTimeoutMs !== undefined"
  class="flex items-center gap-1.5"
>
```

改为：

```html
<div
  class="flex items-center gap-1.5"
>
```

外层 div 的 `v-if="streamTimeoutMs !== undefined || capabilities !== undefined"` 已经因为 capabilities 总有值而始终为 true，无需修改。

- [ ] **Step 2: 运行前端类型检查**

Run: `cd frontend && npx vue-tsc -b --noEmit`
Expected: 0 errors

- [ ] **Step 3: 运行前端 lint**

Run: `cd frontend && npx eslint . --max-warnings=0`
Expected: 0 warnings

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/quick-setup/ModelCard.vue
git commit -m "fix(ui): always show stream timeout input in ModelCard"
```
