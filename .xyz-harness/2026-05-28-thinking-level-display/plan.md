---
verdict: pass
complexity: L1
---

# Thinking Level Display & Model Filter Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use xyz-harness-subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Monitor、Logs、Request Detail 中展示 thinking level；修复日志页面模型过滤 bug（拆分为客户端模型 + 目标模型）；日志表格增加耗时列。

**Architecture:** 纯展示层改动。后端在 `buildActiveRequest()` 中提取 thinking level 字符串并注入 SSE 广播；日志/详情场景前端从 `client_request` JSON 提取。模型过滤修复后端新增两个查询参数，前端拆分为两个 Select。耗时列纯前端。

**Tech Stack:** TypeScript (Fastify) + Vue 3 + shadcn-vue + i18n

---

## File Structure

| File | Type | Group | Description |
|------|------|-------|-------------|
| `router/src/core/monitor/types.ts` | modify | BG1 | `ActiveRequest` 新增 `thinkingLevel` 字段 |
| `router/src/proxy/orchestration/orchestrator.ts` | modify | BG1 | `buildActiveRequest()` 从请求体提取 thinking level |
| `router/src/db/logs.ts` | modify | BG1 | `LogFilterOptions` 新增 `client_model`/`backend_model`，`buildLogWhereClause` 新增条件 |
| `router/src/admin/logs.ts` | modify | BG1 | `LogQuerySchema` 新增 `client_model`/`backend_model` 参数 |
| `frontend/src/types/monitor.ts` | modify | FG1 | 前端 `ActiveRequest` 新增 `thinkingLevel` |
| `frontend/src/composables/useLogFilters.ts` | modify | FG1 | 拆分 modelFilter 为两个 ref，修改 loadModelOptions |
| `frontend/src/utils/thinking-level.ts` | create | FG1 | thinking level 提取工具函数 |
| `frontend/src/utils/format.ts` | modify | FG1 | 新增 `formatLatency()` |
| `frontend/src/views/Monitor.vue` | modify | FG1 | 活跃请求卡片展示 thinking level badge |
| `frontend/src/views/Logs.vue` | modify | FG1 | 模型过滤拆分为两个 Select |
| `frontend/src/components/logs/LogTableRow.vue` | modify | FG1 | 新增 thinking level 列 + 耗时列 |
| `frontend/src/components/request-detail/types.ts` | modify | FG1 | `UnifiedRequestOverview` 新增 `thinkingLevel` |
| `frontend/src/components/request-detail/RequestOverviewPanel.vue` | modify | FG1 | 详情面板展示 thinking level |
| `frontend/src/components/request-detail/upstream-merge.ts` | modify | FG1 | `fromLogEntry`/`fromActiveRequest` 提取 thinkingLevel |
| `frontend/src/i18n/locales/zh-CN/logs.json` | modify | FG1 | 新增过滤标签 i18n |
| `frontend/src/i18n/locales/en/logs.json` | modify | FG1 | 新增过滤标签 i18n |
| `router/tests/admin/logs-filter.test.ts` | create | BG1 | 模型过滤后端集成测试 |

## Interface Contracts

### Module: thinking-level (frontend)

#### Function: extractThinkingLevel

| Method | Signature | Returns | Edge Cases | Spec Ref |
|--------|-----------|---------|------------|----------|
| extractThinkingLevel | `(clientRequestJson: string \| null, apiType: string) => string` | `"off"` / `"low"` / `"medium"` / `"high"` / `"enabled"` / `"disabled"` | `clientRequestJson` 为 null → `"off"`；JSON parse 失败 → `"off"` | AC-A1-A7 |

#### Data: UnifiedRequestOverview (新增字段)

| Field | Type | Description |
|-------|------|-------------|
| thinkingLevel | `string` | 提取后的 thinking level 值 |

### Module: orchestrator (backend)

#### Function: buildActiveRequest (修改)

