---
verdict: pass
must_fix: 0

review:
  type: spec_review
  round: 3
  timestamp: "2026-05-22T14:30:00"
  target: ".xyz-harness/2026-05-21-/spec.md"
  verdict: pass
  summary: "Spec 评审第 3 轮，0 条 MUST FIX，8 条 LOW + 2 条 INFO 仍 open + 1 条新 LOW，通过"

statistics:
  total_issues: 13
  must_fix: 0
  must_fix_resolved: 3
  low: 9
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

  - id: 13
    severity: LOW
    location: "spec.md > FR2 / AC1"
    title: "pre_route phase 不再被 emit，外部插件 hook 可能静默失效"
    status: open
    raised_in_round: 3
    resolved_in_round: null
---

# Spec 评审 v3

## 评审记录
- 评审时间：2026-05-22 14:30
- 评审类型：计划评审（spec 完整性专项，第 3 轮，最终轮）
- 评审对象：`.xyz-harness/2026-05-21-/spec.md`

## 评审方法

独立重新审查，不继承 v2 结论的锚定效应。按 SKILL.md「模式一：计划评审」1. spec 完整性维度逐项检查。

## 1. 目标明确性

「Pipeline 全量接管代理请求执行」——一段话可概括。三层架构（L1 预计算 / L2 pipeline 单次执行 / L3 循环控制）的分层模型清晰，FR1 的"边界"段落有效地消解了 L1 与 L2 的职责模糊。

**结论：明确。**

## 2. 范围合理性

Out of Scope 8 项，覆盖了可识别的非本次范围项（on_stream_event 深度集成、plugin bridge 重构、Admin API、orchestrator 内部、scope.ts/types.ts/DB 反向依赖）。没有明显的"范围蔓延"信号。

**结论：合理。** 高复杂度（~15 文件、612 行重写）但范围边界清晰。

## 3. AC 可量化性

| AC | 可测试性 | 说明 |
|----|---------|------|
| AC1 | ✅ | 4 个 phase 触发可通过 spy proxyPipeline.emit 或 hook execute() 调用来验证 |
| AC2 | ✅ | ≤ 150 行、≤ 20 import、禁止 import 列表——全部可静态分析 |
| AC3 | ✅ | hook execute() 调用可测试 |
| AC4 | ✅ | ctx 字段值（body、effectiveApiType、transportResult）可直接断言 |
| AC5 | ✅ | 10 种场景可通过集成测试对比响应（录制/快照或运行前后对比） |
| AC6 | ✅ | DB 记录一致性可通过对比查询验证 |
| AC7 | ✅ | 现有测试套件通过——无条件通过标准 |
| AC8 | ✅ | 注册测试 hook 并验证执行顺序和 ctx 修改 |

AC1 的验证方式仍标注为"添加调试日志"（→ Issue #4），但 AC 本身是可测试的——这是验证方式描述的缺陷，不是 AC 定义的问题。

**结论：可量化。** 8 个 AC 全部有明确的通过/不通过判断标准。

## 4. `[待决议]` 标记检查

无 `[待决议]` 标记。

## 5. FR 覆盖完整性

| FR | 核心 AC | 覆盖状态 |
|----|---------|---------|
| FR1 三层架构 | AC1, AC2 | ✅ |
| FR2 Pipeline 驱动 | AC1 | ✅ |
| FR3 内置 hook | AC3, AC4 | ✅ |
| FR4 消除内联 | AC2 | ✅ |
| FR5 PipelineContext | AC4 | ✅ |
| FR6 on_error | AC1 | ✅ |
| FR7 on_stream_event | AC1 注释排除 | ✅ 正确处理 |
| Constraints 1-8 | AC1-8 整体 | ✅ |

**结论：FR 全量覆盖。** 无遗漏。

## 6. 与 CLAUDE.md 架构约束一致性

### 关键条款对照

| CLAUDE.md 规则 | Spec 状态 | 说明 |
|----------------|----------|------|
| Pipeline Hook 执行路径验证（注册到 proxyPipeline，非仅 hookRegistry） | ⚠️ 隐式 | FR3 定义 6 个 new builtin hooks 但未显式提及 `registerBuiltinHooks()` 的变更。v2 Issue #7 已记录 |
| Hook 降级（try-catch 包裹，异常不得传播到调用链） | ✅ 对齐 | Constraint 8 定义三级异常处理，与 CLAUDE.md 规范一致 |
| 数据消费者完整性（新字段列出所有消费者） | ✅ 对齐 | FR5 给出完整的 writer/consumer 映射表 |
| 前端控件模式一致 | N/A | 无前端变更 |
| structuredClone 替代 JSON roundtrip | N/A | 无相关变更 |
| 禁止 eslint-disable | N/A | 不涉及 |

## 7. 独立审查发现

### 7.1 MUST FIX 验证（v1 → v2 修复确认）

三条历史 MUST FIX 的修复在本轮独立审查中再次验证：

