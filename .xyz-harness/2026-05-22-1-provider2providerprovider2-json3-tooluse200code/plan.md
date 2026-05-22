---
verdict: pass
---

# Retry Rule Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use xyz-harness-subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 429 usage-limit responses not returning to clients by adding provider isolation for retry rules, JSON field matching, and upstream error logging.

**Architecture:** Extend existing RetryRuleMatcher with provider-scoped matching and structured body matchers. New upstream_error_logs table follows tool-error-logger pattern. Frontend adapts existing RetryRules.vue Dialog with provider selector and JSON matcher editor.

**Tech Stack:** TypeScript (Fastify + better-sqlite3), Vue 3 + shadcn-vue, Vitest

**Complexity:** L1 (single plan file)

---

## File Structure

| File | Type | Group | Description |
|------|------|-------|-------------|
| `router/src/db/migrations/049_add_provider_isolation_and_matchers.sql` | create | BG1 | DB migration: provider_id + body_matchers + upstream_error_logs |
| `router/src/db/retry-rules.ts` | modify | BG1 | RetryRule type + CRUD 适配新字段 |
| `router/src/db/upstream-error-logs.ts` | create | BG1 | upstream_error_logs 写入 + 查询 |
| `router/src/proxy/orchestration/retry-rules.ts` | modify | BG2 | RetryRuleMatcher: provider 隔离 + JSON 匹配 |
| `router/src/proxy/orchestration/body-matcher.ts` | create | BG2 | matchBodyMatchers 纯函数 |
| `router/src/proxy/orchestration/resilience.ts` | modify | BG2 | decide() 传入 providerId |
| `router/src/proxy/orchestration/orchestrator.ts` | modify | BG2 | stream_error 响应修复 + 传 providerId |
| `router/src/proxy/handler/failover-loop.ts` | modify | BG2 | upstream_error 写入 + stream_error 补充 |
| `router/src/proxy/transport/transport-fn.ts` | modify | BG2 | checkEarlyError 传 providerId |
| `router/src/admin/retry-rules.ts` | modify | BG3 | CRUD 适配 provider_id + body_matchers |
| `router/src/db/index.ts` | modify | BG3 | re-export 新模块 |
| `tests/unit/body-matcher.test.ts` | create | BG2 | body matcher 纯函数测试 |
| `tests/unit/retry-rule-matcher.test.ts` | create | BG2 | provider 隔离 + JSON 匹配集成测试 |
| `frontend/src/views/RetryRules.vue` | modify | FG1 | Provider 列 + Dialog provider 选择 + JSON matcher |
| `frontend/src/i18n/locales/zh-CN/retryRules.json` | modify | FG1 | 新增 i18n key |
| `frontend/src/api/retry-rules.ts` | modify | FG1 | API 类型适配新字段 |

---

## Task List

| # | Task | Type | Depends on | Group |
|---|------|------|-----------|-------|
| 1 | DB migration + retry-rules CRUD + upstream-error-logs | backend | — | BG1 |
| 2 | Body matcher 纯函数 + RetryRuleMatcher 升级 | backend | 1 | BG2 |
| 3 | resilience/orchestrator/failover-loop 适配 | backend | 2 | BG2 |
| 4 | Admin API 适配新字段 | backend | 1 | BG3 |
| 5 | 前端 RetryRules 页面适配 | frontend | 4 | FG1 |

---

## Execution Groups

### BG1: DB Schema + CRUD

**Description:** 数据层基础——迁移文件、RetryRule 类型扩展、新 upstream_error_logs 模块。

**Tasks:** Task 1

**Files (预估):** 4 个（1 create + 2 modify + 1 create）

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| Agent | general-purpose → general-purpose → general-purpose |
| Model | 按 taskComplexity 自动选择 |
| 注入上下文 | Task 1 描述、spec FR1/FR5/FR7、RetryRule 类型定义、tool-error-logger 模式 |
| 读取文件 | `router/src/db/retry-rules.ts`, `router/src/proxy/tool-error-logger.ts`, `router/src/db/tool-error-logs.ts`, `router/src/db/helpers.ts`, `router/src/db/index.ts` |
| 修改/创建文件 | `router/src/db/migrations/049_add_provider_isolation_and_matchers.sql`, `router/src/db/retry-rules.ts`, `router/src/db/upstream-error-logs.ts`, `router/src/db/index.ts` |

