---
verdict: pass
---

# 前后端代码审查改进 — 实施计划

## 复杂度评估

**L1（简单）**：6 项独立修复，无跨需求依赖，无业务逻辑变更，无 DB 变更。

## 任务分组与执行顺序

```
Group A（后端独立，零依赖）→ Group B（前端 R4 共享模块提取）→ Group C（前端独立 bug 修复）→ Group D（D1 决策记录）
```

Group A 和 Group B 之间无依赖，可并行。Group C 依赖 Group B（因为 R1 Monitor 可能用到 `useClipboard` 改动后的 import）。

---

## Group A: 后端修复（R5 + R6）

独立于前端，零交叉依赖。

| # | 文件 | 操作 | 说明 |
|---|------|------|------|
| A1 | `router/src/proxy/orchestration/resilience.ts` | modify | R5: L241 三元表达式去重 |
| A2 | `router/src/proxy/handler/create-proxy-handler.ts` | modify | R6: 注入 container 到 metadata + 删除 `applyEnhancementPreprocess` 函数及调用 |

### A1 详细步骤

`resilience.ts` L241:
```typescript
// Before
const errMsg = err instanceof Error ? err.message : err instanceof Error ? err.message : JSON.stringify(err);
// After
const errMsg = err instanceof Error ? err.message : JSON.stringify(err);
```

### A2 详细步骤

`create-proxy-handler.ts`:

1. **L277**（注入 container）: 在 `ctx.metadata.set("db", db)` 之后加 `ctx.metadata.set("container", container)`
2. **删除 L136-190**：整个 `applyEnhancementPreprocess` 函数定义（55 行）
3. **删除 L287-297**：调用 `applyEnhancementPreprocess` 的 try-catch 块
4. **清理 import**：删除不再需要的 import（`loadEnhancementConfig`、`ToolLoopGuard`、`SessionTracker`、`PipelineAbort`、`applyToolRoundLimit`、`extractLastToolUse`、`HTTP_UNPROCESSABLE_ENTITY`、`HTTP_CLIENT_CLOSED`、`TIER2_LOOP_THRESHOLD`）

**注意**: 删除内联版本后，`enhancement-preprocess` hook 通过 Pipeline emit 执行。hook 内的 `throw PipelineAbort` 会被 `proxyPipeline.emit("pre_route", ctx).catch(...)` 捕获，但当前 `.catch` 只记日志不发送 reply。需要修改 `.catch` 处理逻辑，识别 `PipelineAbort` 并发送响应（类似当前内联版本的 try-catch 行为）。

具体修改：
```typescript
// L279 当前代码
await proxyPipeline.emit("pre_route", ctx).catch(err => {
  request.log.error({ err }, "pre_route hook failed");
});

// 改为
try {
  await proxyPipeline.emit("pre_route", ctx);
} catch (e) {
  if (e instanceof PipelineAbort) {
    if (e.statusCode === HTTP_CLIENT_CLOSED && (e.body as Record<string, unknown>)?._disconnect) {
      reply.raw.destroy();
      return reply;
    }
    return reply.code(e.statusCode).send(e.body);
  }
  request.log.error({ err: e }, "pre_route hook failed");
}
```

这与当前内联版本的 try-catch 行为一致。

### A 验证

```bash
npm run build
npm run lint -w router
npm test
```

---

## Group B: 前端 R4 共享模块提取

先创建共享文件，再修改消费文件。4 个新文件互不依赖，可同时创建。

| # | 文件 | 操作 | 说明 |
|---|------|------|------|
| B1 | `frontend/src/utils/format.ts` | create | R4a/R4b/R4c: toIsoStart, toIsoEnd, formatBytes, formatSize, formatContextWindow |
| B2 | `frontend/src/utils/model-patches.ts` | create | R4d: computeDefaultPatches |
| B3 | `frontend/src/types/concurrency.ts` | create | R4e: ConcurrencyMode type |
| B4 | `frontend/src/types/models.ts` | create | R4f: RetryRule, RouterKey interfaces |
| B5 | `frontend/src/composables/useDashboard.ts` | modify | R4a: 删除 toIsoStart/toIsoEnd，改为 import |
| B6 | `frontend/src/composables/useLogFilters.ts` | modify | R4a: 删除 toIsoStart/toIsoEnd，改为 import |
| B7 | `frontend/src/components/monitor/RuntimePanel.vue` | modify | R4b: 删除 formatBytes，改为 import |
| B8 | `frontend/src/components/log-viewer/LogRequestViewer.vue` | modify | R4b: 删除 formatSize，改为 import |
| B9 | `frontend/src/components/mappings/CascadingModelSelect.vue` | modify | R4c: 删除 formatContextWindow，改为 import |
| B10 | `frontend/src/components/quick-setup/ModelCard.vue` | modify | R4c: 删除 formatCw，改为 import |
| B11 | `frontend/src/composables/useFetchUpstreamModels.ts` | modify | R4d: 删除 getDefaultPatches + DEFAULT_PATCHES_BY_KEYWORD，改为 import computeDefaultPatches |
| B12 | `frontend/src/composables/useProviderPresets.ts` | modify | R4d: 同上 |
| B13 | `frontend/src/composables/useQuickSetup.ts` | modify | R4d: 删除 computeDefaultPatches + ConcurrencyMode，改为 import |
| B14 | `frontend/src/composables/useProviderForm.ts` | modify | R4e: 删除 ConcurrencyMode，改为 import |
| B15 | `frontend/src/views/RetryRules.vue` | modify | R4f: 删除 RetryRule interface，改为 import |
| B16 | `frontend/src/views/RouterKeys.vue` | modify | R4f: 删除 RouterKey interface，改为 import |