| Method | Signature | Returns | Edge Cases | Spec Ref |
|--------|-----------|---------|------------|----------|
| buildActiveRequest | `(request, config, apiType) => ActiveRequest` | `ActiveRequest` (含 `thinkingLevel`) | 无 thinking 参数 → `"off"` | AC-A1-A7 |

### Module: logs DB (backend)

#### Function: buildLogWhereClause (修改)

| Method | Signature | Returns | Edge Cases | Spec Ref |
|--------|-----------|---------|------------|----------|
| buildLogWhereClause | `(options: LogFilterOptions, baseCondition) => { where, params }` | `{ where: string, params: unknown[] }` | `backend_model` 需通过 `rm.backend_model` JOIN | AC-B1-B5 |

## Spec Coverage Matrix

| Spec AC | Interface Method | Data Flow | Task |
|---------|-----------------|-----------|------|
| AC-A1 | extractThinkingLevel | buildActiveRequest → SSE → Monitor.vue | Task 1, Task 3 |
| AC-A2 | extractThinkingLevel | buildActiveRequest → SSE → Monitor.vue | Task 1, Task 3 |
| AC-A3 | extractThinkingLevel | buildActiveRequest → SSE → Monitor.vue | Task 1, Task 3 |
| AC-A4 | extractThinkingLevel | `"off"` 默认值 | Task 1, Task 3 |
| AC-A5 | extractThinkingLevel | `thinking.type === "disabled"` | Task 1, Task 3 |
| AC-A6 | extractThinkingLevel | `clientRequest === null → "off"` | Task 2 |
| AC-A7 | extractThinkingLevel | `reasoning.effort` 优先于 `reasoning_effort` | Task 1 |
| AC-B1 | buildLogWhereClause | `client_model` → `rl.model LIKE ?` | Task 4, Task 5 |
| AC-B2 | buildLogWhereClause | `backend_model` → `rm.backend_model LIKE ?` | Task 4, Task 5 |
| AC-B3 | buildLogWhereClause | 两个条件组合 | Task 4, Task 5 |
| AC-B4 | useLogFilters | 移除 filteredModelOptions 的 provider 过滤 | Task 5 |
| AC-B5 | LogQuerySchema | 保留原 `model` 参数 | Task 4 |
| AC-C1 | formatLatency | `latency_ms` → 格式化字符串 | Task 6 |
| AC-C2 | formatLatency | `< 1000 → Xms`, `>= 1000 → X.Xs` | Task 6 |

## Spec Metrics Traceability

| Spec AC | 采纳状态 | 对应 Task |
|---------|---------|----------|
| AC-A1 (OpenAI thinking level) | adopted | Task 1, Task 3 |
| AC-A2 (Anthropic thinking level) | adopted | Task 1, Task 3 |
| AC-A3 (Responses API thinking level) | adopted | Task 1, Task 3 |
| AC-A4 (无参数 → "off") | adopted | Task 1, Task 2 |
| AC-A5 (disabled 显式展示) | adopted | Task 1, Task 2 |
| AC-A6 (client_request null) | adopted | Task 2 |
| AC-A7 (reasoning 优先级) | adopted | Task 1 |
| AC-B1 (客户端模型过滤) | adopted | Task 4, Task 5 |
| AC-B2 (目标模型过滤) | adopted | Task 4, Task 5 |
| AC-B3 (组合过滤) | adopted | Task 4, Task 5 |
| AC-B4 (下拉不受 provider 影响) | adopted | Task 5 |
| AC-B5 (model 向后兼容) | adopted | Task 4 |
| AC-C1 (耗时展示) | adopted | Task 6 |
| AC-C2 (耗时格式化) | adopted | Task 6 |

## Task List

### Task 1: 后端 — ActiveRequest 注入 thinkingLevel

**Type:** backend

**Files:**
- Modify: `router/src/core/monitor/types.ts:27` (ActiveRequest interface)
- Modify: `router/src/proxy/orchestration/orchestrator.ts:149` (buildActiveRequest)
- Test: `router/tests/orchestration-thinking-level.test.ts` (create)