**Dependencies:** 无

**设计细节:**

**049 migration SQL:**
```sql
-- retry_rules: provider isolation + body matchers
ALTER TABLE retry_rules ADD COLUMN provider_id TEXT NULL DEFAULT NULL;
ALTER TABLE retry_rules ADD COLUMN body_matchers TEXT NULL DEFAULT NULL;

-- upstream_error_logs: final failed request error summaries
CREATE TABLE upstream_error_logs (
  id TEXT PRIMARY KEY,
  request_log_id TEXT REFERENCES request_logs(id) ON DELETE SET NULL,
  provider_id TEXT NOT NULL,
  backend_model TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  error_type TEXT,
  error_message TEXT,
  client_agent_type TEXT NOT NULL DEFAULT 'unknown',
  router_key_id TEXT,
  session_id TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_upstream_error_logs_time ON upstream_error_logs(created_at);
CREATE INDEX idx_upstream_error_logs_provider ON upstream_error_logs(provider_id, created_at);
CREATE INDEX idx_upstream_error_logs_status ON upstream_error_logs(status_code, created_at);
```

**RetryRule interface 扩展:**
```typescript
export interface RetryRule {
  id: string;
  name: string;
  status_code: number;
  body_pattern: string;
  body_matchers: string | null;  // JSON array of BodyMatcher[], or null
  is_active: number;
  created_at: string;
  retry_strategy: "fixed" | "exponential";
  retry_delay_ms: number;
  max_retries: number;
  max_delay_ms: number;
  provider_id: string | null;
}
```

**RetryRule CRUD 变更:**
- `createRetryRule()`: 新增可选参数 `provider_id?` 和 `body_matchers?`
- `updateRetryRule()`: `RETRY_FIELDS` set 新增 `"provider_id"` 和 `"body_matchers"`
- `getActiveRetryRules()`: 查询不变（加载到内存后在 matcher 中分组）

**upstream-error-logs.ts:**
- `logUpstreamError(ctx)`: 写入单条记录
- `extractErrorInfo(body: string): { errorType: string | null, errorMessage: string | null }`: 从 JSON body 提取 error.type > error.code > null 和 error.message
- `cleanUpstreamErrorLogs(db, beforeDate)`: 清理过期记录

---

### BG2: Matcher 升级 + 调用链适配

**Description:** Body matcher 纯函数、RetryRuleMatcher 升级（provider 隔离 + JSON 匹配）、resilience/orchestrator/failover-loop 调用链传入 providerId。

**Tasks:** Task 2, Task 3

**Files (预估):** 8 个（1 create + 6 modify + 1 create test）+ 1 test create

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| Agent | general-purpose → general-purpose → general-purpose |
| Model | 按 taskComplexity 自动选择 |
| 注入上下文 | Task 2-3 描述、spec FR2/FR3/FR4、RetryRuleMatcher 当前实现、resilience decide() 签名 |
| 读取文件 | `router/src/proxy/orchestration/retry-rules.ts`, `router/src/proxy/orchestration/resilience.ts`, `router/src/proxy/orchestration/orchestrator.ts`, `router/src/proxy/handler/failover-loop.ts`, `router/src/proxy/transport/transport-fn.ts`, `router/src/proxy/types.ts` |
| 修改/创建文件 | `router/src/proxy/orchestration/body-matcher.ts`, `router/src/proxy/orchestration/retry-rules.ts`, `router/src/proxy/orchestration/resilience.ts`, `router/src/proxy/orchestration/orchestrator.ts`, `router/src/proxy/handler/failover-loop.ts`, `router/src/proxy/transport/transport-fn.ts`, `tests/unit/body-matcher.test.ts`, `tests/unit/retry-rule-matcher.test.ts` |

**Dependencies:** BG1（需要新的 RetryRule 类型定义和 DB migration）

