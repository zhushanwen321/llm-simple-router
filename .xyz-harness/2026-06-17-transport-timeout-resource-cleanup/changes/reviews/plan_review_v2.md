---
review:
  type: plan_review
  round: 2
  timestamp: "2026-06-17T11:30:00"
  target: ".xyz-harness/2026-06-17-transport-timeout-resource-cleanup/plan.md (+ plan-tasks-backend.md, plan-tasks-frontend.md, interface_chain.json, test_cases_template.json)"
  verdict: pass
  summary: "计划评审完成，第2轮（增量复核），v1 MUST_FIX #1 已解决，0条 open MUST_FIX，通过"

statistics:
  total_issues: 9
  must_fix: 0
  must_fix_resolved: 1
  low: 4
  info: 1

issues:
  - id: 1
    severity: MUST_FIX
    location: "plan-tasks-backend.md §Task 6 / interface_chain.json §release+releaseByReqId / data_flows flow-kill"
    title: "kill 同步释放链路 token 流转缺失，接口契约无法落地"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
  - id: 2
    severity: LOW
    location: "plan-tasks-backend.md §Task 4（close handler 幂等）"
    title: "close handler 幂等模式使用 `as any` 违反 no-explicit-any lint"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
  - id: 3
    severity: LOW
    location: "test_cases_template.json TC-9-03"
    title: "AC-5（流式 STREAMING idle 超时）无对应 TC"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
  - id: 4
    severity: LOW
    location: "plan-tasks-backend.md §Task 4 Files"
    title: "scope.ts 在 Task 4/Task 6 双重归属"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
  - id: 5
    severity: LOW
    location: "plan-tasks-frontend.md §Task 10 ModelCapabilitiesEditor.vue"
    title: "ModelCapabilitiesEditor.vue stream_timeout_ms 镜像点未穷举"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
  - id: 6
    severity: LOW
    location: "plan.md §Execution Groups FG1 / interface_chain.json data_flows flow-kill"
    title: "FG1 文件数 11 略超上限；flow-kill 命名混用"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 7
    severity: LOW
    location: "plan-tasks-backend.md §Task 6 releaseByReqId / reqTokenMap 定义"
    title: "releaseByReqId 缺 providerId 来源（reqTokenMap 只存 token）"
    status: open
    raised_in_round: 2
    resolved_in_round: null
  - id: 8
    severity: LOW
    location: "plan-tasks-backend.md §Task 6 reqTokenMap 生命周期"
    title: "自然完成路径 reqTokenMap 清理机制未点明（潜在内存泄漏）"
    status: open
    raised_in_round: 2
    resolved_in_round: null
  - id: 9
    severity: INFO
    location: "interface_chain.json data_flows flow-kill"
    title: "flow-kill 引用 complete()/releaseSlotProvider 未列入 methods[]（既有/注入实体，可接受）"
    status: open
    raised_in_round: 2
    resolved_in_round: null
---

# 计划评审 v2（增量复核）

## 评审记录
- 评审时间：2026-06-17 11:30
- 评审类型：计划评审（模式一，增量审查模式）
- 评审对象：plan.md + plan-tasks-backend.md + plan-tasks-frontend.md + interface_chain.json + test_cases_template.json
- 评审依据：xyz-harness-expert-reviewer SKILL.md「模式一：计划评审」+「增量审查模式」
- 源码核验范围：semaphore.ts（acquire/release/withSlot）、orchestrator.ts（kill callback 注册时机、reqId 可获取性、withSlot 调用点）、request-tracker.ts（killRequest 现状）、scope.ts（withSlot finally 模式）

## 评审结论概述

**v1 MUST_FIX #1（kill 同步释放 token 流转链路）已彻底解决。** v2 引入 `SemaphoreManager.reqTokenMap` + `releaseByReqId(reqId)` + `AcquireToken.released` 标志，构成完整、可执行的闭环设计。经源码逐场景验证：

- **reqId 可达性**：`trackerReq.id`（orchestrator.ts:95）在 `withSlot` 调用点（:112）处于同一作用域，作为第 6 参传入无障碍。kill 回调（:98-103）不需捕获 token——`releaseByReqId` 通过 reqId 反查 reqTokenMap，从根本上规避了 v1 指出的「token 是 withSlot 内部局部变量、kill 回调闭包无法捕获」问题。
- **三场景验证**（已逐个对照 semaphore.ts/request-tracker.ts/orchestrator.ts 源码）：
  - kill 已 acquire 请求 → releaseByReqId 取 token → current 递减 ✓（AC-1/AC-2）
  - kill 排队中请求（acquire 未 resolve）→ reqTokenMap 无条目 → noop，不抛 TypeError ✓（AC-10）
  - kill 与自然完成竞态 → token.released 标志保证只递减一次 ✓（AC-13）
- **无双重 release**：Node 单线程下 release() 与 releaseByReqId() 同步执行，token.released 检查+置位原子完成。

v1 的 5 条 LOW 全部处理（详见下表），未引入阻断性新问题。残留 3 条 LOW + 1 INFO 均为实现细节/文档清晰度，不阻断 plan 可执行性。

