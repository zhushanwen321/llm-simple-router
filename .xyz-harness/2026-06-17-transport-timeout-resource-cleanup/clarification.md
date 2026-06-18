# Clarification — Transport 超时与资源泄漏

## 已确认的决策（用户拍板）

| 决策点 | 结论 | 理由 |
|--------|------|------|
| 流式超时语义 | idle（chunk 间无活动） | 思考期靠上游心跳，关心"多久没动静"非"总时长" |
| 流式默认值 | 300s | 宽松安全，兼顾 thinking 模型思考期 |
| 非流式默认值 | 600s | 推理任务总时长上限 |
| UI 形式 | A（主行平铺两个输入框） | 全可见，补丁按钮左侧 |
| 超时统一范围 | 仅上游交互，不含 queue_timeout_ms | queue 是本机排队，独立维度 |

## 超时语义澄清

**核心统一语义 = 上游无活动超时（inactivity timeout）**

`req.setTimeout(ms)` 的 Node.js 行为：socket 上指定时间内无活动（无数据收发）即触发 `timeout` 事件。有数据传输时自动重置。这正好是「无活动」语义。

因此：
- **流式**：响应头到达前用 `req.setTimeout(300s)`；响应头到达后切换给 `idleTimer(300s)`（已有逻辑）。两段共用一个值。
- **非流式**：全程用 `req.setTimeout(600s)`。覆盖"等待响应头"和"body 间无活动"。

非流式不引入额外 wall-clock 总时长超时（YAGNI）。若未来发现需要总时长限制，再加。

## 已知泄漏场景表（排查结论）

并发度数字来源：`RequestTracker.getConcurrency()` 读 `semaphoreManager.getStatus(providerId).active`（即 `SemaphoreEntry.current`），**不是** `activeMap.size`。槽位释放只在 `SemaphoreScope.withSlot` 的 `finally` → `manager.release()`，前提是 `transportFn` Promise 结束。

| # | 场景 | 类型 | 当前兜底 | 修复后 |
|---|------|------|---------|--------|
| 1 | 流式·TTFT 阶段客户端断连/kill | A（槽位泄漏） | 无 | FR-1 signal destroy + FR-2 同步释放 |
| 2 | 非流式·客户端断连/kill | A | 无 | FR-1 + FR-2 |
| 3 | 流式·上游真 hang（连响应头都不返回） | A | 无（idleTimer 未创建） | FR-3 req.setTimeout |
| 4 | 非流式·上游 hang | A | 无（callNonStream 无超时） | FR-3 + FR-4 非流式超时 |
| 5 | 流式·STREAMING 阶段客户端断连 | B（计费泄漏） | close handler resolve，但 upstreamRes 不 destroy | FR-1 signal destroy（AC-8） |
| 6 | 流式·idle timeout / loop detection | B | resolve 正常，upstreamRes 不 destroy | AC-8 cleanup 销毁 upstreamRes |

类型说明：A=槽位永久占用（严重）；B=槽位已释放但上游连接泄漏（中等，计费）。

## 关键代码位置

| 文件 | 关注点 |
|------|--------|
| `router/src/core/monitor/request-tracker.ts` | `killRequest()`、`getConcurrency()`、killCallbacks |
| `router/src/core/concurrency/semaphore.ts` | `acquire`/`release`/`getStatus`、signal 仅排队阶段生效 |
| `router/src/proxy/orchestration/orchestrator.ts:111` | kill callback 注册，controller.abort + reply.destroy |
| `router/src/proxy/orchestration/scope.ts` | `withSlot` finally release、`track` finally complete |
| `router/src/proxy/transport/stream.ts` | `callStream`、`StreamProxy.cleanup`(131)、`registerCloseHandler`(225)、idleTimer(151) |
| `router/src/proxy/transport/http.ts` | `callNonStream`（无 signal/timeout）、`callGet` |
| `router/src/proxy/transport/transport-fn.ts` | `buildTransportFn`、callStream/callNonStream 调用点 |
| `router/src/proxy/handler/iteration-setup.ts:165` | `getModelStreamTimeout` 取值 |
| `router/src/db/providers.ts:36` | `getModelStreamTimeout`、`DEFAULT_STREAM_TIMEOUT_MS` |
| `router/src/config/model-context.ts` | `ModelEntry`（含 stream_timeout_ms）、`parseModels` |
| `frontend/src/components/quick-setup/ModelCard.vue` | 主行布局、超时输入框（当前在补丁区） |
| `frontend/src/components/providers/ModelCapabilitiesEditor.vue` | updateModelStreamTimeout |
| `frontend/src/constants.ts` | DEFAULT_STREAM_TIMEOUT_MS=30000 |

## 待 subagent 重点追踪

1. **Failure Path 视角**：除上表 6 个场景外，是否还有其他资源未关闭路径？（resilience 重试/failover 循环中 upstreamReq 的生命周期、shutdown 路径、错误分支的 cleanup）
2. **状态机视角**：StreamProxy 状态转换（BUFFERING/STREAMING/COMPLETED/ABORTED/EARLY_ERROR）在 kill/timeout 时是否都能到达终态并 cleanup？
3. **数据视角**：`non_stream_timeout_ms` 新增后，`parseModels`/前端类型/迁移的完整性。

