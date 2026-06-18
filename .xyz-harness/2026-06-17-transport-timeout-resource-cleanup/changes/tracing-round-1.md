# Tracing Round 1

## 追踪范围

- **spec 初稿版本**：`spec.md`（verdict: pass），含 FR-1~FR-5、AC-1~AC-8、3 个 UC
- **clarification.md**：已知 6 个泄漏场景表（4 个 A 类槽位泄漏 + 2 个 B 类计费泄漏）、超时语义澄清（inactivity）
- **追踪视角**：
  - P1 User Journey（适用：运维 kill / 管理员配置 / 客户端断连三个 actor）
  - P2 Data Lifecycle（适用：新增 `non_stream_timeout_ms` 字段，需追踪消费者）
  - P3 API Contract（**部分降级**：外部 HTTP API 不变，但内部 transport 接口签名变更需追踪）
  - P4 State Machine（适用：StreamProxy 状态机 + semaphore generation）
  - P5 Failure Path（**重点**：用户明确要求系统排查资源未关闭/泄漏/不健壮失败路径）

### 降级视角记录

| 视角 | 降级理由 | 依据 |
|------|---------|------|
| P3 API Contract（部分） | 外部客户端 HTTP 契约（/v1/chat/completions 等）不变，只追踪内部 transport 函数签名变更 | spec.md Constraints：「保持三层代理架构，不破坏现有职责边界」；FR 未提外部 API 变更 |

---

## Gap 列表