**设计细节:**

**body-matcher.ts (纯函数):**
```typescript
export interface BodyMatcher {
  path: string;              // "error.type"
  operator: "equals" | "contains" | "exists";
  value?: string;
}

export function matchBodyMatchers(body: string, matchers: BodyMatcher[]): boolean
export function resolvePath(obj: unknown, path: string): unknown
```

- `resolvePath(obj, "error.type")` → 逐层取值，不存在返回 undefined
- `matchBodyMatchers`: JSON.parse 失败 → false。逐条 AND 检查
- equals: `String(value) === String(expected)` (both sides toString for safety)
- contains: `String(value).includes(expected)`
- exists: value !== undefined

**RetryRuleMatcher 升级:**
```typescript
interface CachedRule {
  rule: RetryRule;
  matchers: BodyMatcher[] | null;  // parsed from body_matchers JSON
  pattern: RegExp | null;          // compiled from body_pattern
}

class RetryRuleMatcher {
  // Key: `${provider_id ?? "__global__"}:${statusCode}`
  private cache = new Map<string, CachedRule[]>();

  load(db): void {
    // 按 (provider_id, status_code) 二级分组
    // provider_id 为 null 时 key 用 "__global__"
  }

  match(statusCode: number, body: string, providerId?: string): RetryRule | null {
    // 1. 查 `providerId:statusCode` 绑定规则
    // 2. 查 `__global__:statusCode` 通用规则
    // 每条规则：有 matchers → matchBodyMatchers，无 → pattern.test(body)
  }

  test(statusCode: number, body: string, providerId?: string): boolean
}
```

**resilience.ts 变更:**
- `decide()` 签名新增 `providerId?: string` 参数
- 所有 `config.ruleMatcher.match(statusCode, body)` 调用改为 `config.ruleMatcher.match(statusCode, body, providerId)`
- `ResilienceConfig` 新增可选 `providerId?: string`

**orchestrator.ts 变更:**
- `handle()` 传入 `provider.id` 到 ResilienceConfig
- `sendResponse()`: stream_error + !headersSent 分支：使用 adapter.formatError() 格式化错误体

**failover-loop.ts 变更:**
- 传入 `provider.id` 到 orchestrator config
- resilience 最终失败（status >= 400）时调用 `logUpstreamError()`
- stream_error 结果补充 `updateLogClientStatus()`

**transport-fn.ts 变更:**
- `checkEarlyError` 需要传入 providerId（从 config 中获取）

---

### BG3: Admin API 适配

**Description:** retry-rules Admin API 端点适配 provider_id 和 body_matchers 新字段。

**Tasks:** Task 4

**Files (预估):** 1 modify

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| Agent | general-purpose → general-purpose → general-purpose |
| Model | 按 taskComplexity 自动选择 |
| 注入上下文 | Task 4 描述、spec FR8/FR9、admin/retry-rules.ts 当前 CRUD 逻辑 |
| 读取文件 | `router/src/admin/retry-rules.ts` |
| 修改/创建文件 | `router/src/admin/retry-rules.ts` |

**Dependencies:** BG1（需要新的 RetryRule 类型）

**设计细节:**

- `CreateRetryRuleSchema`: 新增 `provider_id: Type.Optional(Type.String())`, `body_matchers: Type.Optional(Type.String())`
- `UpdateRetryRuleSchema`: 同上
- Create handler: 新字段传入 `createRetryRule()`
- Update handler: `RETRY_FIELDS` 白名单新增 provider_id, body_matchers
- `validateBodyMatchers()`: 新增校验函数，解析 JSON 并验证结构（path 必填、operator 必须是三个值之一、equals/contains 时 value 必填）
- AI 生成规则端点: 不变（不自动填充 provider_id）

---

### FG1: 前端 RetryRules 页面适配

**Description:** RetryRules.vue 表格新增 Provider 列、Dialog 新增 provider 选择器和 JSON matcher 编辑器。

**Tasks:** Task 5

