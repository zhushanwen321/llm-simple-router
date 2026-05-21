---
verdict: pass
must_fix: 0
review:
  type: code_review
  round: 3
  timestamp: "2026-05-22T23:30:00"
  target: "router/src/proxy/handler/failover-loop.ts + 6 new hook files + pipeline.ts + register-hooks.ts + types.ts"
  verdict: pass
  summary: "编码评审第3轮（最终轮），v2 的 MUST FIX #11 已修复（errorInfo key + 移除 inline insertRequestLog + flushToolErrors），0条 open MUST FIX，通过"

statistics:
  total_issues: 13
  must_fix: 0
  must_fix_resolved: 4
  low: 6
  info: 3

issues:
  - id: 1
    severity: MUST_FIX
    location: "router/src/proxy/handler/failover-loop.ts"
    title: "FR6 违反：catch 块未 emit on_error phase"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2

  - id: 2
    severity: MUST_FIX
    location: "router/src/proxy/hooks/builtin/transport-execute.ts:L131-L147"
    title: "Plugin 响应转换逻辑丢失（applyBeforeResponse/applyAfterResponse）"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2

  - id: 3
    severity: MUST_FIX
    location: "router/src/proxy/handler/failover-loop.ts + usage-record.ts"
    title: "usage 重复记录：usage-record hook + inline 代码双重调用 recordRequest"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2

  - id: 4
    severity: LOW
    location: "router/src/proxy/hooks/builtin/request-logging.ts + router/src/proxy/handler/failover-loop.ts"
    title: "requestLoggingHook 是 no-op（读 ctx.metadata resilientResult 但 transport-execute 写 ctx.resilienceResult），inline 代码补偿"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 5
    severity: LOW
    location: "router/src/proxy/hooks/builtin/stream-timeout.ts:L7"
    title: "stream-timeout priority 110 vs spec FR3 定义的 50"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 6
    severity: LOW
    location: "router/src/proxy/hooks/builtin/usage-record.ts:L12"
    title: "usage-record priority 120 vs spec FR3 定义的 100"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 7
    severity: LOW
    location: "router/src/proxy/handler/failover-loop.ts"
    title: "AC2：logResilienceResult/collectTransportMetrics 仍在 failover-loop import 中（requestLoggingHook no-op 的连带问题）"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 8
    severity: INFO
    location: "router/src/proxy/pipeline/types.ts:L53"
    title: "ProviderInfo.adaptive_enabled boolean→number 是 bug 修复（对齐 DB schema），非回归"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 9
    severity: INFO
    location: "tests/proxy/"
    title: "Plan 中 2 个测试文件未创建（pipeline-hooks.test.ts、pipeline-emit.test.ts），已有 pipeline-error-degradation.test.ts"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 10
    severity: INFO
    location: "router/src/proxy/handler/failover-loop.ts + router/src/proxy/hooks/builtin/route-resolve.ts"
    title: "filterExcluded 重复调用（failover-loop L3 + route-resolve hook），无害冗余"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 11
    severity: MUST_FIX
    location: "router/src/proxy/handler/failover-loop.ts:unknown error catch 块"
    title: "unknown error 路径双重日志：errorLoggingHook + inline insertRequestLog 均插入 request_logs，且 tool errors 双重 flush"
    status: resolved
    raised_in_round: 2
    resolved_in_round: 3

  - id: 12
    severity: LOW
    location: "router/src/proxy/handler/failover-loop.ts:flushToolErrors closure"
    title: "flushToolErrors 闭包未在 flush 后置空 pendingToolErrors，failover 场景下 tool errors 被多次写入"
    status: open
    raised_in_round: 3
    resolved_in_round: null

  - id: 13
    severity: LOW
    location: "router/src/proxy/handler/failover-loop.ts:ProviderSwitchNeeded catch"
    title: "ProviderSwitchNeeded catch 使用 emit 前的 snapshot（不含 routing/patch 阶段），诊断信息不完整"
    status: open
    raised_in_round: 3
    resolved_in_round: null
---

# 编码评审 v3

## 评审记录
- 评审时间：2026-05-22 23:30
- 评审类型：编码评审（第3轮，最终轮）
- 评审对象：Pipeline 全量接管代理请求执行（v2 MUST FIX #11 修复验证 + 全量审查）

## v2 MUST FIX #11 修复验证

### Issue #11: unknown error 路径双重日志 → **已修复**

修复方案验证（逐项确认）：

**1. metadata key 匹配** ✅

```typescript
// failover-loop.ts unknown error catch
ctx.metadata.set("errorInfo", {
  statusCode: UPSTREAM_ERROR_STATUS,
  errorMessage: errMsg || "Upstream connection failed",
  providerId: ctx.provider?.id,
});
```

