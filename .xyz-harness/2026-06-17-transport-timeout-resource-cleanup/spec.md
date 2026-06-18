---
verdict: pass
---

# Transport 超时统一与资源泄漏修复

## Background

监控页面 kill 进行中请求后并发度不下降。排查发现 transport 层请求中断链路不完整，并由此暴露普遍的资源泄漏与超时覆盖缺口（详见 `clarification.md` 已知泄漏场景表）。本轮经独立 5 视角追踪又发现一批实现正确性与健壮性问题（loop_detection 路径泄漏、resilience 不感知 signal、req.setTimeout 不自动 destroy 等）。

## Functional Requirements

### FR-1: transport 接受 AbortSignal + signal 全链路透传

- `buildTransportFn` 返回的函数签名变更为 `(target, signal?) => Promise<TransportResult>`，`callStream`/`callNonStream`/`callGet` 均增加可选 `signal` 参数。
- signal abort 时 `upstreamReq.destroy(abortError)`（**必须带 error 参数**，否则不 emit `error` 事件，Promise 永挂），触发其 `error` 事件 → resolve → 释放槽位。
- orchestrator 把已有的 `controller.signal` 穿透 `resilience.execute` 边界传到 transport（signal 在 orchestrator 创建，需传入 fn 或 HandleContext）。
- **resilience 层 signal 短路**：`resilience.execute` 循环每次 attempt 前检查 `signal.aborted`，已 abort 则不再 retry/failover，避免客户端断连后消耗 retry 配额与上游计费。

### FR-10: 修复客户端断连检测链路（FR-1 的前提）

当前 `orchestrator.ts:100` 的自动 abort 守卫 `if (!request.raw.readableEnded)` 对 Fastify 已完整解析 body 的 POST 请求**永远为 false** → `controller.abort()` 永不执行。这导致 FR-1 整套客户端断连覆盖不成立（已有 bug）。

修复：在 orchestrator 统一监听 `reply.raw.on("close")`（客户端响应端断连），在响应未完成时 `controller.abort()`，移除对 POST 永远为 true 的 `readableEnded` 守卫。这是 FR-1、AC-3、AC-8 能生效的前提。

### FR-2: killRequest 同步释放信号量（幂等）

`killRequest` 强制 `complete()` 时对称地强制释放信号量槽位，不依赖 transport 异步结束。释放回调**必须幂等**：与 FR-1 的自然释放不可双重 release（否则 `semaphore.current` 多递减致超限）。用 request id 去重或检查 token 已释放状态。

### FR-3: upstreamReq 无活动超时（含 setTimeout+destroy 配套）

用 `upstreamReq.setTimeout(ms)` 覆盖「响应头到达前」阶段。**`setTimeout` 只触发 `timeout` 事件，不自动销毁请求**，必须配套 `req.on("timeout", () => req.destroy(timeoutError))`，destroy 后 emit `error` → resolve → 释放槽位。统一语义为**上游无活动超时**（socket 无数据传输即超时，有数据传输自动重置）。

### FR-4: 拆分流式/非流式超时配置

数据模型新增 `non_stream_timeout_ms`，与 `stream_timeout_ms` 对称：

| 字段 | 语义 | 默认值 | 适用 |
|------|------|--------|------|
| `stream_timeout_ms` | 流式 idle（chunk 间隔无活动） | 300000 (300s) | callStream 的 idleTimer + 响应头前 setTimeout |
| `non_stream_timeout_ms` | 非流式无活动超时 | 600000 (600s) | callNonStream 的 upstreamReq.setTimeout |

- `getModelStreamTimeout` 重构为 `getModelTimeouts(provider, model): {stream, nonStream}`（单函数返回对象，减少调用点改动）。
- `0` 表示禁用（`Infinity`），与现有约定一致。
- **默认值三处统一**：前端 `constants.ts`、后端 `db/providers.ts`、spec 均对齐（流式 300s）。现有前端 30s / 后端 600s 的不一致属 bug，本次顺带修复。
- 完整消费者矩阵见 `clarification.md`（≥9 处）。

### FR-5: 前端 UI — 超时配置提升到模型主行

`ModelCard` 主行新增流式/非流式两个超时输入框，置于补丁按钮左侧（形式 A）。移除补丁展开区内的单一超时输入框。默认值 `DEFAULT_STREAM_TIMEOUT_MS=300_000`、`DEFAULT_NON_STREAM_TIMEOUT_MS=600_000`。`0` 值显示文案为「禁用」。

### FR-6: StreamProxy cleanup 销毁 upstreamRes/upstreamReq

cleanup() 持有并 destroy `upstreamRes` 与 `upstreamReq` 引用，不仅依赖外部 signal。覆盖**所有内部终止路径**：loop_detection、EARLY_ERROR、onUpstreamError 等（这些不走 controller.abort，原方案漏掉导致上游继续吐数据计费泄漏）。

