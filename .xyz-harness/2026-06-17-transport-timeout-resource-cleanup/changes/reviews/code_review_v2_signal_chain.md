---
verdict: pass
must_fix: 0
round: 2
---

# Code Review v2 — Signal 链路深审 + 第 1 轮修复验证

**审查范围**：`router/src/proxy/transport/{stream,http,transport-fn}.ts`、`router/src/proxy/orchestration/{orchestrator,resilience}.ts`、`router/src/core/types.ts`

**基线校验**：
- `npx tsc --noEmit` → 0 error
- `npx vitest run`（全量 152 文件）→ 1832 passed / 5 skipped
- `npx eslint <6 files> --max-warnings=0` → 0 warning
- `stream-cleanup.test.ts`（含 W-1 回归用例）→ 7/7 passed
- `orchestrator-client-disconnect.test.ts` → 5/5 passed

---

## 总结

第 1 轮的 2 个问题（MF-1 / W-1）均**完整修复**，未引入新 bug、资源泄漏或 Promise 永挂。signal 全链路（orchestrator → resilience → transport-fn → http/stream）穿透正确，destroy 带 error 规范落实，状态机新增 ABORTED 路径合法。`pipe_error` 加入 `abortReason` 联合类型后，所有消费点（仅 `proxy-logging.ts` 作为自由字符串存储）兼容。

本轮发现 **0 个 MUST FIX**，4 个 INFO（均属防御性 / 一致性改进，不阻塞合并）。

---

## 第 1 轮修复验证

### MF-1 — WeakSet 阻断 failover 迭代 2+ 的 abort 传播  ✅ 已修复

**验证结论**：完整修复，逻辑正确。

- `orchestrator.ts:98-106` 模块级 `ABORT_LISTENER_ATTACHED` WeakSet 已移除；每次 `handle()` 都 `new AbortController()` 并 `reply.raw.on("close", ...)` 挂载独立 listener。
- **listener 上界确认**：`handle()` 仅在 `failover-loop.ts` 的 `while(true)` 内经 `processResilienceResult`（`resilience-processor.ts:209`）调用，循环受 `MAX_FAILOVER_ITERATIONS = 10`（`failover-loop.ts:51,238`）约束 → 同一 `reply.raw` 上同时存活的 close listener ≤ 10。
- **无交叉污染**：每个 listener 闭包捕获各自的 `controller`，`controller.abort()` 幂等，多 listener 各 abort 各自 controller 互不干扰。
- **无永久泄漏**：请求结束后 `reply.raw` 关闭触发 `close`（`writableEnded=true` → 跳过 abort），随 `reply.raw` 对象 GC 释放 listener；无需 `reply.raw.off()`。
- **writableEnded 判断正确**：响应已发送完毕时 `writableEnded=true`，close 不再 abort 已完成的迭代。

残留观察见 **I-1**（listener 数量触及 Node 默认 maxListeners 阈值）。

### W-1 — passThrough 'error' handler 不 resolve Promise  ✅ 已修复

**验证结论**：完整修复，回归测试到位。

- `stream.ts:225-230` handler 改为 `this.terminal("stream_abort", { abortReason: "pipe_error", error: err })`。`terminal()`（`stream.ts:102`）顶部 `if (this.resolved) return; this.resolved = true;` 守卫到位，且非 deferred 分支（`stream.ts:131-142`）在 cleanup 后调 `this.resolveFn(result)`，**Promise 必然 resolve**。
- `cleanup(cause?)`（`stream.ts:146-154`）：`pipe_error` 路径透传 `err` → `upstreamRes/upstreamReq.destroy(err)` emit `'error'` → 触发 `onUpstreamError` → `resolved` 守卫拦截为 noop。**无重复 resolve**。
- **回归测试**：`stream-cleanup.test.ts` 新增 "StreamProxy passThrough error resolves Promise (W-1 regression)"，断言 `resolved.kind === "stream_abort"` 且 `abortReason === "pipe_error"`，并通过。
- **`pipe_error` 消费兼容性**：`types.ts:125` 联合类型已扩展；全仓 grep 显示 `abortReason` 仅在 `proxy-logging.ts:115` 作为自由字符串写入 DB（`result.abortReason ?? null`），无 `switch`/exhaustive 检查，**新增枚举值完全兼容**。
- **竞态**：`onUpstreamError` 与 passThrough error handler 对称使用 `resolved` 守卫，无论谁先触发，后触发方均为 noop。