---

## non_stream_timeout_ms 完整消费者矩阵（G-011）

新增字段必须同步更新以下全部消费点（违反 CLAUDE.md「新字段数据消费者检查」即 MUST FIX）：

| # | 位置 | 改动 |
|---|------|------|
| 1 | `config/model-context.ts` | `ModelEntry`、`ModelInfo` 加 `non_stream_timeout_ms?`；`parseModels`(L267-278) 解析；`buildModelInfoList`(L300) 输出 |
| 2 | `db/providers.ts:36` | `getModelStreamTimeout` → `getModelTimeouts` 返回 `{stream, nonStream}` |
| 3 | `admin/providers.ts` | ModelInput 类型 + L173/L196 两处 TypeBox schema 加 `non_stream_timeout_ms`；**另 `extractModelOverrides`(L104)、QuickSetup `createAll` 镜像点需同步** |
| 4 | `admin/quick-setup.ts:66` | QuickSetupProviderSchema 加字段；**另 L151 createAll 镜像点需同步** |
| 5 | `proxy/handler/iteration-setup.ts:165` | 调 `getModelTimeouts`，传入 transport |
| 6 | `proxy/transport/transport-fn.ts` | TransportFnParams 加 `nonStreamTimeoutMs`，传给 callNonStream |
| 7 | `frontend/.../quick-setup/ModelCard.vue` | 主行双输入框 |
| 8 | `frontend/.../providers/ModelCapabilitiesEditor.vue` | updateModelNonStreamTimeout |
| 9 | `frontend/src/constants.ts` | `DEFAULT_NON_STREAM_TIMEOUT_MS=600_000`；`DEFAULT_STREAM_TIMEOUT_MS` 改 300_000 |
| 10 | `frontend/src/types/mapping.ts` | ModelConfig 类型加字段 |
| 11 | `frontend/src/components/quick-setup/types.ts` | ModelConfig 类型加字段 |
| 12 | `frontend/src/components/mappings/cascading-types.ts` | 关联类型加字段 |
| 13 | `frontend/src/composables/useProviderForm.ts` | 4 处：读取/默认值/赋值/序列化 |
| 14 | `frontend/src/composables/quick-setup-actions.ts` | 2 处 |
| 15 | `frontend/src/composables/quick-setup-helpers.ts` | 2 处 |
| 16 | `frontend/src/composables/useProviderGroups.ts` | 读取处 |
| 17 | `frontend/src/views/QuickSetup.vue` | 透传 |

> 前端共 11 个文件消费 `stream_timeout_ms`/`streamTimeoutMs`，全部需同步新增 `non_stream_timeout_ms` 处理。

## Round 1 追踪后的决策记录

| 决策点 | 结论 |
|--------|------|
| getModelStreamTimeout 拆分方式（G-013） | 重构为 `getModelTimeouts()` 返回 `{stream, nonStream}`（单函数，减少调用点改动） |
| 默认值统一（G-012） | 前后端流式默认统一 300s，前端 30s 属 bug 顺带修；非流式 600s |
| 范围：shutdown abort（G-005） | 纳入（FR-8） |
| 范围：callGet 超时（G-006） | 纳入（FR-9） |
| 范围：retry headersSent（G-010） | 不纳入，记录为已知问题 |

## Gap → spec 映射表（23 项）

| Gap | 处理 | 落点 |
|-----|------|------|
| G-001 resilience 不检查 signal | 纳入 | FR-1 signal 短路 / AC-9 |
| G-002/G-019 signal 透传接口 | 纳入 | FR-1 transportFn 签名变更 |
| G-003 setTimeout 不自动 destroy | **修正 FR-3** | FR-3 配套 destroy handler |
| G-004 cleanup 不销毁 upstreamRes/loop_detection 泄漏 | 纳入 | FR-6 / AC-8 扩展 |
| G-005 shutdown 不 abort inflight | 纳入 | FR-8 / AC-11 |
| G-006 callGet 无超时 | 纳入 | FR-9 / AC-12 |
| G-007 passThrough 无 error handler | 纳入 | FR-7 |
| G-008 idleTimer 未 unref | 纳入 | FR-7 |
| G-009 onUpstreamError 绕过状态机 | 纳入（次要） | FR-7 走 transition |
| G-010 retry headersSent | **不纳入** | 已知问题 |
| G-011 消费者矩阵不全 | 纳入 | 见上方矩阵 |
| G-012 默认值三处不一致 | 纳入 | FR-4 默认值统一 |
| G-013 拆分方式 | 决策 | getModelTimeouts 单函数 |
| G-014 不需 SQL 迁移 | 声明 | Constraints |
| G-015 TypeBox 范围 | 决策 | Constraints 复用 |
| G-016 kill 排队中请求 TypeError | 纳入 | FR-7 release 防护 / AC-10 |
| G-017 0 值前端显示 | 决策 | FR-5 显示「禁用」 |
| G-018 响应式布局 | 实现细节 | FR-5 plan 阶段定 |
| G-020 FR-2 双重 release | 纳入 | FR-2 幂等 / AC-13 |
| G-021 pipeEntry.write 容错 | 纳入（次要） | FR-7 |
| G-022 destroy→error→resolve 验证 | 实现要点 | plan/编码阶段验证 |
| G-023 close handler 协同 | 实现要点 | plan 阶段厘清 request.raw vs reply.raw |

