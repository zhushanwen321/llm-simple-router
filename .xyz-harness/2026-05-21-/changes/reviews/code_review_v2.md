---
review:
  type: code_review
  round: 2
  timestamp: "2026-05-22T22:00:00"
  target: "router/src/proxy/handler/failover-loop.ts + 6 new hook files + pipeline.ts + register-hooks.ts + types.ts + transport-execute.ts"
  verdict: fail
  summary: "编码评审第2轮，1条MUST FIX（unknown error catch 中 on_error emit 导致双重日志记录），v1 的 MF2/MF3 已修复"

statistics:
  total_issues: 11
  must_fix: 1
  must_fix_resolved: 2
  low: 5
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
    location: "router/src/proxy/handler/failover-loop.ts:L282-L284 + router/src/proxy/hooks/builtin/usage-record.ts"
    title: "usage 重复记录：usage-record hook + inline 代码双重调用 recordRequest"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2

  - id: 4
    severity: LOW
    location: "router/src/proxy/hooks/builtin/request-logging.ts + router/src/proxy/handler/failover-loop.ts"
    title: "requestLoggingHook 是 no-op（读 ctx.metadata 但 resilienceResult 写在 ctx 上），inline 代码补偿"
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
    title: "AC2：logResilienceResult/collectTransportMetrics 仍在 failover-loop import 中"
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
    title: "Plan 中 2 个测试文件未创建（pipeline-hooks.test.ts、pipeline-emit.test.ts）"
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
    status: open
    raised_in_round: 2
    resolved_in_round: null
---

# 编码评审 v2

## 评审记录
- 评审时间：2026-05-22 22:00
- 评审类型：编码评审
- 评审对象：Pipeline 全量接管代理请求执行（v1 MUST FIX 修复验证 + 新增变更审查）

## v1 MUST FIX 修复验证

### Issue #1 (MF): catch 块未 emit on_error → **已修复**

修复方案采用差异化策略：
- **Unknown error catch**: 新增 `await proxyPipeline.emit("on_error", ctx)` ✅
- **SemaphoreQueueFullError/SemaphoreTimeoutError catch**: 不 emit on_error，由 `rejectAndReply→insertRejectedLog` 处理日志 ✅ 合理，避免与 errorLoggingHook 双重插入
- **AbortError catch**: 不 emit（客户端断连，无需日志）✅
- **PipelineAbort catch**: 不 emit（设计预期的短路）✅
- **ProviderSwitchNeeded catch**: 不 emit（触发 failover，不是错误）✅

Semaphore 错误不 emit on_error 的决策是合理的——`rejectAndReply` 已经通过 `insertRejectedLog` 处理了日志，再 emit on_error 会导致 errorLoggingHook 再次调用 `insertRequestLog`（因为 errorLoggingHook 在 `errorInfo` 未设置时走 else 分支），造成双重日志。当前策略是正确的。

**但**：unknown error 路径引入了新的双重日志问题 → Issue #11。

### Issue #2 (MF): Plugin 响应转换丢失 → **已修复**

transport-execute.ts 的 `responseTransform` 闭包中已恢复完整的 plugin 响应处理链：

```typescript
const pluginRegistry = container.resolve<PluginRegistry>(SERVICE_KEYS.pluginRegistry);
if (pluginRegistry && !isStream) {
  try {
    const respCtx: ResponseTransformContext = { ... };
    pluginRegistry.applyBeforeResponse(respCtx);
    pluginRegistry.applyAfterResponse(respCtx);
    transformed = respCtx.response;
  } catch (pluginErr) {
    ctx.request.log.debug({ err: pluginErr }, "plugin response hook failed");
  }
}
```

与原始 failover-loop 代码逻辑等价，包含 best-effort catch 保护。✅

### Issue #3 (MF): usage 重复记录 → **已修复**

failover-loop.ts 中的 inline `usageWindowTracker?.recordRequest()` 调用已删除。usage-record hook 是唯一的 recordRequest 调用者。✅

## v1 LOW/INFO 状态更新

| # | 状态 | 说明 |
|---|------|------|
| 4 | 仍 open | requestLoggingHook 仍读 `ctx.metadata.get("resilienceResult")`，transport-execute 写 `ctx.resilienceResult`，hook 是 no-op。Inline 代码补偿功能正常。 |
| 5 | 仍 open | stream-timeout priority 110，spec FR3 定义 50。符合 Constraint 4 分段规则（100-199 = 内置功能）。 |
| 6 | 仍 open | usage-record priority 120，spec FR3 定义 100。同 Issue #5。 |
| 7 | 仍 open | logResilienceResult/collectTransportMetrics 仍在 failover-loop import 中。Issue #4 的连带问题。 |
| 8 | 仍 open | adaptive_enabled boolean→number 类型修正，对齐 DB schema。 |
| 9 | 仍 open | pipeline-hooks.test.ts、pipeline-emit.test.ts 未创建。新增 pipeline-error-degradation.test.ts ✅ |
| 10 | 仍 open | filterExcluded 冗余调用，无害。 |

## 新增变更审查

### create-proxy-handler.ts: registerBuiltinHooks() 调用位置

`registerBuiltinHooks()` 同时在 `index.ts`（buildApp 时调用一次）和 `create-proxy-handler.ts`（每个 plugin callback 调用）中被调用。`proxyPipeline.register()` 按名称去重（幂等），重复调用安全。注释"幂等，重复调用不会重复注册"与实现一致。✅

### pipeline.ts: emit 异常降级

PipelineAbort 直接 throw → core hook (priority < 100 或 core=true) 直接 throw → 非核心 hook catch + log.error + continue。与 plan Task 1 设计一致。✅

