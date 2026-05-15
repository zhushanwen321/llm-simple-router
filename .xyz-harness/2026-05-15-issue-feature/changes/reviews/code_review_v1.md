# 编码评审：映射原因追踪 (Mapping Reason Tracking)

**评审日期**: 2026-05-15
**评审轮次**: v1
**评审范围**: 后端 B1-B6 + 前端 F1-F5（15 个文件变更，+713/-44 行）
**基准 commit**: a44051b..HEAD

---

## 评审结论：需修改后重审

发现 1 条 MUST FIX（前端 `parseMappingReason` 数据格式不匹配，导致映射原因永远不会显示）和 1 条 LOW（缩进回归导致 lint 失败）。

---

## MUST FIX（1 条）

### MF-1: `parseMappingReason` 期望 `{ stages: [...] }` 但 DB 存储的是纯数组

**文件**: `frontend/src/components/request-detail/types.ts` L136-170（`parseMappingReason` 函数）
**优先级**: MUST FIX
**分类**: 代码逻辑错误 — 实现与数据格式不符

**问题**:

`PipelineSnapshot.toJSON()` 序列化的是 `JSON.stringify(this.stages)`，即直接序列化 `StageRecord[]` 数组：

```json
[{"stage":"routing","client_model":"gpt-4","mapping_reason":"group_schedule"},{"stage":"overflow","triggered":false}]
```

但 `parseMappingReason()` 将 `JSON.parse` 的结果断言为 `{ stages?: Array<Record<string, unknown>> }` 格式：

```typescript
const parsed: { stages?: Array<Record<string, unknown>> } = JSON.parse(snapshot);
if (!Array.isArray(parsed.stages)) return undefined;  // ← 永远为 true
```

由于 `parsed` 实际上是一个数组（不是对象），`parsed.stages` 为 `undefined`，`Array.isArray(undefined)` 为 `false`，函数直接返回 `undefined`。

**后果**: 所有历史日志的映射原因都不会被解析，Badge 永远不渲染。AC1-AC9 中涉及 `fromLogEntry` 的部分全部失效。

**修复方向**:

```typescript
export function parseMappingReason(
  snapshot: string | null | undefined,
): string | undefined {
  if (!snapshot) return undefined;
  try {
    const parsed = JSON.parse(snapshot);
    const stages: Array<Record<string, unknown>> = Array.isArray(parsed) ? parsed : [];
    if (stages.length === 0) return undefined;

    // 检查 overflow stage
    for (const stage of stages) {
      if (stage.stage === "overflow" && stage.triggered === true) {
        return "overflow_redirect";
      }
    }
    // 取 routing stage 的 mapping_reason
    for (const stage of stages) {
      if (stage.stage === "routing" && typeof stage.mapping_reason === "string") {
        return stage.mapping_reason;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}
```

**Spec 对照**: spec 数据流章节明确说明 `pipeline_snapshot` 是 JSON 字符串，前端 `fromLogEntry()` 通过 `JSON.parse` 解析。实现中未正确处理其数组格式。

---

## LOW（1 条）

### L-1: 后端 3 个文件缩进回归，lint 无法通过

**文件**:
- `router/src/proxy/handler/failover-loop.ts`（16 处）
- `router/src/proxy/orchestration/orchestrator.ts`（7 处）
- `router/src/proxy/routing/mapping-resolver.ts`（15 处）

**优先级**: LOW（代码风格问题，不影响功能正确性）
**说明**: 项目配置 `--max-warnings=0`，当前 `npm run lint -w router` 报 38 个 indent 警告，全部是本次变更引入的缩进不一致（4 空格位置用了 2 空格，或 8 空格位置用了 4 空格）。用 `npm run lint -w router -- --fix` 可自动修复。

---

## Spec 合规逐项检查

### AC1-AC4: resolveMapping 4 种映射原因

