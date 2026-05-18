---
verdict: pass
---

# 前后端代码审查改进

## Background

2026-05-18 对项目全量代码进行审查：

- **前端**: `frontend/src` 约 80 个业务文件、~16,800 行
- **后端**: `router/src/` 全部 172 个 TS 文件、~20,352 行

经 zoom-out 复审，将前端 41 项发现精简为 4 项可操作改进，后端发现 2 类问题：低风险 bug 修复 + 插件化架构死代码问题。

详细发现记录在：
- 前端: `.xyz-harness/2026-05-18-improvement/frontend-impr.md`
- 后端: `.xyz-harness/2026-05-18-improvement/backend-impr.md`

## 需求分层

本 spec 分两层：

- **Tier 1 — 可立即实施的修复**（6 项）：明确修复方案，低风险，不涉及架构决策
- **Tier 2 — 需要架构决策的问题**（1 组）：后端 Pipeline 死代码，需要先决定策略再实施

---

# Tier 1: 可立即实施的修复

---

## R1. Monitor.vue clipboard 状态全局共享 bug

### 现状

`useClipboard()` composable（`composables/useClipboard.ts`）返回的 `copied` 是**模块级单例 ref**——所有调用者共享同一个布尔值。

```typescript
// composables/useClipboard.ts
export function useClipboard() {
  const copied = ref(false)  // 模块作用域，所有调用者共享
  // ...
  return { copied, copy }
}
```

Monitor.vue 3 个列表（活跃/队列/已完成）的所有复制按钮都绑定到同一个 `copied`：

```vue
<!-- L60, L110, L161 — 三处完全相同 -->
<CheckIcon v-if="copied" class="size-3 text-success" />
```

### 期望

只有被点击的那一行显示 CheckIcon，其余行不受影响。

### 参考实现

`views/Logs.vue` L386-394 使用 `copiedId` 逐行追踪模式：

```typescript
const { copy } = useClipboard()                 // 只用 copy
const copiedId = ref<string | null>(null)

function copyLogId(id: string) {
  copy(id)
  copiedId.value = id
  setTimeout(() => { if (copiedId.value === id) copiedId.value = null }, 2000)
}
// 模板中: v-if="copiedId === log.id"
```

### 修复方案

Monitor.vue 引入 `copiedId: ref<string | null>(null)`，3 处 `v-if="copied"` 改为 `v-if="copiedId === req.id"`，copy 回调中设置 `copiedId`。

### 受影响文件

`frontend/src/views/Monitor.vue` — 1 个文件

---

## R2. 认证逻辑双重实现统一到 router guard

### 现状

两处独立实现认证检查，各自调用 `api.getStats()` 探测：

**Router guard**（`router/index.ts` L65-92）：
- `beforeEach` 检查 `to.meta.requiresAuth`
- 未认证 → `next('/login')`

**App.vue**（L38-57）：
- `checkAuth()` 也调 `api.getStats()`
- `watch(route.path)` 每次导航**同步**置 `isAuthenticated = false`
- 硬编码 `publicPages` 数组与 router `meta.requiresAuth` 独立维护

### 问题链

1. **冗余 API 调用**: 每次导航触发 2 次 `api.getStats()`
2. **Sidebar 闪烁**: watch 先同步置 false，checkAuth 异步完成后置 true，Sidebar 短暂消失
3. **双重维护**: 新增公开页面需同时修改 router meta 和 App.vue `publicPages`

### 修复方案

1. 删除 App.vue 中的 `checkAuth()`、`publicPages`、`watch(route.path)`
2. `isAuthenticated` 改为基于 `route.meta.requiresAuth` 的 computed 或由 router guard 驱动
3. 认证拦截完全由 router guard 负责，App.vue 只决定布局（有 requiresAuth → 带 Sidebar，无 → 全屏）

### 约束

- router guard 中 `setupChecked` / `isSetupInitialized` 缓存逻辑保留
- `markSetupDone()` export 保留
- publicPages 判断合并到 router guard

### 受影响文件

`frontend/src/App.vue`、`frontend/src/router/index.ts` — 2 个文件