errorLoggingHook 读取 `ctx.metadata.get("errorInfo")` — key 完全匹配。errorLoggingHook 的 else 分支（非 isRejected）正确调用 `insertRequestLog`，写入一条日志。

**2. inline insertRequestLog 移除** ✅

unknown error catch 块中不再有 `insertRequestLog(db, { ... })` 调用。日志完全由 errorLoggingHook 通过 `emit("on_error")` 处理。

**3. inline flushToolErrors 移除** ✅

unknown error catch 块中不再有 `flushCurrentErrors()` 或 `flushToolErrors()` 调用。tool error flush 由 errorLoggingHook 的 `ctx.metadata.delete("pendingToolErrors")` 处理（flush 后删除防止重复）。

**4. SemaphoreQueueFullError/SemaphoreTimeoutError 不 emit on_error** ✅

```typescript
if (e instanceof SemaphoreQueueFullError) {
    if (ctx.provider) flushToolErrors(ctx.provider.id, ctx.resolved?.backend_model ?? clientModel);
    return rejectAndReply(reply, rCtx, ...);
}
```

Semaphore 错误通过 `rejectAndReply → insertRejectedLog` 处理日志，不触发 on_error emit，避免与 errorLoggingHook 双重插入。策略与 v2 审查一致。

**5. on_error emit 异常安全** ✅

```typescript
try { await proxyPipeline.emit("on_error", ctx); } catch (emitErr) {
  ctx.request.log.debug({ err: emitErr }, "on_error emit failed");
}
```

emit 失败时降级为 debug 日志，不影响后续错误响应发送。

**结论**：Issue #11 的根因（key 不匹配 + inline 日志未移除 + tool errors 双重 flush）全部消除。unknown error 路径现在只有 errorLoggingHook 写入一条 request_log + 一次 tool error flush。

## v2 MUST FIX #1/#2/#3 状态确认（v1 遗留）

| # | 问题 | v2 状态 | v3 状态 |
|---|------|---------|---------|
| 1 | catch 块未 emit on_error | resolved | 维持 resolved |
| 2 | Plugin 响应转换丢失 | resolved | 维持 resolved |
| 3 | usage 重复记录 | resolved | 维持 resolved |

## v1-v2 LOW/INFO 状态更新

| # | 状态 | 说明 |
|---|------|------|
| 4 | 仍 open | requestLoggingHook 仍读 `ctx.metadata.get("resilienceResult")`，transport-execute 写 `ctx.resilienceResult`（ctx 属性而非 metadata），hook 是 no-op。Inline 代码补偿功能正常。需后续迭代让 transport-execute 同步写入 metadata 或 requestLoggingHook 读 ctx 属性。 |
| 5 | 仍 open | stream-timeout priority 110，spec FR3 定义 50。Constraint 4 分段规则（100-199 = 内置功能）支持当前值。不改也行。 |
| 6 | 仍 open | usage-record priority 120，spec FR3 定义 100。同 Issue #5。 |
| 7 | 仍 open | logResilienceResult/collectTransportMetrics 仍在 failover-loop import 中。Issue #4 的连带问题，inline 代码仍需这些函数。 |
| 8 | 仍 open | adaptive_enabled boolean→number 类型修正，对齐 DB schema。 |
| 9 | 仍 open | pipeline-hooks.test.ts、pipeline-emit.test.ts 未创建。pipeline-error-degradation.test.ts 已覆盖 emit 异常降级。 |
| 10 | 仍 open | filterExcluded 冗余调用，无害。 |

## 全量代码审查（v3 diff）

### spec 合规检查