## Round 2 收敛复核后的决策记录

| 决策点 | 结论 |
|--------|------|
| callGet 超时来源（G2-R2-02） | 独立短超时常量 `DEFAULT_GET_TIMEOUT_MS=30_000`，不从 model 配置取（GET 是元数据/探测请求） |
| 后端流式默认值收紧风险（G2-R2-03） | **保持 300s 决策**。600s→300s 是存量收紧，影响未显式配置的 model（流式 idle 10min→5min）。风险点：上游不发心跳的长 thinking 模型思考期可能被误杀。但 5min 无任何数据本身属异常（官方 OpenAI/Anthropic 均发 keepalive 心跳），收紧风险可控。备选：若上线后发现误杀，可回退后端兜底为 600s。 |
| 前端消费者矩阵（G2-R2-01） | 补全至 11 文件（见上方矩阵 #10-17） |

## Round 3 收敛复核后的决策记录

| 决策点 | 结论 |
|--------|------|
| **客户端断连检测链路断裂（G3-001，核心）** | 新增 **FR-10**。现有 `request.raw.readableEnded` 守卫对 POST 永远为 true，是已有 bug。改为监听 `reply.raw.on("close")`（客户端响应端）+ 检查响应未完成才 abort。这是 FR-1/AC-3/AC-8 生效的前提。 |
| setTimeout 禁用语义（G3-002） | FR-3 显式要求对 0/Infinity 跳过，与 idleTimer 守卫对称 |
| callGet 用途描述失实（G3-003） | FR-9 修正：callGet 仅用于 admin 连通性探测，GET /v1/models 是本地 DB 读取不经此路径 |

## Round 4 收敛复核后的决策记录

| 决策点 | 结论 |
|--------|------|
| **callStream 非 200 早分支缺 error listener（G4-001，AC 阻断）** | 纳入 FR-7。该分支只有 data/end 无 error listener，FR-1 的 destroy(abortError) 会触发 upstreamRes error 无 listener → uncaughtException 或 Promise 永挂（正是本需求要修的泄漏）。修复：补 `upstreamRes.on("error", ...)`，与 callNonStream 对称 |
| destroy 是否带 error 参数（G4-002） | FR-1 明确 `destroy(abortError)` 必须带参数。Node 语义：无参数不 emit error，Promise 永挂 |
| FR-10 listener 重复注册（G4-003） | 纳入 FR-7。failover 循环同一 reply 调 N 次 handle()，close listener 堆积，需幂等或 removeListener |
| 消费者矩阵行级精度（G4-004） | 补充下方镜像点 |

## Round 5 收敛复核后的决策记录

| 决策点 | 结论 |
|--------|------|
| **FR-10+FR-1 引入 adaptive 误降并发（G5-001，修复引入副作用）** | 纳入 FR-10。客户端断连不应计入 provider 失败。链路：abort → transport resolve `{kind:"throw"}` → `extractTrackStatus` failed → `adaptiveController.onRequestComplete(success:false)` → 误降 currentLimit。客户端取消高频，provider 健康时也会误降。修复：orchestrator 调 `onRequestComplete` 前检测 `controller.signal.aborted`（或结果携带 clientAborted 标记），客户端断连不计入 adaptive 失败 |
| spec FR-9 文本陈旧（G5-002） | 修正：FR-9 明确 callGet 仅用于 admin 连通性探测，GET /v1/models 本地不经此路径 |

## 实现要点（plan 阶段需厘清）

1. **G-022 destroy 语义验证**：`upstreamReq.destroy(err)` 在不同状态（未连接/等待响应头/响应体流式中）下的事件触发顺序。callNonStream 监听 `req.on('error')` + `res.on('error')`，需确保 destroy 后必有一处 resolve，否则 promise 永挂。
2. **G-023 close handler 协同**：`request.raw`(IncomingMessage) 与 `reply.raw`(ServerResponse) 共享同一 socket。orchestrator 注册 `request.raw.on('close', abort)`，StreamProxy 注册 `reply.raw.on('close', terminal)`。客户端断连两者都触发，需确保不重复 resolve/cleanup（FR-2 幂等 + terminal resolved 标志已有保护）。
3. **G-020 释放幂等机制**：FR-2 注入的释放回调，需在 RequestTracker 记录已释放的 request id，或 semaphore.release 内部对 generation/已释放 token 做幂等判断，避免 FR-1 自然释放 + FR-2 强制释放叠加。
