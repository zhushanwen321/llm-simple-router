---
verdict: pass
complexity: L2
---

# Provider Multi-API-Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use xyz-harness-subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a single Provider entity to support multiple API protocol endpoints (openai, anthropic, openai-responses) with automatic endpoint selection and format-transform fallback.

**Architecture:** Add `endpoints` JSON field to providers table, encapsulate selection logic in `resolveEndpoint()`, adapt 3 proxy middle-layers (patch/plugin/transport) to consume `ResolvedEndpoint`, extend Admin API to new format, update frontend forms and log display.

**Tech Stack:** Fastify + SQLite (backend), Vue 3 + shadcn-vue + Tailwind (frontend), Vitest (testing)

---

## Sub-documents

| Document | Description |
|----------|-------------|
| `plan-backend.md` | Backend design: data model, migration, resolveEndpoint, Admin API, proxy layer adaptation, logging |
| `plan-api-contract.md` | Admin API request/response contract, internal API signatures |
| `plan-frontend.md` | Frontend design: types, components, composables, i18n, API calls |

## File Structure

| File | Type | Group | Description |
|------|------|-------|-------------|
| `src/db/migrations/051_add_endpoints.sql` | create | BG1 | Migration: add endpoints column + data conversion |
| `src/core/types.ts` | modify | BG1 | ProviderEndpoint + ResolvedEndpoint types |
| `src/db/providers.ts` | modify | BG1 | parseEndpoints/serializeEndpoints（DB 层工具函数）+ updateProvider fields |
| `src/proxy/routing/resolve-endpoint.ts` | create | BG1 | resolveEndpoint()（从 providers.ts import parseEndpoints） |
| `tests/resolve-endpoint.test.ts` | create | BG1 | Unit tests for resolveEndpoint behavior table |
| `src/admin/providers.ts` | modify | BG2 | Schema + CRUD for endpoints format + encryption |
| `src/proxy/handler/failover-loop.ts` | modify | BG3 | Replace provider.api_type/base_url/api_key with resolvedEndpoint |
| `src/proxy/patch/index.ts` | modify | BG3 | Adapt patch conditions to use resolved api_type |
| `src/proxy/transport/transport-fn.ts` | modify | BG3 | Adapt transport to receive ResolvedEndpoint |
| `src/proxy/log-helpers.ts` | modify | BG3 | Add upstream_api_type + upstream_base_url to logs |
| `src/db/logs.ts` | modify | BG3 | Add upstream_api_type + upstream_base_url to INSERT columns |
| `src/admin/logs.ts` | modify | BG3 | Add upstream_api_type + upstream_base_url to log detail response |
| `src/db/migrations/052_add_upstream_log_fields.sql` | create | BG3 | Add upstream_api_type + upstream_base_url columns |
| `tests/provider-endpoints.test.ts` | create | BG2 | Integration tests for Admin API CRUD + proxy routing |
| `frontend/src/types/mapping.ts` | modify | FG1 | Provider type: add endpoints field |
| `frontend/src/components/providers/EndpointEditor.vue` | create | FG1 | New endpoint list editor component |
| `frontend/src/components/providers/ModelCapabilitiesEditor.vue` | modify | FG1 | Remove old single-field area, embed EndpointEditor |
| `frontend/src/composables/useProviderForm.ts` | modify | FG1 | FormState + buildPayload + validate for endpoints |
| `frontend/src/views/Providers.vue` | modify | FG1 | Table columns + dialog binding |
| `frontend/src/views/QuickSetup.vue` | modify | FG1 | Provider config area: shared key + endpoint list |
| `frontend/src/composables/useQuickSetup.ts` | modify | FG1 | buildProviderPayload → endpoints format |
| `frontend/src/components/logs/LogTableRow.vue` | modify | FG1 | Tags column: arrow for format transform |
| `frontend/src/components/request-detail/RequestOverviewPanel.vue` | modify | FG1 | Metadata: upstream_api_type + upstream_base_url |

## Task List

| # | Task | Type | Depends on | Group |
|---|------|------|-----------|-------|
| 1 | DB types + migration + resolveEndpoint() | backend | — | BG1 |
| 2 | Admin API endpoints format | backend | 1 | BG2 |
| 3 | Proxy layer adaptation + logging | backend | 1 | BG3 |
| 4 | Provider form + endpoint editor | frontend | 2 | FG1 |
| 5 | Provider list + QuickSetup + Logs | frontend | 4 | FG1 |

## Execution Groups

#### BG1: 数据基础层

**Description:** Provider 类型定义、DB 迁移、resolveEndpoint() 核心封装。所有后续后端和前端任务都依赖此组产出的类型和函数。

**Tasks:** Task 1

