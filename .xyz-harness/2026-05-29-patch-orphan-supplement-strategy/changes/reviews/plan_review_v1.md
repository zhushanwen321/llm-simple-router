---
review:
  type: plan_review
  round: 1
  timestamp: "2026-05-29T14:00:00"
  target: ".xyz-harness/2026-05-29-patch-orphan-supplement-strategy/plan.md"
  verdict: pass
  summary: "计划评审完成，第1轮通过，0条MUST FIX"

statistics:
  total_issues: 1
  must_fix: 0
  must_fix_resolved: 0
  low: 1
  info: 0

issues:
  - id: 1
    severity: LOW
    location: "plan.md: Execution Groups → Task 1 subagent flow"
    title: "Task 1 写失败测试与 Task 2 更新测试期望值的边界未清晰界定"
    status: open
    raised_in_round: 1
    resolved_in_round: null
---

# 计划评审 v1

## 评审记录
- 评审时间：2026-05-29 22:00
- 评审类型：计划评审
- 评审对象：`patch-orphan-supplement-strategy` — spec.md + plan.md + e2e-test-plan.md + use-cases.md + non-functional-design.md

## 1. Spec 完整性

### 1.1 目标明确性 ✅
目标明确：将 `patchOrphanToolResultsOA` 的反向孤儿处理从"删除"策略重构为"补配对"策略。一段话能说清楚。

### 1.2 范围合理性 ✅
5 个 FR 覆盖完整：
- FR-1: 反向补配对（核心改动）
- FR-2: 正向删除保持（与 Claude Code 一致）
- FR-3: Tool Call Cache（可选增强，可推迟）
- FR-4: 移除连锁清理逻辑
- FR-5: 移除 opencode.ai hack

有明确边界——只改 OpenAI 版本，Anthropic 版本不动（Constraint #3）。无[待决议]项。

### 1.3 验收标准可量化 ✅
10 个 AC 全部有 Given/When/Then 格式，可写测试验证。无模糊描述。

## 2. Plan 可行性

### 2.1 任务拆分合理性 ✅
2 个 Task 粒度适中，每个可由 subagent 独立完成：
- **Task 1**（核心逻辑重构 + hack 移除）：单函数策略替换，涉及 2 个文件
- **Task 2**（测试更新）：更新 7 个测试的期望值 + 1 个新增测试，1 个文件

### 2.2 依赖关系正确性 ✅
Task 2 依赖 Task 1（先实现再改测试），正确。

### 2.3 工作量估算 ✅
3 个文件改动，Medium 复杂度，2 Task 串行执行，工作量合理。

### 2.4 遗漏检查 ✅
对照 spec 逐条覆盖见下方 3.1 节，无遗漏。

## 3. Spec 与 Plan 一致性

### 3.1 AC 覆盖矩阵 ✅

| AC | 覆盖状态 | Plan Task | 说明 |
|----|---------|-----------|------|
| AC-1 反向补配对 | ✅ | Task 1 | 反向遍历 assistant + splice 插入合成 tool 消息 |
| AC-2 正向删除 | ✅ | Task 1 | 保留现有正向删除逻辑（FR-2） |
| AC-3 正向删除后合并连续 user | ✅ | Task 1 | 保留合并逻辑 |
| AC-4 Step 4 重排保留 | ✅ | Task 1 | 保留 Step 4，在补入/删除后执行 |
| AC-5 幂等性 | ✅ | Task 2 | 正常链路测试验证 |
| AC-6 空 ID 处理 | ✅ | Task 1 | 空 id 的 tool_call 跳过 |
| AC-7 末尾 assistant 跳过 | ✅ | Task 1 | 遍历时跳过最后一个 assistant |
| AC-8 现有测试全部通过 | ✅ | Task 2 | 更新 7 个测试期望值 |
| AC-9 Step 6/opencode.ai hack 移除 | ✅ | Task 1 | 删除对应代码段 |
| AC-10 KV cache 友好 | ✅ | Task 1 | 固定 content + 复用 id 保证幂等 |
| FR-3 Tool Call Cache | postponed | — | plan 明确标记推迟，spec Constraint #6 允许 |