- [ ] **Step 1: 修改后端 ActiveRequest 类型**

在 `router/src/core/monitor/types.ts` 的 `ActiveRequest` interface 中新增字段：
```typescript
thinkingLevel?: string; // "off" | "low" | "medium" | "high" | "enabled" | "disabled"
```

- [ ] **Step 2: 在 buildActiveRequest() 中提取 thinkingLevel**

在 `orchestrator.ts` 的 `buildActiveRequest()` 中，从 `config.clientRequest` JSON 解析请求体，按 apiType 提取 thinking level：

提取逻辑（内联在 buildActiveRequest 中，约 15 行）：
- 解析 `config.clientRequest` 为 JSON，取 `.body`
- 如果 `apiType === "anthropic"`：取 `body.thinking?.type`，无则 `"off"`
- 如果 `apiType === "openai"` 或 `"openai-responses"`：
  - 优先取 `body.reasoning?.effort`
  - 其次取 `body.reasoning_effort`
  - 都无则 `"off"`
- 解析失败（JSON 无效 / body 不存在）→ `"off"`

注意：`config.clientRequest` 格式为 `JSON.stringify({ headers: {...}, body: {...} })`，需要先解析外层再取 body。

- [ ] **Step 3: 写测试验证提取逻辑**

创建 `router/tests/orchestration-thinking-level.test.ts`：
- 测试 OpenAI `reasoning_effort: "high"` → `"high"`
- 测试 Anthropic `thinking.type: "enabled"` → `"enabled"`
- 测试 Responses API `reasoning.effort: "low"` → `"low"`
- 测试 `reasoning.effort` 优先于 `reasoning_effort`
- 测试无 thinking 参数 → `"off"`
- 测试 `thinking.type: "disabled"` → `"disabled"`
- 测试 `clientRequest` 为 undefined → `"off"`

- [ ] **Step 4: 提交**

```bash
git add -A && git commit -m "feat: inject thinkingLevel into ActiveRequest for SSE broadcast"
```

---

### Task 2: 前端 — thinking level 提取工具函数

**Type:** frontend

**Files:**
- Create: `frontend/src/utils/thinking-level.ts`

- [ ] **Step 1: 创建 extractThinkingLevel 函数**

创建 `frontend/src/utils/thinking-level.ts`：

函数签名：
```typescript
export function extractThinkingLevel(
  clientRequestJson: string | null,
  apiType: string,
): string
```

逻辑：
- `clientRequestJson === null` → `"off"`
- JSON.parse 失败 → `"off"`
- 解析后取 `.body`
- `apiType === "anthropic"` → `body.thinking?.type ?? "off"`
- 其他（openai/openai-responses）→ `body.reasoning?.effort ?? body.reasoning_effort ?? "off"`

此函数复用于：
1. `upstream-merge.ts` 的 `fromLogEntry()` — 从日志的 `client_request` JSON 提取
2. `upstream-merge.ts` 的 `fromActiveRequest()` — 直接取 `req.thinkingLevel`
3. `LogTableRow.vue` — 行内展示（不打开详情时）

- [ ] **Step 2: 提交**

```bash
git add -A && git commit -m "feat: add extractThinkingLevel utility for frontend"
```

---

### Task 3: 前端 — Monitor + Logs + Detail 展示 thinking level

**Type:** frontend

**Files:**
- Modify: `frontend/src/types/monitor.ts:14` (ActiveRequest interface)
- Modify: `frontend/src/views/Monitor.vue` (活跃请求卡片)
- Modify: `frontend/src/components/request-detail/types.ts:9` (UnifiedRequestOverview)
- Modify: `frontend/src/components/request-detail/upstream-merge.ts` (fromLogEntry, fromActiveRequest)
- Modify: `frontend/src/components/request-detail/RequestOverviewPanel.vue` (详情面板)
- Modify: `frontend/src/components/logs/LogTableRow.vue` (日志列表行)