| Spec 要求 | 状态 | 说明 |
|-----------|------|------|
| FR1 三层架构 | ✅ | L1 预计算（resolveMapping→IR→OF→allowed_models）在循环前；L2 pipeline emit 在循环内；L3 循环控制壳 |
| FR2 Pipeline 驱动 L2 | ✅ | post_route → pre_transport → post_response emit 序列完整 |
| FR3 核心步骤 hook | ✅ | 6 个新 hook 注册且执行（route-resolve, format-transform, api-key-decrypt, transport-execute, stream-timeout, usage-record） |
| FR4 消除内联重复 | ✅ | applyPluginAdjustments/resolveUpstreamPath/buildTransportFn/applyProviderPatches 已从 failover-loop 移除 |
| FR5 PipelineContext 字段 | ✅ | ctx.resolved/provider/effectiveApiType/effectiveUpstreamPath/transportResult/resilienceResult 等字段由对应 hook 写入 |
| FR6 on_error 接入 | ✅ | unknown error catch emit on_error；Semaphore 错误不 emit（避免双重） |
| FR7 on_stream_event 就绪 | ✅ | 不在 scope 内，注册/查询机制完整 |
| AC1 pipeline 全量接管 | ✅ | post_route, pre_transport, post_response, on_error 四个 phase 均通过 emit 触发 |
| AC2 failover-loop 体积 | ⚠️ | 366 行 / 27 imports，超过 spec ≤250 行目标。但核心 L2 逻辑已迁移，剩余是 L1+L3+inline 日志补偿 |
| AC3 已有 hook 激活 | ✅ | overflow-redirect, provider-patches, request-logging 通过 emit 触发执行 |
| AC4 核心 hook 可执行 | ✅ | 6 个内置 hook 注册且有对应 execute 逻辑 |
| AC5 功能等价 | ✅ | 1492/1492 测试通过 |
| AC6 日志指标等价 | ✅ | logResilienceResult/collectTransportMetrics/insertRejectedLog 调用路径正确 |
| AC7 现有测试通过 | ✅ | 1492/1492, 0 tsc, 0 eslint |
| AC8 pipeline 扩展 | ✅ | priority 排序正确（format-transform 0 → api-key-decrypt 1 → provider-patches 100 → plugin-request 250 → transport-execute 300） |
| Constraint 8 Hook 异常降级 | ✅ | PipelineAbort 直接 throw；core hook (priority < 100 或 core=true) 异常传播；非核心 hook 降级 |

### 新增文件质量

| Hook | 代码质量 | 备注 |
|------|---------|------|
| route-resolve.ts | ✅ | 清晰的 target 选择 + provider 查询 + is_active 校验，PipelineAbort 短路 |
| format-transform.ts | ✅ | needsTransform 检测 + transformRequest + upstream_path 优先级 |
| api-key-decrypt.ts | ✅ | encryption_key 缺失→PipelineAbort，Map 缓存 |
| transport-execute.ts | ✅ | 完整的 adapter/stream/response transform + buildTransportFn + orchestrator.handle + plugin 响应链 |
| stream-timeout.ts | ✅ | stream_abort 检测 + SSE error event |
| usage-record.ts | ✅ | succeeded 判断 + recordRequest |

### pipeline.ts 异常降级

PipelineAbort → 直接 throw ✅
core hook (priority < 100 或 core=true) → 直接 throw ✅
非核心 hook → catch + log.error + continue ✅

与 plan Task 1 设计完全一致。

### create-proxy-handler.ts: registerBuiltinHooks()

`registerBuiltinHooks()` 同时在 `index.ts`（buildApp）和 `create-proxy-handler.ts`（每个 plugin callback）中调用。`proxyPipeline.register()` 按名称去重，幂等安全。✅

### plugin-request.ts / provider-patches.ts: body mutation guard

新增 `if (patchedBody !== body)` / `if (pluginCtx.body !== body)` 守卫，避免不必要的 key-by-key 拷贝。✅

### Semaphore catch: e.providerId

使用 `e.providerId`（从错误对象获取）替代旧代码的 `provider.id`（从局部变量获取）。`SemaphoreQueueFullError` 和 `SemaphoreTimeoutError` 均在构造函数中声明 `public readonly providerId: string`，编译通过（0 tsc 错误已验证）。✅

## 发现的新问题

### Issue #12 (LOW): flushToolErrors 闭包未置空 pendingToolErrors

**位置**：failover-loop.ts while 循环内的 flushToolErrors 闭包

**问题描述**：

```typescript
const flushToolErrors = (pId: string, model: string) => {
  if (!pendingToolErrors) return;
  logToolErrors(pendingToolErrors, { ... });
  // 注意：缺少 pendingToolErrors = null;
};
```

原始代码在 flush 后执行 `pendingToolErrors = null` 防止重复写入。v3 重写后缺失此语句。

在 failover 场景中：
1. Iteration 1: ProviderSwitchNeeded → flushToolErrors → 日志写入 → continue
2. Iteration 2: 成功 → flushToolErrors → 同一组 tool errors 再次写入（不同 logId）

同一批 tool errors 在 `tool_error_logs` 表中被记录多次，干扰诊断。

**影响范围**：仅影响 failover 场景的 tool error 诊断日志重复，不影响请求处理正确性。

**修改建议**：在 `logToolErrors(...)` 后添加 `pendingToolErrors = null;`

### Issue #13 (LOW): ProviderSwitchNeeded catch 使用 emit 前 snapshot

