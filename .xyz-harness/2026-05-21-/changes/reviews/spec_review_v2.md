---
verdict: pass
must_fix: 0

review:
  type: spec_review
  round: 2
  timestamp: "2026-05-22T10:30:00"
  target: ".xyz-harness/2026-05-21-/spec.md"
  verdict: pass
  summary: "Spec 评审第 2 轮，0 条 MUST FIX（3 条历史 MUST FIX 已全部解决），6 条 LOW 仍 open + 2 条新 LOW，通过"

statistics:
  total_issues: 12
  must_fix: 0
  must_fix_resolved: 3
  low: 8
  info: 2

issues:
  - id: 1
    severity: MUST_FIX
    location: "spec.md > FR1 + FR3"
    title: "L1 路由预计算 resolveMapping 与 builtin:route-resolve 职责重叠"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2

  - id: 2
    severity: MUST_FIX
    location: "spec.md > FR3 + FR6 + Constraints"
    title: "Pipeline hook 错误传播和降级机制完全缺失"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2

  - id: 3
    severity: MUST_FIX
    location: "spec.md > FR7 vs Constraint 7"
    title: "on_stream_event FR7 接入要求与 Constraint 7 矛盾"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2

  - id: 4
    severity: LOW
    location: "spec.md > AC1"
    title: "AC1 验证方式描述为临时调试日志而非自动化测试断言"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 5
    severity: LOW
    location: "spec.md > Background"
    title: "failover-loop.ts 行数/import 基线数据过时"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2

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

  - id: 11
    severity: LOW
    location: "spec.md > FR2 vs FR3"
    title: "FR2 执行序列图中 orchestrator.handle() 与 FR3 builtin:transport-execute 位置不一致"
    status: open
    raised_in_round: 2
    resolved_in_round: null

  - id: 12
    severity: LOW
    location: "spec.md > Constraint 8"
    title: "Constraint 8 核心钩子 vs 非核心钩子异常处理的优先级分界表述可更清晰"
    status: open
    raised_in_round: 2
    resolved_in_round: null
---

# Spec 评审 v2

## 评审记录
- 评审时间：2026-05-22 10:30
- 评审类型：计划评审（spec 完整性专项，第 2 轮）
- 评审对象：`.xyz-harness/2026-05-21-/spec.md`

## 评审方法

按 SKILL.md「模式一：计划评审」第 1 项 spec 完整性维度逐项审查。本轮重点：
1. 验证 v1 的 3 条 MUST FIX 修复是否充分
2. 检查修复是否引入新问题
3. 对整体 spec 做独立完整审查（非增量审查）

## MUST FIX 修复验证

### MF1 (Issue #1): L1/route-resolve 职责重叠 — 已解决

**v1 问题**：FR1 说 L1 包含 "resolveMapping"，FR3 说 `builtin:route-resolve` 负责 "target 选择 + provider 查找"，职责边界模糊。

**v2 修复**：
- FR1 L1 明确输出 `Target[]` + `overflowIndices`，不做单 target 选择
- FR1 新增 "L1 与 L2 的边界" 段落，明确 L1 只做候选列表预计算，L2 的 `builtin:route-resolve` 从列表中选第一个非 excluded target
- FR3 `builtin:route-resolve` 描述改为"从候选 target 列表（L1 输出，通过 ctx.metadata 传入）中取第一个非 excluded target"

**判定：充分**。分工明确：L1 产出候选列表，L2 做每轮迭代的选择。两者无重叠。

### MF2 (Issue #2): Hook 异常传播机制缺失 — 已解决

**v1 问题**：spec 未定义 hook execute() 抛出异常时的行为。

**v2 修复**：新增 Constraint 8，定义三级异常处理：
1. PipelineAbort → 正常传播，触发短路
2. 非 PipelineAbort + priority 0-99（核心 hook）→ 直接传播到 pipeline 执行器
3. 非 PipelineAbort + priority 100+ → try-catch 捕获，记日志，继续后续 hook

**判定：充分**。覆盖了所有异常类型，且与 CLAUDE.md「Hook 降级」规则对齐。逻辑自洽：核心 hook（format-transform、transport-execute）是系统骨架，失败应立即传播；非核心 hook（usage-record、外部插件）可降级。

**minor 留意点**（→ Issue #12）：Constraint 8 第一句写"非 PipelineAbort → catch，继续"，第三句写"核心 hook → 直接传播"。从执行顺序看第三句覆盖第一句，但文面上有表面矛盾，建议在 plan 阶段用表格或伪代码明确。不阻塞。

### MF3 (Issue #3): on_stream_event 矛盾 — 已解决

**v1 问题**：FR7 要求"on_stream_event phase 接入"，AC1 要求验证"on_stream_event 通过 emit() 触发"，但 Constraint 7 和 Out of Scope 说暂不激活。

**v2 修复**：
- FR7 标题改为"on_stream_event phase 基础设施就绪"，明确"不在 transport/stream.ts 内部调用 emit"
- AC1 明确列出 4 个 phase（post_route、pre_transport、post_response、on_error），并加注"on_stream_event 不在本次 AC 范围内"
- Constraint 7 和 Out of Scope 保持一致

**判定：充分**。FR7 降级为"基础设施就绪"（注册机制完整但 emit 不实现），AC1 排除 on_stream_event，三层文档不再矛盾。

## 整体 spec 完整性审查

### 1. 目标明确性

"Pipeline 全量接管代理请求执行"，三层架构（L1 预计算 / L2 pipeline 单次执行 / L3 循环控制）。一句话可概括，目标清晰。

### 2. 范围合理性

Out of Scope 8 项，覆盖 on_stream_event 深度集成、plugin bridge 重构、Admin API、orchestrator 内部、scope.ts/types.ts/DB 反向依赖。边界清晰。

