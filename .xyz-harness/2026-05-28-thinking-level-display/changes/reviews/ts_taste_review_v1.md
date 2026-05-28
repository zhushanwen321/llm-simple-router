---
verdict: fail
must_fix: 2
---

# Taste Review — thinking-level-display

## Scope

| # | File | Role |
|---|------|------|
| 1 | `router/src/proxy/orchestration/orchestrator.ts` | 后端 thinking level 提取 (`extractThinkingLevelFromRequest`) |
| 2 | `frontend/src/utils/thinking-level.ts` | 前端 thinking level 提取 (`extractThinkingLevel`) |
| 3 | `frontend/src/utils/format.ts` | 耗时格式化 (`formatLatency`) |
| 4 | `frontend/src/composables/useLogFilters.ts` | 模型过滤拆分重构 |
| 5 | `frontend/src/components/logs/LogTableRow.vue` | 日志行（展示 thinking level Badge + 耗时列） |
| 6 | `frontend/src/views/Logs.vue` | 日志页（使用 useLogFilters） |
| 7 | `frontend/src/views/Monitor.vue` | 监控页（展示 thinking level Badge） |
| 8 | `frontend/src/components/request-detail/RequestOverviewPanel.vue` | 请求详情面板 |
| 9 | `frontend/src/components/request-detail/upstream-merge.ts` | upstream 数据合并 |

---

## MUST FIX Issues

### MUST-FIX-1: `apiTypeFilter` 无 UI 绑定，属于死功能

**文件**: `frontend/src/composables/useLogFilters.ts`, `frontend/src/views/Logs.vue`

`useLogFilters` 返回 `apiTypeFilter`，`Logs.vue` 也将其从 composable 中解构（第 54 行），但模板中没有任何 Select 或 UI 控件绑定到 `apiTypeFilter`。所有筛选下拉框中缺少 api_type 选择器。

`buildFilterParams()` 中使用了 `apiTypeFilter.value`，但由于用户无法修改其值（永远是默认值 `"all"`），该分支逻辑永远不会生效。

**影响**: 死代码留在 composable 的公开接口中，调用方必须解构一个无用的值。以后有人看到它会困惑是功能缺失还是忘记删除。

**修补方案**: 两种方案二选一：
1. 从 `useLogFilters` 的 return 中移除 `apiTypeFilter`，同时在 `buildFilterParams()` 中删除相关 if 分支（如果确实不需要 api_type 筛选）；
2. 或者在 `Logs.vue` 模板中补上 api_type 下拉筛选框。

### MUST-FIX-2: 后端和前端 thinking level 提取逻辑不一致

**文件对比**: `router/src/proxy/orchestration/orchestrator.ts` vs `frontend/src/utils/thinking-level.ts`

后端 `extractThinkingLevelFromRequest`:
```typescript
if (body.reasoning?.effort) return body.reasoning.effort;   // truthy 检查
if (body.reasoning_effort) return body.reasoning_effort;
```

前端 `extractThinkingLevel`:
```typescript
return body.reasoning?.effort ?? body.reasoning_effort ?? "off";  // nullish 合并
```

**逻辑差异**:
- 当 `reasoning.effort = ""`（空字符串）时：后端返回 `"off"`（跳过空字符串），前端返回 `""`（`??` 视 `""` 为非 nullish）。
- 当 `reasoning_effort = ""` 时同理。

虽然实际业务中 `effort` 字段总是 `"low"`/`"medium"`/`"high"` 等非空字符串，但两条独立实现且逻辑不同，未来维护时会成为陷阱——改了一端忘记改另一端。

**修补方案**: 统一采用同一种模式。推荐使用前端的 `??` 模式（更符合 TS 语义），后端改为：
```typescript
return body.reasoning?.effort ?? body.reasoning_effort ?? "off";
```

---

## Medium Issues

### MEDIUM-1: Badge 条件渲染模式不统一

存在两种模式：

**模式 A（LogTableRow.vue — 无预检）**:
```vue
<Badge v-if="thinkingLevel !== 'off'">
```
依赖 `extractThinkingLevel` 始终返回字符串。

**模式 B（Monitor.vue, RequestOverviewPanel.vue — 带预检）**:
```vue
<Badge v-if="req.thinkingLevel && req.thinkingLevel !== 'off'">
```
多一层 `&&` 防御 `undefined`。

**分析**:
- `UnifiedRequestOverview.thinkingLevel` 类型声明为 `string`（非 optional），且在 `fromActiveRequest()` 和 `fromLogEntry()` 中总是默认到 `"off"`，所以 `RequestOverviewPanel.vue` 的 `&&` 预检是冗余的。
- `ActiveRequest.thinkingLevel` 在类型中标记为 `thinkingLevel?: string`（optional），导致 `Monitor.vue` 的 `&&` 确实需要。但运行时 `buildActiveRequest()` 始终设置该字段（`extractThinkingLevelFromRequest` 返回 `"off"` 兜底），类型声明与实际行为不一致。

**建议**: 将 `ActiveRequest.thinkingLevel` 类型改为 `string`（非 optional），统一使用模式 A。类型声明与实际行为对齐后，所有消费者可以安全使用 `!== 'off'`。

### MEDIUM-2: `formatLatency` 缺少 NaN/Infinity 防护

**文件**: `frontend/src/utils/format.ts`

```typescript
export function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "-";
  if (ms < MS_PER_SECOND_FORMAT) return `${Math.round(ms)}ms`;
  return `${(ms / MS_PER_SECOND_FORMAT).toFixed(1)}s`;
}
```

缺少 `isFinite(ms)` 检查——如果 `ms` 是 `NaN`（JSON 反序列化可能产生），会输出 `"NaN"` 而非 `"-"`。虽然 `LogEntry.latency_ms` 来自 DB 不太可能为 NaN，但防御性处理缺失仍是品味问题。

**建议**: 将第一个条件改为 `if (ms == null || !isFinite(ms)) return "-";`

---

## Minor Issues

### MINOR-1: 后端 `extractThinkingLevelFromRequest` 类型签名可收窄

后端函数 `apiType` 参数类型为 `"openai" | "openai-responses" | "anthropic"`，前端为 `string`。后端精确类型更优，前端也应当收窄。不过前端 `fromLogEntry` 处有 fallback `"openai"`，改动成本较大。

### MINOR-2: `useLogFilters` 中 `onMounted` 隐式副作用

`useLogFilters` 在 composable 内部调用 `onMounted` 发起三个 API 请求，这意味着该 composable 有隐式的 mount 副作用。调用方无法控制加载时机。现有代码已接受此模式，非本次引入，仅记录。

### MINOR-3: `upstream-merge.ts` 的 `JSON_INDENT` 与 `RequestOverviewPanel.vue` 重复

两处各自定义了 `JSON_INDENT = 2`（upstream-merge.ts 第 17 行，RequestOverviewPanel.vue 第 52 行）。应当从 `upstream-merge.ts` 中导出常量和 `mergeUpstreamData`/`extractResponseMetadata` 共用。

---

## Summary

| Severity | Count | Details |
|----------|-------|---------|
| MUST FIX | 2 | apiTypeFilter 无 UI 绑定（死代码）；前后端 thinking level 提取逻辑不一致 |
| MEDIUM | 2 | Badge 条件渲染模式不统一；formatLatency 缺 NaN 防护 |
| MINOR | 3 | 类型签名可收窄、隐式副作用、常量重复 |

**Verdict**: fail — 两个 MUST FIX 需在合并前修复。