## v1 MUST_FIX #1 修复验证（核心）

### 设计闭环核对

| 环节 | v1 状态 | v2 设计 | 源码核验 |
|------|---------|---------|---------|
| token 存储位置 | 无（withSlot 内部局部变量） | `reqTokenMap: Map<string, AcquireToken>`，acquire 成功时按 reqId 存入 | semaphore.ts acquire 现有 3 条返回路径（bypassed/direct/queued-resolve）均可插入存储点 ✓ |
| kill 路径取 token | 无（releaseSlotProvider 签名无 token，edge_case「undefined→return」=空操作） | `releaseByReqId(reqId)` 从 reqTokenMap 取 token 后调 release | 新增方法，逻辑清晰 ✓ |
| reqId 来源 | 未定义 | orchestrator 从 `trackerReq.id` 传入 withSlot 第 6 参 → acquire | trackerReq.id 在 withSlot 调用点作用域内 ✓ |
| 幂等防双重 release | clarification G-020 提了 releasedReqIds 但未落地 | `AcquireToken.released: boolean`，release() 开头检查 | 与现有 generation/bypassed 检查正交，向后兼容 ✓ |
| kill 回调注册时机冲突 | v1 担心回调早于 acquire 无法捕获 token | 回调只做 controller.abort()+reply.destroy()，**完全不依赖 token**；releaseByReqId 在 killRequest 中按 reqId 反查 | orchestrator.ts:98-103 回调体确认无 token 引用 ✓ |

### 三场景时序验证（对照实际源码）

**场景 A — kill 已 acquire 请求（transport 进行中）：**
```
acquire(providerId, ..., reqId=X) → token T 存入 reqTokenMap[X], current++
transport 进行中
killRequest(X):
  1. callback() → controller.abort() → [async] transport resolve throw
  2. complete(X) [同步]
  3. releaseSlotProvider(X) → releaseByReqId(X) → T → release → T.released=true, current--  ✓
[async] transport resolve → fn() return → withSlot finally release(T) → T.released=true → noop  ✓
```

**场景 B — kill 排队中请求（acquire 未 resolve）：**
```
acquire 进入 queue（token T 在 Promise 内创建但未 resolve，**未存入 reqTokenMap**）
killRequest(X):
  1. callback() → controller.abort() → acquire queue entry 的 signal listener 同步触发 → reject(AbortError) [microtask]
  2. complete(X) [同步]
  3. releaseSlotProvider(X) → releaseByReqId(X) → reqTokenMap 无 X → noop  ✓ (不递减，不抛 TypeError)
[microtask] acquire reject → withSlot acquire 抛错 → finally: token undefined → 跳过 release(undefined)  ✓ (AC-10)
```

**场景 C — kill 与自然完成竞态：**
```
顺序1: transport 先 resolve → withSlot finally release(T) → T.released=true, current--
       → killRequest → releaseByReqId(X) → T.released=true → noop  ✓
顺序2: killRequest 先 → releaseByReqId(X) → T.released=true, current--
       → transport resolve → withSlot finally release(T) → noop  ✓
```

**结论：v1 MUST_FIX #1 完全解决。** reqId 流转链路（orchestrator→withSlot→acquire→reqTokenMap）与反向链路（killRequest→releaseSlotProvider→releaseByReqId→release）双向闭合，token.released 提供终态幂等。

## v1 LOW 项处理状态

| # | v1 LOW | v2 处理 | 状态 |
|---|--------|---------|------|
| 2 | `as any` 幂等模式 | Task 4 改为「模块级 `WeakSet<FastifyReply["raw"]>` 避免 any」 | ✅ resolved |
| 3 | AC-5 无 TC | test_cases_template 新增 TC-9-03（注入 stream_timeout_ms=200，mock 首 chunk 后停顿，验证 idle_timeout） | ✅ resolved |
| 4 | scope.ts 双重归属 | Task 4 Files 已移除 scope.ts，归属明确归于 Task 6 | ✅ resolved |
| 5 | ModelCapabilitiesEditor 镜像点 | Task 10 显式列出 3 处（L98 默认值/L131 序列化/L289 prop+emit） | ✅ resolved |
| 6a | FG1 文件数 11 超 ≤10 | 未补豁免说明 | ⚠️ open（仍 LOW，单字段对称强内聚，不阻断） |
| 6b | flow-kill 命名混用 | data_flows 改用 `releaseByReqId(reqId)`（methods[] 真实方法），消除 releaseSlotProvider(id,providerId) 旧签名 | ✅ resolved |

## 修复引入的新问题（均 LOW/INFO，不阻断）

