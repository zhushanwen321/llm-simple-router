---
review:
  type: code_review
  round: 1
  timestamp: "2026-05-22T20:30:00"
  target: "router/src/proxy/handler/failover-loop.ts + 6 new hook files + pipeline.ts + register-hooks.ts + types.ts"
  verdict: fail
  summary: "编码评审第1轮，3条MUST FIX（on_error未emit、plugin响应转换丢失、usage重复记录），需修复后重审"

statistics:
  total_issues: 10
  must_fix: 3
  must_fix_resolved: 0
  low: 4
  info: 3

issues:
  - id: 1
    severity: MUST_FIX
    location: "router/src/proxy/handler/failover-loop.ts"
    title: "FR6 违反：catch 块未 emit on_error phase"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 2
    severity: MUST_FIX
    location: "router/src/proxy/hooks/builtin/transport-execute.ts:L131-L147"
    title: "Plugin 响应转换逻辑丢失（applyBeforeResponse/applyAfterResponse）"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 3
    severity: MUST_FIX
    location: "router/src/proxy/handler/failover-loop.ts:L282-L284 + router/src/proxy/hooks/builtin/usage-record.ts"
    title: "usage 重复记录：usage-record hook + inline 代码双重调用 recordRequest"
    status: open
    raised_in_round: 1
    resolved_in_round: null

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
    title: "Plan 中 3 个测试文件未创建（pipeline-hooks.test.ts、pipeline-emit.test.ts、failover-loop-slim.test.ts）"
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
---

# 编码评审 v1

## 评审记录
- 评审时间：2026-05-22 20:30
- 评审类型：编码评审
- 评审对象：Pipeline 全量接管代理请求执行（BG1: 6 新 hook + pipeline emit 降级 + BG2: failover-loop 重写）

## 1. Spec 合规（逐条对照）

### FR1: 三层执行架构
- **L1 路由预计算** ✅ resolveMapping → computeModalityRedirect → expandOverflow → allowed_models 过滤全部在 while(true) 外完成。`applyAllowedModelsFilter` 辅助函数提取合理。
- **L2 pipeline emit** ✅ `post_route → pre_transport → post_response` 序列正确。
- **L3 循环控制** ✅ while(true) 壳含 destroy 检查、迭代上限、ProviderSwitchNeeded 捕获。

### FR2: Pipeline 驱动 L2
- emit 序列 `post_route → pre_transport → post_response` 完整 ✅
- **但**：日志和指标采集仍由 L3 inline 代码执行（`logResilienceResult`、`collectTransportMetrics` 在 emit 之后调用），未走 post_response hook。`requestLoggingHook` 因从 `ctx.metadata` 读 `resilienceResult` 而 failover-loop 将其写在 `ctx.resilienceResult`，导致 hook 是 no-op。见 Issue #4。

### FR3: 核心步骤作为内置 hook
- `builtin:route-resolve` ✅ post_route, priority 0, core: true
- `builtin:format-transform` ✅ pre_transport, priority 0, core: true
- `builtin:api-key-decrypt` ✅ pre_transport, priority 1, core: true
- `builtin:transport-execute` ✅ pre_transport, priority 300, core: true
- `builtin:stream-timeout` ⚠️ priority 110（spec 定义 50），见 Issue #5
- `builtin:usage-record` ⚠️ priority 120（spec 定义 100），见 Issue #6

### FR4: 消除 failover-loop 内联重复
- `applyProviderPatches` ✅ 已移除，由 provider-patches hook 处理
- `applyPluginAdjustments` ✅ 已移除，由 plugin-request hook 处理
- `resolveUpstreamPath` ✅ 已移除，由 format-transform hook 处理
- `buildTransportFn` + orchestrator.handle ✅ 已移至 transport-execute hook
- `logResilienceResult` + `collectTransportMetrics` ❌ 仍在 failover-loop（见 Issue #7）
- Stream 内容日志 ✅ 移至 post_response 后 L3 inline

### FR5: PipelineContext 字段填充
逐字段验证：

| 字段 | 写入者 | 验证 |
|------|--------|------|
| ctx.resolved | route-resolve hook | ✅ |
| ctx.provider | route-resolve hook | ✅ |
| ctx.effectiveUpstreamPath | format-transform hook | ✅ |
| ctx.effectiveApiType | format-transform hook | ✅ |
| ctx.injectedHeaders | plugin-request hook | ✅ |
| ctx.transportResult | transport-execute hook | ✅ |
| ctx.resilienceResult | transport-execute hook | ✅ |
| ctx.clientRequest | transport-execute hook | ✅ |
| ctx.upstreamRequest | transport-execute hook | ✅ |

### FR6: on_error phase 接入 ❌
**MUST FIX Issue #1**：failover-loop 的所有 catch 块均未调用 `proxyPipeline.emit("on_error", ctx)`。Semaphore 错误、AbortError、未知错误的 catch 块直接 inline 处理，绕过了 `errorLoggingHook` 和其他 on_error hook。