- [ ] **Step 1: 前端 ActiveRequest 类型新增 thinkingLevel**

在 `frontend/src/types/monitor.ts` 的 `ActiveRequest` interface 中新增：
```typescript
thinkingLevel?: string;
```

- [ ] **Step 2: UnifiedRequestOverview 新增 thinkingLevel**

在 `frontend/src/components/request-detail/types.ts` 的 `UnifiedRequestOverview` interface 中新增：
```typescript
thinkingLevel: string;
```

- [ ] **Step 3: upstream-merge.ts 填充 thinkingLevel**

在 `fromActiveRequest()` 中：直接取 `req.thinkingLevel ?? "off"` 赋值给 `overview.thinkingLevel`。

在 `fromLogEntry()` 中：调用 `extractThinkingLevel(entry.client_request, entry.api_type)` 赋值。

- [ ] **Step 4: Monitor.vue 活跃请求卡片展示**

在 Monitor.vue 的活跃请求卡片中（`req.model` 旁边），添加 thinking level Badge：
```vue
<Badge v-if="req.thinkingLevel && req.thinkingLevel !== 'off'"
  variant="outline" class="shrink-0 text-xs">
  {{ req.thinkingLevel }}
</Badge>
```

注意：思考中（thinking level 为 "off"）不展示 Badge，减少视觉噪音。

- [ ] **Step 5: RequestOverviewPanel.vue 详情面板展示**

在状态行（Row 2: status + SSE + apiType）之后新增一行展示 thinking level：
```vue
<Badge variant="outline" class="text-[10px]">
  {{ overview.thinkingLevel }}
</Badge>
```

- [ ] **Step 6: LogTableRow.vue 日志列表展示**

在 LogTableRow.vue 中，在 apiType Badge 旁边（状态列内），新增 thinking level Badge：
```vue
<Badge v-if="thinkingLevel !== 'off'" variant="outline" class="text-[10px] px-1.5 py-0">
  {{ thinkingLevel }}
</Badge>
```

其中 `thinkingLevel` 通过 `extractThinkingLevel(log.client_request, log.api_type)` 计算。为避免每行重复解析，在组件内用 `computed` 缓存。

- [ ] **Step 7: 提交**

```bash
git add -A && git commit -m "feat: display thinking level in Monitor, Logs, and Request Detail"
```

---

### Task 4: 后端 — 日志过滤新增 client_model / backend_model

**Type:** backend

**Files:**
- Modify: `router/src/db/logs.ts:150` (LogFilterOptions type)
- Modify: `router/src/db/logs.ts:160` (buildLogWhereClause function)
- Modify: `router/src/admin/logs.ts:12` (LogQuerySchema)
- Modify: `router/src/admin/logs.ts:46` (listOptions)
- Test: `router/tests/admin/logs-filter.test.ts` (create)

- [ ] **Step 1: LogFilterOptions 新增字段**

在 `router/src/db/logs.ts` 的 `LogFilterOptions` type 中新增：
```typescript
client_model?: string;
backend_model?: string;
```

- [ ] **Step 2: buildLogWhereClause 新增条件**

在 `buildLogWhereClause` 中，在 `options.model` 条件之后新增：
```typescript
if (options.client_model) {
  where += " AND rl.model LIKE ?";
  params.push(`%${options.client_model}%`);
}
if (options.backend_model) {
  where += " AND rm.backend_model LIKE ?";
  params.push(`%${options.backend_model}%`);
}
```

注意：`rm.backend_model` 依赖 `LOG_LIST_JOIN` 中已有的 `LEFT JOIN request_metrics rm`，无需新增 JOIN。

- [ ] **Step 3: LogQuerySchema 新增参数**

在 `router/src/admin/logs.ts` 的 `LogQuerySchema` 中新增：
```typescript
client_model: Type.Optional(Type.String()),
backend_model: Type.Optional(Type.String()),
```

- [ ] **Step 4: 路由 handler 传递新参数**

