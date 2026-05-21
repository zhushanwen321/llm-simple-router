---
verdict: pass
---

# Pipeline 全量接管代理请求执行

## Background

### 现状

`failover-loop.ts`（~612 行，41 个 import）是实际执行引擎。它将路由决策、格式转换、transport 构建、日志记录、指标采集、failover 循环控制全部内联在一个函数中。

Pipeline hook 系统已建立基础设施（`ProxyPipeline`、`PipelineContext`、9 个内置 hook），但只有 `pre_route` 阶段被 emit。其余 5 个 phase（`post_route`、`pre_transport`、`post_response`、`on_error`、`on_stream_event`）的逻辑全部内联在 failover-loop 中，4 个已注册 hook 成为死代码。

ADR 0005 定义了 Pipeline Hook 可扩展架构，并明确 "Failover 循环包裹 Pipeline 外层"。当前代码未实现这个设计。

### 为什么要做

1. **新功能扩展困难**：添加任何代理行为（新的 redirect 策略、请求修改、日志增强）都需要修改 failover-loop.ts 这个 612 行的 god function
2. **两套模式并存**：开发者必须同时理解 pipeline hook 和 failover-loop 内联逻辑，认知负担高
3. **已有 hook 是死代码**：4 个 hook 已注册、已测试、但从不执行

## Functional Requirements

### FR1: 三层执行架构

将 failover-loop 的职责拆为三个层次：

| 层次 | 职责 | 执行次数 | 位置 |
|------|------|---------|------|
| **L1 路由预计算** | resolveMapping → 候选 target 列表；computeModalityRedirect → 可能 prepend fallback；expandOverflow → overflow 扩展；allowed_models 过滤。输出: `Target[]` + `overflowIndices` | 整个请求 1 次 | pipeline 外，failover 循环前 |
| **L2 pipeline 单次执行** | 从候选列表选 target → 格式转换 → patches → transport → 日志/指标 | 每个 target 1 次 | pipeline emit 序列 |
| **L3 循环控制** | excludeTargets 管理 + ProviderSwitchNeeded 捕获 + 迭代上限 + socket destroy 检查 | 循环直到成功或耗尽 | pipeline 外，failover 循环壳 |

**L1 与 L2 的边界**：L1 输出候选 target 列表（含 overflow 扩展和 allowed_models 过滤后的结果），不做单 target 选择。L2 的 `builtin:route-resolve` hook 从候选列表中取第一个非 excluded 的 target，查 provider，校验 active 状态，写入 ctx.resolved + ctx.provider。

### FR2: Pipeline 驱动 L2 单次执行

failover 循环的每次迭代通过 pipeline emit 序列执行：

```
emit("post_route")    → 设置 resolved + provider，校验 (allowed-models, overflow)
emit("pre_transport") → 修改 body/headers (format-transform, plugin-request, provider-patches)
[核心] orchestrator.handle(transportFn)
emit("post_response") → 日志 + 指标 (request-logging, cache-estimation)
```

格式转换（`resolveUpstreamPath`）和 transport 构建（`buildTransportFn`）实现为内置 hook（`pre_transport` phase，高优先级），可被外部插件观察/增强，核心行为由系统保证。

### FR3: 核心步骤作为内置 hook

以下当前内联在 failover-loop 中的逻辑提取为内置 hook：

| Hook Name | Phase | Priority | 职责 |
|-----------|-------|----------|------|
| `builtin:route-resolve` | `post_route` | 0 | 从候选 target 列表（L1 输出，通过 ctx.metadata 传入）中取第一个非 excluded target，查 provider（getProviderById），校验 is_active，写入 ctx.resolved + ctx.provider。无可用 target 或 provider 不可用时抛出 PipelineAbort |
| `builtin:format-transform` | `pre_transport` | 0 | `resolveUpstreamPath()` — 格式转换 + upstreamPath 决策，写入 ctx.body + ctx.effectiveApiType + ctx.effectiveUpstreamPath |
| `builtin:api-key-decrypt` | `pre_transport` | 1 | API key 解密（带请求级缓存），写入 ctx.metadata |
| `builtin:transport-execute` | `pre_transport` | 300 | `buildTransportFn()` + `orchestrator.handle()`，写入 ctx.transportResult + ctx.resilienceResult。Priority 300 确保在 format-transform(0)、api-key-decrypt(1)、provider-patches(100)、plugin-request(250) 全部完成后再执行 |
| `builtin:stream-timeout` | `post_response` | 50 | stream_abort 场景的 SSE 错误事件写入 |
| `builtin:usage-record` | `post_response` | 100 | `usageWindowTracker.recordRequest()` |

