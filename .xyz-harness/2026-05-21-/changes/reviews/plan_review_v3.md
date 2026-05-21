---
review:
  type: plan_review
  round: 3
  timestamp: "2026-05-22T23:30:00"
  target: ".xyz-harness/2026-05-21-/plan.md"
  verdict: fail
  summary: "计划评审v3，Issue #8 修复不充分：spec Constraint 8 和 plan Task 1 的机制定义已更新（core?: boolean + emit 逻辑），但 plan Task 5/7 缺少对 transport-execute 设置 core: true 的显式指令，实现者按 plan 逐步执行时会遗漏此设置，导致 Issue #8 的 bug 复现"
statistics:
  total_issues: 9
  must_fix: 1
  must_fix_resolved: 2
  low: 5
  info: 0
issues:
  - id: 1
    severity: MUST_FIX
    location: "plan.md:Task 5 + spec.md:FR3"
    title: "builtin:transport-execute priority 导致 pre_transport 阶段执行顺序错误"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
  - id: 2
    severity: MUST_FIX
    location: "plan.md:BG2 Task 8 + spec.md:AC2"
    title: "failover-loop 缩减至 ≤150 行的目标不可行，实际预估 ~200-240 行"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
  - id: 3
    severity: LOW
    location: "plan.md:BG1 Files (预估)"
    title: "BG1 文件数文字描述（13个）与 File Structure 表格（9个）不一致"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 4
    severity: LOW
    location: "plan.md:BG1 Execution Flow"
    title: "BG1 串行执行 7 个 Task 过于保守，Tasks 2/3/4/6 可并行"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 5
    severity: LOW
    location: "plan.md:Task 5 Depends on"
    title: "Task 5 依赖列表不完整，遗漏了对 Task 2 (route-resolve) 的依赖"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 6
    severity: LOW
    location: "plan.md:Task 8 设计细节"
    title: "on_error hook 在不同 catch 分支中的 ctx 字段准备不完整"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 7
    severity: INFO
    location: "plan.md:Constraint 8 设计细节"
    title: "Pipeline emit 异常降级的 priority < 100 判断依赖 hook 实例属性"
    status: dismissed
    raised_in_round: 1
    resolved_in_round: 2
  - id: 8
    severity: MUST_FIX
    location: "plan.md:Task 5 (L142-157) + Task 7 (L164-166) + spec.md:Constraint 8"
    title: "transport-execute 的 core: true 设置在 plan 中缺少显式指令，Issue #8 修复不充分"
    status: open
    raised_in_round: 2
    resolved_in_round: null
  - id: 9
    severity: LOW
    location: "plan.md:File Structure + Task 1"
    title: "types.ts 归属 BG2 但 Task 1 (BG1) 需修改其 PipelineHook 接口，分组分配不一致"
    status: open
    raised_in_round: 3
    resolved_in_round: null
---

# 计划评审 v3

## 评审记录
- 评审时间：2026-05-22 23:30
- 评审类型：计划评审（第 3 轮）
- 评审对象：`.xyz-harness/2026-05-21-/plan.md`（含 spec.md、e2e-test-plan.md）

## v2 修复验证

### Issue #8 修复验证：transport-execute core hook 标记

**结论：修复不充分。机制已定义，但实际使用指令缺失。**

验证过程：

1. **spec Constraint 8 更新** ✅ — 明确描述了 `PipelineHook.core = true` 标记机制和核心 hook 列表（含 transport-execute）
2. **plan Task 1 PipelineHook 接口** ✅ — 新增 `core?: boolean` 字段定义（plan.md L115-122）
3. **plan Task 1 emit() 逻辑** ✅ — `hook.priority < 100 || hook.core === true` 双条件判断（plan.md L103-104）
4. **plan Task 5 (transport-execute 创建)** ❌ — **未提及 `core: true`**。全文仅描述 priority 300 和职责列表，无 core 标记指令（plan.md L142-157）
5. **plan Task 7 (hook 注册)** ❌ — **未提及 `core: true`**。仅说"将 6 个新 hook 加入 ALL_HOOKS 数组"，无 core 字段设置指导（plan.md L164-166）

**风险分析：**

实现者按 plan 逐步执行时：
1. 执行 Task 1 → 看到接口定义和 emit 逻辑，理解了机制 ✅
2. 执行 Task 5 → 创建 transport-execute，按描述设置 `priority: 300`，**不知道需要设置 `core: true`** ❌
3. 执行 Task 7 → 注册 hook，按常规方式加入数组，**不知道 transport-execute 需要特殊标记** ❌

虽然 BG1 注入上下文包含 spec Constraint 8（列出了核心 hook），但要求实现者在跨 task 交叉引用中自行推断具体设置项，超出了 plan 作为"可执行规格"的预期。TDD 安全网也可能无法覆盖此场景——Task 1 的测试验证 emit 机制逻辑正确，但不会验证 transport-execute 具体实例是否携带 `core: true`。

**Bug 复现路径：** transport-execute 无 `core: true` + priority 300 → emit() 的 `hook.priority < 100` 为 false、`hook.core === true` 为 undefined（falsy）→ 非 PipelineAbort 异常被 catch 后仅记录日志 → ctx.transportResult 为 undefined → 后续 post_response hook 二次崩溃 → 客户端收到 502 但错误信息误导。这正是 Issue #8 描述的原始 bug。

## 1. spec 完整性（独立复查）

**结论：完整，无新增问题。** spec.md 在 v2 基础上更新了 Constraint 8（增加 `core = true` 标记机制），与 FR3 的 hook 列表一致。

## 2. plan 可行性

