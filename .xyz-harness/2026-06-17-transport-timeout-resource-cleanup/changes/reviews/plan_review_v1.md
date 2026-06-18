---
review:
  type: plan_review
  round: 1
  timestamp: "2026-06-17T10:42:00"
  target: ".xyz-harness/2026-06-17-transport-timeout-resource-cleanup/plan.md (+ plan-tasks-backend.md, plan-tasks-frontend.md, interface_chain.json, e2e-test-plan.md, test_cases_template.json)"
  verdict: fail
  summary: "计划评审完成，第1轮，1条 MUST FIX（Task 6 kill 同步释放接口落地断层），需修改后重审"

statistics:
  total_issues: 6
  must_fix: 1
  must_fix_resolved: 0
  low: 5
  info: 0

issues:
  - id: 1
    severity: MUST_FIX
    location: "plan-tasks-backend.md §Task 6 / interface_chain.json §release / spec FR-2 AC-1 AC-2 AC-13"
    title: "kill 同步释放链路 token 流转缺失，接口契约无法落地"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 2
    severity: LOW
    location: "plan-tasks-backend.md §Task 4"
    title: "close handler 幂等模式使用 `as any` 违反 no-explicit-any lint"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 3
    severity: LOW
    location: "test_cases_template.json / e2e-test-plan.md"
    title: "AC-5（流式 STREAMING idle 超时）无对应 TC"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 4
    severity: LOW
    location: "plan-tasks-backend.md §Task 4 Files / plan.md BG2"
    title: "scope.ts 在 Task 4/Task 6 双重归属，文件计数与所有权歧义"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 5
    severity: LOW
    location: "plan-tasks-frontend.md §Task 10"
    title: "ModelCapabilitiesEditor.vue 的 stream_timeout_ms 镜像点未穷举"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 6
    severity: LOW
    location: "plan.md §Execution Groups FG1 / interface_chain.json data_flows"
    title: "FG1 文件数 11 略超上限；flow-kill 混用 releaseSlotProvider/setReleaseSlotProvider 命名"
    status: open
    raised_in_round: 1
    resolved_in_round: null
---

# 计划评审 v1

## 评审记录
- 评审时间：2026-06-17 10:42
- 评审类型：计划评审（模式一）
- 评审对象：plan.md + plan-tasks-backend.md + plan-tasks-frontend.md + interface_chain.json + e2e-test-plan.md + test_cases_template.json + use-cases.md + non-functional-design.md
- 评审依据：xyz-harness-expert-reviewer SKILL.md「模式一：计划评审」检查维度
- 源码核验范围：orchestrator.ts、resilience.ts、semaphore.ts、scope.ts、request-tracker.ts、stream.ts、http.ts、transport-fn.ts、iteration-setup.ts、db/providers.ts、model-context.ts、admin/providers.ts、register-routes.ts、前端 stream_timeout_ms 全部消费点

## 评审结论概述

spec 完整性好——13 个 AC（含 AC-3b）均可测试，10 个 FR 全部 adopted 并映射到 Task，Coverage Matrix 与 Metrics Traceability 无遗漏，retry headersSent 明确 postponed 并声明原因。plan 的 transport signal 透传（FR-1）、StreamProxy cleanup（FR-6）、getModelTimeouts 重构（FR-4）、close handler 修复（FR-10）等主线设计在现有源码上均可落地（已逐文件验证签名与改动点）。

**阻断点集中在 FR-2 / Task 6 的 kill 同步释放机制**：interface_chain 中 `release` 的 edge_case「token undefined → return」与 kill 路径的 `releaseSlotProvider(reqId, providerId)` 签名矛盾——后者不携带 token，而 token 是 `SemaphoreScope.withSlot` 内部的局部变量，kill 回调注册时机（orchestrator.ts:108，acquire 之前）决定它无法闭包捕获 token。plan 未定义 token 如何从 withSlot 流转到 release 回调，也未提供 `forceRelease(providerId)` 等替代路径，导致 AC-1/AC-2/AC-13 的「同步释放 + 幂等」无法按描述实现。

## 源码核验摘要（可行性确认）

