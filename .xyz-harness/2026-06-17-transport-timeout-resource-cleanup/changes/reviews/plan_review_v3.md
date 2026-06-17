---
verdict: pass
must_fix: 0
---

# 计划评审 v3（终审确认）

## 评审记录
- 评审时间：2026-06-17 12:15
- 评审类型：计划评审（模式一，终审增量确认）
- 评审对象：plan.md + plan-tasks-backend.md + plan-tasks-frontend.md + interface_chain.json + test_cases_template.json + spec.md
- 评审依据：xyz-harness-expert-reviewer SKILL.md「终审模式」——聚焦验证 v1→v2 修复点是否真正解决，不大范围重新挑刺
- 前序审查：plan_review_v1.md（verdict=fail, 1 MUST_FIX）、plan_review_v2.md（verdict=pass, 0 MUST_FIX）
- 源码核验范围：semaphore.ts（acquire 三路径/release/withSlot 调用链）、orchestrator.ts（handle 闭包/trackerReq/kill 回调/executeResilience 独立方法/controller 局部变量）、scope.ts（withSlot 5 参 finally）、resilience.ts（execute while 循环体 + sleep 点）、request-tracker.ts（killRequest/killCallbacks/complete 副作用）、stream.ts（StreamProxy 构造 12 参 + callStream L395-433 闭包 + cleanup + 非 200 分支）

## 评审结论概述

**终审通过。** v1 MUST_FIX #1（kill 同步释放 token 流转）的 v2 修复方案在源码层面**完全可行**，无幻觉路径。v2 引入的 `reqTokenMap: Map<string, TokenRecord>` + `releaseByReqId(reqId)` + `AcquireToken.released` 三件套构成闭合的双向链路，所有改动点都落在现有函数边界内，签名向后兼容。v2 LOW #7（releaseByReqId 的 providerId 来源）与 LOW #8（reqTokenMap 自然完成清理）均已显式纳入 plan-tasks-backend.md Task 6 与 interface_chain.json。Spec Coverage Matrix 14 个 AC（AC-1~AC-13 含 AC-3b）全部有 Task 对应，测试 TC 覆盖全部 AC（含 v2 新增的 TC-9-03 覆盖 AC-5）。

本轮无新增 MUST_FIX。残留项均为 v2 已记录的 LOW/INFO（#6a FG1 文件数、#9 文档清晰度），以及本轮发现的一条 SHOULD_FIX 级实现提示（queued 路径存入时机），均不阻断编码启动。

## 终审重点逐项核验

### 重点 1：v1 MUST_FIX #1（token 流转）修复方案源码层面可行性 ✅

**核验方法**：逐路径对照 semaphore.ts acquire/release 现有实现，验证 plan 改动点的可插入性与语义正确性。

| acquire 返回路径 | 源码位置 | plan 存入点 | 可行性 | 语义核验 |
|------------------|---------|------------|--------|---------|
| bypassed（maxConcurrency=0） | semaphore.ts:88 | `return {generation, bypassed:true}` 前存 map | ✅ | kill 时 releaseByReqId 取 token → release 检查 `token.bypassed===true`（L163）→ return，current 不变（与 acquire 时未递增一致）✓ |
| direct（current<max） | semaphore.ts:91-94 | `entry.current++; return` 之间存 map | ✅ | 正常路径，存入后 releaseByReqId/自然 release 都能命中 ✓ |
| queued-resolve（排队） | semaphore.ts:111-153（Promise executor） | **必须**在 resolve 回调内（L123-127）存，不能在 executor 创建 token（L121）后立即存 | ✅（见下方实现提示） | 排队中被 kill → signal abort → reject（L143-148）→ acquire Promise reject → token 从未存入 map → releaseByReqId noop（AC-10）✓ |

**release 路径核验**（semaphore.ts:158）：
- 当前签名 `release(providerId, token, logger?)`，token 必填 → plan 改 `token?` + 开头 `if (!token) return` + `if (token.released) return`，向后兼容 ✓
- 现有 `if (token.bypassed) return`（L163）与 `generation 不匹配 return`（L165-168）位于 released 检查之后，三者正交，不冲突 ✓
- `released` 字段为可变 boolean，AcquireToken 是普通对象（非 frozen），可加字段 ✓
- LOW #8 清理：「成功递减/dequeue 后同步 `reqTokenMap.delete(reqId)`」——需 token 携带 reqId（acquire 时传入），release 内 `if (token.reqId) this.reqTokenMap.delete(token.reqId)`，1 行实现 ✓

**releaseByReqId 核验**：新增方法 `const record = this.reqTokenMap.get(reqId); if (!record) return; this.release(record.providerId, record.token);`，逻辑闭环，LOW #7 的 providerId 来源由 TokenRecord 结构解决 ✓

**三场景时序复核**（对照实际源码，与 v2 结论一致）：
- 场景 A（kill 已 acquire）：releaseByReqId → release → token.released=true, current-- ✓
- 场景 B（kill 排队中）：reqTokenMap 无条目 → noop；acquire reject → withSlot finally `if(token)` 守卫跳过 release(undefined) ✓（AC-10）
- 场景 C（竞态）：token.released 标志保证只递减一次 ✓（AC-13）