| ID | Type | Perspective | Source | Question |
|----|------|------------|--------|----------|
| G-001 | F | Failure Path | `orchestration/resilience.ts:execute()` + `orchestration/orchestrator.ts:97-117` | **resilience 重试/failover 循环完全不感知 `controller.signal.aborted`**。signal 当前只传给 `semaphore.acquire`（排队阶段）。客户端断连后 `controller.abort()`，当前 attempt 因 FR-1 结束（throw），但 `resilience.decide` 可能判定 retryable → `sleep(delayMs)` → 继续下一次 attempt。下一次 attempt 也会因 signal 立即失败，但中间会消耗 N 次 retry 配额 + 累积延迟 + 上游计费。failover-loop.ts:172 有 `if (reply.raw.destroyed) return` 保护，但 resilience 内部循环没有。spec/FR 未提 resilience 层的 signal 短路检查。 |
| G-002 | F | Failure Path | `orchestration/scope.ts:withSlot(fn)` + `orchestration/resilience.ts:execute(targets, fn, config)` + `transport/transport-fn.ts:buildTransportFn` | **FR-1 signal 透传缺少接口设计**。`transportFn` 签名是 `(target: Target) => Promise<TransportResult>`，不含 signal。signal 当前只到 `semaphoreScope.withSlot`。要传到 `callStream`/`callNonStream`，必须改 transportFn 签名为 `(target, signal?) => ...`，或在 orchestrator.handle 中通过闭包/HandleContext 注入。spec FR-1 只说"orchestrator 把已有的 controller.signal 透传进 transport"，没说这个 signal 如何穿过 `resilience.execute(targets, fn, config)` 的边界（fn 是 buildTransportFn 构建好的闭包，resilience 只调 fn）。 |
| G-003 | F | Failure Path | `transport/stream.ts:callStream`（无 setTimeout）+ spec FR-3 | **`req.setTimeout(ms)` 不会自动 destroy 请求**。Node `http.ClientRequest.setTimeout()` 只注册超时，触发 `'timeout'` 事件但**不会自动销毁请求或 emit 'error'**。必须配套 `req.on("timeout", () => req.destroy(new Error("timeout")))`，destroy 后才 emit 'error' → resolve → 释放槽位。spec FR-3 只说"用 `upstreamReq.setTimeout(ms)` 覆盖"，没提配套的 timeout → destroy → error 转换。若按字面实现，AC-4（上游 hang 超时结束）直接 fail：timeout 事件触发但请求继续挂起。 |
| G-004 | F | Failure Path / State Machine | `transport/stream.ts:cleanup()`（只 destroy 3 个 Transform）+ `onData` loop_detection 分支 | **StreamProxy.cleanup 从不 destroy `upstreamRes`/`upstreamReq`**。已知场景 5/6 提到 STREAMING 阶段客户端断连和 idle timeout 泄漏上游连接，FR-1 方案是"signal abort → upstreamReq.destroy()"。但 **`loop_detection`** 是 proxy 内部决策（`onData` 中 `loopGuard.isTriggered()` → `terminal("stream_abort")`），**不走 controller.abort()**，所以 loop_detection 触发的 stream_abort **不会 destroy upstreamRes**，上游继续吐数据 → 计费泄漏。spec AC-8 说"kill 或超时后 destroy"，但漏了 loop_detection 路径。cleanup 应直接持有并 destroy upstreamRes 引用，而非仅依赖外部 signal。 |
| G-005 | F | Failure Path | `app/register-routes.ts:close()` + `index.ts:shutdown` | **graceful shutdown 不 abort inflight 请求**。`close()` 调用 `semaphoreManager.removeAll()`（reject 队列）、`proxyAgentFactory.invalidateAll()`（destroy agents），但**没有 abort inflight 的 controller**。inflight 的 upstreamReq 继续跑，直到 `app.server.closeAllConnections()` 2 秒后强制关闭。这期间上游连接和计费继续。kill 机制（FR-2）已存在但 shutdown 未复用。spec 未提 shutdown 路径的资源处理。 |
| G-006 | F | Failure Path | `transport/http.ts:callGet` + `proxy/proxy-core.ts:proxyGetRequest` + `handler/create-proxy-handler.ts:249` (`GET /v1/models`) | **callGet 完全无 signal/timeout**。用于 `GET /v1/models`（客户端代理路径）和 provider connectivity check（admin）。如果上游 hang，请求永久挂起。`callGet` 的 `req.on("error")` 只 reject 网络错误，无超时兜底。spec 完全没提 callGet，AC 也没覆盖。是否在本次范围？需明确边界。 |
| G-007 | F | Failure Path | `transport/stream.ts:startStreaming` + `transport-fn.ts:metricsTransform.on("error")` | **passThrough 无 error handler，可能 uncaughtException**。metricsTransform 和 formatTransform 在 transport-fn.ts 注册了 `on("error", warn)`。但 StreamProxy 内部 `this.passThrough.on("data", ...)` 监听 data，**passThrough 本身没有 error listener**。若 formatTransform 报错并 destroy，pipe 链传播使 passThrough emit 'error'，无 listener → `uncaughtException` → 进程级处理（index.ts 的 handler 会 `close().finally(exit(1))`）。StreamProxy.cleanup 会 destroy passThrough，但 error 事件在 destroy 前 emit 就会冒泡。spec 未提 transform error 的管道拆除策略。 |
| G-008 | F | Failure Path | `transport/stream.ts:resetIdleTimer` | **idleTimer 未 `.unref()`**。`this.idleTimer = setTimeout(...)` 没有 unref。正常路径 cleanup 会 clearTimeout，但如果 StreamProxy 因任何原因未 cleanup（如 promise 链异常、shutdown 时未触发），idleTimer 会保持事件循环活跃，**阻止 graceful shutdown**（shutdown 的 10s 超时强关兜底，但本可避免）。对比：`END_REPLY_TIMEOUT_MS` 的 setTimeout 已 `.unref()`，idleTimer 没有，不一致。 |
| G-009 | F | State Machine | `transport/stream.ts:onUpstreamError` | **onUpstreamError 绕过状态机**。`terminal()` 有 `transition()` 校验（非法转换抛错），但 `onUpstreamError` 直接 `this.resolved = true; this.cleanup()`，**不调用 transition**。若当前 state 是 BUFFERING，状态机记录仍是 BUFFERING（未到终态），虽然 resolved=true 阻止后续操作，但状态记录不一致。是否应先 `transition("ABORTED")` 再 cleanup？ |
| G-010 | F | State Machine | `transport/stream.ts:startStreaming`（headersSent 分支） | **startStreaming 在 `reply.raw.headersSent` 时跳过 writeHead 但仍执行 pipe + data listener**。retry 场景下前一次 StreamProxy 已写 headers，新 StreamProxy 跳过 writeHead 但仍 `transition("STREAMING")` + pipe + `passThrough.on("data")`，继续向已发送 headers 的 reply 写 chunk。前一次 retry 的 body 可能已部分发送，新旧 StreamProxy 的数据流如何衔接？状态机/数据一致性需确认（是否触发下游解析错乱）。 |
| G-011 | F | Data Lifecycle | 多处（见下） | **`non_stream_timeout_ms` 完整消费者矩阵未列出**。CLAUDE.md「新字段数据消费者检查」规则要求列出全部消费点。实际消费者至少包括：<br>① `config/model-context.ts`: `ModelEntry`、`ModelInfo`、`parseModels`（L267-278）、`buildModelInfoList`<br>② `db/providers.ts:36`: `getModelStreamTimeout`（需拆分）<br>③ `admin/providers.ts:83` ModelInput 类型 + L173/L196 两处 TypeBox schema<br>④ `admin/quick-setup.ts:66` QuickSetupProviderSchema<br>⑤ `proxy/handler/iteration-setup.ts:165` 调用点<br>⑥ `proxy/transport/transport-fn.ts` TransportFnParams<br>⑦ `frontend/src/components/quick-setup/ModelCard.vue`<br>⑧ `frontend/src/components/providers/ModelCapabilitiesEditor.vue`<br>⑨ `frontend/src/constants.ts`<br>spec.md 只提到 parseModels 和前端类型，未列完整矩阵。 |
| G-012 | F | Data Lifecycle | `frontend/src/constants.ts:3` (30_000) + `db/providers.ts:38` (600_000) + `spec.md` FR-4 (300_000) | **stream_timeout_ms 默认值三处不一致**。前端 `DEFAULT_STREAM_TIMEOUT_MS = 30_000`（30s），后端 `DEFAULT_STREAM_TIMEOUT_MS = 600_000`（600s），spec FR-4 表格写 `300_000`（300s）。clarification.md 决策表说"流式默认值 300s"。**三处全不同，且前端 30s 明显是 bug**（流式 30s 几乎所有 thinking 模型都会超时）。本次变更是否要统一三处？spec 未明确"修复已有不一致"。 |
| G-013 | D | Data Lifecycle | `db/providers.ts:36 getModelStreamTimeout` + spec FR-4 | **getModelStreamTimeout 拆分方式未拍板**。spec 说"拆为两个读取函数（或一个返回 `{stream, nonStream}` 的函数）"，给了两个方案没选。两方案对调用方（iteration-setup.ts:165）和 transport-fn.ts 的传参形式影响不同。需决策。 |
| G-014 | F | Data Lifecycle | `db/migrations/*.sql`（stream_timeout_ms 无列，在 models JSON 中）+ spec | **non_stream_timeout_ms 不需要 SQL 迁移，spec 未声明**。stream_timeout_ms 存储在 `providers.models` JSON 字段中，不是表列。新增 non_stream_timeout_ms 同理，不需要 ALTER TABLE。但 spec.md 没明确说"不需要迁移"，实现者可能误以为要写迁移文件。应明确字段存储位置（JSON 内）以避免误操作。 |
| G-015 | F | API Contract | `admin/providers.ts:173,196` `stream_timeout_ms: Type.Optional(Type.Number({ minimum: 0, maximum: 86_400_000 }))` | **non_stream_timeout_ms 的 TypeBox 范围约束未定**。stream_timeout_ms 现有约束 `0 ≤ x ≤ 86_400_000`（24h）。non_stream_timeout_ms 是否用同样范围？上限 24h 对非流式是否合理？spec 未说。 |
| G-016 | K | User Journey | `orchestration/orchestrator.ts:111` kill callback + `semaphore.ts:acquire` signal listener | **kill 一个"正在排队"（未 acquire 槽位）的请求的行为未定义**。请求在信号量队列中等待时，kill 触发 `controller.abort()`。`semaphore.acquire` 的 signal listener 会 `reject(AbortError)`，但 `withSlot` 的 `try { return await fn() } finally { release() }` 中——token 未获取（acquire 抛错），finally 调 `release(token)` 会怎样？token 是 undefined。AC-1/AC-2 只覆盖"流式 TTFT"和"非流式"，没覆盖"排队中"的 kill。 |
| G-017 | K | User Journey | spec AC-7 + `ModelCard.vue` | **管理员配置 `non_stream_timeout_ms=0` 时前端显示什么？** AC-7 说 0 表示禁用超时。前端输入框显示 0 时，placeholder/提示文案是什么？"禁用"还是"0 秒"？是否需要专门的无穷大图标？UX 未定义。 |
| G-018 | F | User Journey | spec FR-5 + `ModelCard.vue` | **ModelCard 主行新增两个超时输入框的响应式布局未定**。主行已有模型名、补丁按钮、capabilities 等。再加两个数字输入框，窄屏（< 768px）如何换行？spec 只说"补丁按钮左侧"，没说响应式行为。可能挤压模型名。 |
| G-019 | F | API Contract | `transport-fn.ts:buildTransportFn` 返回 `(target) => Promise<TransportResult>` + spec FR-1 | **transportFn 接口签名变更未在 spec 说明**。FR-1 要 transport 接受 signal，意味着 `buildTransportFn` 返回的函数签名从 `(target) => Promise<TransportResult>` 变为 `(target, signal?) => ...`。这是内部接口契约变更，影响 `resilience.execute(fn)` 和 `orchestrator.handle` 的调用方式。spec 没列出这个签名变更，实现时可能选错注入点。 |
| G-020 | F | Failure Path | `core/monitor/request-tracker.ts:killRequest` + `complete()` | **FR-2「同步释放信号量」与 FR-1 的关系未厘清**。FR-2 要给 RequestTracker 注入释放回调。但若 FR-1 完全 work（signal abort → transport destroy → resolve → `withSlot` finally release），槽位已自然释放。FR-2 的"对称强制释放"是否冗余？是否有场景 transportFn 不会因 signal 结束（如 callStream 内部漏接 signal listener）？需明确 FR-2 是"防御兜底"还是"覆盖 FR-1 漏洞"，否则可能双重 release（release 已 release 的 token）。 |
| G-021 | F | Failure Path | `transport-fn.ts:onContentDelta` (loopGuard feed) + `stream.ts:onData` | **metricsTransform 报错后 loopGuard 停止 feed，但 StreamProxy 仍从 upstreamRes 接收数据并 write 到已 destroyed 的 pipeEntry**。metricsTransform 是 pipeEntry，destroy 后 `pipeEntry.write(chunk)` 会返回 false 或抛错。StreamProxy.onData 无 try-catch 包裹 `this.pipeEntry.write(chunk)`。数据流状态不一致，可能导致 write 到 destroyed stream 抛错。次要 gap。 |
| G-022 | F | Failure Path | `transport/http.ts:callNonStream` + spec FR-1 | **`upstreamReq.destroy()` 在 `callNonStream` 中是否真的 emit 'error'？** Node `http.ClientRequest.destroy()` 的行为：若请求已收到 response，destroy 会触发 response 的 'error' 或直接关闭 socket。callNonStream 监听了 `req.on("error")` 和 `res.on("error")`，但若 destroy 时 response 正在流式接收，destroy 后的事件触发顺序未明确。spec 假设"destroy → error → resolve"，但 callNonStream 的 resolve 路径（res.on("end")）和 error 路径（req/res.on("error")）可能竞态。需验证 destroy 后 resolve 一定触发，否则 promise 永不 resolve（槽位永久占用）。 |
| G-023 | F | Failure Path | `orchestration/orchestrator.ts:97` `request.raw.on("close", ...)` + FR-1 signal | **request.raw 的 close handler 与 StreamProxy.registerCloseHandler 的职责重叠**。orchestrator 注册 `request.raw.on("close", () => controller.abort())`，StreamProxy 注册 `reply.raw.on("close", ...)`。reply.raw 和 request.raw 是同一个 socket 的两端。客户端断连时两个 close handler 都触发：controller.abort()（FR-1 destroy upstreamReq）+ StreamProxy terminal(stream_abort)。竞态下若 StreamProxy 先 terminal，signal abort 后的 upstreamReq.destroy 是否多余？是否有重复 resolve/cleanup？需确认两条路径的协同。 |

