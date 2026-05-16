# 后端实现计划：映射原因追踪 (Mapping Reason Tracking)

## 概述

在映射解析流程中追踪映射原因（6 种），通过 `ResolveResult.mappingReason` → `PipelineSnapshot routing stage` → `ActiveRequest` 三级传递链路，实现存储（pipeline_snapshot JSON 列）和实时推送（SSE）。

## 变更范围

| # | 文件 | 变更类型 | 说明 |
|---|------|---------|------|
| 1 | `router/src/core/types.ts` | 修改 | 新增 `MappingReason` type + `ResolveResult` 扩展 |
| 2 | `router/src/proxy/routing/mapping-resolver.ts` | 修改 | 所有返回路径填充 `mappingReason` |
| 3 | `router/src/proxy/pipeline-snapshot.ts` | 修改 | routing variant 新增 `mapping_reason` 字段 |
| 4 | `router/src/proxy/handler/failover-loop.ts` | 修改 | 后置覆写 + 写入 PipelineSnapshot 和 ActiveRequest |
| 5 | `router/src/core/monitor/types.ts` | 修改 | `ActiveRequest` 新增 `mappingReason` 字段 |
| 6 | `router/src/proxy/orchestration/orchestrator.ts` | 修改 | `buildActiveRequest` 传递 `mappingReason` |

不需要修改 `request-tracker.ts`：strip 逻辑只移除 `clientRequest`/`upstreamRequest`/`streamContent`/`streamMetrics`，`mappingReason` 是标量字段，不会被 strip。

---

## Task 1: 类型定义

**文件**: `router/src/core/types.ts`

### 变更内容

1. 新增 `MappingReason` union type（放在 `ResolveResult` 之前）

```typescript
/** 映射解析原因：resolveMapping() 返回 4 种，failover-loop 后置覆写 2 种 */
export type MappingReason =
  | "direct_format"       // provider/model 直接指定
  | "group_base_rule"     // 映射组基础规则
  | "group_schedule"      // 映射组分时段规则
  | "fallback_provider"   // 无映射组，回退 provider 匹配
  | "overflow_redirect"   // 溢出重定向（failover-loop 覆写）
  | "failover_retry";     // failover 重试（failover-loop 覆写）
```

2. `ResolveResult` 新增 `mappingReason` 字段

```typescript
export interface ResolveResult {
  target: Target;
  concurrency_override?: ConcurrencyOverride;
  targetCount: number;
  allTargets?: Target[];
  mappingReason: MappingReason;  // 新增
}
```

### 设计决策

**为什么 `MappingReason` 放在 `core/types.ts` 而非 `mapping-resolver.ts` 局部？**

被 4 个模块引用：`resolveMapping()`、`failover-loop.ts`、`ActiveRequest`、前端转换器。放在共享类型文件避免循环依赖。虽然前端不直接 import 这个类型（前端从 JSON 解析），但保持概念一致性。

**为什么 `mappingReason` 不是 optional？**

`resolveMapping()` 返回 `ResolveResult` 时必须携带原因——这是函数的核心职责。返回 `null`（无映射）时不存在 `ResolveResult`，自然不需要原因。`ActiveRequest.mappingReason` 是 optional，因为请求开始时映射尚未完成。

### 验收标准

- [ ] TypeScript 编译通过（`npx tsc --noEmit`）
- [ ] 所有引用 `ResolveResult` 的代码编译通过（`mappingReason` 是新增字段，赋值端必须同步更新）

### 风险点

- `ResolveResult` 的所有构造点都必须补充 `mappingReason`，否则编译失败。这正是我们想要的（编译器强制完整性检查）。

---

## Task 2: resolveMapping() 所有返回路径填充 mappingReason

**文件**: `router/src/proxy/routing/mapping-resolver.ts`

### 变更内容

在 `resolveMapping()` 的 4 个返回路径中填充 `mappingReason`：

| 返回路径 | 当前代码位置 | mappingReason 值 |
|---------|------------|-----------------|
| `provider/model` 直接格式命中 | `if (slashMatch)` → `return { target: ..., targetCount: 1 }` | `"direct_format"` |
| 映射组基础规则（无 schedule 或 schedule 无匹配） | `if (matchedSchedule)` 为 false → `return { target: filtered[0], ... }` | `"group_base_rule"` |
| 映射组分时段规则命中 | `if (matchedSchedule)` → `activeTargets = scheduleTargets` → `return { ... }` | `"group_schedule"` |
| 无映射组，回退 provider 匹配 | `if (!group)` → `for (const p of providers)` → `return { ... }` | `"fallback_provider"` |

