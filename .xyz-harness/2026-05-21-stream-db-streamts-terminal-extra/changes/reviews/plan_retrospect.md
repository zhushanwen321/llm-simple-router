---
phase: plan
verdict: pass
---

# Phase 2 复盘 — Plan

## Phase 执行复盘

### 概要

Phase 2 产出 4 个交付物：`plan.md`（含 5 个 Task + 2 个 Execution Group）、`e2e-test-plan.md`（7 个测试场景）、`test_cases_template.json`（24 个测试用例）、以及 2 轮 plan_review。核心决策：L1 复杂度判定（无新增 API/表，仅扩展现有列），前后端完全独立可并行执行。

### 遇到的困难

1. **plan_review_v1 的 frontmatter 格式问题**：审查 subagent 输出使用嵌套 YAML 结构（`review.verdict` 而非顶层 `verdict`），gate 检查时解析失败。同样的错误在 spec_review 阶段也出现过。**根因**：subagent task prompt 中指定了 YAML 格式模板，但 subagent 倾向于自由格式。**解决**：手动修改 frontmatter 将嵌套字段提升到顶层。

2. **数据流串联的精确路径需深入代码确认**：spec 阶段只是在高层描述了"stream → resilience → failover-loop → logging → DB" 的数据流，plan 阶段需要精确到行号。`stream.ts` 中三条 abort 路径都调用同一个 `terminal()` 但传入不同参数，`resilience.ts` 中 `decide()` 返回值类型在循环外层被丢弃，这些细节只有在写 plan 时通过阅读源码才能发现。

3. **AC 覆盖不完整**：第一版 spec 中 AC6 缺 `failover_retry`，被 plan_review 捕获。说明 spec 六元素检查时虽然名义上覆盖了枚举值，但实际遗漏了一个——人眼检查不如交叉验证有效。

### 如果重来

- 在 spec 写完后立即运行一个简单的交叉对照表（FR 枚举值 → AC 覆盖），而非依赖后续 review 发现
- frontmatter 格式问题应该沉淀为 gate check 的自动修复脚本或 subagent prompt 中的强制要求

### 关键风险

- **headers_sent 语义边界**：spec 和 plan 中 headers_sent 的 0 vs NULL 何时分别出现未有精确定义，在 plan_review 中被标记为 LOW。这是一个可能影响测试断言的隐式假设，如不澄清可能导致 dev 阶段的 TDD 测试预期值模糊。

---

## Harness 可用性复盘

### 流程摩擦

- **Phase 间交接时 retrospect 被跳过**：Phase 2 gate 通过后，`coding-workflow-phase-start` 直接注入了 Phase 5 的任务，跳过了 Phase 2 应有的复盘。这导致本复盘文档在事后补写。**根因**：用户可能在 gate pass 后立即说了话，导致系统跳过了 retrospect → phase transition → next phase 的标准流程。

### Gate 质量

- Phase 2 gate check（`gate-script.sh 2 .`）直接返回 PASS，没有做任何文件内容检查。这与 Phase 1 gate 形成了对比（Phase 1 gate 通过 `coding-workflow-gate` 工具检查了 spec.md 的 verdict 和 spec_review 的 verdict/must_fix）。**所有 phase 应该使用统一的 gate 检查工具**，而非部分走 python 脚本、部分走 bash。

### 提示词清晰度

- writing-plans skill 的 L1/L2 判定表比较清晰，5 个维度各有关键问题，判定直接
- Execution Group 模板详细但冗长，其中 subagent 配置（Agent/Model/注入上下文）对主 agent 写 plan 时的指引不够明确——主 agent 需要知道具体应该填哪些 Agent 名称和 Model 名称，而这些信息分散在 CLAUDE.md 中

### 可自动化之处

- **交叉对照校验**（FR 枚举值 → AC → test case）可以自动化：解析 spec 中的枚举列表和 AC 中的断言，对比是否有遗漏。当前依赖 plan_review subagent 来做，但这是事后检查，理想情况是 spec 写完时立即发现。

### 耗时点

- **数据流精确路径追踪**占时最长：需要从 `core/types.ts` → `transport/stream.ts` → `orchestration/resilience.ts` → `handler/failover-loop.ts` → `proxy-logging.ts` → `log-helpers.ts` → `db/logs.ts` 连续 grep/read 7 个文件来精确到行号。这个过程没有捷径，但如果 code-review-graph MCP 工具可用，语义搜索应该能显著加速。