---

## INFO（本轮新发现，均不阻塞合并）

### I-1 — close listener 数量触及 Node 默认 maxListeners 阈值  [v2 新发现]

- **文件**：`router/src/proxy/orchestration/orchestrator.ts:98-106`
- **维度**：资源管理 / 健壮性
- **严重程度**：info

**描述**

MF-1 注释称 "listener 数量受 `MAX_FAILOVER_ITERATIONS` 上界约束（通常 ≤5）"，但实际 `MAX_FAILOVER_ITERATIONS = 10`（`failover-loop.ts:51`）。最坏情况下同一 `reply.raw` 累积 10 个 close listener，恰好等于 Node `EventEmitter` 默认 `defaultMaxListeners = 10`。

Node 在添加**第 11 个** listener 时才 emit `MaxListenersExceededWarning`，因此当前（最多 10 个）**不会触发警告**，功能无影响。但处于阈值边界——若未来 `MAX_FAILOVER_ITERATIONS` 上调到 >10（或同时存在其他 close listener），将出现告警噪音。

注释中 "通常 ≤5" 与实际常量 10 不符，会误导后续维护者低估边界距离。

**修复建议（可选）**

在挂载 listener 处显式提升上限，或注释更正为实际值：

```ts
reply.raw.setMaxListeners(reply.raw.getMaxListeners() + 1);
reply.raw.on("close", () => { if (!reply.raw.writableEnded) controller.abort(); });
```

或保持现状但把注释改为 "上界 = MAX_FAILOVER_ITERATIONS(10)，等于 Node 默认 maxListeners，未越界"。

### I-2 — passThrough error handler 未调用 transition("ABORTED")，状态机不一致  [v2 新发现]

- **文件**：`router/src/proxy/transport/stream.ts:225-230`
- **维度**：状态机一致性
- **严重程度**：info

**描述**

`passThrough` error handler 直接调 `terminal("stream_abort", ...)`，而 `terminal()` 本身不修改 `this.state`（`stream.ts:101-130`）。对比同文件内其他中止路径：

| 路径 | 是否 transition("ABORTED") |
|------|---------------------------|
| `onUpstreamError`（`stream.ts:397-399`） | ✅ 是 |
| `registerCloseHandler` close 回调（`stream.ts:258-260`） | ✅ 是 |
| **passThrough error handler（`stream.ts:225-230`）** | ❌ 否 |

passThrough handler 仅在 `startStreaming()`（state 已转 STREAMING）后注册，故触发时 state=STREAMING，terminal 后仍停留在 STREAMING。

**实际影响**：无。`resolved=true` 是真正的门禁，`onData`/`onEnd`/`onUpstreamError`/close 回调全部先查 `resolved` 早返，stale 的 `state` 永不被观察。仅当未来有人新增"只查 state 不查 resolved"的代码路径时才会暴露。

**修复建议（可选）**

为一致性补一行 transition（STREAMING→ABORTED 在合法转换表内）：

```ts
this.passThrough.on("error", (err: Error) => {
  console.warn("[stream-proxy] passThrough error:", err.message);
  if (!this.resolved) {
    if (this.state === "BUFFERING" || this.state === "STREAMING") this.transition("ABORTED");
    this.terminal("stream_abort", { abortReason: "pipe_error" as const, error: err });
  }
});
```

### I-3 — callNonStream 响应到达后未清除 socket timeout（与 callStream 不对称）  [v2 新发现]

- **文件**：`router/src/proxy/transport/http.ts:102-106`（callNonStream）vs `stream.ts:441`（callStream）
- **维度**：代码一致性 / 防御性
- **严重程度**：info

**描述**

`callStream` 在 `upstreamReq.on("response")` 内调 `upstreamReq.setTimeout(0)` 清除响应头前超时（`stream.ts:440-441`），避免与 `StreamProxy.idleTimer` 竞争。`callNonStream` 未做对称处理——响应 `end` 后若 socket timeout 迟到触发，会 `req.destroy(new Error(...))` → emit `'error'` → `resolve({kind:"throw"})`。

**实际影响**：无。Promise `resolve` 幂等，二次 resolve 被忽略，不永挂、不抛错。仅是一次无意义的 destroy + 日志噪音，且响应已读完时 socket 通常已释放，timeout 极少触发。