| AC | mappingReason 值 | 代码实现 | 结果 |
|----|-----------------|---------|------|
| AC1 | `direct_format` | `mapping-resolver.ts` L135 `mappingReason: "direct_format" as MappingReason` | ✓ |
| AC2 | `group_base_rule` | `mapping-resolver.ts` L179 默认值 + L185 schedule 不命中不改写 | ✓ |
| AC3 | `group_schedule` | `mapping-resolver.ts` L182-184 schedule targets 非空时 `mappingReason = "group_schedule"` | ✓ |
| AC4 | `fallback_provider` | `mapping-resolver.ts` L148 `mappingReason: "fallback_provider" as MappingReason` | ✓ |

schedule 边界：`scheduleTargets.length === 0` 时回退到 base rule，`mappingReason` 保持 `group_base_rule`。✓

### AC5: overflow_redirect

**后端**: `failover-loop.ts` L275 初始化 `effectiveMappingReason = resolveResult.mappingReason`，L280 overflow 触发时覆写为 `"overflow_redirect"`。写入 routing stage（L299）和 orchestrator config（L390）。✓

**pipeline_snapshot**: 同时保留 routing stage（`mapping_reason: "overflow_redirect"`）和 overflow stage（`triggered: true`）。✓

**前端**: `parseMappingReason` 存在 MF-1 bug，但逻辑结构正确（先检查 overflow stage 再取 routing stage）。修复数据格式问题后可正常工作。

### AC6: failover_retry

**后端**: BP-H2 缓存路径（L227）硬编码 `"failover_retry"`。首次迭代使用原始 mappingReason。✓

**非缓存路径**: 仅在首次迭代（`excludeTargets.length === 0`）时调用 `resolveMapping()`，此时不应为 `failover_retry`。✓

### AC7: 双页面一致性

`fromLogEntry` 和 `fromActiveRequest` 对同一请求应返回相同 mappingReason：

- `fromActiveRequest`: 直接透传 `req.mappingReason`（后端已覆写）✓
- `fromLogEntry`: 从 `pipeline_snapshot` 解析（修复 MF-1 后）✓

后端保证 `ActiveRequest.mappingReason` 和 `pipeline_snapshot` routing stage 的 `mapping_reason` 值一致（同一个 `effectiveMappingReason` 变量）。✓

### AC8: 历史数据降级

- `pipeline_snapshot` routing variant 的 `mapping_reason` 为 optional ✓
- `parseMappingReason` 对 null/undefined/非法 JSON/无 routing stage 均返回 undefined ✓（修复 MF-1 后）
- `RequestOverviewPanel.vue` 使用 `v-if="overview.mappingReason"` 条件渲染 ✓

### AC9: DB 查询验证

测试用例直接查询 `SELECT pipeline_snapshot FROM request_logs` 验证 routing stage 包含 `mapping_reason`。✓

---

## 架构合规检查

| 检查项 | 结果 |
|--------|------|
| 类型定义位置（`core/types.ts`） | ✓ 符合 spec |
| `ResolveResult.mappingReason` 为 required 字段 | ✓ 编译器强制赋值 |
| `ActiveRequest.mappingReason` 为 optional | ✓ 符合 spec |
| `StageRecord` routing variant `mapping_reason` 为 optional string | ✓ 符合 plan 设计决策 |
| 禁止裸 `JSON.parse` | ✓ `mapping-resolver.ts` 中 `parseModels()` 仍通过类型安全函数解析 |
| SSE strip 逻辑不删除 `mappingReason` | ✓ 已确认 `request-tracker.ts` 只 strip 4 个大字段 |
| 前端 Badge 使用 shadcn-vue 组件 | ✓ `import { Badge } from '@/components/ui/badge'` |
| 前端无 Emoji | ✓ |
| 前端无硬编码颜色 | ✓ 使用 `variant="secondary"` |
| 前端无魔数间距 | ✓ 使用标准 Tailwind class `gap-1.5`、`text-[10px]`（与现有代码一致） |
| template ≤ 400 行 | ✓ 当前约 140 行 |
| script setup ≤ 300 行 | ✓ 当前约 90 行 |
| `parseMappingReason` 防御性处理 | ✓ try-catch + null 检查（格式问题 MF-1 需修复） |