---

## Top 3 最严重遗漏（追踪者判断）

### #1 — G-003：`req.setTimeout(ms)` 不会自动 destroy，FR-3 字面实现直接失效

**严重度：致命**。这是 FR-3 的**实现正确性**问题。Node 的 `ClientRequest.setTimeout()` 只触发 `'timeout'` 事件，**不自动销毁请求**。必须配套 `req.on("timeout", () => req.destroy(new Error("timeout")))`，destroy 后才 emit `'error'` → resolve → 释放槽位。

若按 spec 字面实现（只调 `setTimeout`），**AC-4（上游真 hang 超时结束）直接 fail**：timeout 事件触发但请求继续挂起，槽位永不释放。整个"超时覆盖缺口"修复无效。

spec FR-3 必须补充：`req.on("timeout", () => req.destroy(timeoutError))` 的配套 handler，以及 destroy 后如何转化为 TransportResult（throw 还是新的 timeout kind）。

### #2 — G-002 / G-019：FR-1 signal 透传的接口设计缺失

**严重度：高**。FR-1 是"治本"方案，但 spec 没说清楚 signal 如何穿过 `resilience.execute(targets, fn, config)` 的边界传到 transport。

当前架构：`buildTransportFn` 在 iteration-setup 中构建为闭包 `(target) => Promise<TransportResult>`，resilience 只调 `fn(currentTarget)`，orchestrator 在更外层。signal 在 orchestrator 创建，要传到最内层的 callStream/callNonStream，必须**修改 transportFn 签名**（加 signal 参数）或在 orchestrator 中通过闭包注入。