### 具体修改

**路径 1 — 直接格式**（约 L145）：
```typescript
return {
  target: { backend_model: backendModel, provider_id: provider.id },
  targetCount: 1,
  mappingReason: "direct_format",
};
```

**路径 2 — 回退 provider 匹配**（约 L158）：
```typescript
return {
  target: { backend_model: clientModel, provider_id: p.id },
  targetCount: 1,
  mappingReason: "fallback_provider",
};
```

**路径 3 — 最终返回**（约 L210，需要区分 base 和 schedule）：

```typescript
// 确定 mappingReason：schedule 有匹配且产生了有效 targets 则为 schedule，否则为 base
const mappingReason: MappingReason = (matchedSchedule && matchedSchedule === scheduleUsedForTargets)
  ? "group_schedule"
  : "group_base_rule";

return {
  target: filtered[0],
  concurrency_override: concurrencyOverride,
  targetCount: activeTargets.length,
  allTargets: activeTargets,
  mappingReason,
};
```

需要调整逻辑：在 `if (matchedSchedule)` 分支中记住 `scheduleUsedForTargets` 变量。

### 设计决策

**为什么 resolveMapping() 只返回 4 种原因？**

职责分离：`resolveMapping()` 只做映射解析，不感知 failover/overflow 语义。`failover_retry` 和 `overflow_redirect` 是循环层概念，由 `failover-loop.ts` 后置覆写。

**为什么 schedule 和 base 需要区分？**

同一个映射组可能在不同时间命中不同规则（分时段切换），用户需要知道当前请求命中的是哪个规则。

### 验收标准

- [ ] `resolveMapping()` 的所有非 null 返回都携带 `mappingReason`
- [ ] 4 种 mappingReason 值正确对应 4 种解析路径
- [ ] `filterExcluded` 不影响 `mappingReason` 的正确性
- [ ] 现有 `resolveMapping()` 调用方（`failover-loop.ts` BP-H2 缓存重建路径）也需要补充 `mappingReason`

### 风险点

- **BP-H2 缓存路径**：`failover-loop.ts` 第 ~238 行的缓存重建逻辑 `resolveResult = { target: filtered[0], concurrency_override: ..., targetCount: ... }` 也需要补充 `mappingReason`。但此时原始 `mappingReason` 已丢失（缓存只存了 `allTargets`）。**解决方案**：在 BP-H2 缓存中同时缓存 `mappingReason`。

---

## Task 3: PipelineSnapshot routing stage 扩展

**文件**: `router/src/proxy/pipeline-snapshot.ts`

### 变更内容

`StageRecord` 的 routing variant 新增 `mapping_reason` 字段：

```typescript
export type StageRecord =
  | { stage: "tool_round_limit"; action: string; rounds: number }
  | { stage: "tool_guard"; action: string; tool: string }
  | { stage: "routing"; client_model: string; backend_model: string; provider_id: string; strategy: string; mapping_reason?: string }
  //                                                                               ^^^^^^^^^^^^^^^^ 新增，optional（历史数据兼容）
  | { stage: "overflow"; triggered: boolean; redirect_to?: string; redirect_provider?: string }
  | { stage: "provider_patch"; types: string[] };
```

### 设计决策

**为什么 `mapping_reason` 是 optional 而不是 required？**

虽然每次正常请求都会有值，但 `StageRecord` 可能被其他测试代码直接构造。设为 optional 避免 breaking change。`failover-loop.ts` 赋值时始终填充，实际不会出现 undefined。

**为什么不使用 `MappingReason` 类型而用 `string`？**

`pipeline-snapshot.ts` 不 import `core/types.ts`（当前无依赖）。引入类型依赖只为一个 optional 字段不值得。`string` 足够——序列化为 JSON 后类型信息丢失，消费端自行验证。

### 验收标准

- [ ] `StageRecord` routing variant 编译通过
- [ ] `pipelineSnapshot.add({ stage: "routing", ... })` 的所有调用点编译通过

### 风险点

- 需要检查是否有其他文件直接构造 routing `StageRecord`（搜索 `stage: "routing"`）。目前只有 `failover-loop.ts` 一处。

---

## Task 4: failover-loop.ts 后置覆写 + BP-H2 缓存扩展

**文件**: `router/src/proxy/handler/failover-loop.ts`

### 变更内容

这是最复杂的 task，涉及 4 处修改：

#### 4-1: BP-H2 缓存扩展

缓存 `mappingReason`，避免后续迭代丢失原始原因：