| 验证项 | 现状 | plan 改动 | 可行性 |
|--------|------|----------|--------|
| StreamProxy 持有 upstreamRes/upstreamReq | 构造函数仅收 `upstreamRes.headers`（stream.ts:42-54），两个对象是 callStream 内局部变量 | Task 2 增 2 个构造参数，callStream 传入（两引用均在作用域内） | ✅ 可落地 |
| callStream 非 200 早分支缺 error listener | 确认只有 data/end（stream.ts:404-414），FR-1 destroy 会触发悬空 error | Task 2/FR-7 补 `upstreamRes.on("error", effectiveResolve.bind(null,{kind:"throw",error}))` | ✅ 与 callNonStream 对称 |
| orchestrator close handler | `request.raw.on("close")` + `readableEnded` 守卫（orchestrator.ts:100-105），对已解析 body 的 POST 永远 false | Task 4 改 `reply.raw.on("close")` + `writableEnded` | ✅ 两对象均在作用域 |
| resilience.execute signal 注入 | 3 参数签名（resilience.ts:198），调用点 `execute(targets, fn, config)`（orchestrator.ts:241） | Task 4 加第 4 参 `signal?`，fn 签名加 `signal?`，调用点 `fn(currentTarget)`→`fn(currentTarget, signal)` | ✅ 向后兼容 |
| semaphore.release 签名 | `release(providerId, token: AcquireToken, logger?)`（semaphore.ts:158），token 必填 | interface_chain 改 `token?` + released 标志 | ⚠️ 见 MUST_FIX #1 |
| withSlot token 暴露 | `withSlot` 内部 acquire，token 不暴露给 fn 或调用方（scope.ts:10-20） | Task 6 需 token 流转到 kill 回调 | ❌ 见 MUST_FIX #1 |
| killRequest 同步释放 | 现仅调 callback（request-tracker.ts:230-246），callback 内 `controller.abort()+reply.destroy()`，无 semaphore 释放 | Task 6 增 `releaseSlotProvider(reqId, providerId)` | ⚠️ 见 MUST_FIX #1 |
| abortAllInflight | 不存在；killCallbacks 已有（request-tracker.ts:65） | Task 7 遍历 killCallbacks | ✅ 字段就绪 |
| DEFAULT_STREAM_TIMEOUT_MS | 600_000（db/providers.ts:33），前端 30_000（constants.ts:3） | 统一 300_000 | ✅ 已确认不一致 |
| getModelTimeouts 调用点 | iteration-setup.ts:165 单处调用 getModelStreamTimeout | 拆分为返回对象 | ✅ 调用点唯一 |
| parseModels / ModelEntry 镜像 | model-context.ts:13/278/300 三处 stream_timeout_ms | Task 8 对称加 non_stream_timeout_ms | ✅ |
| admin TypeBox schema | providers.ts:173/174/196/197 + extractModelOverrides:104 | Task 8 镜像 | ✅ 行号准确 |
| 前端 11 文件消费点 | grep 确认 11 文件含 stream_timeout_ms | Task 9/10 对称处理 | ✅ |
| close() shutdown | register-routes.ts:129-152，tracker/semaphoreManager 均在作用域 | Task 7 在 removeAll 前 abortAllInflight | ✅ 顺序正确 |

### 发现的问题

