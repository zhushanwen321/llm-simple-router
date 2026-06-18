# Tracing Round 3（收敛复核）

> **结论：未收敛（NOT CONVERGED）** — 发现 1 个核心新 gap（客户端断连检测链路断裂）+ 2 个次要新 gap。

## 追踪范围

- **spec 初稿版本**：吸收了两轮 gap 后的版本（FR-1~FR-9，AC-1~AC-13，23 项 gap→spec 映射，17 项消费者矩阵）。
- **追踪的视角**：
  - P1 User Journey（运维 kill、客户端断连两条用户路径）
  - P2 Data Lifecycle（`non_stream_timeout_ms` 消费者矩阵完整性 + `HandleContext.streamTimeoutMs` 死代码）
  - P3 API Contract（降级：本需求不改对外 API 契约，仅扩展 DB 字段 + UI；不追踪）
  - P4 State Machine（StreamProxy 状态机在 kill/timeout/client-disconnect 下的终态可达性）
  - P5 Failure Path（重点：客户端断连 / 上游 hang / 重试循环 / shutdown 四类失败下的资源释放）
- **降级理由**：P3 不适用（本需求是内部健壮性修复 + 字段扩展，HTTP 接口形状不变）；其余 4 视角全跑。

---

## Gap 列表

### G3-001（核心）〔F+D〕客户端断连检测链路断裂 — FR-1 的触发前提不成立

**类型**：F（代码事实）+ D（需决策修复方向）

**代码位置**：
- `router/src/proxy/orchestration/orchestrator.ts:98-102` — 唯一的自动 abort 路径：
  ```ts
  // 客户端断连时自动 abort（保留原有行为）
  request.raw.on("close", () => {
    if (!request.raw.readableEnded) {
      controller.abort();
    }
  });
  ```
- `router/src/proxy/transport/http.ts` `callNonStream` — 函数签名**完全不接收 `reply`，也不接收 `signal`**，无任何 client-disconnect 监听。
- `router/src/proxy/transport/stream.ts` `callStream` — `proxy.registerCloseHandler()`（即 `reply.raw.on("close")`）只在 `upstreamReq.on("response", ...)` 回调**内部**调用，TTFT 阶段（上游尚未返回响应头）StreamProxy 尚不存在，无任何 close 监听器。

**问题**：
spec 的 FR-1 建立在「`controller.signal` 在客户端断连时会被 abort」这一前提上（"signal abort 时 `upstreamReq.destroy()`"）。但追踪触发侧发现该前提**对 POST 请求不成立**：

1. Fastify 在调用路由 handler 前已由 body parser 完整消费请求体，handler 执行时 `request.raw.readableEnded === true`。因此 orchestrator.ts:100 的 `if (!request.raw.readableEnded)` 守卫**对正常的 POST /v1/chat/completions、POST /v1/messages 永远为 false**，`controller.abort()` 永不执行。注释「客户端断连时自动 abort（保留原有行为）」描述的是意图，代码并未兑现。
2. `callNonStream` 既无 `reply` 也无 `signal` 参数 → 客户端断连对非流式传输层**完全不可见**，上游必定跑到自然结束。
3. 流式 TTFT 阶段：StreamProxy 未创建 → `reply.raw.on("close")` 未注册 → 客户端断连同样不可见，直到上游响应头到达、StreamProxy 试图向已销毁的 reply 写入才触发 abort（此时上游计费已发生）。

**与 spec 的冲突**：
- 已知泄漏表第 1 行（流式·TTFT 客户户端断连）和第 2 行（非流式·客户端断连）的「修复后」都标注「FR-1 signal destroy」。但 FR-1 的 signal 在这两种场景下**根本不会 abort**（守卫挡掉 + 无 reply 监听器），故这两行声称的修复**不成立**。
- **AC-3**（客户端 TTFT 阶段断连 → 并发度下降，upstreamReq 被销毁）在当前触发机制下**不可实现**。
- **AC-8** 的「客户端断连」路径对非流式**不可实现**（callNonStream 无任何客户端感知）。

**为何前两轮未发现**：前两轮聚焦 signal 的**透传**（orchestrator→transport）和**反应**（destroy upstreamReq），未审计 signal 的**触发**侧。round-1 的 G-023 只讨论了 request.raw 与 reply.raw 共享 socket 的协同去重，未质疑 readableEnded 守卫本身。

**需决策（D）**：修复方向二选一（spec 应明确选定）：
- 方案 A：移除 `!readableEnded` 守卫，改用 `reply.raw.writableEnded` 判定「响应是否已发完」来区分「客户端放弃」与「正常完成」；或
- 方案 B：在 orchestrator 层统一注册 `reply.raw.on("close", () => { if (!reply.raw.writableEnded && !resolved) controller.abort(); })`，覆盖非流式 + 流式 TTFT 两个盲区（流式 STREAMING 阶段仍由 StreamProxy 自身的 close handler 处理）。

无论哪种方案，spec 必须新增一条 AC：**非流式请求，客户端发送完整 body 后断连 → upstreamReq 被销毁、槽位释放**（当前 13 条 AC 无一覆盖非流式客户端断连）。

---