### FR4: 消除 failover-loop 中的内联重复

迁移后，failover-loop.ts 只保留 L1（路由预计算）和 L3（循环控制），不再包含：
- 格式转换逻辑
- plugin adjustments 调用
- provider patches 调用
- API key 解密
- transport 构建和 orchestrator 调用
- 日志记录和指标采集
- stream 内容日志

### FR5: PipelineContext 字段填充

当前 failover-loop 使用局部变量而非 ctx 字段。迁移后，所有 hook 通过 PipelineContext 通信：

| 字段 | 写入者 | 消费者 |
|------|--------|--------|
| `ctx.resolved` | `builtin:route-resolve` | overflow-redirect, allowed-models, format-transform, transport-execute |
| `ctx.provider` | `builtin:route-resolve` | provider-patches, plugin-request, api-key-decrypt, transport-execute, request-logging |
| `ctx.effectiveUpstreamPath` | `builtin:format-transform` | transport-execute |
| `ctx.effectiveApiType` | `builtin:format-transform` | transport-execute |
| `ctx.injectedHeaders` | `builtin:plugin-request` | transport-execute |
| `ctx.transportResult` | `builtin:transport-execute` | request-logging, cache-estimation |
| `ctx.resilienceResult` | `builtin:transport-execute` | request-logging |
| `ctx.clientRequest` | `builtin:transport-execute` | request-logging |
| `ctx.upstreamRequest` | `builtin:transport-execute` | request-logging |

### FR6: on_error phase 接入

failover 循环的 catch 块通过 `emit("on_error", ctx)` 执行错误处理 hook，替代当前内联的 `insertRequestLog()` 和 `insertRejectedLog()` 调用。

### FR7: on_stream_event phase 基础设施就绪

`on_stream_event` phase 在 `types.ts` 中已定义，SSEEventTransform 解析事件后存入 ctx.metadata。本次迁移确保该 phase 的 hook 注册机制完整（已注册的 plugin bridge 动态 hook 可以被查询），但**不在 transport/stream.ts 内部调用 `emit("on_stream_event")`**——这需要改动 SSE 流式管线内部结构，作为独立迭代。

## Acceptance Criteria

### AC1: Pipeline 全量接管（4 个核心 phase）

**Given** 一个代理请求进入 `create-proxy-handler`
**When** 请求执行完成（无论成功或失败）
**Then** 以下 4 个 phase 都通过 `proxyPipeline.emit()` 被触发：`post_route`、`pre_transport`、`post_response`、`on_error`（异常时）

验证方式：在 `ProxyPipeline.emit()` 中添加调试日志，确认每个 phase 被调用。

注：`on_stream_event` 不在本次 AC 范围内（见 Constraint 7 和 Out of Scope）。

### AC2: failover-loop 体积缩减

**Given** 迁移完成
**Then** `failover-loop.ts` 行数 ≤ 250 行，import 数 ≤ 25
**And** 文件不包含以下 import：`applyProviderPatches`、`logResilienceResult`、`collectTransportMetrics`、`buildTransportFn`、`applyPluginAdjustments`

### AC3: 已有 hook 激活

**Given** 请求触发 `post_route` phase
**When** `overflow-redirect` hook 执行
**Then** 它的 `execute()` 方法被调用（可通过测试验证）

**Given** 请求触发 `pre_transport` phase
**When** `provider-patches` hook 执行
**Then** 它的 `execute()` 方法被调用

**Given** 请求成功完成
**When** `post_response` phase 触发
**Then** `request-logging` hook 执行日志记录和指标采集

### AC4: 核心步骤作为 hook 可执行

**Given** `builtin:format-transform` hook 注册在 `pre_transport` phase
**When** 一个 openai 请求被路由到 anthropic provider
**Then** hook 执行格式转换，ctx.body 被转换为 anthropic 格式，ctx.effectiveApiType 设为 "anthropic"

**Given** `builtin:transport-execute` hook 注册在 `pre_transport` phase
**When** 格式转换和 patches 完成
**Then** hook 构建 transportFn 并调用 orchestrator.handle()，结果写入 ctx.transportResult

### AC5: 功能等价 — 请求正确处理

**Given** 迁移完成
**When** 发送以下类型的请求：
1. OpenAI 非流式请求
2. OpenAI 流式请求
3. Anthropic 非流式请求
4. Anthropic 流式请求
5. 跨格式转换请求（openai → anthropic）
6. 触发 failover 的请求（第一个 target 失败）
7. 触发重试的请求（retry rule 匹配）
8. 触发溢出重定向的请求
9. 触发模态重定向的请求
10. 触发 allowed_models 拦截的请求