```typescript
let cachedTargets: Target[] | undefined;
let cachedConcurrencyOverride: ConcurrencyOverride | undefined;
let cachedMappingReason: MappingReason | undefined;  // 新增
```

首次解析时缓存：
```typescript
if (resolveResult?.allTargets) {
  cachedTargets = resolveResult.allTargets;
  cachedConcurrencyOverride = resolveResult.concurrency_override;
  cachedMappingReason = resolveResult.mappingReason;  // 新增
}
```

缓存重建路径补充 `mappingReason`：
```typescript
resolveResult = filtered.length > 0
  ? { target: filtered[0], concurrency_override: cachedConcurrencyOverride, targetCount: cachedTargets.length, mappingReason: cachedMappingReason! }
  : null;
```

#### 4-2: mappingReason 后置覆写逻辑

在 routing stage add 之前确定最终 `mappingReason`：

```typescript
// 确定 mappingReason：原始值 → failover 覆写 → overflow 覆写
let currentReason: string = resolveResult.mappingReason;

// 第 2+ 次迭代（failover）：覆写为 failover_retry
if (excludeTargets.length > 0) {
  currentReason = "failover_retry";
}

// overflow 触发时：进一步覆写为 overflow_redirect（优先级最高）
if (overflowResult) {
  currentReason = "overflow_redirect";
}
```

#### 4-3: routing stage 添加 mapping_reason

```typescript
iterationSnapshot.add({
  stage: "routing",
  client_model: clientModel,
  backend_model: resolved.backend_model,
  provider_id: resolved.provider_id,
  strategy: resolveResult.targetCount > 1 ? "failover" : "scheduled",
  mapping_reason: currentReason,  // 新增
});
```

#### 4-4: ActiveRequest 传递 mappingReason

`buildActiveRequest` 无法直接接收 `mappingReason`（它在 `orchestrator.handle()` 中调用，此时 `mappingReason` 尚未最终确定——overflow 在 orchestrator 内部）。

**方案**：在 `orchestrator.handle()` 的 `OrchestratorConfig` 中新增 `mappingReason` 字段，`buildActiveRequest` 将其写入 `ActiveRequest`。`failover-loop.ts` 在调用 `orchestrator.handle()` 时传入 `currentReason`。

```typescript
// orchestrator.ts OrchestratorConfig 新增：
mappingReason?: string;

// orchestrator.ts buildActiveRequest 补充：
return {
  ...existing,
  mappingReason: config.mappingReason,
};
```

```typescript
// failover-loop.ts 调用 orchestrator.handle 时传入：
const resilienceResult = await orchestrator.handle(
  request, reply, clientApiType,
  {
  ...existingConfig,
  mappingReason: currentReason,  // 新增
  },
  { ...existingCtx },
);
```

### 设计决策

**为什么 overflow 优先级高于 failover？**

overflow 触发意味着请求已经被重定向到另一个模型，这是比 failover 更根本的路由变更。用户更关心"请求被溢出重定向了"而非"这是第 N 次重试"。

**为什么不直接在 ActiveRequest 上后置赋值而走 orchestrator config？**

`ActiveRequest` 对象在 `buildActiveRequest` 中创建，之后存入 `tracker.activeMap`。直接修改 `ActiveRequest` 需要在 failover-loop 中拿到 tracker 后 `tracker.update(id, { mappingReason })`。这可行但需要额外的 update 调用。通过 config 传递，`buildActiveRequest` 一次性设置，更简洁。

**但有一个问题**：overflow 在 orchestrator.handle 之前就确定了（`applyOverflowRedirect` 在 orchestrator 调用之前），所以 `currentReason` 在传入 orchestrator 时已是最终值。

### 验收标准

- [ ] BP-H2 缓存路径正确传递 `mappingReason`
- [ ] 首次迭代使用原始 `mappingReason`（如 `group_schedule`）
- [ ] 第 2+ 次迭代 `mappingReason` 为 `"failover_retry"`
- [ ] overflow 触发时 `mappingReason` 为 `"overflow_redirect"`
- [ ] pipeline_snapshot routing stage 包含 `mapping_reason`
- [ ] ActiveRequest.mappingReason 与 pipeline_snapshot 一致
- [ ] `request_update` / `request_start` / `request_complete` SSE 事件携带 `mappingReason`

### 风险点

