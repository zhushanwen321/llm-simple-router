---
verdict: pass
must_fix: 0
round: 2
---

# Code Review v2 — 并发与生命周期深审（semaphore reqTokenMap + killRequest + abortAllInflight）

**审查范围**（git diff main...HEAD）：
- `router/src/core/concurrency/semaphore.ts`
- `router/src/core/monitor/request-tracker.ts`
- `router/src/proxy/orchestration/scope.ts`
- `router/src/app/register-routes.ts`
- `router/src/index.ts`

**审查焦点**：边界 / 竞态 / 内存泄漏 / 幂等（非功能正确性，功能已在 v1 验证）。

**基线校验**：
- `npx vitest run tests/core/monitor/kill-release.test.ts tests/core/concurrency/semaphore.test.ts` → 24/24 passed
- v1 的 MF-1（WeakSet 阻断 failover abort）已修复并验证（orchestrator.ts:108-116 注释确认每次 handle 挂独立 listener）

---

## 总结

本次变更（reqTokenMap + releaseByReqId + token.released + abortAllInflight）是 kill 不释放信号量 bug 的核心修复。**所有 5 类边界点（A-E）经逐路径验证，均确认安全**。无内存泄漏、无双重释放、无 crash 路径、无竞态窗口。

核心设计正确性源自三个关键决策：
1. **token.released 在 entry 检查前置位**（semaphore.ts:177-179）——幂等防护 + reqTokenMap.delete 都在 `entries.get` 之前，保证即使 entry 被清空，map 仍被清理。
2. **queued 路径在 resolve 回调内才 buildAndRecordToken**（semaphore.ts:135-138）——排队中 kill 时 map 无记录 → releaseByReqId noop，不误减 current。
3. **failover 每迭代独立 reqId**（failover-loop.ts:244 `randomUUID()` 每次循环新生）——每迭代是完整的 acquire→release 周期，reqTokenMap 无跨迭代残留。

verdict=pass，must_fix=0。以下为逐项边界结论与 2 个 info 级改进建议。

---

## 边界审查结论（A-E 逐项）

### A. reqTokenMap 内存与增长 — ✅ 已确认安全

| 检查点 | 结论 | 证据 |
|--------|------|------|
| **A1** 自然完成时 release 是否 delete map | ✅ 安全 | `release` 第 179 行 `if (token.reqId) this.reqTokenMap.delete(token.reqId)`。自然完成走 `withSlot` finally → release → delete。kill-release.test.ts "kill 后自然完成（竞态）" 验证 active 归零且无超减。 |
| **A2** 进程崩溃 / 未走 finally 时泄漏 | ✅ 无永久泄漏 | (1) acquire reject（queue full / timeout / abort）路径不 set map（buildAndRecordToken 仅在 resolve 回调内调，reject 不走 resolve）。(2) withSlot 的 try/finally 保证 release。(3) 进程崩溃后 map 随进程消失，非长期泄漏。唯一"延迟清理"场景见 I-1。 |
| **A3** reqId undefined 时是否跳过 set | ✅ 安全 | `buildAndRecordToken` 第 101 行 `if (reqId) this.reqTokenMap.set(...)`；release 第 179 行 `if (token.reqId)`。undefined 双向跳过，不污染 map。旧调用方（未传 reqId）兼容。 |
| **A4** 实例级 vs 静态级 / key 冲突 | ✅ 安全 | reqTokenMap 是实例字段（第 35 行，非 static）。单例 SemaphoreManager（buildApp 第 104 行 container.resolve）。reqId 来自 `config.trackerId ?? crypto.randomUUID()`（orchestrator.ts:186），failover 每迭代新 UUID（failover-loop.ts:244）。全局唯一，无跨 provider key 冲突。 |

### B. release 幂等边界 — ✅ 已确认安全

