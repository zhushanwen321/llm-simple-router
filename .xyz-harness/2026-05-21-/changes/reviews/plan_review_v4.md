---
verdict: pass
must_fix: 0
review:
  type: plan_review
  round: 4
  timestamp: "2026-05-22T23:55:00"
  target: ".xyz-harness/2026-05-21-/plan.md"
  summary: "计划评审v4，v3的MUST FIX #8（core: true显式指令）和LOW #9（types.ts分组）均已修复，0条open MUST FIX，评审通过"
statistics:
  total_issues: 9
  must_fix: 0
  must_fix_resolved: 3
  low: 4
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
    title: "BG1 文件数文字描述（13个）与 File Structure 表格（10个）不一致"
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
    title: "Task 5 依赖列表不完整，遗漏了对 Task 2 (route-resolve) 的运行时数据依赖"
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
    title: "transport-execute 的 core: true 设置在 plan 中缺少显式指令"
    status: resolved
    raised_in_round: 2
    resolved_in_round: 4
  - id: 9
    severity: LOW
    location: "plan.md:File Structure + Task 1"
    title: "types.ts 归属 BG2 但 Task 1 (BG1) 需修改其 PipelineHook 接口，分组分配不一致"
    status: resolved
    raised_in_round: 3
    resolved_in_round: 4
---

# 计划评审 v4

## 评审记录
- 评审时间：2026-05-22 23:55
- 评审类型：计划评审（第 4 轮）
- 评审对象：`.xyz-harness/2026-05-21-/plan.md`（含 spec.md、e2e-test-plan.md）

## v3 修复验证

### Issue #8 修复验证：transport-execute `core: true` 显式指令

**结论：修复充分。** 逐项验证：

| 检查点 | v3 状态 | v4 状态 |
|--------|---------|---------|
| Task 5 描述包含 `core: true` 指令 | 缺失 | **已修复** — Task 5 底部新增："**重要：注册时必须设置 `core: true`（参见 Constraint 8）**，因为 transport-execute 是系统骨架 hook 但 priority 300 超出 0-99 阈值。`core: true` 确保 emit() 中其非 PipelineAbort 异常正确传播而非被降级。" |
| Task 7 描述包含 `core: true` 注册要求 | 缺失 | **已修复** — Task 7 明确指出："transport-execute 必须以 `core: true` 标记注册" |
| v3 Bug 复现路径是否阻断 | 未阻断 | **已阻断** — 实现者执行 Task 5 时会看到显式的 `core: true` 指令，执行 Task 7 时会看到注册要求 |

**实现者可执行性验证：**
1. Task 1 → 看到 PipelineHook 接口 `core?: boolean` 和 emit() 双条件逻辑 ✅
2. Task 5 → 看到底部"重要"段落，知道需要设置 `core: true` ✅
3. Task 7 → 看到"transport-execute 必须以 `core: true` 标记注册"，在注册代码中加入该字段 ✅

Bug 复现路径被完整阻断。修复充分。

### Issue #9 修复验证：types.ts 分组归属

**结论：已修复。** File Structure 表格中 `types.ts` 已从 `BG2` 改为 `BG1`：

```
| `router/src/proxy/pipeline/types.ts` | modify | BG1 | PipelineHook 接口新增 core?: boolean 字段 |
```

与 Task 1 (BG1) 的实际修改一致。BG2 的"修改/创建文件"中仍列出 `types.ts`（modify if needed），这是合理的——BG2 可能在 failover-loop 重写时需要额外类型调整。BG1 负责主要修改，BG2 负责可能的后续微调，不构成冲突。

## 1. spec 完整性（独立复查）

**结论：完整，无新增问题。** spec.md 目标明确（三层架构接管代理请求），范围合理（不涉及 on_stream_event 深度集成和 DB 层重构），8 条 AC 均可量化验证。无 `[待决议]` 项。

## 2. plan 可行性

### 发现的问题

继承 v3 的 4 条 LOW 问题，无新增 MUST FIX：