- **SSE 时序**：`request_start` 事件在 `tracker.start()` 时发出（此时 `mappingReason` 尚未设置，因为映射在 orchestrator 内部完成）。`request_update`（每 5s）和 `request_complete` 会携带正确的值。这是可接受的——映射解析在毫秒级完成，5s 轮询足够及时。
- **overflow 双记录**：pipeline_snapshot 同时保留 routing stage（含原始原因）和 overflow stage（triggered=true），ActiveRequest.mappingReason 始终是最终值（overflow_redirect）。前端从 pipeline_snapshot 解析时可看到完整历史。

---

## Task 5: ActiveRequest 类型扩展

**文件**: `router/src/core/monitor/types.ts`

### 变更内容

`ActiveRequest` interface 新增字段：

```typescript
export interface ActiveRequest {
  // ... 现有字段 ...
  mappingReason?: string;  // 新增：映射原因（6 种枚举值）
}
```

### 设计决策

**为什么用 `string` 而非 `MappingReason`？**

`monitor/types.ts` 目前不 import `core/types.ts`。虽然可以引入，但 `ActiveRequest` 是 SSE 推送的数据结构，字段语义应保持松耦合。`string` 足够，前端通过 i18n 映射展示。

### 验收标准

- [ ] `ActiveRequest` 编译通过
- [ ] `request-tracker.ts` 的 `broadcast` strip 逻辑不会移除 `mappingReason`（已确认：只 strip `clientRequest`/`upstreamRequest`/`streamContent`/`streamMetrics`）
- [ ] SSE `request_update` 事件中 `mappingReason` 字段正常传递到前端

### 风险点

- 无。`mappingReason` 是 optional 标量字段，不影响现有代码。

---

## Task 6: orchestrator.ts 传递 mappingReason

**文件**: `router/src/proxy/orchestration/orchestrator.ts`

### 变更内容

1. `OrchestratorConfig` 新增 `mappingReason`：
```typescript
export interface OrchestratorConfig {
  // ... 现有字段 ...
  mappingReason?: string;
}
```

2. `buildActiveRequest` 补充字段：
```typescript
return {
  // ... 现有字段 ...
  mappingReason: config.mappingReason,
};
```

### 验收标准

- [ ] `buildActiveRequest` 构造的 `ActiveRequest` 包含 `mappingReason`
- [ ] `tracker.start(req)` 后 `activeMap` 中的条目包含 `mappingReason`
- [ ] 不影响 `orchestrator.ts` 的其他逻辑

### 风险点

- 无。纯增量修改。

---

## 实现顺序

```
Task 1 (types.ts) → Task 5 (monitor/types.ts) → Task 3 (pipeline-snapshot.ts)
                    ↓
                Task 2 (mapping-resolver.ts)
                    ↓
                Task 6 (orchestrator.ts)
                    ↓
                Task 4 (failover-loop.ts)
```

Task 1 是基础依赖。Task 2-6 可以顺序执行（每个依赖前一个的编译结果）。

## 数据消费者验证

| 消费者 | 文件 | 验证点 |
|--------|------|-------|
| DB 写入 | `db/logs.ts` `insertRequestLog()` | 无变更：`pipeline_snapshot` 列自动序列化 routing stage 的新增字段 |
| SSE strip | `request-tracker.ts` `broadcast()` | 确认 `mappingReason` 不在 strip 列表中（只 strip `clientRequest`/`upstreamRequest`/`streamContent`/`streamMetrics`） |
| SSE 事件 | `request_start`/`request_update`/`request_complete` | `ActiveRequest.mappingReason` 随事件 JSON 序列化自动携带 |
| Admin API | `admin/logs.ts` | 无变更：已返回 `pipeline_snapshot` 完整 JSON |
| 前端 | 不在本次后端范围 | 前端从 SSE 或 pipeline_snapshot 解析 `mappingReason` |

## AC 覆盖矩阵

| AC | 后端覆盖 | 涉及 Task |
|----|---------|----------|
| AC1-4 | resolveMapping() 4 种原因正确填充 | Task 1, 2 |
| AC5 | overflow 触发时覆写为 `overflow_redirect`，写入 ActiveRequest 和 pipeline_snapshot | Task 3, 4, 5, 6 |
| AC6 | 第 2+ 次迭代覆写为 `failover_retry` | Task 4 |
| AC7 | ActiveRequest（Monitor SSE）和 pipeline_snapshot（Logs API）数据一致 | Task 4, 5, 6 |
| AC8 | 历史日志无 `mapping_reason` → 前端优雅降级 | 后端不需要处理（前端职责），但 pipeline_snapshot routing variant 中 `mapping_reason` 为 optional |
| AC9 | `pipeline_snapshot` routing stage 包含 `mapping_reason` 字段 | Task 3, 4 |