在 admin log routes 的 GET handler 中，`listOptions` 新增：
```typescript
client_model: query.client_model || undefined,
backend_model: query.backend_model || undefined,
```

- [ ] **Step 5: 写集成测试**

创建 `router/tests/admin/logs-filter.test.ts`：
- 测试 `client_model` 过滤 `rl.model`
- 测试 `backend_model` 过滤 `rm.backend_model`
- 测试两者组合
- 测试原 `model` 参数仍正常工作

- [ ] **Step 6: 提交**

```bash
git add -A && git commit -m "feat: add client_model and backend_model filter params to logs API"
```

---

### Task 5: 前端 — 模型过滤拆分为两个 Select

**Type:** frontend

**Files:**
- Modify: `frontend/src/composables/useLogFilters.ts`
- Modify: `frontend/src/views/Logs.vue`
- Modify: `frontend/src/i18n/locales/zh-CN/logs.json`
- Modify: `frontend/src/i18n/locales/en/logs.json`

- [ ] **Step 1: useLogFilters 拆分 modelFilter**

修改 `frontend/src/composables/useLogFilters.ts`：

1. 将 `modelFilter` ref 拆分为：
   - `clientModelFilter = ref("all")`
   - `backendModelFilter = ref("all")`
2. 将 `modelOptions` 拆分为：
   - `clientModelOptions = ref<string[]>([])` — 从 `result.rows` 取 `model` 去重
   - `backendModelOptions = ref<string[]>([])` — 从 `result.rows` 取 `backend_model` 去重
3. 删除 `filteredModelOptions` computed（不再按 provider 过滤）
4. `buildFilterParams()` 中：
   - 删除 `if (modelFilter.value !== "all") params.model = modelFilter.value`
   - 新增 `if (clientModelFilter.value !== "all") params.client_model = clientModelFilter.value`
   - 新增 `if (backendModelFilter.value !== "all") params.backend_model = backendModelFilter.value`
5. 导出新增 `clientModelFilter`、`backendModelFilter`、`clientModelOptions`、`backendModelOptions`，删除 `modelFilter`、`filteredModelOptions`、`modelOptions`

- [ ] **Step 2: Logs.vue 模板更新**

在 `frontend/src/views/Logs.vue` 中：

1. 将原来的单个模型 Select 替换为两个 Select：
   - 客户端模型：下拉选项为 `clientModelOptions`，绑定 `clientModelFilter`
   - 目标模型：下拉选项为 `backendModelOptions`，绑定 `backendModelFilter`
2. 保留 provider Select、key Select、status Select 不变
3. 更新 `watch` 依赖数组：将 `modelFilter` 替换为 `clientModelFilter` 和 `backendModelFilter`

- [ ] **Step 3: i18n 更新**

`zh-CN/logs.json` 新增：
```json
"clientModel": "客户端模型",
"allClientModels": "全部客户端模型",
"backendModel": "目标模型",
"allBackendModels": "全部目标模型"
```

`en/logs.json` 新增：
```json
"clientModel": "Client Model",
"allClientModels": "All Client Models",
"backendModel": "Backend Model",
"allBackendModels": "All Backend Models"
```

- [ ] **Step 4: 提交**

```bash
git add -A && git commit -m "fix: split model filter into client model and backend model selectors"
```

---

### Task 6: 前端 — 日志表格增加耗时列

**Type:** frontend

**Files:**
- Modify: `frontend/src/utils/format.ts` (新增 formatLatency)
- Modify: `frontend/src/components/logs/LogTableRow.vue` (新增耗时 TableCell)
- Modify: `frontend/src/i18n/locales/zh-CN/logs.json` (新增列标题)
- Modify: `frontend/src/i18n/locales/en/logs.json` (新增列标题)

- [ ] **Step 1: formatLatency 工具函数**

在 `frontend/src/utils/format.ts` 中新增：
```typescript
/** latency_ms → 可读字符串 (45ms / 1.2s) */
export function formatLatency(ms: number | null): string {
  if (ms === null || ms === undefined) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
```