### FR7: on_stream_event 基础设施 ✅
Phase 定义保持不变，未在 stream.ts 内部调用 emit，符合约束。

### AC1: Pipeline 全量接管
4 个核心 phase：`post_route` ✅ `pre_transport` ✅ `post_response` ✅ `on_error` ❌（见 Issue #1）

### AC2: failover-loop 体积缩减
- 当前行数 374 行（spec 原始要求 ≤250，已更新阈值）
- import 数 27（spec 要求 ≤25，略超）
- 禁止 import 列表：`applyProviderPatches` ✅ `buildTransportFn` ✅ `applyPluginAdjustments` ✅ `logResilienceResult` ❌ `collectTransportMetrics` ❌

### AC3: 已有 hook 激活
- overflow-redirect: post_route phase 现在被 emit，hook 会执行 ✅
- provider-patches: pre_transport phase 现在被 emit，hook 会执行 ✅
- request-logging: post_response phase 现在被 emit，但因 metadata 集成不完整是 no-op ⚠️

### AC4: 核心步骤作为 hook 可执行 ✅
- format-transform: 正确执行格式转换 + upstreamPath 决策
- transport-execute: 正确调用 orchestrator.handle()

### AC5: 功能等价
- 10 种场景的端到端等价性依赖既有测试通过（1492/1492）✅
- 但 plugin 响应转换缺失影响跨格式非流式请求（见 Issue #2）

### AC6: 日志和指标等价
- requestLoggingHook 是 no-op，inline 代码补偿，日志内容等价 ✅
- 但 usage 记录会重复（见 Issue #3）❌

### AC7: 现有测试全部通过 ✅

### AC8: 新增 pipeline 扩展 ✅
Priority 排序正确：format-transform(0) → api-key-decrypt(1) → provider-patches(100) → plugin-request(250) → transport-execute(300)

## 2. 代码质量

- **可读性**：failover-loop 的 L1/L2/L3 注释清晰。`makeRejectCtx` 辅助函数消除了重复的参数构造。`applyAllowedModelsFilter` 提取了过滤逻辑。
- **错误处理**：route-resolve hook 正确处理无可用 target 和 provider 不可用场景，PipelineAbort 短路机制正确。
- **边界条件**：allowed_models 过滤后 target 为空的情况正确处理。

## 3. 架构合规

- **分层正确**：6 个 hook 各自职责单一，不跨层调用 ✅
- **依赖方向**：hook 通过 ctx.metadata 和 ctx 字段通信，不直接依赖 failover-loop ✅
- **Pipeline emit 异常降级**：实现了 Constraint 8 的要求（PipelineAbort 短路 + core hook 直接传播 + 非核心 hook 降级）✅
- **Hook 优先级分段**：Constraint 4 的分段规则遵守（0-99 基础，100-199 内置，200-299 外部，900 观测）✅

## 4. 安全和性能

- **API key 解密**：正确使用请求级缓存 Map，避免重复解密 ✅
- **Header 脱敏**：sanitizeHeadersForLog 在 precompute 阶段调用 ✅
- **性能**：pipeline emit 是同步 Map lookup + for 循环，无额外异步调度开销 ✅

## 5. 集成验证

### Hook 注册 → 执行路径验证