### B1 详细: `utils/format.ts`

```typescript
/** 日期字符串 → ISO 开始时间（00:00:00.000Z） */
export function toIsoStart(dateStr: string): string {
  if (dateStr.includes('T')) return `${dateStr}:00.000Z`
  return `${dateStr}T00:00:00.000Z`
}

/** 日期字符串 → ISO 结束时间（23:59:59.999Z） */
export function toIsoEnd(dateStr: string): string {
  if (dateStr.includes('T')) return `${dateStr}:59.999Z`
  return `${dateStr}T23:59:59.999Z`
}

/** 字节数 → 可读字符串（B / KB / MB） */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

/** 文本内容 → 编码字节大小可读字符串（B / KB） */
export function formatSize(text: string): string {
  const bytes = new TextEncoder().encode(text).length
  if (bytes < 1024) return `${bytes}B`
  return `${(bytes / 1024).toFixed(1)}KB`
}

const CONTEXT_MILLION = 1_000_000
const CONTEXT_THOUSAND = 1_000

/** 上下文窗口数字 → 可读字符串（n / nK / nM） */
export function formatContextWindow(n: number): string {
  if (n >= CONTEXT_MILLION) return `${n / CONTEXT_MILLION}M`
  if (n >= CONTEXT_THOUSAND) return `${n / CONTEXT_THOUSAND}K`
  return `${n}`
}
```

### B2 详细: `utils/model-patches.ts`

提取 `useQuickSetup.ts` 的 `computeDefaultPatches`（功能最完整的版本）。`useFetchUpstreamModels` 和 `useProviderPresets` 调用时传 `isNonOpenaiEndpoint = false`。

```typescript
/** 根据模型名称和 API 格式计算默认 patches */
export function computeDefaultPatches(
  modelName: string,
  format: string,
  isNonOpenaiEndpoint: boolean,
): string[] {
  const patches: string[] = []
  const isDeepseek = modelName.toLowerCase().includes('deepseek')
  if (isDeepseek) {
    patches.push('thinking-consistency')
    if (format === 'anthropic') {
      patches.push('orphan-tool-results')
    } else {
      patches.push('orphan-tool-results-oa')
    }
  }
  if (format === 'openai' && isNonOpenaiEndpoint) {
    patches.push('developer-role')
  }
  if (format === 'openai-responses') {
    patches.push('anthropic-arguments')
  }
  return patches
}
```

### B3 详细: `types/concurrency.ts`

```typescript
export type ConcurrencyMode = 'auto' | 'manual' | 'none'
```

### B4 详细: `types/models.ts`

```typescript
export interface RetryRule {
  id: string
  name: string
  status_code: number
  body_pattern: string
  is_active: number
  created_at: string
  retry_strategy: 'fixed' | 'exponential'
  retry_delay_ms: number
  max_retries: number
  max_delay_ms: number
}

export interface RouterKey {
  id: string
  name: string
  key: string | null
  key_prefix: string
  allowed_models: string[] | null
  is_active: number
  created_at: string
}
```

### B11/B12 适配细节

`useFetchUpstreamModels.ts` 和 `useProviderPresets.ts` 原来用：
```typescript
patches: getDefaultPatches(name, form.value.api_type)
```
改为：
```typescript
patches: computeDefaultPatches(name, form.value.api_type, false)
```
同时删除 `DEFAULT_PATCHES_BY_KEYWORD` 常量。

### B13 适配细节

`useQuickSetup.ts` 原来用：
```typescript
patches: getDefaultPatches(name, preset.apiType)  // 调 computeDefaultPatches(name, format, isNonOpenaiEndpoint.value)
```
改为：
```typescript
patches: computeDefaultPatches(name, preset.apiType, isNonOpenaiEndpoint.value)
```
同时删除 `ConcurrencyMode` type 定义和 `computeDefaultPatches` / `getDefaultPatches` 函数定义。