spec 未明确：
- transportFn 签名是否变更（`(target, signal?) => ...`）
- resilience.execute 是否需要感知 signal（与 G-001 相关）
- signal 注入点（buildTransportFn 闭包 vs HandleContext vs 函数参数）

实现时若选错注入点，retry 循环中 signal 可能失效（每次 attempt 用旧 signal 引用，或 signal 未传到新一轮 fn 调用）。

### #3 — G-004：StreamProxy.cleanup 不销毁 upstreamRes，loop_detection 路径泄漏

**严重度：高**。这是 AC-8 的**覆盖漏洞**。AC-8 说"kill 或超时后 destroy"，但漏了 **loop_detection** 路径。

loop_detection 是 proxy 内部决策（`onData` 中 `loopGuard.isTriggered()` → `terminal("stream_abort")`），**不走 controller.abort()**。FR-1 的"signal abort → upstreamReq.destroy()"对 loop_detection 无效。结果：loop_detection 触发后，上游连接继续吐数据 → **计费泄漏**（B 类）。

更根本的问题：StreamProxy.cleanup 只 destroy 3 个 Transform，**从不持有 upstreamRes/upstreamReq 引用**。这导致任何不走 signal 的内部终止路径（loop_detection、EARLY_ERROR 后上游继续发数据等）都无法切断上游。修复方案应是 cleanup 直接 destroy upstreamRes/upstreamReq 引用，而非仅依赖外部 signal。

---

## 补充观察（非 gap，但值得注意）

1. **`stream_timeout_ms` 的 inactivity 语义已有部分实现**：`StreamProxy.resetIdleTimer` 在 STREAMING 阶段每收到 chunk 重置 timer，已是 inactivity 语义。FR-3 的 `req.setTimeout` 是补充 TTFT 阶段（响应头前）。两段共用一个值合理。
2. **`getModelStreamTimeout` 返回 `Infinity`（stream_timeout_ms=0）**：若 FR-3 把这个值传给 `req.setTimeout(Infinity)`，Node 行为未定义（可能立即触发或不触发）。需确认禁用路径的实现（spec AC-7）。
3. **semaphore 的 generation 机制**：`updateConfig` 在 maxConcurrency=0 时递增 generation 使旧 token 失效，设计完善。但 maxConcurrency 降低时不截断 current（注释说明原因），这与 FR-2 的"强制释放"可能交互——需确认 FR-2 释放回调是否走 generation 校验。
4. **`request.raw.on("close")` handler 永不移除**：每次请求注册一个，依赖 request 对象 GC 清理。Fastify request 一次性，不是泄漏，但 handler 闭包持有 controller、reply 引用，直到 request 结束。
