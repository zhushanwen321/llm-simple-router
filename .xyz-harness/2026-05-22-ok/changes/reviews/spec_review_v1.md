---
review:
  type: spec_review
  round: 1
  timestamp: "2026-05-22T11:15:00"
  target: ".xyz-harness/2026-05-22-ok/spec.md"
  verdict: fail
  summary: "Spec 评审完成，第1轮，2条MUST FIX，需修改后重审"

statistics:
  total_issues: 6
  must_fix: 2
  must_fix_resolved: 0
  low: 2
  info: 2

issues:
  - id: 1
    severity: MUST_FIX
    location: "spec.md:AC-1"
    title: "AC-1 缺少迭代级字段迁移的验证项"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 2
    severity: MUST_FIX
    location: "spec.md:FR-6"
    title: "proxyPipeline.getHookChain() 返回类型未定义，Admin API 消费者无法预知数据结构"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 3
    severity: LOW
    location: "spec.md:FR-2"
    title: "ProviderSwitchNeeded 降级对外部 plugin 的兼容性未说明"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 4
    severity: LOW
    location: "spec.md:AC-5"
    title: "AC-5 验收标准偏宽松，未覆盖 spec 宣称的消除 CRUD 骨架重复"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 5
    severity: INFO
    location: "spec.md:FR-4c"
    title: "AC-4c '至少 1 个同构转换器'未指定候选，验收时可能有歧义"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 6
    severity: INFO
    location: "spec.md:AC"
    title: "缺少性能回归验收标准（TransportExecutor 新增间接调用层）"
    status: open
    raised_in_round: 1
    resolved_in_round: null
---

# Spec 评审 v1

## 评审记录

- 评审时间：2026-05-22 11:15
- 评审类型：计划评审（spec 完整性审查）
- 评审对象：`.xyz-harness/2026-05-22-ok/spec.md`

---

## 1. spec 完整性检查

### 1.1 目标是否明确

**通过。** Background 清晰陈述了 3 个结构性缺陷，FR-1~FR-6 一一对应解决。一句话概述："渐进式重构 Pipeline Hook 架构，解决 metadata 无类型、控制流分裂、模块深度不足 3 个问题。" 目标明确。

### 1.2 范围是否合理

**通过但有观察点。** 4 个 Phase、6 个 FR，每个 FR 有明确的变更清单和边界（Constraints 1-6）。迁移顺序合理。范围覆盖了 3 个结构性缺陷，没有过度设计的迹象。

观察点：
- FR-4a 删除 `createConverter()` 工厂函数：spec 未检查是否有外部代码（plugin/extensions）依赖此函数。虽然 Constraint 3 声明"扩展点保留"，但未做兼容性验证。

### 1.3 验收标准是否可量化

**发现 MUST FIX 问题。** 大部分 AC 可量化，但有 2 处不足：

**MUST FIX #1**（详见下方问题表）：
- FR-1 正文明确说明迭代级状态（`excludeTargets`、`mappingReason`、`isFailoverIteration`、`iterationStartTime`、`lastFailoverTrigger`）提升为 `PipelineContext` 具名可变字段，但 **AC-1 没有任何一项检查迭代级字段的存在性**。AC-1 第 2 条只检查 `failover-loop.ts` 中无 `metadata.set` 调用，第 3 条只检查固定依赖的 `as` 断言。如果 implementer 只迁移了固定依赖、忘记迁移迭代级字段，编译器不会报错（`metadata.set("startTime", ...)` 仍合法），而 AC 也无法捕获。

### 1.4 待决议项

**无。** 未发现 `[待决议]` 标记。

---

## 2. 与 CLAUDE.md 架构约束的一致性

### 2.1 Pipeline Hook 执行路径验证

**一致。** FR-6 正是解决 CLAUDE.md 中"新增 Hook 必须同时注册到 hookRegistry 和 proxyPipeline"的需求——合并双注册表后只需注册一次。这与 CLAUDE.md 的强制要求一致。

### 2.2 taste-lint / 代码品味规则

**一致。** 不涉及 `taste/no-raw-json-parse-models`、`taste/prefer-allsettled` 等规则。

### 2.3 新字段数据消费者检查

**部分满足。** infrastructure-scan.md 列出了完整的 metadata 依赖清单（Section 3），但 FR-1 AC 没有要求逐一验证每个 metadata key 的迁移完整性（特别是迭代级字段，见 MUST FIX #1）。

### 2.4 测试模式

**一致。** AC 全部使用"所有现有测试通过"，对新增模块（TransportExecutor）要求新测试，符合项目测试规范。

### 2.5 转换层类型安全规范

**一致。** FR-1 PipelineDeps 本质上是将 `metadata.get("xxx") as T` 替换为类型安全的 `ctx.deps.xxx`，符合规范要求。

---

## 3. 迁移路径可行性

**通过。** Phase 划分合理：

| Phase | FR | 前置依赖 | 独立性能 | 风险 |
|-------|-----|---------|---------|------|
| 1 | FR-1 + FR-6 | 无 | 是 | 中（15 个 hook 逐一迁移） |
| 2 | FR-3 + FR-2 | FR-1 | TransportExecutor 可独立，控制流依赖 PipelineDeps | 中（failover 回归） |
| 3 | FR-4a→4b→4c | 无 | 是 | 低（纯格式子系统） |
| 4 | FR-5 | 无 | 完全独立 | 低（Admin 工具提取） |