---

## 数据消费者完整性检查

| 消费者 | 文件 | 状态 |
|--------|------|------|
| DB 写入 (`insertRequestLog`) | `router/src/db/logs.ts` | ✓ 无需变更，pipeline_snapshot JSON 自动序列化新字段 |
| SSE ActiveRequest 定义 | `router/src/core/monitor/types.ts` | ✓ 新增 `mappingReason?: string` |
| SSE 赋值 | `router/src/proxy/orchestration/orchestrator.ts` | ✓ `buildActiveRequest` 传递 |
| SSE strip 逻辑 | `router/src/core/monitor/request-tracker.ts` | ✓ 不 strip 标量字段 |
| SSE 事件推送 | `request_start` / `request_update` / `request_complete` | ✓ ActiveRequest 完整序列化 |
| Admin API | `router/src/admin/logs.ts` | ✓ 已返回 pipeline_snapshot |
| 前端 LogEntry 类型 | `frontend/src/components/logs/types.ts` | ✓ 新增 `pipeline_snapshot?: string \| null` |
| 前端 ActiveRequest 类型 | `frontend/src/types/monitor.ts` | ✓ 新增 `mappingReason?: string` |
| 前端转换器 fromLogEntry | `frontend/src/components/request-detail/types.ts` | ✓ 调用 `parseMappingReason`（MF-1 需修复） |
| 前端转换器 fromActiveRequest | 同上 | ✓ 直接透传 `req.mappingReason` |
| 前端展示 | `RequestOverviewPanel.vue` | ✓ v-if + Badge + i18n |
| 前端 i18n | `zh-CN/requestDetail.json` + `en/requestDetail.json` | ✓ 6 种翻译键完整 |

---

## 测试覆盖评估

| 测试文件 | 覆盖场景 |
|---------|---------|
| `mapping-reason.test.ts` | 4 种 resolveMapping 路径（direct_format、group_base_rule ×2、group_schedule、fallback_provider）|
| `mapping-reason-failover.test.ts` | failover_retry（2nd iteration + 1st iteration 不设 failover_retry）|
| `mapping-reason-overflow.test.ts` | overflow_redirect（触发 + 不触发）|

覆盖了所有 6 种 mappingReason 值，包括 DB 查询验证（AC9）和 ActiveRequest 验证。测试质量良好。缺少前端 `parseMappingReason` 单元测试（plan 中 F2 验收标准列出了 6 个边界用例，但未在本次 diff 中实现）。

---

## 风险点验证

| 风险点 | 评估 |
|--------|------|
| BP-H2 缓存丢失 mappingReason | ✓ 采用简化方案：缓存路径直接硬编码 `"failover_retry"`，不缓存原始值。正确——BP-H2 缓存命中仅发生在第 2+ 次迭代 |
| SSE request_start 时序 | ✓ `buildActiveRequest` 在 `orchestrator.handle()` 内调用，此时 `mappingReason` 已确定。`request_start` 事件携带 mappingReason |
| overflow 双记录策略 | ✓ pipeline_snapshot 同时保留 routing stage（最终原因）和 overflow stage（triggered） |
| `scheduleTargets.length === 0` 边界 | ✓ 保持 `group_base_rule`，不误设为 `group_schedule` |

---

## 问题汇总

| 编号 | 优先级 | 文件 | 行号 | 问题 |
|------|--------|------|------|------|
| MF-1 | MUST FIX | `frontend/src/components/request-detail/types.ts` | L136-140 | `parseMappingReason` 期望 `{ stages: [...] }` 但 DB 存储纯数组，导致永远返回 undefined |
| L-1 | LOW | `failover-loop.ts` / `orchestrator.ts` / `mapping-resolver.ts` | 多处 | 38 个缩进警告，lint 失败 |
