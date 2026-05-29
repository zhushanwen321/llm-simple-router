---
review:
  type: spec_review
  round: 2
  timestamp: "2026-05-30T14:30:00"
  target: ".xyz-harness/2026-05-29-adaptive-concurrency-v3-fix/spec.md"
  verdict: pass
  summary: "Spec 评审完成，第2轮通过，0条 MUST FIX，2条历史 MUST FIX 已修复"

statistics:
  total_issues: 5
  must_fix: 0
  must_fix_resolved: 2
  low: 2
  info: 1

issues:
  - id: 1
    severity: MUST_FIX
    location: "spec.md:FR-4"
    title: "5xx/net 下降路径遗漏冷却期触发，导致纯 5xx 场景退化到 V2 下降速度"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
  - id: 2
    severity: MUST_FIX
    location: "spec.md:AC-1"
    title: "deriveProfile(1,1) 期望值与不修改公式约束矛盾"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
  - id: 3
    severity: LOW
    location: "spec.md:FR-3 / types.ts:AdaptiveState"
    title: "设计文档建议 cooldownUntil 重命名为 dropCooldownUntil 但 spec 未提及"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 4
    severity: INFO
    location: "spec.md:Constraints"
    title: "Spec 无需测试的约束条目与实际代码路径存在隐含关联"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
  - id: 5
    severity: LOW
    location: "spec.md:AC 覆盖"
    title: "5xx 主动触发冷却期缺少专属 AC，设计场景 S8 无直接验证"
    status: open
    raised_in_round: 2
    resolved_in_round: null
---

# Spec 评审 v2

## 评审记录
- 评审时间：2026-05-30 14:30
- 评审类型：Spec 增量评审（第 2 轮）
- 评审对象：`.xyz-harness/2026-05-29-adaptive-concurrency-v3-fix/spec.md`
- 评审模式：增量审查 — 验证 v1 MUST FIX 修复 + 检查回归

## MUST FIX 修复验证

### Issue #1: 5xx/net 下降路径冷却期触发 — [FIXED] ✅

**v1 问题**：FR-4 原文"5xx/net 路径保持不变"，遗漏了设计文档要求的 5xx 下降后进入冷却期。

**当前 FR-4 文本**：
> 5xx/net 路径：与 429 使用相同的固定 -1 下降，并新增冷却期触发（`s.cooldownUntil = Date.now() + profile.cooldownMs`）。V2 中 5xx 下降不设冷却期，导致纯 5xx 场景的下降速度退化

**验证结论**：
- ✅ 明确声明 5xx/net 使用固定 -1 下降
- ✅ 明确声明 5xx/net 触发冷却期（`s.cooldownUntil = Date.now() + profile.cooldownMs`）
- ✅ 解释了 V2 中此遗漏的后果（下降速度退化）
- ✅ 与 FR-3（冷却期语义翻转）的"冷却期内所有失败类型（429/5xx/net）均被拦截"形成闭环：5xx 触发冷却期 → 冷却期拦截后续所有失败类型

**影响量化验证**：修复后纯 5xx 场景 max=10→1 耗时：
- 每 dropThreshold(2) 次 5xx 降 1 格 + 20s 冷却期 → 9 格 × 20s ≈ 180s
- 符合设计文档宣称的 ~200s 目标

**结论：已修复，无回归。**

### Issue #2: deriveProfile(1,1) 期望值 — [FIXED] ✅

**v1 问题**：AC-1 声称 `deriveProfile(1,1)` 返回 `climbThreshold=2, dropThreshold=1`，但公式实际计算得 `climbThreshold=4, dropThreshold=3`。

**当前 AC-1 文本**：
> Then max 被钳制为 1，`deriveProfile(1, 1)` 返回有效数值（climbThreshold=4, dropThreshold=3, cooldownMs=20000）

**验证结论**：
- ✅ `climbThreshold=4`：`max(2, round(2 + 0*2 + 1*2)) = max(2, 4) = 4` — 正确
- ✅ `dropThreshold=3`：`max(1, round(5 - 0*2 - 1*2)) = max(1, 3) = 3` — 正确
- ✅ `cooldownMs=20000`：`round(10000 + 1*10000) = 20000` — 正确
- ✅ 与 Constraints "不修改 deriveProfile 公式"一致
- ✅ 不会导致测试断言失败

**结论：已修复，无回归。**

### Issue #4: Constraints 隐含关联 — [FIXED] ✅

Issue #2（AC-1 期望值）修复后，Constraints 中"不修改 deriveProfile 公式"与 AC-1 的数值不再冲突。此 INFO 级问题自然消解。

## 回归检查

### FR 一致性验证

逐条检查 FR-1 至 FR-6，确认修复未引入不一致：

| FR | 与 FR-4 新文本一致性 | 说明 |
|----|---------------------|------|
| FR-1 | ✅ 无关 | max 输入防护，不涉及冷却期 |
| FR-2 | ✅ 无关 | 移除利用率门控，不涉及冷却期 |
| FR-3 | ✅ 一致 | "冷却期内所有失败类型（429/5xx/net）均被拦截"与 FR-4 的"5xx/net 也触发冷却期"形成完整闭环 |
| FR-4 | — | 本次修复对象 |
| FR-5 | ✅ 无关 | 满额保留计数器，不涉及失败路径 |
| FR-6 | ✅ 一致 | deriveProfile 简化删除 keepRatio，FR-4 已同步删除 keepRatio |