| 检查点 | 结论 | 证据 |
|--------|------|------|
| **B1** token.released 的 TOCTOU（kill 与自然完成并发） | ✅ 无窗口 | Node 单线程，`if (token.released) return; token.released = true;`（第 176-177 行）之间**无 await**，是同步原子操作。killRequest 的 `releaseSlotProvider`（同步 release）与 withSlot finally 的 release 之间即使有微任务调度，release 内部 check+set 同步完成，不存在中间窗口。kill-release.test.ts 竞态用例验证。 |
| **B2** releaseByReqId 不存在时是否抛 TypeError | ✅ noop 不抛 | 第 206 行 `const record = this.reqTokenMap.get(reqId); if (!record) return;`。map.get 返回 undefined 被守卫拦截。kill-release.test.ts "kill 排队中请求（未 acquire）" 显式断言 `not.toThrow()`。 |
| **B3** current 是否可能变负（双重 release） | ✅ 不可能 | 双重 release 被 `token.released` 拦截（第 176 行 return）。generation 不匹配也跳过（第 187 行）。updateConfig 重置 current=0 时递增 generation，旧 token release 因 generation 不匹配 noop，不递减已归零的 current。 |

### C. killRequest 竞态 — ✅ 已确认安全

| 检查点 | 结论 | 证据 |
|--------|------|------|
| **C1** callback + releaseSlotProvider + complete 三步顺序（与自然完成竞态） | ✅ 幂等 | **若自然完成先**：`complete` 内 `killCallbacks.delete(id)`（第 262 行），随后 killRequest 第 274 行 `killCallbacks.get(id)` 返回 undefined → return false，不重复 release。**若 kill 先**：release 置 token.released=true（active--），complete 标记 failed；后续 transport abort resolve → withSlot finally release（released 已 true，noop）。kill-release.test.ts 两个用例分别覆盖。 |
| **C2** killCallbacks 迭代时并发修改 | ✅ 快照防护 | abortAllInflight 第 295 行 `const ids = [...this.killCallbacks.keys()]` 复制快照，循环内 killRequest → delete 不影响迭代。callback() 触发的 reply.destroy → emit close → controller.abort 是同步 EventEmitter 链，不阻塞循环。 |
| **C3** setReleaseSlotProvider 绑定时机（releaseSlotProvider undefined 时降级） | ✅ 安全 | buildApp 第 109 行在 registerRoutes（注册路由接收请求）**之前**绑定。请求到达前 releaseSlotProvider 已就绪。即使未绑定，第 284 行 `this.releaseSlotProvider?.(id)` 可选链 noop（kill 仍执行 callback + complete，仅跳过信号量——但该场景不会发生）。 |

### D. abortAllInflight + shutdown — ✅ 已确认安全

| 检查点 | 结论 | 证据 |
|--------|------|------|
| **D1** close 中 abortAllInflight 与 removeAll 顺序 / release 能否在 removeAll 前完成 | ✅ 顺序正确 | register-routes.ts:137-140 顺序：`closeAllClients → abortAllInflight → removeAll`。abortAllInflight **同步**循环 killRequest → 同步 releaseSlotProvider → release（递减 current + delete map）。removeAll 随后清空 entries。关键：release 第 179 行 `reqTokenMap.delete` 在第 181 行 `entries.get` **之前**，所以即使后续 entry 被清空，map 已先行清理。信号量递减在同步阶段完成，不依赖异步 settle。 |
| **D2** shutdown 期间 reply.destroy 安全性 | ✅ 有防护 | kill callback 内 `try { reply.raw.destroy(); } catch { /* may already be destroyed */ }`（orchestrator.ts:118-119）。reply 已关闭时 destroy 是 noop 或抛错，均被 try-catch 吞掉。closeAllClients 先于 abortAllInflight 执行（第 137 行），SSE 客户端已清空，killRequest 内 complete 的 broadcast 遍历空 set，noop。 |

### E. scope.ts withSlot — ✅ 已确认安全

| 检查点 | 结论 | 证据 |
|--------|------|------|
| **E1** acquire 抛错（未进 try）时是否误调 release / 漏释放 | ✅ 无风险 | `acquire` 在 try 块**之外**（scope.ts:17 `const token = await acquire(...)`）。若 acquire reject（queue full / timeout / abort），异常直接传播到 withSlot 外，**根本不进入 try/finally**，token 未定义也不调 release。acquire 失败时无槽位被占用（排队中被 reject 的 entry 已从 queue.splice 移除，semaphore.ts:151/158），无需释放。✅ 既不误调 releaseByReqId，也不漏释放。 |