---

## R3. PatchChips.vue 原生 `<button>` 替换为 shadcn Button

### 现状

`components/quick-setup/PatchChips.vue` L45-56 使用原生 `<button>`，pre-commit hook `vue_rules_checker.py` 会拦截提交。

### 修复方案

替换为 `<Button variant="outline" size="sm">`，添加 `import { Button } from '@/components/ui/button'`。保持 toggle 行为和 active 样式。

### 受影响文件

`frontend/src/components/quick-setup/PatchChips.vue` — 1 个文件

---

## R4. 6 组重复工具函数/类型提取

同一函数/类型在 2-3 个文件中各自定义，维护时改一处漏另一处。

### R4a. `toIsoStart` / `toIsoEnd`

**重复位置**（两处一字不差）:
- `composables/useDashboard.ts` L22-31（顶层函数）
- `composables/useLogFilters.ts` L52-61（composable 内局部函数）

```typescript
// 两处完全相同
function toIsoStart(dateStr: string): string {
  if (dateStr.includes('T')) return `${dateStr}:00.000Z`
  return `${dateStr}T00:00:00.000Z`
}
function toIsoEnd(dateStr: string): string {
  if (dateStr.includes('T')) return `${dateStr}:59.999Z`
  return `${dateStr}T23:59:59.999Z`
}
```

**提取目标**: `utils/format.ts`

### R4b. `formatBytes` / `formatSize`

**重复位置**:

| 文件 | 函数名 | 签名 | 用途 |
|------|--------|------|------|
| `components/monitor/RuntimePanel.vue` L77 | `formatBytes` | `(bytes: number) => string` | 内存字节数 → B/KB/MB |
| `components/log-viewer/LogRequestViewer.vue` L324 | `formatSize` | `(text: string) => string` | 文本编码长度 → B/KB |

两者签名和用途不同，不强行合并，分别导出。

**提取目标**: `utils/format.ts`

### R4c. `formatContextWindow` / `formatCw`

**重复位置**:

```typescript
// CascadingModelSelect.vue L28 — 2 分支
function formatContextWindow(cw: number): string {
  if (cw >= 1_000_000) return `${cw / 1_000_000}M`
  return `${cw / 1_000}K`          // < 1M 的全部显示为 K（如 500 → 0.5K）
}

// ModelCard.vue L80 — 3 分支
function formatCw(n: number): string {
  if (n >= 1_000_000) return `${n / 1_000_000}M`
  if (n >= 1_000) return `${n / 1_000}K`
  return `${n}`                     // < 1K 显示原始数字
}
```

合并为 ModelCard 的 3 分支版本（更完整）。

**提取目标**: `utils/format.ts`，统一为 `formatContextWindow`

### R4d. `getDefaultPatches`

**重复位置**（3 处）:

| 文件 | 行号 | 签名 | 特殊处理 |
|------|------|------|---------|
| `useFetchUpstreamModels.ts` | L21 | `(name, apiType: string)` | 仅 deepseek patch |
| `useProviderPresets.ts` | L82 | `(name, apiType: string)` | 仅 deepseek patch，与前一处完全相同 |
| `useQuickSetup.ts` | L44 `computeDefaultPatches` | `(name, format, isNonOpenaiEndpoint)` | deepseek + developer-role + anthropic-arguments |

前两处实现完全相同。第三处（useQuickSetup）功能更完整，额外处理 `isNonOpenaiEndpoint` 和 `openai-responses`。

**提取方案**: 将 `computeDefaultPatches` 完整版提取到 `utils/model-patches.ts`，前两处传 `isNonOpenaiEndpoint = false`。

**提取目标**: `utils/model-patches.ts`

### R4e. `ConcurrencyMode` 类型

**重复位置**:

| 文件 | 行号 | 定义 |
|------|------|------|
| `composables/useProviderForm.ts` | L21 | `export type ConcurrencyMode = "auto" \| "manual" \| "none"` |
| `composables/useQuickSetup.ts` | L14 | `export type ConcurrencyMode = 'auto' \| 'manual' \| 'none'` |