### AC 一致性验证

| AC | 与 FR-4 新文本一致性 | 说明 |
|----|---------------------|------|
| AC-1 | ✅ | 期望值已修正为公式实际输出 |
| AC-2 | ✅ 无关 | 高水位爬升，不涉及 5xx |
| AC-3 | ✅ | 测试 429 冷却期，与 5xx 冷却期正交 |
| AC-4 | ✅ | 测试 429 固定 -1，FR-4 明确 5xx 同样固定 -1 |
| AC-5 | ✅ 无关 | 满额保留计数器 |
| AC-6 | ✅ | 连续 429 攻击，不涉及 5xx |
| AC-7 | ✅ 无关 | 从 limit=1 恢复 |
| AC-8 | ✅ | 测试冷却期拦截 5xx 不重置成功计数，前提是冷却期已由之前的 429 设置。**注意**：此 AC 未验证 5xx 主动触发冷却期（见 Issue #5） |

### Constraints 一致性

| 约束 | 与修复一致性 | 说明 |
|------|-------------|------|
| 不修改 deriveProfile 公式 | ✅ | AC-1 期望值已修正 |
| 不修改 admin API/前端 | ✅ | FR-4 改动仅为内存行为，无 API 变更 |
| 不修改 DB schema | ✅ | 无新增字段 |
| 保持 AdaptiveResult 不变 | ✅ | FR-4 不涉及此接口 |

## 发现的问题

| # | 优先级 | 文件/位置 | 描述 | 修改建议 |
|---|--------|----------|------|---------|
| 1 | ~~MUST FIX~~ | spec.md:FR-4 | ~~5xx/net 下降路径遗漏冷却期触发~~ | [v1 已修复] |
| 2 | ~~MUST FIX~~ | spec.md:AC-1 | ~~deriveProfile(1,1) 期望值错误~~ | [v1 已修复] |
| 3 | LOW | spec.md:FR-3 | cooldownUntil 重命名建议（继承自 v1） | 可选 |
| 4 | ~~INFO~~ | spec.md:Constraints | ~~AC-1 期望值与 Constraints 隐含冲突~~ | [v1 已修复] |
| 5 | LOW | spec.md:AC 覆盖 | **5xx 主动触发冷却期缺少专属 AC**。FR-4 已明确 5xx/net 下降触发冷却期，但 8 条 AC 中无一条直接验证此行为。AC-8 仅测试"冷却期内 5xx 被拦截"（前提是冷却期已由 429 设置），未验证"连续 5xx 达到 dropThreshold 后主动设置 cooldownUntil"。设计文档场景 S7（持续 5xx）和 S8（5xx 后恢复）的完整链路（5xx 触发下降→冷却期→恢复）缺少端到端验证。 | 建议新增 AC-9：Given max=10, currentLimit=10, When 连续 dropThreshold(2) 次 5xx, Then currentLimit=9 且 cooldownUntil 被设置。此为 LOW 因为 FR-4 已明确描述行为，测试可从 FR 推导。 |

> 优先级定义：
> - **MUST FIX**：不修复则评审不通过，会阻塞流程
> - **LOW**：建议修复，但不阻塞
> - **INFO**：观察记录，无需操作

## AC 覆盖矩阵（更新版）

| 设计文档场景 | 对应 AC | 覆盖状态 | 变化 |
|-------------|---------|---------|------|
| S1 正常启动 | AC-5 | ✅ | — |
| S2 偶发 429 | AC-3, AC-4 | ✅ | — |
| S5 连续 429 攻击 | AC-6 | ✅ | — |
| S7 持续 5xx | AC-8（间接）+ FR-4 | ⚠️ FR-4 覆盖行为但无专属 AC | FR-4 已修复 |
| S8 5xx 后恢复 | — | ⚠️ 无专属 AC（Issue #5） | 无变化 |
| S15/S21 从 1 恢复 | AC-7 | ✅ | — |
| S16 冷却期边界 | AC-3 | ✅ | — |
| E15 冷却期内大量成功 | AC-3 | ✅ | — |
| max=0 防护 | AC-1 | ✅ | 期望值已修正 |

## 结论

**通过。**

两条 MUST FIX 均已修复：
1. FR-4 已补充 5xx/net 冷却期触发描述，与 FR-3 冷却期拦截形成完整闭环
2. AC-1 期望值已修正为 `deriveProfile(1,1)` 的实际输出

未引入回归。FR 间一致性、AC 与 FR 间一致性、Constraints 合理性均保持。

Issue #5（5xx 专属 AC 缺失）标为 LOW：FR-4 已明确描述行为，测试可从 FR 推导，不阻塞。

### Summary

Spec 评审完成，第2轮通过，0条 MUST FIX，2条历史 MUST FIX 已修复。