**位置**：failover-loop.ts ProviderSwitchNeeded catch 块

**问题描述**：

```typescript
const snapshot = ctx.snapshot.toJSON(); // 在 emit 前捕获
// ...
try {
  await proxyPipeline.emit("post_route", ctx);
  ctx.snapshot.add({ stage: "routing", ... }); // emit 后添加
  await proxyPipeline.emit("pre_transport", ctx); // hooks 可能继续添加
  // ...
} catch (ProviderSwitchNeeded) {
  logResilienceResult(db, { pipelineSnapshot: snapshot, ... }); // 用的是 emit 前的快照
}
```

`snapshot` 在任何 emit 之前捕获，不含 routing 阶段和 hook 添加的阶段。原始代码在所有 inline 阶段完成后捕获 `pipelineSnapshot`。

**影响范围**：ProviderSwitchNeeded 错误日志中的 pipeline_snapshot 不完整（缺少 routing 和 provider_patch 阶段信息），降低错误诊断的完整性。

**修改建议**：在 ProviderSwitchNeeded catch 中使用 `ctx.snapshot.toJSON()` 替代 `snapshot` 变量。

## 架构合规检查

- **分层正确**：hook 不跨层调用。route-resolve（post_route）→ format-transform/api-key-decrypt（pre_transport）→ transport-execute（pre_transport）→ stream-timeout/usage-record（post_response）
- **依赖方向正确**：hook 通过 ctx.metadata 接收依赖，不直接 import 业务层
- **Hook 注册验证**：6 个新 hook 注册到 ALL_HOOKS 数组，registerBuiltinHooks() 调用 proxyPipeline.register()
- **Hook 注册与执行一致**：registerBuiltinHooks() 同时注册到 hookRegistry（查询用）和 proxyPipeline（执行用）

## 安全和性能检查

- **无安全漏洞**：API key 解密在 api-key-decrypt hook 中，encryption_key 缺失时 PipelineAbort（503）
- **无性能退化**：pipeline emit 是同步 Map lookup + 顺序执行，无额外异步调度
- **metadata 传递合理**：L1 预计算结果通过 ctx.metadata 传入 L2，避免重复计算

## 集成验证

### Hook 注册 → emit 路径验证

| Hook | 注册目标 | emit 调用位置 | 验证 |
|------|---------|-------------|------|
| route-resolve | proxyPipeline (post_route/0) | failover-loop.ts `emit("post_route")` | ✅ |
| format-transform | proxyPipeline (pre_transport/0) | failover-loop.ts `emit("pre_transport")` | ✅ |
| api-key-decrypt | proxyPipeline (pre_transport/1) | failover-loop.ts `emit("pre_transport")` | ✅ |
| transport-execute | proxyPipeline (pre_transport/300) | failover-loop.ts `emit("pre_transport")` | ✅ |
| stream-timeout | proxyPipeline (post_response/110) | failover-loop.ts `emit("post_response")` | ✅ |
| usage-record | proxyPipeline (post_response/120) | failover-loop.ts `emit("post_response")` | ✅ |
| error-logging | proxyPipeline (on_error/900) | failover-loop.ts `emit("on_error")` | ✅ |

### 数据消费者完整性

| 数据字段 | 写入者 | 消费者 | 验证 |
|---------|--------|--------|------|
| ctx.resolved | route-resolve | format-transform, transport-execute, failover-loop L3 | ✅ |
| ctx.provider | route-resolve | api-key-decrypt, transport-execute, failover-loop L3, error-logging | ✅ |
| ctx.effectiveApiType | format-transform | transport-execute | ✅ |
| ctx.effectiveUpstreamPath | format-transform | transport-execute | ✅ |
| ctx.metadata.apiKey | api-key-decrypt | transport-execute | ✅ |
| ctx.resilienceResult | transport-execute | stream-timeout, usage-record, failover-loop L3 | ✅ |
| ctx.metadata.errorInfo | failover-loop catch | error-logging | ✅ |

## 结论

**通过。** v2 的唯一 MUST FIX（Issue #11: unknown error 双重日志）已正确修复。metadata key 从 `"error"` 改为 `"errorInfo"` 匹配 errorLoggingHook 的读取；inline insertRequestLog 和 flushToolErrors 已从 unknown error catch 移除；Semaphore 错误不 emit on_error 避免双重日志。新发现 2 条 LOW 问题（tool errors failover 场景重复写入、ProviderSwitchNeeded snapshot 不完整），不影响功能正确性。

### Summary

编码评审完成，第3轮（最终轮）通过，0条 MUST FIX（v2 的 1 条 MUST FIX 已修复），2条新 LOW。