**Files (预估):** 3 modify

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| Agent | general-purpose → general-purpose |
| Model | 按 taskComplexity 自动选择（前端: medium） |
| 注入上下文 | Task 5 描述、spec FR6、RetryRules.vue 当前实现、shadcn-vue 组件库 |
| 读取文件 | `frontend/src/views/RetryRules.vue`, `frontend/src/i18n/locales/zh-CN/retryRules.json`, `frontend/src/api/client.ts` |
| 修改/创建文件 | `frontend/src/views/RetryRules.vue`, `frontend/src/i18n/locales/zh-CN/retryRules.json`, `frontend/src/api/retry-rules.ts` |

**Dependencies:** BG3（API 端点支持新字段）

**设计细节:**

- 表格新增 Provider 列：使用 Badge 组件显示 "通用" 或 provider 名称
- Dialog Provider 选择：Select 组件，options 从 providers API 加载
- Dialog body matching：用 Tabs 组件切换正则/JSON 模式
  - 正则 Tab：保留现有 Input
  - JSON Tab：动态列表，每行用 Input + Select + Input，"+" Button 添加行
- 保存逻辑：JSON Tab 时序列化 matchers 为 JSON string，正则 Tab 时传 body_pattern + body_matchers=null

---

## Dependency Graph & Wave Schedule

```
BG1 (DB基础) ──┬──→ BG2 (Matcher+调用链)
               │
               └──→ BG3 (Admin API) ──→ FG1 (前端)
```

| Wave | Groups | 说明 |
|------|--------|------|
| Wave 1 | BG1 | DB migration + 类型 + 新模块，无依赖 |
| Wave 2 | BG2, BG3 | BG2 依赖 BG1 类型；BG3 依赖 BG1 CRUD |
| Wave 3 | FG1 | 依赖 BG3 API 端点就绪 |

---

## Self-Review

### Spec Coverage

| FR | Task | 状态 |
|----|------|------|
| FR1 Provider 隔离 | BG2 (Task 2) | 覆盖 |
| FR2 JSON 字段匹配 | BG2 (Task 2) | 覆盖 |
| FR3 RetryRuleMatcher 升级 | BG2 (Task 2) | 覆盖 |
| FR4 stream_error 响应修复 | BG2 (Task 3) | 覆盖 |
| FR5 upstream_error_logs | BG1 (Task 1) + BG2 (Task 3) | 覆盖 |
| FR6 前端适配 | FG1 (Task 5) | 覆盖 |
| FR7 DB Schema 变更 | BG1 (Task 1) | 覆盖 |
| FR8 Admin API 适配 | BG3 (Task 4) | 覆盖 |
| FR9 StateRegistry 刷新 | BG2 (Task 2) | 覆盖（load() 重写） |

### AC Coverage

| AC | 测试文件 | 状态 |
|----|---------|------|
| AC1 Provider 隔离 | retry-rule-matcher.test.ts | 覆盖 |
| AC2 JSON 字段匹配 | body-matcher.test.ts | 覆盖 |
| AC3 429 不再误触发 | retry-rule-matcher.test.ts (集成) | 覆盖 |
| AC4 stream_error 响应 | 现有 proxy test 扩展 | 覆盖 |
| AC5 upstream_error 写入 | upstream-error-logs 测试 | 覆盖 |
| AC6 前端 Provider 选择 | RetryRules.vue 组件测试 | 覆盖 |
| AC7 前端 JSON 编辑 | RetryRules.vue 组件测试 | 覆盖 |
| AC8 向后兼容 | 现有 retry test 回归 | 覆盖 |

### Type Consistency Check

- `RetryRule.provider_id: string | null` — 在 BG1 定义，BG2/BG3/FG1 统一使用
- `RetryRule.body_matchers: string | null` — 在 BG1 定义，BG2 解析为 `BodyMatcher[]`
- `BodyMatcher` interface — 在 BG2 body-matcher.ts 定义，retry-rules.ts 引用
- `match()` 签名 `match(statusCode, body, providerId?)` — BG2 定义，resilience/transport-fn 调用
- `logUpstreamError()` 参数 — BG1 定义，BG2 failover-loop 调用