签名完全相同，仅引号风格不同。

**提取目标**: `types/concurrency.ts`

### R4f. `RetryRule` / `RouterKey` 接口

**重复位置**:

| 文件 | 行号 | 接口 |
|------|------|------|
| `views/RetryRules.vue` | L203 | `interface RetryRule { id, name, status_code, body_pattern, is_active, created_at, retry_strategy, retry_delay_ms, max_retries, max_delay_ms }` |
| `views/RouterKeys.vue` | L148 | `interface RouterKey { id, name, key, key_prefix, allowed_models, is_active, created_at }` |

对应后端 DB 表结构，提取后其他组件可复用。

**提取目标**: `types/models.ts`

### R4 约束

- `getDefaultPatches` 签名统一后，前两处调用者传 `isNonOpenaiEndpoint = false`
- `formatBytes` / `formatSize` 保留两个函数名（签名和用途不同）
- `formatContextWindow` 取 ModelCard 的 3 分支版本
- 不创建 barrel index 文件

### R4 总影响范围

| 操作 | 文件 |
|------|------|
| 新增 | `utils/format.ts`, `utils/model-patches.ts`, `types/concurrency.ts`, `types/models.ts` |
| 修改 | `useDashboard.ts`, `useLogFilters.ts`, `RuntimePanel.vue`, `LogRequestViewer.vue`, `CascadingModelSelect.vue`, `ModelCard.vue`, `useFetchUpstreamModels.ts`, `useProviderPresets.ts`, `useQuickSetup.ts`, `useProviderForm.ts`, `RetryRules.vue`, `RouterKeys.vue` |

---

## R5. resilience.ts errMsg 三元表达式重复

### 现状

`proxy/orchestration/resilience.ts` L241:

```typescript
const errMsg = err instanceof Error ? err.message : err instanceof Error ? err.message : JSON.stringify(err);
```

第二个 `err instanceof Error` 永远不会执行（第一个条件已覆盖）。如果 err 不是 Error 实例，会错误地调用 `JSON.stringify(err)` 而不是走到第三个分支... 实际上因为两个条件完全相同，逻辑上等效于 `err instanceof Error ? err.message : JSON.stringify(err)`，功能没有 bug，但代码明显是复制粘贴错误。

### 修复方案

```typescript
const errMsg = err instanceof Error ? err.message : JSON.stringify(err);
```

### 受影响文件

`router/src/proxy/orchestration/resilience.ts` — 1 个文件，改 1 行

---

## R6. enhancement-preprocess Hook 因依赖注入遗漏而从未执行

### 现状

`proxy/handler/create-proxy-handler.ts` L275-285:

```typescript
ctx.metadata.set("db", db);                          // 只注入了 db
await proxyPipeline.emit("pre_route", ctx);           // 触发 hooks
// ...
applyEnhancementPreprocess(request, reply, ctx, db, container);  // 内联版本（实际运行的）
```

`enhancement-preprocess` hook 内部第一行：

```typescript
if (!db || !container) return;  // container 未注入 → 静默退出
```

hook 写了 91 行完全正确的代码，但因为 emit 前遗漏了 `ctx.metadata.set("container", container)` 而从未执行。实际运行的是 `create-proxy-handler.ts:136-190` 的 55 行内联版本。

### 修复方案

在 emit 前注入 container：

```typescript
ctx.metadata.set("db", db);
ctx.metadata.set("container", container);   // 新增
await proxyPipeline.emit("pre_route", ctx);
```

注入后 hook 将正常执行，但内联版本 `applyEnhancementPreprocess` 仍会被调用——需要确认两者不会重复执行。方案有二：
1. **最小改动**: 注入 container 让 hook 执行，删除内联调用
2. **安全改动**: 注入 container 后保留内联调用作为 fallback，hook 内用 try-catch 包裹

建议方案 1（最小改动），因为 hook 和内联版本做的是同一件事。

### 受影响文件

`router/src/proxy/handler/create-proxy-handler.ts` — 1-2 个文件

---

# Tier 2: 需要架构决策的问题

---

