---
verdict: fail
must_fix: 1
---

# Code Review v1 — 后端核心组（transport + orchestration + concurrency + monitor）

**审查范围**：`router/src/proxy/transport/{http,stream,transport-fn}.ts`、`router/src/proxy/orchestration/{orchestrator,resilience,scope}.ts`、`router/src/core/concurrency/semaphore.ts`、`router/src/core/monitor/request-tracker.ts`、`router/src/app/register-routes.ts`、`router/src/proxy/handler/iteration-setup.ts`

**基线校验**：
- `npx tsc --noEmit` → 0 error
- `npx vitest run`（本次相关 7 个测试文件）→ 71/71 passed
- `provider-connectivity.ts` 本次无 diff（在范围内但未改动）

---

## 总结

本次变更整体质量高，signal 全链路、release 幂等、reqTokenMap 时机、adaptive 客户端断连过滤、StreamProxy cleanup、close handler writableEnded 判断、abortAllInflight 等核心 bug 修复均正确实现，测试覆盖到位（71 个用例）。

但存在 **1 个 MUST FIX**：`orchestrator.ts` 的 `ABORT_LISTENER_ATTACHED` WeakSet 在 failover 多迭代场景下阻断了客户端断连信号的传播，已通过最小复现确认 Promise 永挂。

---

## MUST FIX

### MF-1: WeakSet 阻断 failover 迭代 2+ 的客户端断连 abort 传播

- **文件**: `router/src/proxy/orchestration/orchestrator.ts:108-116`
- **维度**: 路由映射正确性（failover）/ 信号链路完整性
- **严重程度**: error

**描述**

模块级 `ABORT_LISTENER_ATTACHED = new WeakSet<FastifyReply["raw"]>()` 用于"幂等挂载"close listener，注释称"failover 循环复用同一 reply，WeakSet 保证只挂一次"。

但 `failover-loop.ts` 的 `while (true)` 循环在每次 failover 迭代都调用 `processResilienceResult` → `orchestrator.handle(request, reply, ...)`，**复用同一个 `reply`**（`failover-loop.ts:316` 传入的 `reply` 来自外层闭包，所有迭代共享）。每次 `handle()` 都会 `new AbortController()`。

WeakSet 的效果是：**只有第一次 `handle()` 调用会挂载 close listener，后续所有迭代的 controller 都不会绑定到 reply.raw 的 close 事件**。

触发路径（`resilience-processor.ts:280-285`）：
```ts
if (isFailover && !reply.raw.headersSent) {
  const failed = tr.kind === "throw" || ("statusCode" in tr && tr.statusCode >= HTTP_ERROR_THRESHOLD);
  if (failed) return { action: "continue", trigger };  // 进入下一次 failover 迭代
}
```

迭代 1 返回 502/throw 且 headers 未发送 → continue → 迭代 2 再次 `handle()` → WeakSet 命中 → 跳过挂载 → **iteration 2 的 controller 永远不会因客户端断连而 abort**。

**实际后果**：
1. 客户端在 failover 迭代 2+ 期间断连 → controller 不 abort → transport 不被 destroy → 上游连接泄漏
2. 上游 API 调用继续执行（浪费配额/费用），响应无法回写客户端
3. adaptive 控制器可能误判（iteration 2 的 controller 未 abort，失败会被当作正常 provider 失败计入退避）

**复现确认**（最小复现脚本，已删除）：
```
iter1 done, slot: {"active":0,"queued":0}
iter2 acquired, simulating client disconnect...
iter2 abort fired? false
FAIL: WeakSet 阻断 failover 迭代 2 的 abort
```
iteration 2 的 `transportFn` 永挂（Promise unsettled），Controller 从未 abort。

**修复建议**

移除 WeakSet，每次 `handle()` 都挂载自己的 close listener。`controller.abort()` 本身幂等，多 listener 各自 abort 各自的 controller 互不干扰；listener 数量受 `MAX_FAILOVER_ITERATIONS` 上界约束（通常 ≤5），reply.raw 关闭后随对象 GC 一起回收，无永久泄漏。

```ts
// 移除模块级：const ABORT_LISTENER_ATTACHED = new WeakSet<...>();
// 改为每次 handle 都挂载：
reply.raw.on("close", () => {
  if (!reply.raw.writableEnded) controller.abort();
});
```

若担心 listener 堆积，可在 controller.abort 后 `reply.raw.off("close", ...)` 清理自身，但非必需。

**补充**：`tests/core/proxy/orchestrator-client-disconnect.test.ts` 仅覆盖单迭代断连（`makeConfig` 单 target，`isFailover=false`），未覆盖 failover 多迭代 + 客户端断连。修复时需补一个测试：两 target failover + 迭代 2 期间客户端断连 → 验证 iteration 2 的 transport 被 abort、槽位释放、上游连接销毁。

---

## WARNING

### W-1: passThrough 'error' handler 不 resolve Promise，存在低概率永挂风险

- **文件**: `router/src/proxy/transport/stream.ts:217-220`
- **维度**: 兜底响应 / 资源清理
- **严重程度**: warning

**描述**

新增的 handler：
```ts
this.passThrough.on("error", (err: Error) => {
  console.warn("[stream-proxy] passThrough error:", err.message);
  if (!this.resolved) this.cleanup();   // 只 cleanup，不 resolve
});
```

注释称"resolved 由后续 onUpstreamError 兜底"。但这个兜底假设不成立：

