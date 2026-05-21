---
review:
  type: plan_review
  round: 1
  timestamp: "2026-05-22T15:30:00"
  target: ".xyz-harness/2026-05-21-/plan.md"
  verdict: fail
  summary: "计划评审完成，第1轮，2条MUST FIX（transport-execute优先级导致执行顺序错误、failover-loop行数目标不可行），需修改后重审"

statistics:
  total_issues: 7
  must_fix: 2
  must_fix_resolved: 0
  low: 4
  info: 1

issues:
  - id: 1
    severity: MUST_FIX
    location: "plan.md:Task 5 + spec.md:FR3"
    title: "builtin:transport-execute priority 50 导致 pre_transport 阶段执行顺序错误"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 2
    severity: MUST_FIX
    location: "plan.md:BG2 Task 8 + spec.md:AC2"
    title: "failover-loop 缩减至 ≤150 行的目标不可行，实际预估 ~200-240 行"
    status: open
    raised_in_round: 1
    resolved_in_round: null
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
    title: "BG1 串行执行 7 个 Task 过于保守，Tasks 2-6 可并行"
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
    title: "Pipeline emit 异常降级的 priority < 100 判断依赖 hook 实例属性，设计合理但需注意 hook 创建顺序"
    status: open
    raised_in_round: 1
    resolved_in_round: null
---

# 计划评审 v1

## 评审记录
- 评审时间：2026-05-22 15:30
- 评审类型：计划评审
- 评审对象：`.xyz-harness/2026-05-21-/plan.md`（含 spec.md、e2e-test-plan.md）

## 1. spec 完整性

**结论：基本完整。**

- **目标明确**：将 failover-loop.ts 的 L2 执行逻辑迁移到 pipeline hook，使 pipeline 成为请求执行的真正驱动引擎。三层架构（L1 预计算 → L2 pipeline emit → L3 循环控制）描述清晰。
- **范围合理**：明确的 Out of Scope 列表（8 项），不涉及 on_stream_event 激活、plugin bridge 重构、Admin API 变更等。
- **验收标准可量化**：AC2 有具体行数和 import 数限制；AC5 列出 10 种请求场景；AC7 要求现有测试全部通过。AC1 可通过调试日志验证。
- **Constraints 清晰**：8 条约束覆盖了 phase 不变、failover 外层决策、向后兼容、优先级分段等关键决策。
- **无 `[待决议]` 项**。

## 2. plan 可行性

### 发现的问题