- [ ] **Step 2: LogTableRow 新增耗时列**

在 `LogTableRow.vue` 中，在状态/类型列（最后一个 Badge 容器的 `</TableCell>` 之后）和错误列（`text-destructive` TableCell）之间，新增：
```vue
<TableCell class="text-xs text-muted-foreground">
  {{ formatLatency(log.latency_ms) }}
</TableCell>
```

同时更新 `Logs.vue` 中的表头，在对应位置新增一列标题。

- [ ] **Step 3: i18n 列标题**

`zh-CN/logs.json` 的 `table` 对象中新增 `"latency": "耗时"`
`en/logs.json` 的 `table` 对象中新增 `"latency": "Latency"`

- [ ] **Step 4: 提交**

```bash
git add -A && git commit -m "feat: add latency column to logs table"
```

---

## Execution Groups

#### BG1: 后端改动

**Description:** 后端 thinking level 注入 + 日志过滤 API 扩展

**Tasks:** Task 1, Task 4

**Files (预估):** 7 个文件（2 create + 5 modify）

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| Agent | general-purpose → general-purpose → general-purpose |
| Model | 按 taskComplexity 自动选择 |
| 注入上下文 | spec FR-A1/FR-B2、CLAUDE.md 架构约束 |
| 读取文件 | `router/src/core/monitor/types.ts`, `router/src/proxy/orchestration/orchestrator.ts`, `router/src/db/logs.ts`, `router/src/admin/logs.ts` |
| 修改/创建文件 | 上述 4 个 modify + 2 个 test create |

**Execution Flow (BG1 内部):** 串行派遣。

  Task 1 (ActiveRequest thinkingLevel):
    1. general-purpose → 写测试 + 实现
    2. general-purpose → spec 合规检查

  Task 4 (日志过滤 API):
    1. general-purpose → 写测试 + 实现
    2. general-purpose → spec 合规检查

**Dependencies:** 无

---

#### FG1: 前端改动

**Description:** 前端 thinking level 展示 + 模型过滤拆分 + 耗时列

**Tasks:** Task 2, Task 3, Task 5, Task 6

**Files (预估):** 13 个文件（1 create + 12 modify）

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| Agent | general-purpose → general-purpose |
| Model | 按 taskComplexity 自动选择 |
| 注入上下文 | spec Part A/B/C 全部 FR、前端 UI 规范 |
| 读取文件 | `frontend/src/types/monitor.ts`, `frontend/src/views/Monitor.vue`, `frontend/src/views/Logs.vue`, `frontend/src/components/logs/LogTableRow.vue`, `frontend/src/components/request-detail/types.ts`, `frontend/src/components/request-detail/upstream-merge.ts`, `frontend/src/components/request-detail/RequestOverviewPanel.vue`, `frontend/src/composables/useLogFilters.ts`, `frontend/src/utils/format.ts`, i18n JSON 文件 |
| 修改/创建文件 | 上述所有文件 |

**Execution Flow (FG1 内部):** 串行派遣。

  Task 2 (extractThinkingLevel 工具函数):
    1. general-purpose → 创建工具函数

  Task 3 (Monitor + Logs + Detail 展示):
    1. general-purpose → 实现 UI 展示
    2. general-purpose → spec 合规检查

  Task 5 (模型过滤拆分):
    1. general-purpose → 实现过滤拆分
    2. general-purpose → spec 合规检查

  Task 6 (耗时列):
    1. general-purpose → 实现

**Dependencies:** BG1（需要后端 SSE 广播 thinkingLevel 后前端才能在 Monitor 中展示）

---

## Dependency Graph & Wave Schedule

```
BG1 (后端) ──→ FG1 (前端)

| Wave | Groups | 说明 |
|------|--------|------|
| Wave 1 | BG1 | 后端改动，无依赖 |
| Wave 2 | FG1 | 前端改动，依赖 BG1 完成 |
```