### B 验证

```bash
cd frontend && npx vue-tsc -b --noEmit
cd frontend && npx eslint . --max-warnings=0
cd frontend && npm run build
```

---

## Group C: 前端 bug 修复（R1 + R2 + R3）

3 个独立 bug 修复，互不依赖，可并行。

| # | 文件 | 操作 | 说明 |
|---|------|------|------|
| C1 | `frontend/src/views/Monitor.vue` | modify | R1: clipboard 状态独立化 |
| C2a | `frontend/src/App.vue` | modify | R2: 删除 checkAuth/watch/publicPages |
| C2b | `frontend/src/router/index.ts` | modify | R2: export isAuthenticated ref，guard 中驱动 |
| C3 | `frontend/src/components/quick-setup/PatchChips.vue` | modify | R3: button → Button |

### C1 详细步骤: Monitor.vue clipboard

1. 修改 import：从 `useClipboard` 只取 `copy`，不再取 `copied`
2. 新增 `copiedId: ref<string | null>(null)`
3. 新增 `copyId(id: string)` 函数：`copy(id) → copiedId.value = id → setTimeout(() => { if (copiedId.value === id) copiedId.value = null }, 2000)`
4. 模板中 3 处 `v-if="copied"` 改为 `v-if="copiedId === req.id"`
5. 模板中 3 处 `@click.stop="copy(req.id)"` 改为 `@click.stop="copyId(req.id)"`

### C2 详细步骤: 认证统一

**router/index.ts**:
1. 新增 `export const isAuthenticated = ref(true)`
2. beforeEach guard 中：
   - setup 未初始化 + 非 setup 页面 → `next('/setup')`，置 `isAuthenticated.value = false`
   - setup 已初始化 + 认证页面 → `api.getStats()` 成功 → `isAuthenticated.value = true` + `next()`，失败 → `isAuthenticated.value = false` + `next('/login')`
   - setup/login 页面 → `isAuthenticated.value = false` + `next()`

**App.vue**:
1. 删除 `isAuthenticated` ref 定义
2. 删除 `publicPages` 数组
3. 删除 `checkAuth()` 函数
4. 删除 `checkAuth()` 调用
5. 删除 `watch(() => route.path, ...)`
6. 改为 `import { isAuthenticated } from '@/router'`
7. 模板中 `v-if="isAuthenticated"` 使用 import 的 ref

### C3 详细步骤: PatchChips button

1. 添加 `import { Button } from '@/components/ui/button'`
2. `<button>` → `<Button variant="outline" size="sm">`
3. 保持 `:class` 的 active/inactive 样式切换
4. 添加 `:aria-pressed="isActive(item.id)"`
5. 删除 `type="button"`（Button 组件默认 type="button"）

### C 验证

```bash
cd frontend && npx vue-tsc -b --noEmit
cd frontend && npx eslint . --max-warnings=0
cd frontend && npm run build
```

---

## Group D: D1 决策记录

| # | 文件 | 操作 | 说明 |
|---|------|------|------|
| D1 | `.xyz-harness/2026-05-18-improvement/backend-impr.md` | modify | 追加决策选项和选定结果 |

选定**选项 C（标记 + 文档）**，理由：
- 当前分支是 refactor-perf-bug-fix，不适合做大范围架构改动
- 选项 B（删除）有价值但需要单独的 spec/plan
- 选项 C 零风险，减少未来开发者的困惑

### D1 实施

在 `backend-impr.md` 末尾追加：

```markdown
## 决策记录

### D1. Pipeline 死代码 — 选项 C: 标记 + 文档

**决策日期**: 2026-05-18
**选定选项**: C（标记 + 文档）
**理由**: 当前分支 scope 为 bug 修复和小重构，大范围删除或架构改动需要单独的 spec/plan。
**下一步**: 在下一个迭代中评估选项 B（删除 828 行死代码）。
```

不需要改代码文件。

---

## 全局验证（所有 Group 完成后）

```bash
# 后端
npm run build
npm run lint -w router
npm test

# 前端
cd frontend && npx vue-tsc -b --noEmit
cd frontend && npx eslint . --max-warnings=0
cd frontend && npm run build
```

## Subagent 分配建议

| Batch | Group | Subagent 数量 | 说明 |
|-------|-------|--------------|------|
| 1 | A (后端) + B (前端提取) | 2 | 独立，可并行 |
| 2 | C (前端 bug) | 1 | 3 个小修复，1 个 agent 足够 |
| 3 | D (决策记录) | 0 | 主 agent 直接做 |

总计 3 个 subagent，分 2 批执行。