**结论：v1 MUST_FIX #1 修复方案源码层面完全可行，无阻断。**

### 重点 2：v2 LOW #7/#8 是否已纳入 plan ✅

| 问题 | plan-tasks-backend.md Task 6 | interface_chain.json | 状态 |
|------|------------------------------|----------------------|------|
| LOW #7（releaseByReqId providerId 来源） | 「`reqTokenMap` 存 `TokenRecord = { token, providerId }`」+「`releaseByReqId(reqId)`：取 TokenRecord 拿到 `{token, providerId}`，调 `release(providerId, token)`」 | releaseByReqId.edge_cases：「取 TokenRecord{token,providerId} 后 release（幂等）」 | ✅ 已纳入 |
| LOW #8（reqTokenMap 自然完成清理） | 「`release(providerId, token)` 成功递减/dequeue 后，**同步 `reqTokenMap.delete(reqId)`**」+「token 需记录所属 reqId」 | release.edge_cases：「成功后同步 reqTokenMap.delete(reqId)（自然完成自动清理）」 | ✅ 已纳入 |

### 重点 3：关键文件改动点落地性（无幻觉路径核验） ✅

逐文件核验改动点是否都在现有代码作用域内：

**orchestrator.ts**：
- `trackerReq`（L95 buildActiveRequest 返回）的 `.id` 在 withSlot 调用点（L112）同作用域 → 可作第 6 参传入 ✓
- kill 回调（L98-103，注册于 trackerScope.track 的 fn 内即 tracker.start 之后）回调体仅 `controller.abort(); reply.raw.destroy()`，无 token 引用 → 与 v2「release 走 reqId 反查」设计一致，注册时机不再构成障碍 ✓
- close handler 当前监听 `request.raw`（L96），plan Task 4 改 `reply.raw.on("close")` + `writableEnded`，reply 是 handle 参数在作用域内 ✓
- `controller`（L92 new AbortController）是 handle 局部变量；executeResilience 是独立私有方法（L228），plan 通过「executeResilience 加第 3 参 signal?」传入，调用点 L239 传 controller.signal → resilience.execute 第 4 参 ✓（plan Task 4 已列两个选项，实现者选直接传入即可）
- HandleContext.transportFn 接口（L48）签名需同步加 `signal?`，隐含在 Task 4「transportFn 接收并传递 signal」内 ✓

**resilience.ts execute**（L198-202）：
- 当前 3 参签名，plan 加第 4 参 `signal?` 向后兼容 ✓
- while(true) 循环（L214+）：iteration cap 检查（L215）、available 过滤（L226）、`fn(currentTarget)`（L243）、`await sleep(decision.delayMs)`（L291）—— plan 的 signal.aborted 短路检查插入点（顶部 + sleep 后）都在循环体内，逻辑清晰 ✓

**scope.ts withSlot**（L8-19）：
- 当前 5 参，plan 加第 6 参 `reqId?` 透传给 acquire ✓
- finally 当前 `this.manager.release(providerId, token)`（L18），plan 改 `if (token) release(token)` —— acquire 抛错时 token 为 undefined（await 抛错未赋值），跳过 ✓

**request-tracker.ts**：
- killCallbacks 字段已存在（L65）✓
- killRequest（L228-246）当前 `callback(); if(activeMap.has(id)) complete(id,...)`，plan 在 complete 后加 `releaseSlotProvider?.(id)` ✓
- setReleaseSlotProvider 存独立字段（如 `private releaseSlotProvider?`），不受 complete 内 `killCallbacks.delete(id)`（L186）影响 ✓
- abortAllInflight（Task 7）遍历 killCallbacks ✓

**stream.ts**：
- StreamProxy 构造当前 12 参（L55-67），plan Task 2 加 upstreamRes/upstreamReq 两实例字段 ✓
- callStream（L395-433）创建 StreamProxy（L419-423）时 upstreamRes（L398 response callback 参数）与 upstreamReq（L414）均在闭包作用域内 → 可传入 ✓
- cleanup（L137-142）当前 destroy 3 个 Transform，plan 加 `this.upstreamRes?.destroy(); this.upstreamReq?.destroy()`，幂等（destroyed 检查）✓
- 非 200 分支（L404-414）当前仅 data/end listener，plan Task 2 补 `upstreamRes.on("error", effectiveResolve.bind(null, {kind:"throw", error}))`，与 callNonStream 对称 ✓

**结论：所有关键文件改动点均在现有代码边界内，无幻觉路径。**

### 重点 4：Spec Coverage Matrix 14 个 AC 全部有 Task 对应 ✅

| AC | Task | 核验 |
|----|------|------|
| AC-1 | 6 | ✓ |
| AC-2 | 6 | ✓ |
| AC-3 | 1,4 | ✓ |
| AC-3b | 1,4 | ✓ |
| AC-4 | 1 | ✓ |
| AC-5 | 8 | ✓ |
| AC-6 | 10 | ✓ |
| AC-7 | 8,10 | ✓ |
| AC-8 | 2 | ✓ |
| AC-9 | 4 | ✓ |
| AC-10 | 6 | ✓ |
| AC-11 | 7 | ✓ |
| AC-12 | 3 | ✓ |
| AC-13 | 6 | ✓ |

