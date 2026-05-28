---
title: "Standards Review - Thinking Level Display"
phase: "编码评审"
reviewer: "auto (standards_checker)"
date: "2026-05-28"
verdict: "pass"
must_fix: 0
---

# Standards Review: Thinking Level Display + Model Filter Split + Latency Column

## 验证摘要

| 检查项 | 结果 |
|--------|------|
| 后端 lint (`npm run lint -w router`) | ✅ 通过（0 error, 0 warning） |
| 前端 ESLint (`npx eslint . --max-warnings=0`) | ✅ 通过（0 error, 0 warning） |
| 前端 vue-tsc (`npx vue-tsc -b --noEmit`) | ✅ 通过（0 error） |

## 变更文件清单（基于 `git diff main`）

| 文件 | 变更类型 | 变更内容 |
|------|----------|----------|
| `router/src/proxy/orchestration/orchestrator.ts` | 修改 (+30) | 新增 `extractThinkingLevelFromRequest()` + `thinkingLevel` 字段 |
| `router/src/db/logs.ts` | 修改 (+14) | 新增 `client_model`、`backend_model` 筛选参数 |
| `router/src/admin/logs.ts` | 修改 (+4) | Schema 新增 `client_model`、`backend_model` 查询参数 |
| `router/src/core/monitor/types.ts` | 修改 (+1) | `ActiveRequest` 新增 `thinkingLevel` 字段 |
| `frontend/src/utils/thinking-level.ts` | **新建** (24) | `extractThinkingLevel()` 工具函数 |
| `frontend/src/composables/useLogFilters.ts` | 修改 (+42/-22) | 拆分 `modelFilter` 为 `clientModelFilter`/`backendModelFilter` |
| `frontend/src/components/logs/LogTableRow.vue` | 修改 (+3) | 新增 thinking level badge + latency 列 |
| `frontend/src/views/Logs.vue` | 修改 (+44/-20) | 拆分模型筛选为 client/backend 两个 Select，新增 latency 列头 |
| `frontend/src/views/Monitor.vue` | 修改 (+14) | 活跃/已完成请求新增 thinking level badge |
| `frontend/src/components/request-detail/RequestOverviewPanel.vue` | 修改 (+7) | 结构化视图新增 thinking level badge |
| `frontend/src/types/monitor.ts` | 修改 (+1) | thinkingLevel 字段类型 |

**未变更（附带审查）**：`upstream-merge.ts`, `router/src/db/logs.ts`（silent catch 部分）, `router/src/proxy/orchestration/orchestrator.ts`（eslint-disable-line 部分）这些文件的被审查部分均为 pre-existing，非本次 PR 新增。

---

## 逐项检查

### 1. 原生 HTML 元素（禁止）

检查范围：所有前端 `.vue` 文件的 template 部分。

| 文件 | 使用的组件 | 结论 |
|------|-----------|------|
| `LogTableRow.vue` | Badge, Button, TableCell, TableRow, Tooltip, TooltipTrigger, TooltipContent | ✅ 全部使用 shadcn-vue |
| `Logs.vue` | Button, Input, Label, Select/Trigger/Value/Content/Item, Table/Header/Body/Row/Head/Cell, Dialog/Content/Header/Title/Footer, AlertDialog, Skeleton, Separator, TooltipProvider | ✅ 全部使用 shadcn-vue |
| `Monitor.vue` | Badge, Button, Card/Content/Header/Title, ScrollArea, Tooltip/Content/Provider/Trigger, AlertDialog/Action/Cancel/Content/Description/Footer/Header/Title | ✅ 全部使用 shadcn-vue |
| `RequestOverviewPanel.vue` | Badge, Button, ScrollArea, Separator | ✅ 全部使用 shadcn-vue |

**结论：无违规** ✅

---

### 2. eslint-disable 注释（禁止）

CLAUDE.md 明确禁止 eslint-disable 注释，但 `taste/no-eslint-disable` 规则当前为 "注册但未启用"，历史代码中的注释逐步清理。

| 文件 | 注释内容 | 是否本次新增 | 结论 |
|------|---------|-------------|------|
| `LogTableRow.vue` | `<!-- eslint-disable vue/multi-word-component-names -->` | ❌ 非本次新增（pre-existing） | 观察项，待清理 |
| `Logs.vue` | `<!-- eslint-disable vue/multi-word-component-names -->` | ❌ 非本次新增（pre-existing） | 观察项，待清理 |
| `Monitor.vue` | `<!-- eslint-disable vue/multi-word-component-names -->` | ❌ 非本次新增（pre-existing） | 观察项，待清理 |
| `orchestrator.ts` | `// eslint-disable-line taste/no-silent-catch` | ❌ 非本次新增（pre-existing） | 观察项，待清理 |

**本次变更未新增任何 eslint-disable 注释。**

**结论：无违规** ✅（pre-existing 注释不在本评审范围）

---

### 3. catch 块检查

对照 CLAUDE.md 规范：
- `taste/no-silent-catch`：catch 不能为空或仅 console ✅（lint 通过）
- **silent catch 必须注释**：空的 `catch {}` 必须加 `/* 原因 */` 注释

#### 本次新增/修改的 catch 块：