| # | 优先级 | 位置 | 描述 | 修改建议 |
|---|--------|------|------|---------|
| 7 | LOW | plan-tasks-backend.md §Task 6 releaseByReqId | **releaseByReqId 缺 providerId 来源**。reqTokenMap 定义为 `Map<string, AcquireToken>`，但 releaseByReqId 的设计意图是「取 token 后调 release(providerId, token)」——release 必填 providerId，而 map value 只有 token。实现者需自行决定 providerId 来源，plan 未点明。 | 明确 reqTokenMap value 结构为 `{ token: AcquireToken; providerId: string }`，或在 AcquireToken 加 readonly providerId 字段。两者均为 1 行类型变更，不涉及架构调整。 |
| 8 | LOW | plan-tasks-backend.md §Task 6 reqTokenMap 生命周期 | **自然完成路径 map 清理机制未点明**。plan 写「release 时删除映射」，但自然完成走 withSlot finally 的 `release(providerId, token)`（无 reqId 参数），如何反查 reqId 删除条目未说明。reqId 为 UUID 不复用，故无正确性问题，仅长期运行内存增长。 | 二选一：(a) AcquireToken 加 readonly reqId，release() 据 token.reqId 删 map；(b) 在 release() 内反查 reqTokenMap 删除。与 #7 合并处理最简：token 同时带 reqId+providerId，release 一次性清理。 |
| 9 | INFO | interface_chain.json data_flows flow-kill | flow-kill chain 含 `complete(id)`、`releaseSlotProvider(id)` 两节点未列入 methods[]。complete 是既有未改方法，releaseSlotProvider 是 setReleaseSlotProvider 注入的实例——均非悬空引用（代码库存在），L2 交叉检查的「悬空」语义不适用。 | 可选：methods[] 补 complete 行并标「unchanged」，或将 chain 中非新增方法用文字描述区分。纯文档清晰度，不影响执行。 |

### 等级判定校验

- **#7/#8 判 LOW 依据**：两者均为「设计意图明确（plan 写明调 release(providerId, token)）、数据结构字段缺失」型细节。实现者看到 `release(providerId, token)` 调用而 map 无 providerId，会立即补字段——不存在「设计决策分歧」。对比 v1 #1（需在 option A/B 间做架构选择），本质不同。不满足 MUST_FIX 校准口径（无数据丢失/功能失效/语义错误/重复副作用/时序错误）。
- **#9 判 INFO 依据**：纯文档完备性，complete() 存在于 request-tracker.ts:166，非悬空。

## 源码核验补充（本轮新增）

| 验证项 | 现状 | v2 plan 对应 | 结论 |
|--------|------|-------------|------|
| withSlot finally 模式 | `try { fn() } finally { release(providerId, token) }`（scope.ts:14-19），token 在 acquire 抛错时为 undefined 仍会传入 release | plan 加 `if (token) release(token)` 守卫 | ✓ acquire 抛错场景（排队被 kill）token undefined 跳过，AC-10 落地 |
| killRequest 现状 | callback()+`if(activeMap.has(id)) complete(id)`（request-tracker.ts:245-260），无 release 调用 | plan 在 complete 后加 `releaseSlotProvider?.(id)` | ✓ 注入点清晰，reqId 即 killRequest 的 id 参数 |
| kill 回调体 | `controller.abort(); reply.raw.destroy()`（orchestrator.ts:99-102），无 token 引用 | v2 设计 kill 回调不变，release 走 reqId 反查 | ✓ 回调注册时机（早于 acquire）不再构成障碍 |
| reqId 作用域 | `trackerReq`（orchestrator.ts:95）定义于 handle() 内，withSlot 调用（:112）同作用域 | plan 加 withSlot 第 6 参 reqId = trackerReq.id | ✓ 可直接传入 |
| token.released 与 generation 正交 | release 现有 generation 检查（semaphore.ts:158）在 released 检查之后还是之前？ | plan released 检查放开头 | ✓ released 先判（更便宜），generation 兜底（updateConfig 重置后旧 token 不误减），两者不冲突 |

## Spec Coverage 复核（增量）

- AC-1/AC-2/AC-13（v1 阻断的 3 个 AC）：Task 6 接口契约现已可落地，TC-1-01/TC-1-02/TC-8-01 覆盖。✅
- AC-5：TC-9-03 补齐。✅
- AC-10：TC-5-01（kill 排队中）+ withSlot `if(token)` 守卫。✅
- 其余 AC-3/3b/4/6/7/8/9/11/12 覆盖矩阵 v1 已确认，本轮无回归。✅

## 结论

**通过。** v1 MUST_FIX #1 已通过 reqTokenMap + releaseByReqId + token.released 三件套彻底解决，源码逐场景验证闭环成立。v1 全部 LOW 已处理（除 #6a FG1 文件数仍标 LOW 不阻断）。新增 3 项均为实现细节（#7/#8）或文档清晰度（#9），不阻断编码启动。

## Summary

计划评审完成，第2轮（增量复核）通过，0条 open MUST_FIX。v1 MUST_FIX #1（kill 同步释放 token 流转）已解决——reqId 流转链路双向闭合，三场景（已acquire/排队中/竞态）均正确，无双重 release。残留 3 LOW（releaseByReqId providerId 来源、reqTokenMap 自然完成清理、FG1 文件数）+ 1 INFO，均为实现细节，可在编码阶段处理。可进入编码。