Phase 1 作为前置条件是合理的——FR-1 提供结构化 deps，FR-6 简化注册。Phase 2 依赖 FR-1 的 deps 结构也合理。

---

## 4. 发现的全部问题

| # | 优先级 | 位置 | 描述 | 修改建议 |
|---|--------|------|------|---------|
| 1 | **MUST FIX** | spec.md:AC-1 | AC-1 缺少迭代级字段的迁移验证。spec 正文明确说迭代级状态（excludeTargets、mappingReason、isFailoverIteration、iterationStartTime、lastFailoverTrigger）提升为 PipelineContext 具名字段，但 AC 只验证了固定依赖。 | AC-1 增加一项："PipelineContext 包含以下具名字段：excludeTargets、mappingReason、isFailoverIteration、iterationStartTime、lastFailoverTrigger" |
| 2 | **MUST FIX** | spec.md:FR-6 | proxyPipeline.getHookChain() 返回类型未定义。当前 hook-registry 的 `getRegistry()` 返回的数据格式是什么？proxyPipeline.getHookChain() 是否返回兼容的格式？Admin API monitor 端点依赖此数据结构，不定义合约可能导致运行时断裂。 | 在 FR-6 变更清单中定义 getHookChain 的返回类型接口（或说明复用现有 hook-registry 的 HookInfo 类型）。AC-6 增加："Admin API monitor 端点返回的 hook 信息字段名和类型与删除前一致" |
| 3 | **LOW** | spec.md:FR-2 | ProviderSwitchNeeded 标记 @deprecated 且 failover-loop 不再 catch 它。如果外部 plugin（Plugin API）仍依赖 throw ProviderSwitchNeeded 做控制流，该异常将穿透到顶层未处理。与 Constraint 3"扩展点保留"有潜在冲突。 | 在 FR-2 中补充兼容性声明：说明 ProviderSwitchNeeded 是否只用于内部、外部 plugin 是否不应使用它（或提供迁移指南）。建议在 `@deprecated` 注释中写明替代方案。 |
| 4 | **LOW** | spec.md:AC-5 | "至少 providers.ts 和 retry-rules.ts 使用了工具函数"——"至少"型 AC 偏宽松。spec 宣称目标是"消除 CRUD 骨架重复"，但 groups.ts（189 行，35% 骨架）、router-keys.ts（114 行，30% 骨架）没有覆盖要求。如果只有 2 个文件使用了工具函数，其他 CRUD 文件仍有骨架重复，则 spec 目标未达成。 | AC-5 增加覆盖要求：列出具体哪些 admin CRUD 文件应使用工具函数（按 infrastructure-scan 数据，应覆盖 providers.ts、retry-rules.ts、groups.ts、router-keys.ts），允许有合理例外但必须说明原因。 |
| 5 | **INFO** | spec.md:FR-4c | AC-4c "至少 1 个同构转换器迁移为映射表模式"没有指定候选。6 个流式转换器中哪些是同构的？代码量减少多少才算达标？（"代码量减少"无基准线） | 建议指明候选转换器（如 "将 Anthropic↔Responses 同构转换器迁移为映射表模式"），并给出代码行数减少的参考基准（如 "迁移后该文件行数减少 40%+"）。 |
| 6 | **INFO** | spec.md:AC | 缺少性能回归验收标准。FR-3 TransportExecutor 新增了一层间接调用（hook → TransportExecutor.execute() → 7 个内部步骤），虽然逻辑量不变，但存在函数调用开销。重构后不应有可感知的性能退化。 | 允许不立即添加性能测试，但建议在 spec 中注明"实施阶段需确认性能无退化"（如启动时间、首 token 延迟在 ±5% 范围内与 baseline 对比） |

---

## 5. 综合评估

### 优势

- **背景清晰**：3 个结构性缺陷的动机明确，FR 与缺陷一一对应
- **范围精确**：6 个 FR，每个有明确变更清单，没有模糊区域
- **迁移路径合理**：Phase 1（前置条件）→ Phase 2、3（并行可能）→ Phase 4（独立）
- **AC 整体质量高**：大部分可测试、可验证，无模糊"提升用户体验"类 AC
- **infrastructure-scan.md 质量极好**：metadata 依赖清单、控制流路径、统计量化的完整度远超一般项目

### 不足

- **FR-1 AC 迭代级字段遗漏**（MUST FIX）
- **FR-6 getHookChain API 合约缺失**（MUST FIX）
- AC-5 验收标准偏宽松，与 spec 宣称目标不匹配
- FR-2 对 ProviderSwitchNeeded 的外部兼容性未说明

### 结论

**需修改后重审。**

spec 整体质量很高——3 个结构性缺陷的识别精准，6 个 FR 覆盖完整，infrastructure-scan 的数据量化工作扎实。但 2 条 MUST FIX（FR-1 迭代级字段验证遗漏、FR-6 getHookChain API 合约缺失）需要在进入 plan 阶段前修复，确保 implementer 有明确的实现边界和验收标准。

> 优先级定义：
> - **MUST FIX**：不修复则评审不通过，会阻塞流程
> - **LOW**：建议修复，不阻塞
> - **INFO**：观察记录，无需操作

---

## Summary

Spec 评审完成，第 1 轮，2 条 MUST FIX，需修改后重审。