**Files (预估):** 5 个（2 create + 3 modify）

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| Agent | general-purpose → general-purpose → general-purpose |
| Model | taskComplexity 自动选择 |
| 注入上下文 | spec FR-1/FR-2/FR-3, plan-backend.md §1-§3 |
| 读取文件 | `src/core/types.ts`, `src/db/providers.ts`, `src/db/migrations/050_*.sql` |
| 修改/创建文件 | `src/core/types.ts`, `src/db/providers.ts` (parseEndpoints/serializeEndpoints), `src/proxy/routing/resolve-endpoint.ts` (resolveEndpoint), `src/db/migrations/051_add_endpoints.sql`, `tests/resolve-endpoint.test.ts` |

**Execution Flow:**
```
Task 1:
  1. general-purpose (TDD) → 写 resolveEndpoint + parseEndpoints 失败测试
  2. general-purpose (backend-dev) → 实现类型 + 迁移 + 函数
  3. general-purpose (reviewer) → spec 合规检查
```

**Dependencies:** 无

**设计细节:** 见 plan-backend.md §1-§3

---

#### BG2: Admin API

**Description:** Provider CRUD 切换到 endpoints 格式。包含 schema 校验、endpoint api_key 加密、响应解密。

**Tasks:** Task 2

**Files (预估):** 3 个（0 create + 2 modify + 1 create test）

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| Agent | general-purpose → general-purpose → general-purpose |
| Model | taskComplexity 自动选择 |
| 注入上下文 | spec FR-4, plan-api-contract.md, plan-backend.md §4 |
| 读取文件 | `src/admin/providers.ts`, `src/utils/crypto.ts` |
| 修改/创建文件 | `src/admin/providers.ts`, `tests/provider-endpoints.test.ts` |

**Execution Flow:**
```
Task 2:
  1. general-purpose (TDD) → 写 Admin API CRUD 测试
  2. general-purpose (backend-dev) → 实现 schema + CRUD 改造
  3. general-purpose (reviewer) → spec 合规检查
```

**Dependencies:** BG1（类型和 parseEndpoints 依赖）

**设计细节:** 见 plan-backend.md §4, plan-api-contract.md

---

#### BG3: 代理层 + 日志

**Description:** failover-loop.ts 12 处 provider 字段访问替换为 resolvedEndpoint，patch/transport 层适配，日志新增 upstream_api_type/base_url。

**Tasks:** Task 3

**Files (预估):** 8 个（1 create + 7 modify）

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| Agent | general-purpose → general-purpose → general-purpose |
| Model | taskComplexity 自动选择 |
| 注入上下文 | spec FR-2/FR-5, plan-backend.md §5-§6 |
| 读取文件 | `src/proxy/handler/failover-loop.ts`, `src/proxy/patch/index.ts`, `src/proxy/transport/transport-fn.ts`, `src/proxy/log-helpers.ts`, `src/db/logs.ts`, `src/admin/logs.ts` |
| 修改/创建文件 | `failover-loop.ts`, `patch/index.ts`, `transport/transport-fn.ts`, `log-helpers.ts`, `db/logs.ts`, `admin/logs.ts`, `db/migrations/052_add_upstream_log_fields.sql` |

**Execution Flow:**
```
Task 3:
  1. general-purpose (TDD) → 写代理路由集成测试
  2. general-purpose (backend-dev) → 适配 failover-loop + patch + transport + log
  3. general-purpose (reviewer) → spec 合规检查
```

**Dependencies:** BG1（resolveEndpoint 依赖）

**设计细节:** 见 plan-backend.md §5-§6

---

#### FG1: 前端全部

**Description:** Provider 表单重构、列表页三列分离、QuickSetup 适配、日志箭头展示。统一使用 EndpointEditor 组件。

**Tasks:** Task 4, Task 5

**Files (预估):** 10 个（1 create + 9 modify）

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| Agent | general-purpose → general-purpose |
| Model | taskComplexity: medium |
| 注入上下文 | plan-frontend.md, UI demo HTML, shadcn-vue 规范 |
| 读取文件 | 所有 `frontend/src/` 下需修改文件 |
| 修改/创建文件 | 见 File Structure 表 FG1 行 |

**Execution Flow:**
```
Task 4 (表单):
  1. general-purpose (frontend-dev) → EndpointEditor + useProviderForm + ModelCapabilitiesEditor
  2. general-purpose (reviewer) → spec 合规检查

Task 5 (列表+QuickSetup+Logs):
  1. general-purpose (frontend-dev) → Providers table + QuickSetup + LogTableRow + OverviewPanel
  2. general-purpose (reviewer) → spec 合规检查
```

**Dependencies:** BG2（Admin API 就绪后前端才能联调）

**设计细节:** 见 plan-frontend.md

---

## Dependency Graph & Wave Schedule