- `cleanup()` 调用 `upstreamRes.destroy()`（**无 error 参数**）→ IncomingMessage 只 emit 'close'，**不 emit 'error'** → `onUpstreamError` 不会被触发 → `resolveFn` 永不调用 → `callStream` 的 Promise 永挂。
- 触发条件：passThrough 独立 emit 'error'（如外部 `passThrough.destroy(err)` 或内部 stream 错误）而 upstream 未同时错误。概率低，但 `tests/core/proxy/stream-cleanup.test.ts` 的 "absorbs passThrough error" 用例只断言 cleanup 执行，**未断言 Promise 被 resolve**。

**修复建议**

在 handler 中保证 Promise 被 resolve（`terminal` 内部有 resolved 守卫，重复调用安全）：
```ts
this.passThrough.on("error", (err: Error) => {
  console.warn("[stream-proxy] passThrough error:", err.message);
  if (!this.resolved) {
    this.terminal("stream_abort", { abortReason: "pipe_error" as const, error: err });
  }
});
```
或至少 `this.resolved = true; this.resolveFn?.({ kind: "throw", error: err, headersSent: this.headersSent });` 后再 cleanup。补一个断言"passThrough error 后 callStream Promise 被 resolve"的测试。

---

## INFO

### I-1: idleTimer.unref() 改变了进程保活语义

- **文件**: `router/src/proxy/transport/stream.ts:182`
- **维度**: 向后兼容 / 运行时行为

`this.idleTimer.unref()` 是新增。含义：idleTimer 不再阻止 Node 进程退出。在长跑 HTTP server 场景下无影响（server socket 保持 loop 活跃），且 `register-routes.ts` 的关闭流程已通过 `abortAllInflight()` 显式清理 inflight 请求，行为一致。仅作记录——若未来有非 server 上下文使用 StreamProxy（如 CLI 巋试），需注意 timer 不保活。

### I-2: release 签名 `AcquireToken | undefined` 比必需更宽松

- **文件**: `router/src/core/concurrency/semaphore.ts:170`
- **维度**: 类型安全（轻微）

`release(providerId, token: AcquireToken | undefined)`。实际唯一调用方 `scope.ts:withSlot` 的 `finally` 块中 `token` 恒为 defined（`acquire` 在 try 外，抛错时根本不进入 try/finally）。`| undefined` 属防御性编码，函数内 `if (!token) return` 已处理。无害，但非必需。若想收紧，可保持 `AcquireToken` 不变。

---

## 正确实现（本次变更的亮点，无需改动）

| 修复点 | 位置 | 评估 |
|--------|------|------|
| signal 全链路穿透 | `transport-fn.ts`→`http.ts`/`stream.ts` → `req.destroy(new Error(...))` | 正确：destroy 带 error 参数，触发 'error' 事件，Promise 正常 reject/resolve |
| release 幂等 | `semaphore.ts:171-177` `token.released` 标志 | 正确：kill 与自然完成双重 release 防护，`kill-release.test.ts` 竞态用例验证 active 不超减 |
| reqTokenMap 存入时机 | `semaphore.ts:135-138` queued 路径在 `resolve` 回调内 `buildAndRecordToken` | 正确：排队中 kill 不会误减 current（map 无记录 → noop） |
| adaptive 过滤客户端断连 | `orchestrator.ts:153,164,174` `if (!controller.signal.aborted)` | 正确：三处上报点均过滤，避免误降并发 |
| ResilienceLayer signal 短路 | `resilience.ts:230,305` 循环顶部 + retry sleep 后双检查 | 正确：sleep 期间断连也短路，测试覆盖 |
| close handler writableEnded | `orchestrator.ts:112` 改用 `reply.raw.writableEnded` | 正确：旧逻辑 `request.raw.readableEnded` 对 POST 恒 true，close 永不 abort |
| StreamProxy cleanup 销毁上游 | `stream.ts:146-147` `upstreamRes.destroy()` + `upstreamReq.destroy()` | 正确：幂等（destroyed 守卫），`stream-cleanup.test.ts` 验证 |
| onUpstreamError 状态机 | `stream.ts:390-393` BUFFERING/STREAMING → ABORTED transition | 正确：`transition` 合法性表允许，避免状态不一致 |
| abortAllInflight | `request-tracker.ts:293-297` 快照迭代 + 复用 kill 机制 | 正确：`[...keys]` 防 ConcurrentModification，复用 kill 含信号量释放 |

---

## 维度通过情况

| 维度 | 结论 |
|------|------|
| 1. 类型安全 | ✅ 无 any，回调参数有类型注解，tsc 0 error |
| 2. 架构分层 | ✅ Transport 未 import 上层；依赖通过 callback 注入（`setReleaseSlotProvider`），无跨层 |
| 3. 路由映射/并发控制 | ❌ failover 场景 abort 传播断裂（MF-1） |
| 4. 测试覆盖 | ⚠️ 单迭代覆盖完整，failover 多迭代 + 断连未覆盖（MF-1 补充） |
| 5. 代码质量 | ✅ 无 eslint-disable 违规（仅 `taste/no-silent-catch` 标注的合法 catch），无 any，无无界 while |
| 6. 向后兼容 | ✅ `transportFn`/`acquire`/`withSlot` 新增参数均为可选，旧调用方兼容 |
| 7. signal 链路 / 资源清理 | ⚠️ 链路正确，但 failover 迭代 2+ 断链（MF-1）；passThrough error 永挂风险（W-1） |

---

## 修复优先级

1. **MF-1**（error）：移除 WeakSet，每次 handle 挂载独立 close listener + 补 failover 断连测试
2. **W-1**（warning）：passThrough error handler 补 resolve 逻辑 + 补 Promise resolve 断言
3. I-1 / I-2：可选，不阻塞合并