### plugin-request.ts / provider-patches.ts: body mutation guard

新增 `if (patchedBody !== body)` / `if (pluginCtx.body !== body)` 守卫，避免 body 未变更时的不必要的 key-by-key 拷贝。逻辑正确。✅

### types.ts: core 字段 + adaptive_enabled 类型

- `PipelineHook.core?: boolean` 字段新增，用于标记核心 hook 异常不可降级。transport-execute (priority 300, core: true) 因此获得正确的异常传播行为。✅
- `ProviderInfo.adaptive_enabled: number` 类型修正，对齐 DB schema（integer 0/1）。消费者均使用 truthiness 检查，无回归。✅

### 6 个新 hook 文件

逐个验证：

| Hook | Phase/Priority | core | 验证 |
|------|---------------|------|------|
| route-resolve | post_route/0 | true | ✅ 从 cachedTargets 选 target、查 provider、校验 is_active、PipelineAbort 短路 |
| format-transform | pre_transport/0 | true | ✅ needsTransform 检测 + transformRequest + upstream_path 优先级 |
| api-key-decrypt | pre_transport/1 | true | ✅ encryption_key 缺失→PipelineAbort、Map 缓存、metadata 写入 |
| transport-execute | pre_transport/300 | true | ✅ adapter.beforeSendProxy + stream/response transform + buildTransportFn + orchestrator.handle + plugin 响应链 |
| stream-timeout | post_response/110 | - | ✅ stream_abort 检测 + SSE error event 写入 + client disconnect 保护 |
| usage-record | post_response/120 | - | ✅ succeeded 判断 + recordRequest 调用 |

## 发现的新问题

### Issue #11 (MUST FIX): unknown error 路径双重日志

**位置**：failover-loop.ts unknown error catch 块 + errorLoggingHook

**问题描述**：

unknown error catch 块的执行序列：

1. `ctx.metadata.set("error", e)` — 设置 metadata key 为 `"error"`
2. `await proxyPipeline.emit("on_error", ctx)` — 触发 errorLoggingHook
3. errorLoggingHook 读取 `ctx.metadata.get("errorInfo")` → `undefined`（key 不匹配）
4. errorLoggingHook 走 else 分支，调用 `insertRequestLog(db, { id: ctx.logId, error_message: "Upstream connection failed", ... })` — 插入第一条日志
5. errorLoggingHook 还 flush 了 `pendingToolErrors` 并从 metadata 中删除
6. 回到 failover-loop，inline 代码再次调用 `insertRequestLog(db, { id: logId, error_message: errMsg, ... })` — 插入第二条日志（相同 logId）
7. inline `flushToolErrors()` 再次 flush 相同的 tool errors（读 closure 变量，非 metadata）

**影响**：
- **request_logs 双重插入**：同一 logId 被插入两次。若 id 是 PRIMARY KEY，第二次 insert 抛 unique constraint violation，导致后续 `return reply.code(err.statusCode).send(err.body)` 永远无法执行，客户端收到 Fastify 默认 500 而非正确的上游错误响应
- **tool errors 双重 flush**：errorLoggingHook 从 metadata 删除后，failover-loop 的 closure 变量仍持有引用，相同 tool errors 被写入两次
- **数据质量**：即使 DB 允许重复 id，两条日志的错误消息不同（"Upstream connection failed" vs 实际错误信息），干扰问题排查

**根因**：
1. failover-loop 设置 `"error"` 但 errorLoggingHook 读 `"errorInfo"`（key 不匹配）
2. emit on_error 后 inline 日志代码未移除，两者对同一错误各自插入日志

**修改建议**（二选一）：

**方案 A（推荐）**：让 errorLoggingHook 接管 unknown error 日志，移除 inline 代码：
- 在 emit 前设置 `ctx.metadata.set("errorInfo", { statusCode: 502, errorMessage: errMsg, providerId: ctx.provider?.id })`
- 移除 inline `insertRequestLog` 调用
- 移除 inline `flushToolErrors` 调用（errorLoggingHook 已处理）

**方案 B**：不 emit on_error for unknown errors（与 Semaphore 错误策略一致）：
- 移除 `await proxyPipeline.emit("on_error", ctx)` 调用
- 保持 inline 日志代码不变

## 其他观察

### AC2 验证（failover-loop 体积）

failover-loop.ts 经 v2 修复后仍保留 `logResilienceResult`/`collectTransportMetrics` inline 调用（Issue #4/#7 连带）。行数约 300 行，超过 spec AC2 要求的 ≤250 行。但核心 L2 逻辑（格式转换、transport 构建、plugin 调整、provider patches、API key 解密）已全部迁移到 hook。剩余的 inline 代码是日志和指标采集（因 requestLoggingHook 是 no-op 而保留），可在后续迭代中解决。

### 功能等价性

1492/1492 测试通过。但 unknown error 路径的双重日志可能在特定条件下（request_logs.id 有 PK 约束时）导致第二次 insert 失败，使客户端收到非预期响应。这不是测试覆盖的路径（mock 后端不会产生 unknown error），但生产环境会触发。

### 结论

需修改后重审。v1 的 3 条 MUST FIX 中 2 条已正确修复（MF2 plugin 响应、MF3 usage 重复）。MF1 (on_error emit) 修复引入了新的双重日志问题（Issue #11），需要决定是让 errorLoggingHook 完全接管错误日志（推荐），还是回退 to 不 emit on_error for unknown errors。

### Summary

编码评审完成，第2轮，1条MUST FIX（unknown error 双重日志），需修复后重审。