### 3.2 Plan 额外工作 ✅
无 spec 未提及的额外工作。

### 3.3 AC → Task 实现路径 ✅
每个 AC 都能在 Task 1/2 的描述中找到对应的实现步骤。

## 4. Execution Groups 合理性

### 4.1 分组合理性 ✅
单 BG1 组，3 个文件（< 10），2 个 Task（≤ 4），合理。

### 4.2 类型划分 ✅
全部 backend Task，无前后端混合。

### 4.3 功能关联度 ✅
Task 1（逻辑重构）和 Task 2（测试更新）关联紧密，同组合理。

### 4.4 依赖关系 ✅
无外部 Group 依赖，Wave 1 单组。

### 4.5 Wave 编排 ✅
Wave 1 单组，Task 内部串行执行，Task 1 → Task 2 依赖正确。

### 4.6 Subagent 配置完整性 ✅
Agent、Model、注入上下文、读取文件、修改/创建文件全部完整指定。注入上下文包含 spec AC、Constraints、CLAUDE.md，充分性良好。

### 4.7 上下文充分性 ✅
Task 描述极其详细——包含行号引用、新旧行为对比、插入位置策略（`splice(assistantIdx + 1, 0, ...syntheticMsgs)`）、逆序遍历考虑。Subagent 读取当前文件后结合 plan 描述足以独立完成任务。

### 4.8 文件数预估 ✅
3 个文件（0 create + 3 modify），与 Task 描述一致。

## 5. 接口契约审查

Plan 包含 Interface Contracts 章节。标注 `complexity: L1`，不适用 data_flows cross-reference / 类型传递一致性检查（L2 专属）。

**AC 覆盖矩阵完整性**: ✅ — 矩阵完整，所有 adopted AC 都有对应行。FR-3 (Tool Call Cache) 标为 postponed 且有原因说明。

## 6. 后端设计充分性（L1）

### 6.1 为什么这样实现 ✅
Plan 详细解释了：
- "删除"策略的三个副作用（信息丢失、连锁复杂度、KV cache 破坏）
- 为什么改为"补"策略（与 Claude Code 一致、避免信息丢失）
- 为什么保留正向删除（保持与 Claude Code 策略一致）

### 6.2 存储变更 ✅
不涉及 DB 变更。

### 6.3 API 端点 ✅
不涉及 API 端点变更，函数签名保持 `body: Record<string, unknown> → void`（Constraint #5）。

### 6.4 边界条件 ✅
Task 1 覆盖：空 messages early return、末尾 assistant 跳过、空 id 忽略、逆序遍历防止索引偏移。

### 6.5 非功能 Task ✅
`non-functional-design.md` 覆盖稳定性、数据一致性、性能、业务安全、数据安全 5 个维度。不涉及 DB 变更和 API 变更，非功能风险极低。

## 7. 发现的问题

| # | 优先级 | 文件/位置 | 描述 | 修改建议 |
|---|--------|----------|------|---------|
| 1 | LOW | plan.md Execution Groups → Task 1 subagent flow | Task 1 步骤 1 写失败测试与 Task 2 更新期望值之间的边界未完全清晰。如果 Task 1 创建的新测试（如"合成消息内容固定"）与 Task 2 列出的"新增测试"第 7 项重叠，Task 2 的 subagent 需要在已存在测试上做额外判断。 | 在 Task 1 中明确只创建"行为级新测试"（验证核心功能的新场景），Task 2 只更新"现有测试的期望值"。或合并为一个综合测试更新 Task。不影响执行可行性，仅为主 agent 调度时需注意的边界。 |

> 优先级定义：
> - **MUST FIX**：不修复则评审不通过
> - **LOW**：建议修复，但不阻塞
> - **INFO**：观察记录

## 8. 结论

**通过。** 计划质量很高——spec 完整、plan 与 spec 高度一致、Task 粒度适合 subagent 调度、代码变更描述具体到行号和算法细节、测试更新说明覆盖所有策略变化、Execution Groups 配置完整。

0 条 MUST FIX，1 条 LOW（执行边界建议）。

### Summary

计划评审完成，第1轮通过，0条MUST FIX。