### FR-7: 健壮性修复

- `passThrough` 注册 error listener，防止 transform 报错后 pipe 链 `uncaughtException`。
- `idleTimer` 调 `.unref()`，与 `END_REPLY_TIMEOUT_MS` 一致，避免阻止 graceful shutdown。
- `scope.ts withSlot`：acquire 抛错时不应 `release(undefined)`（当前会致 `token.bypassed` TypeError）。
- `semaphore.release` 对 undefined/已释放 token 安全返回。
- **callStream 的 `statusCode !== 200` 早分支补 `upstreamRes.on("error", effectiveResolve.bind(null, {kind:"throw", error}))`**（与 callNonStream 对称）。当前该分支只有 data/end，缺 error listener，FR-1 的 `destroy(abortError)` 会触发 upstreamRes error 无 listener → uncaughtException 或 Promise 永挂。
- FR-10 每次 `handle()` 注册的 `reply.raw.on("close")` 在 failover 循环中会重复注册，需确保幂等（同一 reply 只挂一次 listener）或完成后 removeListener。

### FR-8: graceful shutdown abort inflight

`close()` 复用 kill 机制，遍历 killCallbacks 主动 abort 所有 inflight 请求，不纯依赖 10s 强制退出兜底。

### FR-9: callGet 加超时

`callGet`（仅用于 admin provider 连通性探测 / fetch upstream models；**GET /v1/models 是本地 DB 读取不经此路径**）接受 timeout 参数，`req.setTimeout` + destroy 配套。超时值用**独立短超时常量** `DEFAULT_GET_TIMEOUT_MS=30_000`（30s），不从 model 配置取。

## Acceptance Criteria

- **AC-1**: kill 流式 TTFT 阶段请求 → 并发度立即下降，请求从活跃列表消失。
- **AC-2**: kill 非流式请求 → 并发度立即下降。
- **AC-3**: 客户端流式 TTFT 阶段断连 → 并发度下降，upstreamReq 被销毁（依赖 FR-10 修复断连检测，signal 传入 transport）。
- **AC-3b**: 非流式请求客户端断连 → 并发度下降，upstreamReq 被销毁（callNonStream 接收 signal，依赖 FR-10）。
- **AC-4**: 上游 accept 后不发响应头（真 hang）→ 达 stream/non_stream timeout 后请求超时结束，槽位释放（依赖 setTimeout+destroy 配套）。
- **AC-5**: 流式 STREAMING 阶段 chunk 间隔超 stream_timeout_ms → 超时结束（保留现有 idle 行为）。
- **AC-6**: 模型编辑页主行可独立设置流式/非流式超时，默认显示 300/600。
- **AC-7**: `=0` 时该路径禁用超时。
- **AC-8**: kill/超时/客户端断连/**loop_detection/upstream_error** 任一路径终止后，upstreamReq/upstreamRes 均被 destroy，不向上游泄漏。
- **AC-9**: 客户端断连后 resilience 不再消耗 retry 配额（signal 短路）。
- **AC-10**: kill 排队中（未 acquire）请求 → 正常返回失败，不抛 TypeError。
- **AC-11**: graceful shutdown 时 inflight 请求被主动 abort。
- **AC-12**: callGet 路径也有超时保护。
- **AC-13**: 释放信号量幂等，不出现双重 release。

## Constraints

- 字段命名 `non_stream_timeout_ms`，存储于 `providers.models` JSON 内，**不需 SQL 迁移**（与 stream_timeout_ms 一致）。
- `non_stream_timeout_ms` TypeBox 范围约束复用 stream 的 `0 ≤ x ≤ 86_400_000`。
- 不改 `queue_timeout_ms`（本机排队超时，独立维度，不在范围）。
- 保持三层代理架构，不破坏现有职责边界。
- 非流式超时为「无活动」语义而非「总时长」（YAGNI）。

## 已知问题（不在本次范围）

- **retry headersSent 场景**：重试时若 headers 已发送，新旧 StreamProxy 数据衔接问题。复杂、风险高、疑为已有行为，记录待后续单独排查处理。

## 业务用例

### UC-1: 运维终止异常请求
- **Actor**: 运维人员
- **场景**: 监控页面发现某请求长时间无响应
- **预期结果**: 点击关闭后并发度立即下降，槽位可复用，上游连接被切断不继续计费

### UC-2: 按模型配置超时
- **Actor**: 管理员
- **场景**: 某推理模型非流式响应慢，需更长超时
- **预期结果**: 模型列表主行直接调整非流式超时值，无需展开补丁

### UC-3: 上游假死自动恢复
- **Actor**: 系统
- **场景**: 上游 accept 连接后不返回数据
- **预期结果**: 达无活动超时阈值后自动结束请求，释放槽位
