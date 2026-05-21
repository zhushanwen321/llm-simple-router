---
review:
  type: spec_review
  round: 1
  timestamp: "2026-05-22T01:45:00"
  target: ".xyz-harness/2026-05-21-/spec.md"
  verdict: fail
  summary: "Spec 评审第 1 轮，3 条 MUST FIX（L1/L2 职责重叠、hook 错误传播缺失、on_stream_event 矛盾），需修改后重审"

statistics:
  total_issues: 10
  must_fix: 3
  must_fix_resolved: 0
  low: 5
  info: 2

issues:
  - id: 1
    severity: MUST_FIX
    location: "spec.md > FR1 + FR3"
    title: "L1 路由预计算 resolveMapping 与 builtin:route-resolve 职责重叠"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 2
    severity: MUST_FIX
    location: "spec.md > FR3 + FR6 + Constraints"
    title: "Pipeline hook 错误传播和降级机制完全缺失"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 3
    severity: MUST_FIX
    location: "spec.md > FR7 vs Constraint 7"
    title: "on_stream_event FR7 接入要求与 Constraint 7 矛盾"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 4
    severity: LOW
    location: "spec.md > AC1"
    title: "AC1 验证方式描述为临时调试日志而非自动化测试断言"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 5
    severity: LOW
    location: "spec.md > FR5 + Background"
    title: "failover-loop.ts 行数/import 基线数据过时"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 6
    severity: LOW
    location: "spec.md > Constraint 6"
    title: "性能约束缺乏可量化的阈值基线"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 7
    severity: LOW
    location: "spec.md > FR3"
    title: "registerBuiltinHooks() 变更点未提及"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 8
    severity: LOW
    location: "spec.md > Constraints"
    title: "迁移策略（一次性 vs 分阶段）未说明"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 9
    severity: INFO
    location: "spec.md > AC5"
    title: "AC5 功能等价的具体验证方法未定义"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 10
    severity: INFO
    location: "spec.md > FR3"
    title: "builtin hook 注册位置未明确"
    status: open
    raised_in_round: 1
    resolved_in_round: null
---

# Spec 评审 v1

## 评审记录
- 评审时间：2026-05-22 01:45
- 评审类型：计划评审（spec 完整性专项）
- 评审对象：`.xyz-harness/2026-05-21-/spec.md`

## 评审方法

按 SKILL.md「模式一：计划评审」第 1 项 spec 完整性维度逐项审查：
1. 目标是否明确
2. 范围是否合理
3. AC 是否可量化
4. `[待决议]` 标记检查
5. 六要素完整性（Outcomes, Scope boundaries, Constraints, Decisions made, Task breakdown, Verification）
6. 与 CLAUDE.md 架构约束的一致性

## 六要素完整性审查

### 1. Outcomes — 目标明确性

**结论：基本清晰，但有关键细节模糊。**

目标「Pipeline 全量接管代理请求执行」一句话可以概括。三层架构（L1 预计算 / L2 pipeline 单次执行 / L3 循环控制）的分层模型清晰。

**问题：L1 与 L2 的职责边界模糊**（→ Issue #1）。FR1 说 L1 包含 "resolveMapping"，FR3 说 `builtin:route-resolve` 负责 "target 选择 + provider 查找"。当前代码 `resolveMapping()` 返回单个 target + allTargets 列表，如果 L1 已经 resolve 了 mapping 并选择了 target，那 L2 的 `builtin:route-resolve` 还要做什么？

从 failover 语义看，合理的解释应该是：
- L1：解析映射组，获取所有候选 target 列表（含 modality redirect、overflow 扩展、allowed_models 过滤）
- L2 `builtin:route-resolve`：从候选列表中选出当前迭代的 target（考虑 excludeTargets），查找 provider 并校验 active

但 spec 没有明确说明这个分工，实现者会困惑 `resolveMapping` 到底在 L1 还是 L2 执行。

### 2. Scope boundaries — 范围边界

**结论：充分。**

Out of Scope 列出 8 项，明确关闭了以下门：
- on_stream_event 深度集成（与 FR7 的矛盾另见 Issue #3）
- Plugin bridge 重构
- Admin API 变更
- orchestrator 内部重构
- scope.ts / types.ts / DB 层反向依赖

范围界定合理，不过大也不过小。

### 3. Constraints — 约束充分性

**结论：基本充分，有两处缺陷。**

7 项约束覆盖了关键限制：phase 定义不变、ADR 遵从、向后兼容、优先级分段、核心 hook 不可跳过、性能不退化、on_stream_event 暂缓。