### 发现的问题

| # | 优先级 | 文件/位置 | 描述 | 修改建议 |
|---|--------|----------|------|---------|
| 1 | ~~MUST FIX~~ | plan.md:Task 5 + spec.md:FR3 | ~~builtin:transport-execute priority 导致执行顺序错误~~ | **v2 已修复** |
| 2 | ~~MUST FIX~~ | plan.md:BG2 Task 8 + spec.md:AC2 | ~~failover-loop ≤150 行目标不可行~~ | **v2 已修复** |
| 8 | **MUST FIX** | plan.md:Task 5 (L142-157) + Task 7 (L164-166) | **transport-execute 缺少 `core: true` 显式指令。** 机制已在 Task 1 定义，但 Task 5 创建 hook 和 Task 7 注册 hook 时均未提及需要设置 `core: true`，实现者会遗漏。 | Task 5 增加一句："注册时必须设置 `core: true`（参见 Constraint 8），确保 priority 300 的非 PipelineAbort 异常正确传播而非被 emit() 降级。" Task 7 补充说明 ALL_HOOKS 中 transport-execute 的注册对象需包含 `core: true` 字段。 |
| 3 | LOW | plan.md:BG1 Files (预估) | BG1 文件数文字（13个）与表格（9个）不一致（v1 遗留） | 修正描述或调整表格 |
| 4 | LOW | plan.md:BG1 Execution Flow | BG1 串行执行 7 个 Task 过于保守（v1 遗留） | 改为 3-4 波执行 |
| 5 | LOW | plan.md:Task 5 Depends on | Task 5 依赖列表遗漏 Task 2（v1 遗留） | 更新为 "Depends on: 2, 3, 4" |
| 6 | LOW | plan.md:Task 8 设计细节 | on_error 在不同 catch 分支的 ctx 字段准备不完整（v1 遗留） | 明确 rejectAndReply vs on_error 的分工 |
| 9 | LOW | plan.md:File Structure + Task 1 | types.ts 归属 BG2（File Structure 表格标记 `modify | BG2`），但 Task 1 (BG1) 需修改其 PipelineHook 接口添加 `core?: boolean` 字段。分组分配不一致。 | 将 types.ts 移至 BG1 或在 BG1 描述中注明"types.ts 的 PipelineHook 接口修改随 Task 1 一并完成" |

## 3. spec 与 plan 一致性

**逐条覆盖检查：**

| Spec Section | 对应 Task | 覆盖状态 | 备注 |
|-------------|----------|---------|------|
| FR1 三层架构 | Task 8 | ✅ | |
| FR2 Pipeline 驱动 L2 | Task 8 | ✅ | |
| FR3 核心步骤 hook | Task 2-6 | ✅ | transport-execute priority 300 执行顺序正确 |
| FR4 消除内联重复 | Task 8 | ✅ | |
| FR5 PipelineContext 字段 | Task 2-6 + Task 8 | ✅ | |
| FR6 on_error 接入 | Task 8 | ✅ | |
| FR7 on_stream_event 就绪 | 无 task | ✅ | |
| AC1 pipeline 全量接管 | Task 8 | ✅ | |
| AC2 failover-loop ≤250行 | Task 8 | ✅ | |
| AC3 已有 hook 激活 | Task 8 | ✅ | |
| AC4 核心 hook 可执行 | Task 2-5 | ✅ | |
| AC5 功能等价 10 场景 | Task 9 | ✅ | |
| AC6 日志指标等价 | Task 9 | ✅ | |
| AC7 现有测试通过 | Task 9 | ✅ | |
| AC8 pipeline 扩展 | Task 8 | ✅ | |
| Constraint 8 异常降级 | Task 1 | ⚠️ | 机制正确，但 transport-execute 未显式标记 `core: true`（Issue #8） |

**plan 中无 spec 未提及的额外工作。**

## 4. Execution Groups 合理性

与 v2 一致。BG1→BG2→BG3 串行依赖正确，Wave 编排合理。

**新增发现（Issue #9）：** types.ts 的分组归属需调整。

## 5. E2E Test Plan 交叉验证

| AC | E2E 场景 | 覆盖状态 |
|----|---------|---------|
| AC1 | E2E-01/02/03 | ✅ |
| AC2 | 静态检查 | ✅ |
| AC3 | E2E-17/18/19 | ✅ |
| AC4 | E2E-08 | ✅ |
| AC5 | E2E-04~E2E-13 | ✅ |
| AC6 | E2E-14/15/16 | ✅ |
| AC7 | 全部通过 | ✅ |
| AC8 | E2E-20 | ✅ |

**建议补充：** Issue #8 修复后，E2E 应增加一个场景——模拟 transport-execute 内部抛出非 PipelineAbort 异常（如 TypeError），验证异常是否传播到 failover-loop 的 catch 而非被 emit() 降级。当前 e2e-test-plan 无此场景。

## 结论

**需修改后重审。** v2 的 MUST FIX #8 修复不充分：spec Constraint 8 和 plan Task 1 已正确描述 `core?: boolean` 机制，但 plan Task 5（创建 transport-execute）和 Task 7（注册 hook）均未包含设置 `core: true` 的显式指令。按 plan 逐步执行的实现者会遗漏此设置，导致 Issue #8 描述的 bug 完整复现。

修复方式简单：Task 5 增加一句 core 标记说明，Task 7 增加注册时的 core 字段要求。这是纯文档缺陷，不涉及架构或设计变更。

### Summary

计划评审v3，v2的MUST FIX #8修复不充分（机制定义到位但使用指令缺失），1条MUST FIX仍open，需修改后重审。
