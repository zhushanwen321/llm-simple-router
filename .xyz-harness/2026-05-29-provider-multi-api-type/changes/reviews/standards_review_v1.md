---
verdict: pass
must_fix: 0
review_metrics:
  files_reviewed: 16
  issues_found: 3
  must_fix_count: 0
  low_count: 2
  info_count: 1
---

# Standards Review v1 — Provider Multi-API-Type

**Reviewer**: AI Standards Reviewer
**Date**: 2026-05-29
**Scope**: 16 changed files (8 backend, 6 frontend, 2 shared)

## Phase A: Lint & Type Check

| Check | Command | Result |
|-------|---------|--------|
| Backend lint | `cd router && npm run lint` | PASS — zero warnings |
| Frontend lint | `cd frontend && npx eslint . --max-warnings=0` | PASS — zero output |
| Frontend types | `cd frontend && npx vue-tsc -b --noEmit` | PASS — zero errors |

## Phase B: CLAUDE.md 规范合规检查

### B1. 禁止 `any`，用 `unknown` ✅

所有 16 个文件中未发现 `: any` 或 `as any`。后端 `Record<string, unknown>` 用于 API 字段访问，前端通过类型断言收窄。

### B2. 禁止 eslint-disable 注释 ✅

本次 diff 中 **无新增** eslint-disable 注释。已有文件中的 `eslint-disable` 均为预先存在的代码（`cascadeProviderDisable` 中的 `taste/no-deprecated-rule-format`、`failover-loop.ts` 中的 `max-lines-per-function` 和 `taste/no-silent-catch`），不在本次变更范围内。

### B3. Promise 并行用 `Promise.allSettled` ✅

- `Providers.vue` `onMounted`: 使用 `Promise.allSettled([loadPresets(), loadProviders()])` ✅
- `useQuickSetup.ts` `fetchQuickSetupInitialData`: 使用 `Promise.allSettled` 并逐个检查 `status` ✅
- 未发现不当使用 `Promise.all` 的场景

### B4. 错误处理: catch 块 console.error + toast ✅

前端所有 API 调用的 catch 块：

| 位置 | console.error | toast | 合规 |
|------|:---:|:---:|:---:|
| `Providers.vue` `handleSave` | ✅ | ✅ | ✅ |
| `useQuickSetup.ts` `fetchQuickSetupInitialData` | ✅ | ✅ | ✅ |
| `useQuickSetup.ts` `submit` | ✅ | ✅ | ✅ |

静默 catch（非 API 调用）均有合理理由：
- `parseTransformRules` 中 JSON.parse 失败 → 调用 `onError` 回调 ✅
- `toggleChangedMappings` 中 API 失败 → 推入 errors 列表并在 submit 后报告 ✅
- `buildMappingEntries` 中 JSON.parse 失败 → fallback `rule = {}` ✅
- `buildFullUrl` 中 URL 解析失败 → fallback 简单拼接 ✅

### B5. 前端禁止原生 HTML 表单元素 ✅

所有 UI 组件使用 shadcn-vue：
- `EndpointEditor.vue`: `<Button>`, `<Input>`, `<Label>`, `<Badge>` ✅
- `Providers.vue`: `<Button>`, `<Table>`, `<Dialog>`, `<AlertDialog>`, `<Select>`, `<Badge>` ✅
- `QuickSetup.vue`: `<Button>`, `<Input>`, `<Label>`, `<Select>`, `<Card>`, `<Badge>`, `<Checkbox>` ✅
- `LogTableRow.vue`: `<Button>`, `<TableCell>`, `<TableRow>`, `<Badge>`, `<Tooltip>` ✅
- `RequestOverviewPanel.vue`: `<Button>`, `<Badge>`, `<ScrollArea>`, `<Separator>` ✅

未发现原生 `<button>`, `<input>`, `<select>`, `<table>`, `<label>` 元素。

### B6. 前端禁止 Emoji ✅

所有 5 个前端变更文件中未发现 Emoji 字符。图标使用 `lucide-vue-next`（`PlusIcon`, `Trash2Icon`, `CopyIcon`, `CheckIcon`, `FileJson`, `FileText`, `Shield`, `ImageIcon`, `RotateCw`）。

### B7. `<style scoped>` 只允许 `@apply` ✅

所有 5 个前端变更文件均无 `<style scoped>` 块（纯逻辑/模板组件或样式通过 Tailwind 类名实现）。