**Then** 响应与迁移前完全一致（status code、body、headers、SSE 数据流）

### AC6: 功能等价 — 日志和指标

**Given** 迁移完成
**When** 请求处理完成
**Then** `request_logs` 表中的记录与迁移前一致（字段完整性、mapping_reason、pipeline_snapshot、transport_kind）
**And** `request_metrics` 表中的 token 用量、TTFT、TPS 与迁移前一致

### AC7: 现有测试全部通过

**Given** 迁移完成
**When** 运行 `npm test`
**Then** 所有现有测试通过，无回归

### AC8: 新增 pipeline 扩展可工作

**Given** 一个外部 hook 注册到 `pre_transport` phase（priority 200）
**When** 请求经过 pipeline
**Then** 该 hook 在 `builtin:format-transform` (priority 0) 和 `builtin:provider-patches` (priority 100) 之后执行
**And** hook 可以修改 ctx.body 和 ctx.injectedHeaders

## Constraints

1. **Phase 定义不变**：保持当前 `types.ts` 中的 6 个 HookPhase 不变。不新增 phase，不重命名 phase
2. **ADR 0005 的 failover 外层决策**：Failover 循环包裹 Pipeline 外层，不在 Pipeline 内部
3. **向后兼容**：所有现有 API 行为不变。`request_logs` 表结构不变。Admin API 不变
4. **Hook 优先级分段**：0-99 基础设施，100-199 内置功能，200-299 外部插件，900-999 观测者
5. **核心 hook 不可被跳过**：`builtin:format-transform` 和 `builtin:transport-execute` 是系统骨架。外部插件可以观察/增强，但不能阻止它们执行。如果外部 hook 抛出 PipelineAbort，核心 hook 不执行（pipeline abort 是设计预期的短路机制）
6. **性能不退化**：pipeline emit 的开销（Map lookup + 顺序执行）不应导致可测量的延迟增加。hook 执行是同步调用链，无额外异步调度
7. **`on_stream_event` 暂不激活**：本次不修改 transport/stream.ts 内部来调用 `emit("on_stream_event")`。该 phase 的注册/查询机制保持完整，实际 emit 留作独立迭代
8. **Hook 异常降级**：非 PipelineAbort 异常的 hook 被 `ProxyPipeline.emit()` 内部 try-catch 捕获，记录错误日志后继续执行后续 hook（观测类 hook 不得因前序 hook 异常而跳过）。PipelineAbort 正常传播，触发短路。**核心 hook**（通过 `PipelineHook.core = true` 标记，或 priority < 100）的异常直接传播到 pipeline 执行器，因为它们是系统骨架，降级无意义。当前核心 hook 列表：`builtin:route-resolve`、`builtin:format-transform`、`builtin:api-key-decrypt`、`builtin:transport-execute`

## Out of Scope

1. **on_stream_event 深度集成**：本次不修改 transport/stream.ts 内部结构来激活 on_stream_event phase。如果需要改动 SSE 流式管线内部，作为独立迭代
2. **Plugin bridge 重构**：plugin-bridge.ts 的动态 hook 生成逻辑不变，只是现在这些 hook 能被实际执行
3. **Admin API 变更**：hook 列表查询、状态刷新等管理接口不变
4. **orchestrator 内部重构**：ProxyOrchestrator.handle() 的信号量/resilience/tracker 逻辑不变，只是调用入口从 failover-loop 改为 builtin:transport-execute hook
5. **新增 HookPhase**：不新增 phase
6. **scope.ts 删除**：scope.ts 的仪式化包装问题（架构审查 Candidate 5）不在本次范围内
7. **core/types.ts 拆分**：类型聚合问题（架构审查 Candidate 4）不在本次范围内
8. **DB 层反向依赖修复**：logs.ts 导入 proxy 层的问题（架构审查 Candidate 6）不在本次范围内

## Complexity Assessment

**复杂度：高**

- 修改文件数：~15 个（failover-loop.ts 大幅重写，新增 6 个 hook 文件，修改 pipeline/context.ts、register-hooks.ts、create-proxy-handler.ts）
- 风险区域：failover 循环的错误分类和处理、流式场景的 transport 结果传递、PipelineContext 字段填充时序
- 测试覆盖：需确保 10 种请求场景的端到端等价性（AC5）
- 不可并行：核心步骤有严格的依赖顺序（post_route → pre_transport → transport → post_response）