**缺失 1**：hook 错误传播语义未定义（→ Issue #2）。Constraint 5 提到了 PipelineAbort，但未定义：
- 非 Abort 的异常如何处理？静默吞掉？传播到 pipeline 外层？
- 与 CLAUDE.md「代码品味原则 > Hook 降级」的规则如何对齐？

**缺失 2**：性能约束不可量化（→ Issue #6）。"不应导致可测量的延迟增加"缺乏阈值。

### 4. Decisions made — 决策记录

**结论：充分。**

关键决策明确记录：
- 三层架构（L1/L2/L3）
- Hook 优先级分段（0-99 / 100-199 / 200-299 / 900-999）
- failover 循环包裹 Pipeline 外层（遵循 ADR 0005）
- 核心步骤作为内置 hook（6 个 hook 的 phase/priority/职责）
- PipelineContext 字段的写入者/消费者映射

### 5. Task breakdown — 任务拆分

**结论：适中。**

FR1-7 提供了合理粒度的功能分解。每个 FR 对应一个明确的职责域。不在此 spec 层面拆分更细的 task（属于 plan 层）。

### 6. Verification — 验证方式

**结论：AC 覆盖较全面，但有几个质量缺陷。**

AC1-8 覆盖了所有 FR：
| FR | 覆盖 AC | 状态 |
|----|---------|------|
| FR1 三层架构 | AC1, AC2 | 覆盖 |
| FR2 Pipeline 驱动 | AC1 | 覆盖 |
| FR3 核心步骤作为 hook | AC3, AC4 | 覆盖 |
| FR4 消除内联重复 | AC2 | 覆盖 |
| FR5 PipelineContext 字段 | AC4（部分） | 部分覆盖 |
| FR6 on_error | AC1 | 覆盖 |
| FR7 on_stream_event | AC1 | 与 Constraint 7 矛盾 |
| FR8 扩展性 | AC8 | 覆盖 |

**AC5 的 10 种请求场景是强验证**，覆盖了关键路径和边界条件。但"完全一致"缺乏具体验证方法定义（→ Issue #9）。

## 与 CLAUDE.md 架构约束的一致性

### 冲突检查

| CLAUDE.md 规则 | Spec 是否遵守 | 说明 |
|----------------|-------------|------|
| Pipeline Hook 执行路径验证 | 未提及 | spec 新增 6 个 hook 但未提 registerBuiltinHooks()（→ Issue #7） |
| 代码品味原则 > Hook 降级 | 未对齐 | spec 未定义 hook 异常处理机制（→ Issue #2） |
| 数据消费者完整性 | 部分遵守 | FR5 列出了写入者/消费者映射，但未逐一验证消费路径 |
| 禁止 eslint-disable | 未提及 | 实际 failover-loop.ts 中有 2 处 eslint-disable 注释（历史遗留） |
| structuredClone | 未涉及 | 无相关变更 |
| 禁止 any | 未涉及 | 无相关变更 |

## 发现的问题