### B8. structuredClone 替代 JSON.parse(JSON.stringify()) ✅

所有 16 个文件中未发现 `JSON.parse(JSON.stringify())` 模式。

### B9. 禁止裸 JSON.parse(provider.models) ✅

- `providers.ts` 新增 `parseEndpoints()` 函数处理 `endpoints` JSON 解析，返回类型安全的 `ProviderEndpoint[]` ✅
- `parseEndpoints` 内部使用 `JSON.parse` 但有完整的类型验证（数组检查、元素对象检查）✅
- `parseModels()` 仍用于 models 字段解析 ✅
- `admin/providers.ts` 中 `JSON.parse(g.rule)` 是解析映射规则（非 models/endpoints），属于合理使用 ✅

### B10. while(true) 必须有迭代计数器 ✅

`failover-loop.ts` 第 272 行：
```typescript
while (true) {
  if (++failoverIteration > MAX_FAILOVER_ITERATIONS) { // MAX_FAILOVER_ITERATIONS = 10
    return reply.code(HTTP_SERVICE_UNAVAILABLE).send(...);
  }
}
```
- 有迭代计数器 `failoverIteration` ✅
- 有上限常量 `MAX_FAILOVER_ITERATIONS = 10` ✅
- 超限时返回 503 响应 ✅
- 还有 `reply.raw.destroyed` 提前退出检查 ✅

### B11. headers 写入日志前脱敏 ✅

`failover-loop.ts`:
- 客户端 headers: `sanitizeHeadersForLog(cliHdrs)` 在循环前预计算 ✅
- 上游 headers: `sanitizeHeadersForLog(buildUpstreamHeaders(...))` ✅
- 预计算注释明确说明目的（BP-H4）✅

## 发现的问题

### LOW-1: `useQuickSetup.ts` `toggleChangedMappings` 静默 catch 缺少 console.error

**文件**: `frontend/src/composables/useQuickSetup.ts` 第 79-93 行
**问题**: `api.toggleMappingGroup()` 失败时只推入 errors 列表，无 `console.error`。
**严重度**: LOW — 非 API 调用主流程，且错误会在 submit 后通过 toast 通知用户。但按 CLAUDE.md 前端错误处理规范，catch 块应包含 `console.error`。
**建议**: 添加 `console.error('quickSetup.toggleMapping:', e)` 以便开发调试。

### LOW-2: `useQuickSetup.ts` `buildMappingEntries` 静默 catch 缺少注释

**文件**: `frontend/src/composables/useQuickSetup.ts` 第 218 行
**问题**: `JSON.parse(existingGroup.rule)` 的 catch 块为空（`catch { rule = {} }`），缺少解释性注释。
**严重度**: LOW — 纯 JSON.parse 验证场景（CLAUDE.md 规定可省略 console），但缺少注释解释 fallback 原因。
**建议**: 添加注释如 `/* rule 格式损坏，使用空规则 fallback */`。

### INFO-1: 后端 `parseEndpoints()` 内部使用裸 JSON.parse

**文件**: `router/src/db/providers.ts` `parseEndpoints()` 函数
**说明**: 函数内部使用 `JSON.parse(endpointsJson) as unknown[]` 解析 endpoints JSON。这是 `parseEndpoints()` 本身就是类型安全封装函数，职责就是替代裸 `JSON.parse`，与 `parseModels()` 的设计模式一致。不属于规范违规。

## 未涉及项（无需检查）

| 规范项 | 理由 |
|--------|------|
| `taste/no-unsafe-object-entries` | 本次无 `Object.entries()` 后拼 SQL 的代码 |
| `taste/no-magic-spacing` | 前端无新增任意值间距 |
| `taste/no-hardcoded-colors` | 前端无新增硬编码颜色 |
| 禁止 eval | 自动 lint 覆盖 |

## 结论

**VERDICT: PASS** — 0 个 MUST FIX 问题。

本次变更严格遵守项目编码规范。所有 16 个变更文件通过 lint + 类型检查，无 `any` 类型、无新增 eslint-disable、无原生 HTML 元素、无 Emoji、无 JSON.parse(JSON.stringify())。`while(true)` 有正确的迭代计数器，headers 脱敏完整，前端错误处理遵循双层模式。仅发现 2 个 LOW 级改进建议（静默 catch 缺少 console.error / 注释），不影响代码正确性。