```
BG1 (types+migration+resolveEndpoint) ──┬──→ BG2 (Admin API)
                                        └──→ BG3 (proxy+log)
BG2 ──→ FG1 (frontend all)
```

| Wave | Groups | 说明 |
|------|--------|------|
| Wave 1 | BG1 | 数据基础，无依赖 |
| Wave 2 | BG2, BG3 | BG2 依赖 BG1 类型；BG3 依赖 BG1 resolveEndpoint |
| Wave 3 | FG1 | 依赖 BG2 API 就绪 |

## Interface Contracts

### Module: resolve-endpoint

#### Data: ProviderEndpoint

| Field | Type | Description |
|-------|------|-------------|
| api_type | `"openai" \| "openai-responses" \| "anthropic"` | Protocol type |
| base_url | `string` | Upstream base URL |
| upstream_path | `string \| null` | Override default path |
| api_key | `string \| null` | Per-endpoint key, null = fallback |

#### Data: ResolvedEndpoint

| Field | Type | Description |
|-------|------|-------------|
| api_type | `string` | Actual upstream api_type |
| base_url | `string` | Resolved base URL |
| upstream_path | `string \| null` | Resolved path |
| api_key | `string` | Decrypted final key |
| needs_transform | `boolean` | Whether FormatRegistry is needed |

#### Function: resolveEndpoint

| Method | Signature | Returns | Edge Cases | Spec Ref |
|--------|-----------|---------|------------|----------|
| resolveEndpoint | `(provider: Provider, clientApiType: string, encryptionKey: string) => ResolvedEndpoint` | `ResolvedEndpoint` | parseEndpoints returns [] → throw; no api_type match → first endpoint + transform | AC-2, AC-3 |
| parseEndpoints | `(endpointsJson: string \| null) => ProviderEndpoint[]` | `ProviderEndpoint[]` | null → empty array []; invalid JSON → throw; empty array after parse → throw at resolveEndpoint level | AC-5 |

### Module: admin/providers

| Method | Signature | Returns | Edge Cases | Spec Ref |
|--------|-----------|---------|------------|----------|
| validateEndpoints | `(endpoints: unknown) => { valid: boolean, error?: string }` | validation result | empty array → 400; duplicate api_type → 400 | AC-6 |
| encryptEndpointKeys | `(endpoints: ProviderEndpoint[], key: string) => ProviderEndpoint[]` | encrypted endpoints | null api_key → skip | AC-4 |

## Spec Coverage Matrix

| Spec AC | Interface Method | Data Flow | Task |
|---------|-----------------|-----------|------|
| AC-1 | resolveEndpoint | migrated provider → exact match → no transform | Task 1 |
| AC-2 | resolveEndpoint | multi-endpoint → api_type match | Task 1 |
| AC-2b | resolveEndpoint | 3-endpoint → openai-responses match | Task 1 |
| AC-3 | resolveEndpoint | no match → first endpoint + transform | Task 1 |
| AC-3b | resolveEndpoint | openai-responses fallback to openai | Task 1 |
| AC-4 | encryptEndpointKeys | create → encrypt → read → decrypt → use | Task 2 |
| AC-5 | parseEndpoints + migration SQL | old fields → endpoints JSON | Task 1 |
| AC-6 | validateEndpoints | duplicate api_type → 400 | Task 2 |
| AC-7 | log-helpers | request → upstream_api_type + upstream_base_url | Task 3 |
| AC-8 | Provider list Vue | 3-endpoint provider → 3 badges + 3 key rows | Task 5 |
| AC-9 | useQuickSetup.buildProviderPayload | quick setup → endpoints payload → request success | Task 5 |
| AC-10 | resolveEndpoint upstream_path | custom path → actual URL | Task 1 |

## Spec Metrics Traceability

| Spec 指标 | 采纳状态 | 对应 Task |
|-----------|---------|----------|
| AC-1 单 endpoint 向后兼容 | adopted | Task 1 |
| AC-2 多 endpoint 精确匹配 | adopted | Task 1 |
| AC-2b openai-responses 匹配 | adopted | Task 1 |
| AC-3 无匹配格式转换降级 | adopted | Task 1 |
| AC-3b openai-responses 降级 | adopted | Task 1 |
| AC-4 endpoint api_key 加密 | adopted | Task 2 |
| AC-5 DB 迁移 + 创建正向流程 | adopted | Task 1, Task 2 |
| AC-6 api_type 唯一性校验 | adopted | Task 2 |
| AC-7 日志记录上下游 api_type | adopted | Task 3 |
| AC-8 前端 Provider 列表展示 | adopted | Task 5 |
| AC-9 QuickSetup payload 格式 | adopted | Task 5 |
| AC-10 upstream_path 覆盖 | adopted | Task 1 |