| # | 优先级 | 文件/位置 | 描述 | 修改建议 |
|---|--------|----------|------|---------|
| 1 | MUST FIX | spec.md > FR1 + FR3 | L1 "resolveMapping" 与 L2 `builtin:route-resolve`（"target 选择 + provider 查找"）职责边界模糊。当前代码中 `resolveMapping()` 返回单个 target，L1 如何与 L2 的 per-iteration target 选择衔接不清晰 | 明确分工：L1 只做 mapping group 解析 + 预计算（候选列表），L2 的 `builtin:route-resolve` 负责 per-iteration 的 target 选择（考虑 excludeTargets）+ provider 查找。或明确 L1 resolveMapping 返回的是 target 列表而非单个 target |
| 2 | MUST FIX | spec.md > FR3 + FR6 | Pipeline hook 错误传播语义完全缺失。当 hook execute() 抛出非 PipelineAbort 异常时：(1) 后续 hook 是否执行？(2) 异常是否传播到 pipeline 外层（failover 循环）？(3) 是否与 CLAUDE.md「Hook 降级」规则对齐（try-catch 包裹，异常不得传播）？这个决策直接影响 builtin hook 和外部插件的行为 | 新增约束或 FR 条目，明确定义：① 内置 hook 异常 → 传播还是降级；② 外部 hook 异常 → 降级（不阻塞核心流程）；③ PipelineAbort → 短路整个 pipeline |
| 3 | MUST FIX | spec.md > FR7 vs Constraint 7 | FR7 要求 "on_stream_event phase 接入"，AC1 要求验证 "on_stream_event（流式时）通过 proxyPipeline.emit() 被触发"。但 Constraint 7 说 "暂不强制激活"，Out of Scope 第 1 条说 "本次不修改 transport/stream.ts 内部结构来激活 on_stream_event phase"。如果 emit 调用不在 transport/stream.ts 内，那在哪？如果在 pipeline 外部添加 emit 但没有 SSEEventTransform 集成，emit 的是空数据。这个 AC 无法验证通过 | 二选一：(A) 从 AC1 移除 on_stream_event 验证要求，将 FR7 标记为 "本次不实现" 并移入 Out of Scope；(B) 明确 on_stream_event 的最小接入方式（如 failover-loop 中在 stream_success 后 emit，而非修改 transport 层） |
| 4 | LOW | spec.md > AC1 | AC1 的验证方式写为 "在 ProxyPipeline.emit() 中添加调试日志"，这是临时手段而非自动化测试。AC 应通过测试断言验证（如 spy proxyPipeline.emit 或检查 hook execute 被调用） | 将验证方式改为"通过测试验证：每个 phase 的内置 hook execute() 被调用"或类似可自动化的断言 |
| 5 | LOW | spec.md > Background | Background 描述 failover-loop.ts 为 "~340 行，39 个 import"。实际代码为 **612 行，41 个 import**。基线数据不准确会影响 AC2（≤ 150 行）的可行性判断 | 更新基线数据为实际值。同时验证 AC2 的 ≤ 150 行目标是否合理——从 612 行降到 150 行需要移除 462 行（75.8%），需要确认 L1 + L3 的循环控制壳能否在这个行数内完成 |
| 6 | LOW | spec.md > Constraint 6 | "pipeline emit 的开销不应导致可测量的延迟增加"——"可测量"是主观判断。没有基线数据无法验证 | 给出具体阈值，如 "p99 延迟增加不超过 1ms" 或 "pipeline emit 总耗时不超过请求总延迟的 5%" |
| 7 | LOW | spec.md > FR3 | CLAUDE.md 的 Pipeline Hook 执行路径验证规则要求：新增 hook 必须在 registerBuiltinHooks() 中注册到 proxyPipeline。spec 新增 6 个内置 hook 但未提及 register-hooks.ts 的变更 | 在 Constraints 或 FR3 中明确说明新增 hook 需要在 registerBuiltinHooks() 中注册，并明确是扩展现有 register-hooks.ts 还是新建文件 |
| 8 | LOW | spec.md > Constraints | 修改 ~15 个文件且涉及核心请求处理路径（failover-loop 612 行全部重写），但没有说明迁移策略。一次性全量迁移风险极高（一次提交改动过大，回滚困难） | 考虑在 Constraints 中明确迁移策略：是否允许分阶段迁移（如先迁移 post_route hooks → 再迁移 pre_transport → 最后迁移 post_response），还是要求一次性完成。如果是后者，说明理由 |
| 9 | INFO | spec.md > AC5 | "响应与迁移前完全一致（status code、body、headers、SSE 数据流）"——10 种场景的等价性验证需要具体的测试策略。录制/回放？快照比较？还是依赖现有测试套件？ | 明确验证方法：建议通过现有测试套件（40 个测试文件）+ AC5 列出的 10 种场景的集成测试覆盖 |
| 10 | INFO | spec.md > FR3 | 6 个新增 builtin hook 的注册位置未明确。是扩展现有 `register-hooks.ts` 的 `ALL_HOOKS` 数组，还是创建新的注册文件？ | 明确注册位置。考虑到 hook 数量增加，可能需要拆分 register-hooks.ts，但这不是 spec 层面必须定义的 |

## AC 可测试性评估

| AC | 可测试性 | 说明 |
|----|---------|------|
| AC1 | ⚠️ | 验证方式依赖调试日志而非自动化断言。Phase 触发本身可通过 hook execute() 的 spy 验证 |
| AC2 | ✅ | 行数/import 可通过静态分析验证，具体 import 名可通过 grep 验证 |
| AC3 | ✅ | hook execute() 调用可通过测试验证 |
| AC4 | ✅ | ctx 字段值可通过测试断言验证 |
| AC5 | ✅ | 10 种请求场景可通过集成测试验证，但需补充具体验证方法 |
| AC6 | ✅ | DB 记录一致性可通过对比测试验证 |
| AC7 | ✅ | 现有测试套件通过即可 |
| AC8 | ✅ | 扩展性可通过注册测试 hook 并验证执行顺序 |

## 结论

需修改后重审。

3 条 MUST FIX 问题涉及 spec 内部的逻辑一致性和与项目架构约束的对齐，必须在进入 plan 阶段前解决。

### Summary

Spec 评审完成，第 1 轮，3 条 MUST FIX（L1/L2 职责边界模糊、hook 错误传播机制缺失、on_stream_event 要求矛盾），需修改后重审。