### G3-002〔D/F〕req.setTimeout 在「禁用」语义下的行为未定义

**类型**：D（需决策）+ F（Node.js 行为事实）

**代码位置**：FR-3 新增的 `upstreamReq.setTimeout(ms)` 路径（stream.ts / http.ts 待实现处）；对照现有 idleTimer 守卫 `stream.ts:152` `if (!isFinite(this.timeoutMs) || this.timeoutMs <= 0) return;`。

**问题**：
FR-3/FR-4 规定「`0` 表示禁用（`Infinity`）」。idleTimer 路径已有 `!isFinite || <= 0` 守卫跳过 setTimeout。但 FR-3 新增的 `req.setTimeout(ms)` 路径，spec **未规定**要对 0/Infinity 做同等跳过。

Node.js 的 `socket.setTimeout(Infinity)` 行为未定义（实测会被 clamp 到 2^31-1 ms ≈ 24.8 天，或视版本抛错）。若实现按字面 `req.setTimeout(timeoutMs)` 直接传 Infinity，行为不可预测。

**需决策（D）**：spec 应显式要求 FR-3 的 req.setTimeout 调用前先做 `if (!isFinite(timeoutMs) || timeoutMs <= 0) return` 守卫，与 idleTimer 对称。建议落为一条 Constraint 或 FR-3 子句。

---

### G3-003〔F〕FR-9 对 callGet 使用场景的描述与代码不符

**类型**：F（代码事实）

**代码位置**：
- `router/src/proxy/handler/create-proxy-handler.ts:51-130` `handleModelsRequest` — GET /v1/models **从本地 DB 读取**（`getAllProviders` + `parseModels`），**不代理上游**。
- `router/src/proxy/transport/provider-connectivity.ts:19` — `callGet` 实际唯一活跃调用点是 `ProxyConnectivityChecker.fetchModels`，供 admin 的 `/admin/api/providers/fetch-models`（`admin/providers.ts:605`）做拉取模型列表/连通性探测。
- `router/src/proxy/proxy-core.ts:194` `proxyGetRequest` 包装了 callGet，但全仓 grep 无任何活跃调用方（疑似死代码）。

**问题**：
FR-9 写「`callGet`（GET /v1/models 代理 + provider 连通性检查）」，但 GET /v1/models 并非代理路径。描述失实，虽不影响 FR-9 的实现（独立短超时常量 `DEFAULT_GET_TIMEOUT_MS=30_000` 仍合理），但会误导实现者去给一个不存在的「/v1/models 代理」路径接超时。

**建议**：FR-9 改述为「`callGet`（provider 模型列表拉取 / 连通性探测）」，并顺带确认 `proxyGetRequest` 是否应清理（属 plan 阶段判断，非 spec gap）。

---

## 次要观察（不构成 gap，记录备查）

| # | 观察 | 性质 |
|---|------|------|
| O-1 | `HandleContext.streamTimeoutMs`（orchestrator.ts:56）声明但全仓无读取方，属死代码。17 项消费者矩阵未列入（正确），但重构 `getModelStreamTimeout→getModelTimeouts` 时易引起困惑，建议顺带删除该字段。 | 清理项 |
| O-2 | 多 target failover 下每轮迭代生成新 logId 并重注册 kill callback；kill 任一迭代 ID 会 `reply.raw.destroy()`，failover-loop 顶部 `if (reply.raw.destroyed) return reply` 兜底终止整条链。逻辑自洽，无需新增 AC。 | 已自洽 |
| O-3 | shutdown（FR-8）遍历 killCallbacks 时需先快照 keys（killRequest 会边遍历边 delete），属实现细节，非 spec gap。 | 实现细节 |

---

## 已追踪视角结论汇总

| 视角 | 结论 |
|------|------|
| P1 User Journey | 运维 kill 路径（FR-2）自洽；**客户端断连路径断裂**（G3-001） |
| P2 Data Lifecycle | 17 项消费者矩阵与 grep 结果一致（`HandleContext.streamTimeoutMs` 为死代码，O-1）；矩阵完整 |
| P3 API Contract | 降级（本需求不改对外 HTTP 契约） |
| P4 State Machine | StreamProxy 五状态机在 kill/timeout/loop_detection 下可达终态；**客户端断连在 BUFFERING(TTFT) 阶段无监听器**（G3-001） |
| P5 Failure Path | 上游 hang（FR-3/FR-4）、loop_detection（FR-6）、shutdown（FR-8）、callGet（FR-9）均覆盖；**客户端断连失败路径未覆盖**（G3-001） |

---

## 收敛判定

**未收敛**。G3-001 是核心 gap：spec 的 FR-1 整个机制依赖「客户端断连触发 controller.abort()」，但代码中唯一的自动触发路径被 `readableEnded` 守卫挡掉，且非流式 / 流式-TTFT 两个阶段完全缺失客户端断连监听。这直接导致 AC-3 和 AC-8 的「客户端断连」子句不可实现，也让已知泄漏表第 1、2 行声称的修复失效。该 gap 属本需求的核心目标（"kill/断连后并发度下降、上游不计费"），不能视为范围外。

G3-002、G3-003 为次要 gap，建议一并处理但不阻塞收敛判定。
