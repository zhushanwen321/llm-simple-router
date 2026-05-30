---
phase: spec
verdict: pass
---

# Spec Phase Retrospect — adaptive-concurrency-v3-fix

## 1. Phase Execution Review

### Summary

本 phase 的输入非常特殊：需求不是用户口头描述的，而是在同一会话的前序对话中完成了完整的根因分析、算法设计、数值模拟验证（20+ 场景 + 21 个极端场景），产出了设计文档 `docs/design/adaptive-concurrency-v3.md`。因此 spec 编写本质上是将已有的设计决策结构化为 FR/AC 格式。

关键产出：
- spec.md：6 条 FR、8 条 AC、3 个 UC、8 条约束
- 设计文档（前置产出）：算法伪代码、参数推导表、21 个极端场景模拟
- 两轮 spec review（v1 发现 2 条 MUST FIX，v2 通过）

### Problems Encountered

1. **AC-1 期望值错误**：`deriveProfile(1,1)` 写成了 `climbThreshold=2, dropThreshold=1`，实际为 `climbThreshold=4, dropThreshold=3`。根因：写 spec 时凭记忆而非实际运行验证。第一轮 review subagent 通过 Node.js 执行发现此错误。

2. **5xx 冷却期遗漏**：FR-4 原文说"5xx/net 路径保持不变"，但 V2 代码中 5xx 下降不设 `cooldownUntil`，而设计文档的算法明确要求 5xx 也进入冷却期。这是"保持不变"这个表述的歧义——"不变"应该指"固定 -1 下降方式不变"，但被理解为"整个路径不变"。review subagent 通过对比设计文档和代码发现了这个矛盾。

### What Would You Do Differently

1. **数值断言必须先跑代码验证**，不能凭记忆。deriveProfile 的参数推导虽然简单，但 `log2(1)/7 = 0` 导致 `capacity=0`，进而影响所有阈值，这个边界条件容易记错。

2. **避免"保持不变"这种模糊表述**。对于算法变更，每个路径都应该明确写出最终行为，而不是说"和之前一样"然后隐含变更。

### Key Risks

- **Plan 阶段需注意 5xx 冷却期新增**：这不是简单删除代码，而是在 5xx 分支的 `consecutiveFailures >= dropThreshold` 分支内新增 `s.cooldownUntil = ...`。容易遗漏。
- **测试更新量大**：现有 `adaptive-controller.test.ts` 有大量基于 V2 行为的断言（safeZone、limitReached、乘法衰减），全部需要更新。测试文件可能接近重写。

## 2. Harness Usability Review

### Flow Friction

- **前置分析算不算 Phase 1？** 本会话在初始化 workflow 之前已经完成了完整的算法分析和设计文档编写。coding-workflow-init 之后，Phase 1 的 brainstorming 步骤（Quick Overview → Ask Questions → Propose Approaches → Present Design）几乎全部跳过，直接进入 Write Spec。这是因为 skill 要求的"从零开始探索需求"和"已有完整设计"之间存在 gap。处理方式是合理的（跳过不适用步骤），但 harness 没有这种"从中间进入"的正式路径。

### Gate Quality

- Gate check 质量高：两轮 review 正确识别了两个真实 bug（AC-1 数值错误、5xx 冷却期遗漏），都是零假阳性。
- 特别是 MUST FIX #2（5xx 冷却期），需要交叉对比 spec FR-4、设计文档算法和现有 V2 代码，审查 agent 做得很好。

### Prompt Clarity

- spec.md 的模板和六元素检查清单很清晰，没有歧义。
- review subagent 的 task prompt 需要手动写审查重点（6 个 bullet），这增加了主 agent 的工作量，但也提高了审查针对性。

### Automation Gaps

- **数值验证应自动化**：AC 中的 deriveProfile 期望值可以由脚本自动验证，不需要等 review subagent 人工发现。可以在 spec 编写时就跑 `node -e` 验证。

### Time Sinks

- 21 个极端场景模拟占了大量 token，但对算法设计的信心提升是实质性的。如果算法更简单，这部分可以缩减。