| # | 优先级 | 文件/位置 | 描述 | 修改建议 |
|---|--------|----------|------|---------|
| 1 | MUST FIX | plan.md:Task 5 + spec.md:FR3 | **builtin:transport-execute priority 50 导致执行顺序错误**：在 pre_transport 阶段，priority 数值越小越先执行。当前优先级分配为：format-transform(0) → api-key-decrypt(1) → **transport-execute(50)** → provider-patches(100) → plugin-request(250)。这意味着 transport-execute 在 provider-patches 和 plugin-request **之前**执行，transport 函数会使用未经过 plugin 调整和 provider patches 修改的 body/headers。对照当前 failover-loop.ts 的实际执行顺序（L206 格式转换 → L186 plugin adjustments → L200 provider patches → L228 API key → L241 transport），这是一个关键的功能正确性 bug。 | 将 builtin:transport-execute 的 priority 提高到 800 或更高，使其在所有请求修改 hook 之后执行。同时需要更新 spec.md FR3 表格中的 priority 值，以及 plan.md 中的 Task 5 设计细节。或者，将 transport-execute 放在 `pre_transport` 之后的独立执行点（不作为 hook，直接在 emit("pre_transport") 之后调用），但这与 spec 的"pipeline 驱动 L2"设计冲突。 |
| 2 | MUST FIX | plan.md:BG2 Task 8 + spec.md:AC2 | **failover-loop ≤150 行目标不可行**：对 failover-loop.ts 进行了逐行分析（当前 612 行、41 个 import）。迁移后需保留的代码：① L1 预计算（resolveMapping + modality + overflow + allowed_models + reject cases）约 80 行；② L3 while(true) 循环壳（迭代管理 + emit 调用 + catch 分支）约 90 行；③ rejectAndReply 函数 + RejectParams 接口约 50 行（L3 错误处理需要）；④ imports + constants + FailoverLoopDeps 接口约 25 行。总计约 245 行。即使将 rejectAndReply 提取到独立模块（节省约 50 行），仍约 195 行。plan 中 "~60 行 L1 + ~80 行 L3 = 140 行" 的估算遗漏了 rejectAndReply helper（50 行）和 imports/constants/interface（25 行）。 | 两种方案：(A) 将 AC2 目标从 ≤150 调整为 ≤200 行（仍保留 ≤20 imports 的约束），并在 plan 中明确说明 rejectAndReply/RejectParams 保留在文件内；(B) 新增一个提取任务，将 rejectAndReply 和 RejectParams 移至 `proxy-handler-utils.ts` 或新建 `failover-helpers.ts`，然后在 plan 中说明 failover-loop.ts 调用导入的 helper。 |
| 3 | LOW | plan.md:BG1 Files (预估) | **BG1 文件数文字与表格不一致**：plan 的 "Files (预估)" 段落写 "13 个文件（7 create + 3 modify + 1 test + 2 test-create）"，但 File Structure 表格中 Group=BG1 的文件只有 9 个（6 create hook + 2 modify + 1 test-create）。pipeline-emit.test.ts 和 failover-loop-slim.test.ts 在表格中标记为 BG2。 | 修正 BG1 的 "Files (预估)" 描述为 "9 个文件（7 create + 2 modify）"，或按实际分组调整表格。 |
| 4 | LOW | plan.md:BG1 Execution Flow | **BG1 串行执行 7 个 Task 过于保守**：plan 说明 Tasks 2-6 "互相独立，但串行更安全（共享 pipeline.ts 修改）"。实际上只有 Task 1 修改 pipeline.ts，Tasks 2-6 各自创建独立的 hook 文件，不共享任何修改目标。Task 7 修改 register-hooks.ts，依赖 Tasks 2-6 完成。建议的并行策略：Wave A = Task 1（pipeline.ts）；Wave B = Tasks 2,3,4,6 并行（4 个独立 hook 文件）；Wave C = Task 5（依赖 3,4）；Wave D = Task 7（注册）。 | 改为 3-4 波执行，Tasks 2/3/4/6 并行。预估节省 3-4 个 subagent 周期。注意 CLAUDE.md 中 subagent 并发不超过 5 的约束。 |
| 5 | LOW | plan.md:Task 5 Depends on | **Task 5 依赖列表不完整**：Task 5（transport-execute）标注 "Depends on: 3, 4"，但实际上它也读取 ctx.resolved 和 ctx.provider（由 Task 2 route-resolve 写入）。虽然 BG1 串行执行不会导致实际错误，但依赖关系描述不准确。 | 将 Task 5 的依赖更新为 "2, 3, 4"。 |
| 6 | LOW | plan.md:Task 8 设计细节 | **on_error hook 在不同 catch 分支中的 ctx 字段准备不完整**：plan 的 Task 8 描述在 catch 分支中调用 `emit("on_error", ctx)`，但 errorLoggingHook 依赖 `ctx.metadata.get("startTime")`、`ctx.metadata.get("errorInfo")` 等字段。对于 PipelineAbort 和 AbortError 的 catch 分支（直接 return，不调 emit），这没问题。但对于 SemaphoreQueueFullError/SemaphoreTimeoutError 分支，plan 用 `rejectAndReply` 而非 `emit("on_error")`——这意味着 errorLoggingHook 不会为这些错误执行，日志由 rejectAndReply 内的 insertRejectedLog 处理。需要确认这是有意为之还是遗漏。 | 在 plan 中明确说明：SemaphoreQueueFullError/SemaphoreTimeoutError 使用 rejectAndReply（内含 insertRejectedLog），不走 pipeline on_error。如果这是有意的设计，需要添加注释说明原因。 |
| 7 | INFO | plan.md:Constraint 8 + Task 1 | **emit 异常降级中 priority 判断的实现细节**：plan 的 Task 1 代码片段使用 `hook.priority < 100` 判断核心 hook。这依赖 PipelineHook 对象上有 priority 属性，而当前 PipelineHook 接口确实有 priority 字段，设计合理。但需注意：如果外部 hook 的 priority 被动态修改，判断可能失效。当前场景下这不是问题，因为 priority 在 hook 创建时固定。 | 无需操作，记录观察。 |

> 优先级定义：
> - **MUST FIX**：不修复则评审不通过，会阻塞流程
> - **LOW**：建议修复，但不阻塞
> - **INFO**：观察记录，无需操作

## 3. spec 与 plan 一致性

**逐条覆盖检查：**