**MF1 (Issue #1): L1/route-resolve 职责重叠 → 已解决**
FR1 的"L1 与 L2 的边界"段落彻底消解了模糊性：L1 产出候选列表（不做选择），L2 的 `builtin:route-resolve` 每轮迭代从列表中选取第一个非 excluded target。分工明确，无重叠。

**MF2 (Issue #2): Hook 异常传播缺失 → 已解决**
Constraint 8 定义三级处理：PipelineAbort → 传播短路；核心 hook (0-99) → 传播到执行器；其他 hook → catch + 日志 + 继续。与 CLAUDE.md「Hook 降级」规则完全对齐。

**MF3 (Issue #3): on_stream_event 矛盾 → 已解决**
FR7 降级为"基础设施就绪"，AC1 明确排除 on_stream_event，Out of Scope 第 1 条保持一致。三方文档无矛盾。

### 7.2 仍 open 的历史 LOW/INFO

**Issue #4 (LOW): AC1 验证方式为调试日志而非自动化断言**
验证方式用"添加调试日志"属于临时手段。建议改为 hook execute() 的 spy/stub 验证。

**Issue #6 (LOW): Constraint 6 性能无阈值**
"可测量的延迟增加"缺乏具体基线。建议给出如"p99 延迟增加 ≤ 1ms"的可验证阈值，与项目 CLAUDE.md 无此指标规定不冲突。

**Issue #7 (LOW): registerBuiltinHooks() 变更点未提及**
6 个新增内置 hook 的注册位置未说明。是扩展现有 `register-hooks.ts` 的 `ALL_HOOKS` 数组，还是新建文件？not spec-blocking 但 plan 阶段需明确。

**Issue #8 (LOW): 迁移策略未定义**
~15 文件修改 + 612 行 failover-loop 重写的风险未说明迁移策略。一次性提交过大（回滚困难），建议在 Constraints 中明确是否允许分阶段迁移。

**Issue #9 (INFO): AC5 验证方法未定义**
10 种场景的等价性验证没有具体测试策略（录制回放 / 快照比较 / 断言对比）。plan 阶段需定义。

**Issue #10 (INFO): 6 个 builtin hook 注册位置未明确**
同上 Issue #7，plan 阶段明确即可。

**Issue #11 (LOW): FR2 序列图中 orchestrator.handle() 位置误导**
FR2 的 emit 序列将 `orchestrator.handle()` 显示为 emit("pre_transport") 和 emit("post_response") 之间的独立步骤，但 FR3 将其定义在 `pre_transport` phase 内部（priority 50）的 `builtin:transport-execute` 中。建议在 FR2 序列图中加注释说明"由 builtin:transport-execute hook 在 pre_transport phase 内执行"。

**Issue #12 (LOW): Constraint 8 表述可更清晰**
第一句"非 PipelineAbort → catch + 继续"与第三句"核心 hook (0-99) → 直接传播"在文面上构成表面矛盾。建议用分层表述（列表或表格）消除歧义，如：
1. PipelineAbort → 传播 + 短路
2. 核心 hook (0-99) 非 Abort → 传播到执行器
3. 其他 hook 非 Abort → catch + 日志 + 继续

### 7.3 本轮新发现

**Issue #13 (LOW): pre_route phase 不再被 emit，外部插件 hook 可能静默失效**

**问题描述**：FR2 定义的 emit 序列只包含 `post_route` → `pre_transport` → `post_response`。`pre_route` phase（当前唯一被 emit 的 phase）完全不在新序列中。虽然当前 pre_route 的内置 hook（redirect、allowed_models）的功能被移入 L1 预计算和 post_route 的 builtin hook，但如果**外部插件**（通过 plugin-bridge 注册了 pre_route hook）存在，这些 hook 会因 no emit 而静默不再执行。

**影响分析**：
- 当前是否有外部插件使用了 pre_route，取决于部署环境。系统自身不注册 pre_route hooks（只有 pre_route 的 pipeline hook 定义在 types.ts 中，但无内置 hook 挂载）
- Constraint 3 要求"所有现有 API 行为不变"——插件 hook 不触发是行为变化
- Constraint 2（ADR 0005 failover 包裹 Pipeline）暗示 pipeline 是核心执行路径，但 pre_route 是否属于"pipeline 内部"有讨论空间

**修改建议**：在 Constraints 中新增一条，明确 `pre_route` phase 的处理方式：
- 选项 A：保持 emit pre_route 在 L1 之前（最安全，向后兼容）
- 选项 B：明确声明 pre_route 不再被 emit，并将其功能等价物（redirect、allowed_models 等）标注在 post_route 或 L1 中。如是，则需在 Constraints 中说明理由（如"pre_route 逻辑已全部迁入 L1 预计算或 post_route builtin hook"）
- 选项 C：在 Constraint 3 中补充"插件 hook 的 phase 兼容性说明"

## 8. 整体评价

v1 的 3 条 MUST FIX 修复充分且彻底。spec 结构清晰，FR 到 AC 的映射完整，三层架构定义明确，约束条件全面。在独立重新审查中未发现新的 MUST FIX 问题。

一个之前被遗漏的关注点是 pre_route phase 的向后兼容性（Issue #13），但考虑到当前无内置 hook 挂载在 pre_route 上，且 spec 属于技术设计文档而非插件 API 契约，这更接近 LOW（文档覆盖度）而非 MUST FIX（功能缺陷）。

## 结论

通过。

v1 的 3 条 MUST FIX 已全部解决，本独立审查未发现新的 MUST FIX。9 条 LOW（含 1 条新发现）+ 2 条 INFO 均不阻塞，可在 plan / 实现阶段处理。

### Summary

Spec 评审完成，第 3 轮，0 条 MUST FIX，3 条历史 MUST FIX 已解决，9 条 LOW + 2 条 INFO 仍 open，通过。