## D1. Pipeline 架构 828 行死代码

### 现状

项目设计了 Pipeline + Hook + Plugin 三层可扩展架构，但核心请求处理路径中**只有 `pre_route` 阶段被 emit**，其余 5 个阶段（`post_route`、`pre_transport`、`post_response`、`on_error`、`on_stream_event`）从未被 emit。

结果：

| 已注册 Hook | Phase | 被 emit? | 实际执行? | 实际生效的代码在哪 |
|------------|-------|---------|----------|----------------|
| `client-detection` | `pre_route` | 是 | 是 | hook 本身 |
| `enhancement-preprocess` | `pre_route` | 是 | 否（R6 修复后为是） | `create-proxy-handler.ts:136-190` |
| `allowed-models` | `post_route` | 否 | 否 | `failover-loop.ts` 内联 |
| `overflow-redirect` | `post_route` | 否 | 否 | `failover-loop.ts` 内联 |
| `plugin-request` | `pre_transport` | 否 | 否 | `failover-loop.ts` 内联 |
| `provider-patches` | `pre_transport` | 否 | 否 | `failover-loop.ts` 内联 |
| `cache-estimation` | `post_response` | 否 | 否 | `failover-loop.ts` 内联 |
| `request-logging` | `post_response` | 否 | 否 | `proxy-logging.ts` 内联 |
| `error-logging` | `on_error` | 否 | 否 | `failover-loop.ts` + `proxy-logging.ts` 内联 |

**死代码统计**: 8 个 hook 文件 589 行 + `plugin-bridge.ts` 126 行 + `sse-event-transform.ts` 70 行 + `hook-registry.ts` 43 行 = **828 行**

### 根因

Hook 为"单次请求、单个 resolved target"的场景设计，但 `failover-loop.ts` 处理的是"多 target 列表 + 跨迭代累积"场景。例如：

- `overflow-redirect` hook 处理单个 Target → 替换。内联版本处理 Target[] 列表 → 扩展 + 追踪 `overflowIndices`
- `allowed-models` hook 不匹配时直接 abort(403)。内联版本过滤整个列表，保留允许的 target 继续

要让 Pipeline 接管，需要扩展 `PipelineContext` 数据模型（增加 `allTargets`、`overflowIndices` 等字段），这不是简单修复。

### 决策选项

| 选项 | 描述 | 工作量 | 风险 |
|------|------|--------|------|
| A. 激活 Pipeline | 扩展 PipelineContext + 逐阶段 emit | 大（~2-3 周） | 高（核心请求路径重构） |
| B. 删除死代码 | 删除 828 行未执行的 hook/bridge/registry | 中（~1 天） | 低（只删不执行的代码） |
| C. 标记 + 文档 | 在死代码中加 `@internal` 注释和 README 说明 | 小（~2 小时） | 无 |

### 建议

不在本 spec 中实施，但需要在 `backend-impr.md` 中明确记录决策结果。推荐**选项 C**（标记 + 文档）作为当前步骤，**选项 B**（删除）作为下一个迭代。选项 A 需要单独的 spec + plan。

### 关联问题（跟随 D1 决策）

| 编号 | 问题 | 说明 |
|------|------|------|
| V3 | `plugin-bridge.ts` 从未被调用 | 跟随 D1: 选 B 则删除，选 C 则标记 |
| V5 | Patch 层不通过插件系统接入 | 跟随 D1: 独立决策，是否将 patch 改为 TransformPlugin |
| V7 | `SSEEventTransform` 未接入 | 跟随 D1: 选 B 则删除，选 C 则标记 |
| V8 | `HookRegistry` 双注册 | 跟随 D1: 选 B 则删除 hook-registry.ts |
| A1 | `failover-loop.ts` 592 行膨胀 | 跟随 D1: Pipeline 激活后自然缓解 |
| A2 | 双层日志系统 | 可独立优化，不依赖 D1 决策 |

---

# Acceptance Criteria

## Tier 1

### AC1 (R1): Monitor clipboard 独立状态