| # | 优先级 | 文件/位置 | 描述 | 修改建议 |
|---|--------|----------|------|---------|
| 3 | LOW | plan.md:BG1 Files (预估) | BG1 文件数描述"13 个"与 File Structure 表格中 BG1 行数（10 个）不一致 | 统一为 10 或更新描述 |
| 4 | LOW | plan.md:BG1 Execution Flow | BG1 串行执行 7 个 Task 保守，Tasks 2/3/4/6 无代码级依赖可并行 | 分波执行：Wave A (Task 1), Wave B (Task 2/3/4/6 并行), Wave C (Task 5), Wave D (Task 7) |
| 5 | LOW | plan.md:Task 5 Depends on | Task 5 依赖列表为 "3, 4"，但运行时依赖 Task 2 的 ctx.resolved/ctx.provider 数据。TDD 测试可独立构造，故非 MUST FIX | 考虑标注为 "2(数据), 3, 4" 区分代码依赖和运行时数据依赖 |
| 6 | LOW | plan.md:Task 8 设计细节 | on_error emit 在 SemaphoreQueueFullError 和 unknown catch 分支触发，但此时 ctx.transportResult 等字段可能未填充，on_error hook 的 error-logging/request-logging 行为依赖这些字段 | 明确 on_error hook 对 ctx 字段缺失的防御逻辑（如字段可选检查） |

## 3. spec 与 plan 一致性

**逐条覆盖检查：**

| Spec Section | 对应 Task | 覆盖状态 | 备注 |
|-------------|----------|---------|------|
| FR1 三层架构 | Task 8 | ✅ | L1+L3 在 failover-loop，L2 由 pipeline emit 驱动 |
| FR2 Pipeline 驱动 L2 | Task 8 | ✅ | post_route → pre_transport → transport → post_response 序列 |
| FR3 核心步骤 hook | Task 2-6 | ✅ | 6 个 hook 对应 FR3 表格 |
| FR4 消除内联重复 | Task 8 | ✅ | 列出了要删除的 import 列表 |
| FR5 PipelineContext 字段 | Task 2-6 + Task 8 | ✅ | 字段写入者和消费者映射完整 |
| FR6 on_error 接入 | Task 8 | ✅ | catch 分支触发 emit("on_error") |
| FR7 on_stream_event 就绪 | 无 task | ✅ | 设计决策：不激活 emit，保持注册机制 |
| AC1 pipeline 全量接管 | Task 8 | ✅ | |
| AC2 failover-loop ≤250行 | Task 8 | ✅ | plan 目标 ≤150（严于 spec 的 ≤250） |
| AC3 已有 hook 激活 | Task 8 | ✅ | |
| AC4 核心 hook 可执行 | Task 2-5 | ✅ | |
| AC5 功能等价 10 场景 | Task 9 | ✅ | |
| AC6 日志指标等价 | Task 9 | ✅ | |
| AC7 现有测试通过 | Task 9 | ✅ | |
| AC8 pipeline 扩展 | Task 8 | ✅ | priority 排序保证执行顺序 |
| Constraint 8 异常降级 | Task 1 | ✅ | `core?: boolean` 机制完整，transport-execute 显式标记 `core: true` |

**plan 中无 spec 未提及的额外工作。**

## 4. Execution Groups 合理性

BG1→BG2→BG3 三组串行依赖正确。Wave 编排合理。

BG1 文件数 ≤10，合理。BG2 文件数 4，合理。每组 Subagent 配置完整（Agent、Model、注入上下文、读取文件、修改文件均明确）。

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

## 6. 后端设计充分性（L1）

- 每个 Task 有"为什么"解释（如 Task 5 说明 priority 300 的理由）
- 无新增存储变更（metadata 传递替代 DB 变更）
- API 端点无变更（纯内部重构）
- Hook 异常降级有明确的优先级分段和 core 标记机制
- L1→L2 数据传递通过 ctx.metadata 字符串 key 列出，完整

## 结论

**通过。** v3 的唯一 MUST FIX #8（transport-execute `core: true` 显式指令缺失）已充分修复：Task 5 和 Task 7 均包含明确的 `core: true` 设置指令，Bug 复现路径被完整阻断。Issue #9（types.ts 分组）也已修复。剩余 4 条 LOW 问题为文档精度优化，不阻塞流程。

### Summary

计划评审v4，v3的MUST FIX #8和LOW #9均已修复，0条open MUST FIX，4条LOW（非阻塞），评审通过。