| # | 优先级 | 文件/位置 | 描述 | 修改建议 |
|---|--------|----------|------|---------|
| 1 | MUST FIX | plan-tasks-backend.md §Task 6 / interface_chain.json §release | **kill 同步释放链路 token 流转缺失**。`releaseSlotProvider(reqId, providerId)` 签名不含 token；`SemaphoreManager.release(providerId, token?, logger?)` 的 edge_case 声明「token undefined → return」。但 token 是 `SemaphoreScope.withSlot`（scope.ts:11）内部 `await acquire(...)` 的局部变量，从不暴露给 fn 或调用方。kill 回调在 orchestrator.ts:108 注册（`trackerScope.registerKillCallback`），早于 withSlot 的 acquire（同一 track→withSlot 调用链内 acquire 在 fn 执行时才发生），闭包无法捕获 token。结果：kill 路径 `releaseSlotProvider(id, providerId) → release(providerId, undefined) → return` 是空操作，无法递减 `SemaphoreEntry.current`，FR-2「不依赖 transport 异步结束」、AC-1/AC-2/AC-13 无法按描述实现。clarification.md 的 G-020 只厘清了「幂等去重」（releasedReqIds + token.released），未解决「token 如何到达 release 调用」这一前置问题。 | 二选一补全设计：(A) 修改 `withSlot` 签名暴露 token 给一个 `onAcquired?: (token) => void` 回调，orchestrator 在回调中把 token 存入 per-request Map（reqId→token），`releaseSlotProvider` 查 Map 取 token 后调 `release(providerId, token)`；(B) 新增 `SemaphoreManager.forceRelease(providerId, reqId)` 方法直接递减 current 并用 reqId 做幂等（独立于 token 路径），interface_chain 需补该方法。选定后同步更新 Task 6 接口签名、interface_chain.json 的 release/新增方法、data_flows flow-kill 链。 |
| 2 | LOW | plan-tasks-backend.md §Task 4（close handler 幂等代码块） | 建议的 `(reply.raw as any).__abortListenerAttached` 模式违反项目 `@typescript-eslint/no-explicit-any: error`（CLAUDE.md 质量门禁 + taste-lint）。两次 `as any` 会在 `npm run lint -w router` 报错。 | 改用模块级 `WeakSet<FastifyReply>`（如 `const abortAttached = new WeakSet<FastifyReply>()`）判重，或为 FastifyReply 做 declaration merging 增加标记字段。无需改语义。 |
| 3 | LOW | test_cases_template.json / e2e-test-plan.md 场景 7 | AC-5（流式 STREAMING 阶段 chunk 间隔超 stream_timeout_ms → 超时结束）在 test_cases_template 无对应 TC。e2e-test-plan 场景 7 标题含 AC-5 但步骤聚焦配置端到端，未实际构造「mid-stream chunk gap」触发 idle 超时。本轮把流式默认值从 600s 收紧到 300s，缺少回归保护。 | 新增 TC（如 TC-3-03）：mock 上游发首个 chunk 后停发，注入 stream_timeout_ms=200ms，验证 STREAMING 阶段 idle 超时触发 stream_abort。 |
| 4 | LOW | plan-tasks-backend.md §Task 4 Files / plan.md §BG2 | Task 4 的 Files 列表含 `scope.ts（withSlot acquire 抛错防护，见 Task 6）`，但实际改动归属 Task 6（Task 6 Files 也列 scope.ts）。subagent 执行 Task 4 时可能误改 scope.ts 造成与 Task 6 冲突；BG2「~7 modify」文件计数因此可能虚高。 | 从 Task 4 Files 移除 scope.ts 行（仅保留交叉引用文字于「关键改动」正文），把 scope.ts 所有权明确归于 Task 6；重核 BG2 文件计数。 |
| 5 | LOW | plan-tasks-frontend.md §Task 10 | `ModelCapabilitiesEditor.vue` 现有 3 处 stream_timeout_ms（L98 默认值、L131 序列化 `ms && ms > 0 ? ms : null`、L289 prop 绑定）。Task 10 仅显式提「prop + emit + updateModelNonStreamTimeout」，L98 默认值与 L131 序列化镜像点未点名。虽可由 Task 9 的「凡 stream_timeout_ms 处对称加 non」通则推导，但 Task 10 把该文件列为自有文件却未列全镜像点，易遗漏。 | 在 Task 10 显式列出 ModelCapabilitiesEditor.vue 的 3 处镜像点（默认值/序列化/prop），或把该文件的类型+默认+序列化归入 Task 9、UI prop 归入 Task 10，划清边界。 |
| 6 | LOW | plan.md §Execution Groups FG1 / interface_chain.json data_flows | (a) FG1 标注「~11 modify」文件，超过 Execution Groups 检查项「每组文件数 ≤ 10」的建议值；11 个文件均为单字段对称追加、耦合度高，可接受但建议在 plan 注明豁免理由或拆 Task 9 为 type 层 / composable 层两组。(b) data_flows flow-kill 链引用「releaseSlotProvider(id, providerId)」作为节点，但 methods[] 表中对应方法是 `setReleaseSlotProvider`（setter），链中用的是注入后的函数实例，命名不一致易让读者误以为有同名方法。 | (a) FG1 补一句「11 文件均为单行对称镜像，强内聚不拆」或拆组；(b) flow-kill 节点改为「setReleaseSlotProvider 注入的回调(id, providerId)」或在 methods 表加注释说明 releaseSlotProvider 是 setReleaseSlotProvider 注入的可调用实例。 |

### 等级判定校验

- **#1 判 MUST_FIX 依据**：满足「接口无法落地」+「数据语义错误」双口径——按 interface_chain 字面实现，kill 同步释放是 no-op，生产环境 kill 后并发度不下降（正是本需求要修的原始 bug），属「功能失效」。澄清文档 G-020 已自标「plan 阶段需厘清」却只解决幂等未解决 token 流转，属未完成的前置设计。
- **#2-#6 判 LOW 依据**：均为实现细节/lint 适配/测试补强/文档清晰度，不阻断 plan 可执行性，且都有明确修复方向。AC-5（#3）虽是覆盖缺口，但 spec 已声明「保留现有 idle 行为」，且 idle 超时机制本身不在本次改动范围（仅默认值变化），降为 LOW 合理。

### Spec Coverage 复核

- 13 个 AC（AC-1~AC-13 含 AC-3b）在 Spec Coverage Matrix 均有对应行，Task 映射正确。✅
- 10 个 FR 在 Metrics Traceability 全部 adopted，retry headersSent postponed 并注明 out-of-scope。✅
- use-cases.md UC-1/UC-2/UC-3 + 系统健壮性覆盖 AC-3b/AC-9/AC-11/AC-12，映射完整。✅
- test_cases_template 16 个 TC 覆盖 AC-1,2,3,3b,4,6,7,8,9,10,11,12,13；**AC-5 缺 TC**（见 #3）。
- interface_chain 13 个 method 的 data_flows 4 条链无悬空方法引用（flow-kill 的命名问题见 #6b，非悬空）。

## 结论

需修改后重审。

## Summary

计划评审完成，第1轮，1条 MUST FIX（Task 6 kill 同步释放的 token 流转设计缺失，阻断 AC-1/AC-2/AC-13），5条 LOW（lint 模式、AC-5 测试缺口、scope.ts 归属、前端镜像点、FG1 文件数与命名）。spec 完整性与 plan 主线可行性已确认，修复 MUST FIX #1 后即可进入编码。