- **Given** Monitor 页面有多个活跃/队列/已完成请求
- **When** 点击任意一行的复制按钮
- **Then** 仅该行显示 CheckIcon，其余行保持 CopyIcon
- **And** 2 秒后 CheckIcon 自动恢复

### AC2 (R2): 认证单一来源

- **Given** 应用启动
- **When** 访问任意需要认证的页面
- **Then** 只触发 1 次 `api.getStats()` 认证检查
- **And** 页面加载时 Sidebar 不闪烁

### AC3 (R2): 认证重定向正确

- **Given** 未登录状态
- **When** 访问 `/`、`/providers` 等认证页面
- **Then** 重定向到 `/login`
- **When** 访问 `/setup`（系统未初始化）
- **Then** 正常显示 Setup 页面
- **When** Setup 完成后
- **Then** 跳转到 dashboard

### AC4 (R3): PatchChips 使用 shadcn Button

- **Given** QuickSetup 页面
- **When** 显示 PatchChips 组件
- **Then** 所有 toggle 按钮使用 shadcn `<Button>` 组件
- **And** `vue_rules_checker.py` pre-commit hook 不报错

### AC5 (R4a-d): 重复函数提取 — 功能不变

- **Given** `utils/format.ts` 导出 `toIsoStart`、`toIsoEnd`、`formatBytes`、`formatSize`、`formatContextWindow`
- **And** `utils/model-patches.ts` 导出 `computeDefaultPatches`
- **Then** 所有原位置改为 import
- **And** 各函数行为与原实现完全一致（包括 `formatContextWindow` 取 3 分支版本）

### AC6 (R4e-f): 重复类型提取

- **Given** `types/concurrency.ts` 导出 `ConcurrencyMode`
- **And** `types/models.ts` 导出 `RetryRule` 和 `RouterKey`
- **Then** 原位置改为 import

### AC7 (R5): errMsg 三元表达式修复

- **Given** resilience.ts catch 块
- **Then** `errMsg` 为 `err instanceof Error ? err.message : JSON.stringify(err)`
- **And** 无重复条件判断

### AC8 (R6): enhancement-preprocess Hook 正常执行

- **Given** Pipeline emit `pre_route` 前
- **Then** `ctx.metadata` 同时包含 `db` 和 `container`
- **And** `enhancement-preprocess` hook 正常执行（不再静默跳过）
- **And** 内联版本 `applyEnhancementPreprocess` 不再重复调用

### AC9: 全局质量门禁

- **Given** 所有修改完成
- **Then** `npm run build` 成功（router + frontend）
- **And** `npm run lint -w router` 通过（后端 0 error 0 warning）
- **And** `cd frontend && npx eslint . --max-warnings=0` 通过
- **And** `cd frontend && npx vue-tsc -b --noEmit` 通过
- **And** `npm test` 全部通过

## Tier 2

### AC10 (D1): 架构决策已记录

- **Given** D1 的三个选项
- **Then** `backend-impr.md` 中记录了选定选项及理由
- **And** 如果选择 C（标记+文档），死代码文件中有 `@internal` 注释说明未执行原因

---

# Constraints

- **不引入新依赖**: 所有改动使用现有组件和 API
- **不改变用户行为**: 除 clipboard bug 修复外，Tier 1 所有改动对用户不可见
- **不创建 barrel 文件**: utils/types 文件直接 import
- **向后兼容**: `markSetupDone()` export 保留，`ConcurrencyMode` 签名不变
- **Tier 2 不在本 spec 实施范围内**: D1 仅做决策记录，不做代码改动

# Complexity Assessment

| 维度 | 评估 | 说明 |
|------|------|------|
| Domain | 低 | 无业务逻辑变更，bug 修复 + 代码组织 |
| Storage | 无 | 不涉及 DB 或存储变更 |
| Data-flow | 低 | R2 认证流程简化，R6 依赖注入补全 |
| API | 无 | 不新增/修改 API 调用 |
| Non-functional | 低 | R2 减少冗余 API 调用 |
| Risk | 低 | Tier 1 无架构改动，R6 有小风险（需确认 hook 和内联不重复执行） |