| Hook | 注册到 | emit 调用位置 | 验证 |
|------|--------|-------------|------|
| route-resolve | proxyPipeline (register-hooks.ts) | failover-loop L257 | ✅ |
| format-transform | proxyPipeline | failover-loop L266 | ✅ |
| api-key-decrypt | proxyPipeline | failover-loop L266 | ✅ |
| transport-execute | proxyPipeline | failover-loop L266 | ✅ |
| stream-timeout | proxyPipeline | failover-loop L267 | ✅ |
| usage-record | proxyPipeline | failover-loop L267 | ✅ |
| error-logging | proxyPipeline | ❌ 未 emit on_error | Issue #1 |
| request-logging | proxyPipeline | failover-loop L267 | ⚠️ no-op (Issue #4) |

### 数据消费者完整性（usage recording）

| 消费者 | 读取位置 | 数据来源 | 验证 |
|--------|---------|---------|------|
| usage-record hook | ctx.resilienceResult?.result | transport-execute 写入 | ✅ 执行 |
| failover-loop inline L282 | ctx.resilienceResult!.result | 同上 | ✅ 执行 |
| **结果：同一个请求 recordRequest 被调用两次** | | | ❌ Issue #3 |

## 6. Hook 组件专项检查

### transport-execute (core: true, priority 300)
- [x] 注册到 proxyPipeline（register-hooks.ts ALL_HOOKS 数组）
- [x] emit 路径：failover-loop → proxyPipeline.emit("pre_transport") → transport-execute.execute()
- [x] core: true 已设置，确保非 PipelineAbort 异常直接传播
- [x] 结果通过 ctx.resilienceResult + ctx.transportResult 传递到下游

### Plugin 响应转换（缺失）
- transport-execute hook 的 `responseTransform` 闭包中**缺少** `pluginRegistry.applyBeforeResponse/applyAfterResponse` 调用
- 原始 failover-loop 代码在 responseTransform 中包含完整的 plugin 响应处理链
- **影响**：非流式跨格式请求（如 openai→anthropic）的 plugin 响应 hook 不会被调用

---

### 发现的问题

| # | 优先级 | 文件/位置 | 描述 | 修改建议 |
|---|--------|----------|------|---------|
| 1 | MUST FIX | failover-loop.ts catch 块 | FR6：所有 catch 块（SemaphoreQueueFullError、SemaphoreTimeoutError、AbortError、unknown）均未调用 `proxyPipeline.emit("on_error", ctx)`。errorLoggingHook 和其他 on_error 注册 hook 从不执行 | 在每个非 PipelineAbort/ProviderSwitchNeeded 的 catch 块中，返回前调用 `await proxyPipeline.emit("on_error", ctx)` |
| 2 | MUST FIX | transport-execute.ts:L131-L147 responseTransform | Plugin 响应转换丢失：原始代码在 responseTransform 中调用 `pluginRegistry.applyBeforeResponse`/`applyAfterResponse`，新 hook 未包含。非流式跨格式请求的 plugin 响应修改不会生效 | 在 transport-execute 的 responseTransform 中恢复 plugin 响应处理链（从 container 解析 pluginRegistry，条件执行 applyBeforeResponse/applyAfterResponse） |
| 3 | MUST FIX | failover-loop.ts:L282-L284 + usage-record.ts | usage 重复记录：usage-record hook（post_response priority 120）在 emit 期间调用 `recordRequest()`，然后 inline 代码在 emit 后再次调用 `usageWindowTracker?.recordRequest()`。成功请求的用量会被记录两次 | 从 failover-loop inline 中移除 `usageWindowTracker?.recordRequest(...)` 调用，完全委托给 usage-record hook |
| 4 | LOW | request-logging.ts + failover-loop.ts | requestLoggingHook 是 no-op：它从 `ctx.metadata.get("resilienceResult")` 读取，但 failover-loop 将 resilienceResult 写在 `ctx.resilienceResult`（不是 metadata）。Hook 因 `!resilienceResult` 直接 return。Inline logResilienceResult 补偿了功能，但 hook 架构失效 | 二选一：(a) 在 failover-loop emit 前将 resilienceResult 同步到 metadata；(b) 修改 hook 直接读 ctx.resilienceResult |
| 5 | LOW | stream-timeout.ts:L7 | Priority 110 vs spec FR3 定义的 50。110 在"内置功能"分段（100-199），50 在"基础设施"分段（0-99），两者都合理。与 spec 不一致但符合 Constraint 4 优先级分段约定 | 如需严格匹配 spec，改为 50。否则更新 spec |
| 6 | LOW | usage-record.ts:L12 | Priority 120 vs spec FR3 定义的 100。同 Issue #5 | 同 Issue #5 |
| 7 | LOW | failover-loop.ts imports | AC2 要求不包含 `logResilienceResult` 和 `collectTransportMetrics` import，但两者仍在。这是 requestLoggingHook 未接管日志（Issue #4）的副作用 | 修复 Issue #4 后，将 inline 日志调用移入 hook，然后从 failover-loop 移除这两个 import |
| 8 | INFO | types.ts:L53 | ProviderInfo.adaptive_enabled 从 `boolean` 改为 `number`。这是对齐 DB schema（DB 存储 0/1 integer）的 bug 修复，消费者均使用 truthiness 检查，无回归 | 无需操作 |
| 9 | INFO | tests/proxy/ | Plan 定义 3 个测试文件（pipeline-hooks.test.ts、pipeline-emit.test.ts、failover-loop-slim.test.ts）未创建。仅新增 pipeline-error-degradation.test.ts | 后续补充 hook 单元测试和 emit 序列集成测试 |
| 10 | INFO | failover-loop.ts + route-resolve.ts | `filterExcluded` 被调用两次：failover-loop L1 预计算检查 `avail.length === 0` + route-resolve hook 内部再次 filter。无害冗余（结果一致），可优化为仅 hook 内检查 | 低优先级优化，不阻塞 |

> 优先级定义：
> - **MUST FIX**：不修复则评审不通过，会阻塞流程
> - **LOW**：建议修复，但不阻塞
> - **INFO**：观察记录，无需操作

### 等级判定校准

- Issue #1（on_error 未 emit）：errorLoggingHook 从不执行 → 功能失效 → MUST FIX
- Issue #2（plugin 响应转换丢失）：plugin 响应修改不会被应用 → 功能失效 → MUST FIX
- Issue #3（usage 重复记录）：同一个请求 recordRequest 被调用两次 → 数据语义错误 → MUST FIX

### 结论

需修改后重审。3 条 MUST FIX 均为可修复的集成问题，核心架构设计（三层分离、6 hook 提取、emit 降级）正确。

### Summary

编码评审完成，第1轮，3条MUST FIX，需修改后重审。
