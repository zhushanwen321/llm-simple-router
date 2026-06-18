# Tracing Round 5（收敛复核）

> **状态：NOT CONVERGED** — 发现 1 个修复引入的新行为副作用（G5-001）+ 1 个 spec 文本与既有决策矛盾（G5-002）。

## 追踪范围

- spec 版本：FR-1~FR-10 / AC-1~AC-14（含 FR-7 callStream 非200早分支 error listener、destroy 带参数、FR-10 listener 幂等；含 Round 4 全部吸收）
- clarification 版本：4 轮决策记录齐全
- 追踪视角：User Journey / Data Lifecycle / API Contract / State Machine / Failure Path（完整重跑，无降级——本需求横跨资源管理+状态机+失败路径，全视角适用）
- 源码核对：stream.ts、http.ts、transport-fn.ts、orchestrator.ts、resilience.ts、scope.ts、semaphore.ts、request-tracker.ts、adaptive-controller.ts、iteration-setup.ts、providers.ts、create-proxy-handler.ts、provider-connectivity.ts、frontend 11 文件 grep

## 已确认覆盖良好的视角（无新 gap）

- **P2 Data Lifecycle**：`non_stream_timeout_ms` 消费者矩阵（17 点）经 grep 全量核对，前后端覆盖完整，无遗漏消费者（违反 CLAUDE.md「新字段数据消费者检查」的风险已消除）。
- **P4 State Machine**：StreamProxy BUFFERING/STREAMING/COMPLETED/EARLY_ERROR/ABORTED 各终止路径（loop_detection / EARLY_ERROR / onUpstreamError / idle_timeout / client_disconnect）经 FR-6 + FR-7 后均能到达终态并 cleanup，`resolved` 标志防双重 resolve。流式 STREAMING 阶段断连因 `req.destroy` 的 error 异步触发、StreamProxy close listener 同步 terminal，stream_abort 先胜出 → 语义正确（非 provider 失败）。
- **P5 Failure Path**：6 类已知泄漏场景 + retry/failover 循环 upstreamReq 生命周期 + shutdown 路径 + callGet 路径均有 FR 对应。

## Gap 列表

| ID | Type | Perspective | Source | Question |
|----|------|------------|--------|----------|
| G5-001 | D | Failure Path | orchestrator.ts:170 `adaptiveController?.onRequestComplete` + adaptive-controller.ts `transitionFailure` | **FR-10 + FR-1 将客户端断连计入 adaptive provider 失败，可能误降并发限**（详见下） |
| G5-002 | F | API Contract | spec.md FR-9 文本 vs clarification Round 3 G3-003 决策 | spec.md FR-9 仍写「GET /v1/models 代理 + provider 连通性检查」，与 G3-003「callGet 仅用于 admin 连通性探测，GET /v1/models 是本地 DB 读取不经此路径」矛盾 |

### G5-001 详述（primary，修复引入的新问题）

**链路**（已用源码验证）：

1. 客户端断连（非流式全程 / 流式 TTFT 阶段，即 `upstreamRes` 未到达、StreamProxy 尚未创建）→ FR-10 的 `reply.raw.on("close")` → `controller.abort()`。
2. FR-1：callNonStream / callStream 的 signal listener → `upstreamReq.destroy(abortError)` → `req.on("error")` → resolve `{kind:"throw"}`。
   - 流式 STREAMING 阶段断连不走此路：StreamProxy 的 close listener 先同步 terminal(`stream_abort`)，`resolved` 阻断后续 onUpstreamError → 结果是 `stream_abort`（`status:"completed"`），adaptive 见 success，**安全**。
   - 但 **非流式**（无 StreamProxy）和 **流式 TTFT**（StreamProxy 未创建）两路径结果均为 `throw`。
3. orchestrator `extractTrackStatus`：`kind==="throw"` → `{status:"failed"}`（无 statusCode）。
4. `adaptiveController.onRequestComplete(providerId, {success:false, statusCode:undefined, retryRuleMatched:false})`。
5. `transitionFailure`：statusCode undefined → 不被首段 guard 过滤（guard 仅忽略 `statusCode 有定义 且 ≠429 且 <500`）→ 落入「5xx / 网络错误（statusCode=undefined）」分支 → `consecutiveFailures++`，达 `dropThreshold` 后 `currentLimit--` + 冷却期。

**为何是新问题**：当前线上（pre-FR-10）`request.raw.readableEnded` 对 POST 恒 true → `controller.abort()` 永不执行 → 客户端断连不产生 `throw`，adaptive 看到的是上游真实结果。FR-10 修复断连检测后，**每一次客户端主动取消都会被 adaptive 计为 provider 网络失败**。客户端取消是高频用户行为，会导致 adaptive 在 provider 完全健康时反复误降并发限 + 进入冷却期，与 UC-1「槽位可复用」的预期相悖。

**spec 覆盖情况**：AC-9 只覆盖「resilience 不消耗 retry 配额」，**完全未提 adaptive**。FR 列表无任何 adaptive 交互说明。

**需决策（D）**：
- 方案 A：orchestrator 在上报 adaptive 时识别「客户端断连导致的 throw」并按 success 计（或跳过上报）。需 transport result 携带 abort 原因（stream_abort 已有 `abortReason:"client_disconnect"`，throw 需补）。
- 方案 B：接受该副作用，记入「已知问题」。
- 方案 C：给 throw 增加区分（network error vs client abort），仅 network error 计入 adaptive。

### G5-002 详述（minor，spec 文本陈旧）

spec.md FR-9：「`callGet`（GET /v1/models 代理 + provider 连通性检查）」。
clarification Round 3 G3-003 决策：「callGet 仅用于 admin 连通性探测，GET /v1/models 是本地 DB 读取不经此路径」。
源码核对（`create-proxy-handler.ts:51 handleModelsRequest` 读 DB + `provider-connectivity.ts ProxyConnectivityChecker.fetchModels` 用 callGet）：G3-003 正确，spec.md 文本未同步修正。

**影响**：实现者若只读 spec.md 不读 clarification，可能误以为需给 GET /v1/models 本地读取路径加超时（无意义）。决策本身（`DEFAULT_GET_TIMEOUT_MS=30_000` 独立常量）不受影响。

## 降级视角记录

无降级。本需求涉及资源生命周期（P2）、transport 接口契约（P3）、StreamProxy 状态机（P4）、多失败路径（P5）、运维/管理员操作（P1），全视角均适用且已追踪。