| 文件 | 行 | 内容 | 是否有注释 | 结论 |
|------|----|------|-----------|------|
| `orchestrator.ts` (新函数) | `catch { return "off"; }` | JSON parse 失败时默认返回 "off" | ❌ 无注释 | ⚠️ 建议加注释声明意图 |
| `thinking-level.ts` (新文件) | `catch { return "off"; }` | JSON parse 失败时默认返回 "off" | ❌ 无注释 | ⚠️ 建议加注释声明意图 |
| `useLogFilters.ts` (已存在) | `catch { clientModelOptions.value = []; ... }` | 加载失败时清空选项 | ❌ 无注释 | ⚠️ 建议加注释（pre-existing） |

分析：
- 以上 catch 块均有实质性的 return/赋值逻辑，**非空的 catch**，不触发 `taste/no-silent-catch` ESLint 规则
- 但新的代码（新建文件 + 新增函数）中加入无注释的 silent catch 是代码品味问题，建议添加 `/* JSON parse failed - default to "off" */` 类注释以明确意图

**结论：无硬性违规**（ESLint 全部通过）建议优化

---

### 4. `any` 类型（禁止）

检查所有变更文件中是否存在 `any` 类型。

**结论：未发现 `any` 类型** ✅（ESLint `no-explicit-any: error` 通过）

---

### 5. `Promise.all` vs `Promise.allSettled`

CLAUDE.md 规范："多个独立数据源的并行请求使用 `Promise.allSettled`，不使用 `Promise.all`"

| 文件 | 使用情况 | 结论 |
|------|---------|------|
| `useLogFilters.ts` `loadModelOptions()` | `Promise.allSettled([api.getMetricsSummary(), api.getAvailableModels()])` | ✅ 正确 |
| `useLogFilters.ts` `onMounted()` | `Promise.allSettled([loadProviders(), loadRouterKeys(), loadModelOptions()])` | ✅ 正确 |

**结论：无违规** ✅

---

### 6. 前端控件交互模式一致性

CLAUDE.md 要求："Dashboard.vue / Monitor.vue：实时模式，允许自动刷新"

- `Monitor.vue`：新增的 thinking level badge 通过 SSE 实时数据流驱动，无需用户操作 ✅
- `Logs.vue`：新增的 client/backend model Select 控件使用筛选栏模式（点击选择→触发筛选），与现有控件一致 ✅
- `LogTableRow.vue`：新增的 latency 列和 thinking level badge 为展示性元素，不涉及交互 ✅
- `RequestOverviewPanel.vue`：新增的 thinking level badge 为展示性元素 ✅

**结论：无违规** ✅

---

### 7. 数据完整性检查

**数据流**: `extractThinkingLevelFromRequest` (orchestrator.ts) → `ActiveRequest.thinkingLevel` → `RequestTracker` (SSE broadcast) → Monitor.vue + 实时详情面板。同时存储在 DB 并通过 admin API 查询后在 Logs.vue 显示。

| 数据消费者 | 是否同步 | 文件 |
|-----------|---------|------|
| `ActiveRequest` 结构定义 | ✅ | `types.ts` (monitor) |
| SSE 实时广播（thinkingLevel 字段） | ✅ | `orchestrator.ts` (buildActiveRequest) |
| Monitor 页面活跃/已完成/详情 | ✅ | `Monitor.vue`, `RequestOverviewPanel.vue` |
| Logs 页面详情面板 | ✅ | `RequestOverviewPanel.vue` (通过 `useLogFilters` → 后端 API) |
| DB/Admin API | ✅ | `logs.ts` (DB), `admin/logs.ts` (API) |
| Logs 表格行内展示 | ✅ | `LogTableRow.vue` |

所有数据消费者均已同步。✅

---

### 8. 额外发现

#### 8.1 代码重复

`orchestrator.ts` 的 `extractThinkingLevelFromRequest()` 与 `thinking-level.ts` 的 `extractThinkingLevel()` 逻辑高度相似（JSON parse + API type 分发），仅类型签名有差异：
- 后端：`apiType` 为联合类型 `"openai" | "openai-responses" | "anthropic"`
- 前端：`apiType` 为 `string`

建议在后续重构中合并为共享工具函数。

#### 8.2 Pre-existing eslint-disable 注释

以下 eslint-disable 注释存在于被修改的文件中，非本次 PR 新增。建议在后续 PR 中逐步清理：

```
frontend/src/components/logs/LogTableRow.vue:    <!-- eslint-disable vue/multi-word-component-names -->
frontend/src/views/Logs.vue:                     <!-- eslint-disable vue/multi-word-component-names -->
frontend/src/views/Monitor.vue:                  <!-- eslint-disable vue/multi-word-component-names -->
router/src/proxy/orchestration/orchestrator.ts:  // eslint-disable-line taste/no-silent-catch
```

---

## 最终裁定

| 项目 | 值 |
|------|-----|
| **verdict** | **pass** ✅ |
| **must_fix** | **0** |
| **warnings/建议** | 2 条 silent catch 缺少注释（新代码），建议补充以提高代码可维护性 |
| **pre-existing 观察项** | 4 处 eslint-disable 注释待后续 PR 清理 |
| **Lint/TypeCheck** | 全部通过 ✅ |

所有质量门禁均已通过，未发现必须修复的违规项。