### 3. AC 可量化性

AC1-8 均可测试验证（通过 hook execute() 调用、ctx 字段值、请求响应对比、DB 记录对比）。

AC1 的"验证方式：添加调试日志"仍是临时手段（→ Issue #4，LOW，继承自 v1），但 AC 本身可测。

### 4. `[待决议]` 标记检查

无 `[待决议]` 标记。

### 5. FR 覆盖完整性

| FR | 核心 AC | 覆盖状态 |
|----|---------|---------|
| FR1 三层架构 | AC1, AC2 | 覆盖 |
| FR2 Pipeline 驱动 | AC1 | 覆盖 |
| FR3 核心步骤作为 hook | AC3, AC4 | 覆盖 |
| FR4 消除内联重复 | AC2 | 覆盖 |
| FR5 PipelineContext 字段 | AC4 | 覆盖 |
| FR6 on_error | AC1 | 覆盖 |
| FR7 on_stream_event 基础设施 | AC1 注释排除 | 正确排除 |
| Constraints 1-8 | AC1-8 整体 | 覆盖 |

### 6. 与 CLAUDE.md 架构约束一致性

| CLAUDE.md 规则 | Spec v2 状态 |
|----------------|-------------|
| Pipeline Hook 执行路径验证 | 未显式提及 registerBuiltinHooks()（→ Issue #7） |
| Hook 降级 | Constraint 8 对齐 ✅ |
| 数据消费者完整性 | FR5 字段表覆盖写入者/消费者 ✅ |
| 禁止 eslint-disable | 不涉及（运行时行为） |

## 发现的问题

### 历史问题状态更新

| # | 优先级 | 状态 | 说明 |
|---|--------|------|------|
| 1 | MUST_FIX | **resolved** | L1/L2 边界明确，FR1 新增"边界"段落 + FR3 对齐 |
| 2 | MUST_FIX | **resolved** | Constraint 8 定义三级异常处理 |
| 3 | MUST_FIX | **resolved** | FR7 降级为基础设施就绪，AC1 排除 on_stream_event |
| 5 | LOW | **resolved** | 基线数据已更新为 ~612 行、41 个 import |

### 仍 open 的历史问题

| # | 优先级 | 文件/位置 | 描述 | 修改建议 |
|---|--------|----------|------|---------|
| 4 | LOW | spec.md > AC1 | AC1 验证方式仍为"添加调试日志" | 改为"通过测试验证 hook execute() 被调用"或类似自动化断言 |
| 6 | LOW | spec.md > Constraint 6 | "可测量的延迟增加"无阈值 | 给具体值如"p99 延迟增加 ≤ 1ms" |
| 7 | LOW | spec.md > FR3 | 6 个新 hook 未提及 registerBuiltinHooks() 变更 | 在 FR3 或 Constraints 中说明注册位置 |
| 8 | LOW | spec.md > Constraints | ~15 文件修改无迁移策略说明 | 说明一次性 vs 分阶段 |
| 9 | INFO | spec.md > AC5 | 10 种场景等价性的具体验证方法未定义 | 明确是依赖现有测试套件 + 新增集成测试 |
| 10 | INFO | spec.md > FR3 | 6 个 builtin hook 注册位置未明确 | 在 plan 阶段明确 |

### 本轮新发现问题

| # | 优先级 | 文件/位置 | 描述 | 修改建议 |
|---|--------|----------|------|---------|
| 11 | LOW | spec.md > FR2 vs FR3 | FR2 执行序列图将 `orchestrator.handle(transportFn)` 显示为独立步骤（在 `emit("pre_transport")` 之后），但 FR3 将其定义为 `builtin:transport-execute` hook（`pre_transport` phase，priority 50）。即 `orchestrator.handle()` 实际发生在 `emit("pre_transport")` 内部，而非两个独立步骤 | FR2 图中 `[核心] orchestrator.handle(transportFn)` 应标注为 `pre_transport` phase 的一部分（或加注释说明"由 builtin:transport-execute hook 在 pre_transport phase 内执行"），避免实现者误解为需要单独调用 |
| 12 | LOW | spec.md > Constraint 8 | 第一句写"非 PipelineAbort → catch + 继续"，第三句写"核心 hook（0-99）→ 直接传播"。语义上第三句是第一句的例外，但文面构成表面矛盾 | 建议改为分层表述：(1) PipelineAbort → 传播 + 短路；(2) 核心 hook (0-99) 非 Abort 异常 → 传播到执行器；(3) 其他 hook 非 Abort 异常 → catch + 日志 + 继续。或用表格/伪代码消除歧义 |

## AC 可测试性评估

| AC | 可测试性 | 说明 |
|----|---------|------|
| AC1 | ✅ | 4 个 phase 触发可通过 hook execute() spy 验证 |
| AC2 | ✅ | 行数/import/禁止 import 名可通过静态分析验证 |
| AC3 | ✅ | 已有 hook 激活可通过 execute() 调用验证 |
| AC4 | ✅ | ctx 字段值可直接断言 |
| AC5 | ✅ | 10 种场景可通过集成测试验证 |
| AC6 | ✅ | DB 记录可通过对比测试验证 |
| AC7 | ✅ | 现有测试套件通过即可 |
| AC8 | ✅ | 扩展性可通过注册测试 hook 验证执行顺序 |

## 结论

通过。v1 的 3 条 MUST FIX 已全部充分解决，修复质量好——每个修复都直接回应了问题的核心，没有打补丁式的表面修复。剩余 8 条 LOW + 2 条 INFO 均不阻塞，可在 plan/实现阶段处理。

### Summary

Spec 评审完成，第 2 轮，0 条 MUST FIX，3 条历史 MUST FIX 已解决，8 条 LOW + 2 条 INFO 仍 open，通过。