---

## INFO（可选改进，不阻塞合并）

### I-1: removeAll / remove 不显式清理 reqTokenMap（最终一致，非泄漏）

- **文件**: `router/src/core/concurrency/semaphore.ts:229-237`（removeAll）、`217-227`（remove）
- **维度**: 内存管理 / 一致性
- **严重程度**: info

**描述**

`removeAll()` 和 `remove(providerId)` 清空 `entries` 但未清理 `reqTokenMap` 中该 provider 的条目。调用方有两处：
1. close 流程（register-routes.ts:140）——前置 `abortAllInflight()` 已同步释放并 delete 所有 inflight 的 map 条目，removeAll 时 map 已空。
2. admin 导入配置（register-hooks.ts:62-63 via StateRegistry.removeAllProviders / removeProvider）——此时可能有 inflight 请求。

**为何不是泄漏**：`release` 第 179 行 `reqTokenMap.delete` 在第 181 行 `entries.get` **之前**执行。inflight 请求自然完成时走 withSlot finally → release，**即使 entry 已被 removeAll 清空（get 返回 undefined），map 条目仍会被 delete**。generation 不匹配的 token（第 187 行）虽跳过递减，但此时 token.released 已置 true（第 177 行）且 map 已 delete（第 179 行）。所以 reqTokenMap 最终一致，无永久泄漏。

**残留窗口**：仅当 inflight 请求既不自然完成也不被 kill（上游 hang 且无超时）时，map 条目存活至请求超时。由既有 `STREAM_TIMEOUT_MS`（默认 3000000ms）兜底，非本次变更引入。

**建议**（可选，提升健壮性）：在 removeAll 中 `this.reqTokenMap.clear()` 或在 remove(providerId) 中过滤删除该 provider 的条目，使"导入配置后立即清空"语义更显式。非必需——当前实现已最终一致。

### I-2: release 签名 `AcquireToken | undefined` 比必需更宽松（继承自 v1）

- **文件**: `router/src/core/concurrency/semaphore.ts:170`
- **维度**: 类型安全（轻微）
- **严重程度**: info

`release(providerId, token: AcquireToken | undefined)`。实际唯一调用方 `scope.ts:withSlot` 的 finally 块中 `token` 恒为 defined（acquire 在 try 外，抛错时不进 try/finally）。`| undefined` 属防御性编码，函数内 `if (!token) return`（第 171 行）已处理。无害。v1 已标注，本次未恶化。保持现状亦可。

---

## 维度通过情况

| 维度 | 结论 |
|------|------|
| 内存安全（reqTokenMap 增长/泄漏） | ✅ 无泄漏路径，自然完成 + kill 双路径均 delete，进程崩溃随进程消失 |
| 竞态（kill vs 自然完成 / TOCTOU） | ✅ Node 单线程 + 同步 check-and-set，无窗口；4 个竞态测试用例覆盖 |
| 幂等（双重 release / releaseByReqId noop） | ✅ token.released 守卫 + map.delete 前置，active 不超减、不抛 TypeError |
| 生命周期（acquire 抛错 / shutdown 顺序 / reply.destroy） | ✅ acquire 失败不误释放；close 顺序 closeAllClients→abortAllInflight→removeAll 正确；destroy 有 try-catch |
| 类型安全 | ✅ 无 any，tsc 0 error（v1 已验） |
| 测试覆盖 | ✅ 24/24 passed，覆盖 kill 已 acquire / kill 排队中 / kill-自然完成竞态 / abortAllInflight 多 provider |

---

## 修复优先级

无 must_fix。I-1 / I-2 为可选改进，不阻塞合并。建议合并前确认 v1 的 MF-1（WeakSet）和 W-1（passThrough error resolve）已修复——本轮范围外，但属同一 PR。