spec.md Acceptance Criteria 共 14 条（AC-1~AC-13 + AC-3b），plan.md Coverage Matrix 14 行，一一对应，无遗漏。✓

### 重点 5：测试 TC 覆盖全部 AC ✅

核验 test_cases_template.json（17 个 TC）实际存在性与 AC 映射：

| AC | TC | 核验 |
|----|----|------|
| AC-1 | TC-1-01 | ✓ 存在 |
| AC-2 | TC-1-02 | ✓ 存在 |
| AC-3, AC-9 | TC-2-01 | ✓ 存在（描述含 AC-3, AC-9） |
| AC-3b | TC-2-02 | ✓ 存在 |
| AC-4 | TC-3-01, TC-3-02 | ✓ 存在（流式 + 非流式） |
| AC-5 | TC-9-03 | ✓ 存在（v2 新增，已确认） |
| AC-8 | TC-4-01, TC-4-02 | ✓ 存在（loop_detection + upstream_error） |
| AC-10 | TC-5-01 | ✓ 存在 |
| AC-11 | TC-6-01 | ✓ 存在 |
| AC-12 | TC-7-01 | ✓ 存在 |
| AC-13 | TC-8-01 | ✓ 存在 |
| AC-6 | TC-10-01 | ✓ 存在 |
| AC-7 | TC-10-02 | ✓ 存在 |

全部 14 个 AC 均有 TC 覆盖，无缺口。✓

## 本轮发现（均非阻断）

### SHOULD_FIX（实现提示，不计入 must_fix）

| # | 位置 | 描述 | 建议 |
|---|------|------|------|
| 10 | semaphore.ts acquire queued 路径（L111-153）/ plan-tasks-backend.md Task 6 | **queued 路径 reqTokenMap 存入时机需明确**。token 在 Promise executor 内创建（L121），若实现者在创建后立即 `reqTokenMap.set`，则排队中被 kill 时 map 已有条目 → releaseByReqId 取到 token 并调 release → 此时 acquire Promise 尚未 resolve、withSlot 仍 await，token.generation 匹配当前 generation → release 会**错误递减 current 或 dequeue 下一个 waiter**，破坏并发度计数。正确做法是存入点放在 resolve 回调（L123-127）内，即 `resolve: () => { reqTokenMap.set(reqId, {token, providerId}); resolve(token); }`。plan Task 6 的「场景覆盖验证」已通过「kill 排队中请求（无 token）→ noop」隐含表达此意图，但文字「acquire 成功时若传 reqId 存入」的「成功」一词对实现者有歧义。 | 在 Task 6 显式补一句：「queued 路径的 reqTokenMap.set 必须在 resolve 回调内执行（token 实际授予时），不能在 Promise executor 创建 token 后立即存入，否则排队中被 kill 会误减 current」。设计意图清晰，属实现顺序提示，不阻断。 |

### v2 残留项（沿用，不阻断）

| # | 级别 | 位置 | 状态 |
|---|------|------|------|
| 6a | LOW | plan.md FG1 文件数 11 略超 ≤10 建议 | open（单字段对称强内聚，不阻断） |
| 9 | INFO | interface_chain.json flow-kill 引用 complete()/releaseSlotProvider | open（既有/注入实体，非悬空引用） |

## 终审等级判定

- **无 MUST_FIX**：所有阻断性维度（路径正确性、接口落地性、AC 覆盖、签名与代码一致性）均通过。
- **SHOULD_FIX #10 判定依据**：设计意图清晰（plan 场景验证已隐含），仅文字措辞对实现者有轻微歧义，属编码阶段可消化的实现提示，不满足 MUST_FIX 校准口径（无路径错误/接口无法落地/AC 未覆盖/签名矛盾）。
- **前序 MUST_FIX #1 已 resolved**：v1→v2 修复经本轮源码逐路径复核确认成立。

## 结论

**通过（终审）。** v1 MUST_FIX #1 的 v2 修复方案在源码层面完全可行，reqTokenMap/releaseByReqId/token.released 三件套闭合双向链路，三场景时序正确。v2 LOW #7/#8 已纳入 plan。14 个 AC 全部有 Task + TC 覆盖。关键文件改动点无幻觉路径。残留 1 SHOULD_FIX（queued 存入时机文字提示）+ 2 v2 LOW/INFO，均不阻断编码启动。

可进入编码阶段。编码时注意 SHOULD_FIX #10 的实现顺序提示。

## Summary

终审通过，0 MUST_FIX。v1→v2 修复链路经源码逐路径复核确认可行（acquire 三路径存入点/release 幂等/releaseByReqId 闭环/withSlot 守卫均落地），LOW #7/#8 已纳入 plan，14 AC 全覆盖（Task + TC）。1 SHOULD_FIX（queued 路径存入时机文字提示，不阻断）+ 2 v2 残留 LOW/INFO。