| Spec Section | 对应 Task | 覆盖状态 | 备注 |
|-------------|----------|---------|------|
| FR1 三层架构 | Task 8 | ✅ | L1+L3 在 failover-loop，L2 通过 pipeline emit |
| FR2 Pipeline 驱动 L2 | Task 8 | ✅ | emit 序列: post_route → pre_transport → post_response |
| FR3 核心步骤 hook | Task 2-6 | ⚠️ | 6 个 hook 均有对应 Task，但 transport-execute priority 需修正（见 Issue #1） |
| FR4 消除内联重复 | Task 8 | ✅ | 列出了需要删除的 import |
| FR5 PipelineContext 字段 | Task 2-6 + Task 8 | ✅ | 写入者/消费者映射清晰 |
| FR6 on_error 接入 | Task 8 | ⚠️ | catch 块中 emit("on_error")，但部分错误分支走 rejectAndReply（见 Issue #6） |
| FR7 on_stream_event 就绪 | 无 task | ✅ | spec 明确说不需要 task |
| AC1 pipeline 全量接管 | Task 8 | ✅ | 4 个 phase emit 调用 |
| AC2 failover-loop ≤150行 | Task 8 | ❌ | 目标不可行（见 Issue #2） |
| AC3 已有 hook 激活 | Task 8 | ✅ | emit 触发后已有 hook 自动执行 |
| AC4 核心 hook 可执行 | Task 2-5 | ✅ | 有对应测试 |
| AC5 功能等价 10 场景 | Task 9 | ✅ | e2e-test-plan 覆盖完整 |
| AC6 日志指标等价 | Task 9 | ✅ | E2E-14/15/16 覆盖 |
| AC7 现有测试通过 | Task 9 | ✅ | |
| AC8 pipeline 扩展 | Task 8 | ✅ | priority 排序保证 |
| Constraint 8 异常降级 | Task 1 | ✅ | 代码片段与 Constraint 一致 |

**plan 中无 spec 未提及的额外工作。**

## 4. Execution Groups 合理性

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 分组合理性（文件数 ≤10） | ✅ | BG1 实际 9 个文件（文字描述有误，见 Issue #3）；BG2 4 个文件；BG3 0-2 个文件 |
| 类型划分（前后端不混合） | ✅ | 全部为后端 Task |
| 功能关联度 | ✅ | BG1 是基础设施 + hook，BG2 是重写，BG3 是验证，分组逻辑清晰 |
| 依赖关系 | ✅ | BG1 → BG2 → BG3 严格串行，正确 |
| Wave 编排 | ✅ | 3 个 Wave，无并行冲突 |
| Subagent 配置 | ⚠️ | 每组有 Agent/Model/注入上下文/读取文件/修改文件配置，但 BG1 的 "Agent" 字段写的是 "general-purpose → general-purpose → general-purpose"（链式），实际应该按 Task 分配，不是 3 个 agent 链 |
| 上下文充分性 | ✅ | 注入了 FR3/FR5/Constraint 8 等关键上下文 |
| 文件数预估 | ❌ | BG1 文字描述与表格不一致（见 Issue #3） |

## 5. 后端设计充分性（L1 检查）

| 检查项 | 结果 |
|--------|------|
| 每个 Task 是否说明了"为什么" | ✅ 大部分 Task 有设计细节说明动机和提取来源 |
| 存储变更是否有理由 | ✅ 无 DB 变更 |
| API 端点设计 | ✅ 无 API 变更 |
| 遗漏的边界条件 | ⚠️ transport-execute 的优先级问题（Issue #1）导致功能错误 |
| 非功能性要求 | ✅ Constraint 6 覆盖性能不退化 |

## 结论

**需修改后重审。** 两个 MUST FIX 问题阻塞：

1. **Issue #1（执行顺序错误）**：builtin:transport-execute 的 priority 50 导致其在 provider-patches(100) 和 plugin-request(250) 之前执行，会发送未经修改的请求体到上游。这是功能正确性 bug，必须修正 priority 或调整执行架构。

2. **Issue #2（行数目标不可行）**：failover-loop.ts 缩减至 ≤150 行的目标，经逐行分析当前代码后预估需 200-240 行。要么调整 AC2 目标，要么额外提取 rejectAndReply 等辅助函数到独立模块。

### Summary

计划评审完成，第1轮，2条MUST FIX（transport-execute 优先级导致执行顺序错误、failover-loop 行数目标不可行），需修改后重审。