**修复建议（可选）**

在 `callNonStream` 的 `res.on("end")` 内补 `req.setTimeout(0)`，与 callStream 对称。

### I-4 — signal abort listener 在请求正常完成后仍挂在 signal 上  [v2 新发现]

- **文件**：`router/src/proxy/transport/http.ts:113-121`、`stream.ts:451-459`
- **维度**：资源管理（轻微）

**描述**

`{ once: true }` 保证 abort 触发后自动移除，但若请求**正常完成**（signal 从未 abort），listener 仍挂在 `signal` 上直到 signal 被 GC。`signal` 来自 `orchestrator.handle()` 内局部 `controller`，handle 返回后 controller 无外部引用即可 GC，连带释放 listener 与 `req` 闭包——**非永久泄漏**，仅为短暂传递性保留。

**实际影响**：无（controller 生命周期 = 单次请求，短命）。

**修复建议（可选）**

若追求极致整洁，可在 `res.on("end")` / `req.on("error")` 内 `signal.removeEventListener("abort", abort)`。但鉴于 controller 短命且 `{ once: true }` 已覆盖触发路径，**不建议为此增加代码**（YAGNI）。

---

## signal 全链路 + state machine 深审（无问题项）

| 审查点 | 结论 |
|--------|------|
| ABORTED 转换合法性（`stream.ts:78-87` VALID 表） | ✅ BUFFERING/STREAMING → ABORTED 均合法；COMPLETED/EARLY_ERROR/ABORTED 为终态 |
| cleanup 幂等性（`idleTimer` clearTimeout + `destroyed` 守卫） | ✅ 重复调用安全，`stream-cleanup.test.ts` "repeated onUpstreamError" 验证 destroy 仅一次 |
| `idleTimer.unref()`（`stream.ts:186`） | ✅ v1 I-1 已记录，server 场景无影响，`abortAllInflight` 显式清理兜底 |
| headersSent=true + passThrough error 兜底 | ✅ terminal 非 deferred 分支（`stream.ts:127-129`）调 `reply.raw.end()` 终止 SSE 连接，try/catch 防 socket 已毁 |
| callNonStream signal + timeoutMs | ✅ destroy(err) emit 'error' → resolve({kind:"throw"})，Promise 不永挂；resolve 幂等防双解 |
| callGet 默认 30s 超时 | ✅ 合理（`/v1/models` 等轻量探测），destroy(error) → reject |
| transport-fn signal 透传 | ✅ callStream/callNonStream 均接收 `{ signal, ... }`；`nonStreamTimeoutMs` 由 `iteration-setup.ts:165` 经 `getModelTimeouts` 正常供给 |
| resilience signal 短路（`resilience.ts:230,304`） | ✅ 循环顶部 + retry sleep 后双检查，新增 `clientAbortedResult` 不重试不 failover |

---

## 维度通过情况

| 维度 | 结论 |
|------|------|
| 1. 类型安全 | ✅ tsc 0 error；`terminal` 的 `extra: Record<string,unknown>` + 内部 `as` 断言属既定 API 设计（W-1 已沿用），无新增 `any` |
| 2. 架构分层 | ✅ Transport 未 import 上层；signal 经 `transportFn` 参数注入 |
| 3. 路由映射/并发/failover | ✅ MF-1 修复后 failover 全迭代 abort 传播完整 |
| 4. 测试覆盖 | ✅ W-1 回归用例 + MF-1 单迭代断连用例均通过；failover 多迭代断连仍缺集成测试（v1 已建议，非阻塞） |
| 5. 代码质量 | ✅ lint 0 warning；无 `eslint-disable` 违规（`taste/no-silent-catch` 标注的 catch 均有注释） |
| 6. 向后兼容 | ✅ 新增可选 opts 参数、`abortReason` 联合类型扩展，旧调用方兼容 |
| 7. signal 链路 / 资源清理 | ✅ 全链路 destroy 带 error，无永挂，无永久泄漏 |

---

## 修复优先级

无 MUST FIX。INFO 项均为可选改进，可在后续 polish PR 处理或保持现状。建议优先级（若处理）：

1. **I-1**：注释更正 "≤5" → "10"，避免误导（一行改动，零风险）
2. I-2 / I-3：一致性优化，可选
3. I-4：不建议改动（YAGNI）
