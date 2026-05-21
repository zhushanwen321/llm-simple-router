---
phase: plan
verdict: pass
---

# Plan Phase Retrospect

## 1. Phase Execution Review

### Summary

Plan 阶段产出了一份 9-task、3-group 的实施计划，将 spec 中定义的"Pipeline 全量接管代理请求执行"拆解为可执行的工作单元。核心架构决策：BG1（6 个新 hook + pipeline emit 降级）→ BG2（failover-loop 重写）→ BG3（端到端验证）。附带 20 个 E2E 测试场景和 16 个测试用例模板。评审经历 5 轮才通过，2 条 MUST FIX 在 v2 解决，后续 3 轮为增量复查和最终独立复查。

### Problems Encountered

**1. 评审 5 轮，其中前 2 轮消耗了绝大部分精力。**

MUST FIX #1（transport-execute priority 执行顺序错误）：Task 5 将 transport-execute 放在 pre_transport phase，但 priority 300 排在 provider-patches(100) 和 plugin-request(250) 之后，导致 transport 在所有改造完成前执行。这不是设计问题而是 plan 文档的表述问题——spec 已明确 transport 应最后执行，但 plan 中的 priority 数值和 phase 归属产生了矛盾暗示。v2 通过显式说明 "Priority 300 — 确保在所有改造完成后执行" 和 `core: true` 标记解决。

MUST FIX #2（failover-loop ≤150 行目标不可行）：plan 声称 failover-loop 可缩减至 ≤150 行，但实际评估 ~200-240 行。评审指出 L1 预计算（resolveMapping + modalityRedirect + overflow + allowedModels）和 L3 循环壳（error 分类的 catch 块）的代码量下限决定了无法压缩到 150 行。v2 将目标调整为 ≤250 行（与 spec AC2 对齐），但 plan 正文中仍保留了 ≤150 行的目标描述作为内部挑战值。

**2. 4 条 LOW 问题跨 5 轮未解决。**

Issue #3（BG1 文件数文字描述与表格不一致）、#4（BG1 串行执行过于保守）、#5（Task 5 依赖列表不完整）、#6（on_error hook ctx 字段准备不完整）——这些 LOW 问题从 v1 就存在，到 v5 仍 open。其中 #5 和 #6 在实现阶段可能导致 subagent 需要额外探索：

- #5 的运行时数据依赖（transport-execute 需要 ctx.resolved，由 route-resolve 写入）意味着 Task 5 不能真正独立于 Task 2，但 plan 中 Task 5 的 Depends on 只写了 "3, 4"。subagent 执行时如果先于 Task 2 运行 Task 5，会因 ctx.resolved 为空而失败。
- #6 的 on_error ctx 字段不完整意味着 request-logging hook 在 on_error 分支可能读到 undefined 的 transportResult，需要防御性处理。

**3. v3-v5 为质量保证轮次。**

v3 新发现 Issue #9（types.ts 归属 BG2 但 Task 1 BG1 需修改 PipelineHook 接口），v4 确认 #8 和 #9 已修复，v5 为独立复查确认无新增问题。这 3 轮的价值是确保前 2 轮的修复没有引入回归，属于合理的质量投入。

### What Would You Do Differently

1. **plan 初稿就该做 AC 可行性验证。** ≤150 行的声明在 v1 就被评审否决，说明写 plan 时没有对关键 AC 做代码量估算。正确做法：先统计 L1 预计算和 L3 循环壳的必要代码行数，再设定目标。这比凭直觉设目标然后被否决高效得多。

2. **priority/phase 映射应该有显式表格。** transport-execute 的 MUST FIX 本质上是文档精度问题。如果在 File Structure 表格之外增加一个 "Hook Phase/Priority 映射表"，直接列出所有 hook 的 phase + priority + core 值，评审可以在 10 秒内发现排序矛盾，而不需要从分散的设计细节中推断。

3. **LOW 问题不应该跨轮次积压。** 4 条 LOW 从 v1 积压到 v5，每次评审都需要重新确认状态。正确做法：在评审通过前，至少将影响执行的 LOW（如 #5 依赖不完整）修复为 MUST FIX 或显式标注"实现时注意"。将 LOW 分为"文档精度"和"执行风险"两类，后者不应长期 open。

### Key Risks

1. **Task 5 对 Task 2 的运行时依赖未在 Depends on 中体现（Issue #5）。** 如果 BG1 内部按 plan 声称的串行执行，这不是问题（Task 2 先于 Task 5）。但如果未来并行化优化（Issue #4 建议），Task 5 会因 ctx.resolved 为空而失败。
2. **on_error 分支的 ctx 字段缺失（Issue #6）。** failover-loop 重写后，catch(SemaphoreQueueFullError) 和 catch(unknown) 分支触发 on_error emit，此时 transport-execute hook 未执行，ctx.transportResult/resilienceResult 为 undefined。request-logging hook 需要防御性处理，plan 未明确这一点。
3. **failover-loop 实际行数可能超 250 行。** AC2 目标 ≤250 行是评审调整后的保守估计，但 L1 预计算的代码量取决于 modalityRedirect/overflow 的逻辑复杂度。如果实现中发现需要更多边界处理，行数可能继续膨胀。
4. **E2E 测试场景（AC5 的 10 种）与 test_cases_template 覆盖不完全对齐。** E2E-04~13 的 10 个场景在 template 中只有 TC-8-02（failover）和 TC-8-03（ProviderSwitchNeeded）直接映射，其余（OpenAI 基本流、Anthropic 基本流、溢出重定向等）标注为"复用现有测试"。这意味着 AC5 的等价性验证依赖现有测试覆盖，如果现有测试本身不够，AC5 可能部分未覆盖。

---

## 2. Harness Usability Review

### Flow Friction

评审 5 轮偏多。核心问题出在前 2 轮：2 条 MUST FIX 都是可以通过 plan 自检避免的。plan 模板缺乏"关键数值验证"检查项（如：声称的行数目标是否有依据？priority 排列是否与 phase 归属一致？）。建议在 plan 阶段增加轻量自检清单，将 MUST FIX 在提交评审前拦截。

v3-v5 的 3 轮质量保证轮次是合理的流程设计（确认修复无回归 + 独立复查），不视为摩擦。

### Gate Quality

Gate 检查准确。5 轮评审共发现 9 个问题（2 MUST FIX + 4 LOW + 1 INFO + 2 跨轮确认），MUST FIX 全部在 v2 解决，后续轮次无新增 MUST FIX。无 false positive。

评审对 spec→plan 一致性的覆盖维度全面（逐条 FR/AC 映射、遗漏 Task 检查、E2E 交叉验证），v5 的独立复查进一步确认了无遗漏。

### Prompt Clarity

plan 阶段的产出质量高。Execution Groups 的设计（每组含 Subagent 配置表、注入上下文、读取文件、修改文件）直接支持了 subagent-driven-development 模式，减少了后续 dev 阶段的上下文准备成本。

一个可改进点：plan 的 Self-Review section 是纯表格式的 spec 覆盖检查，缺乏"数值验证"维度。如果 Self-Review 包含"行数目标依据"、"priority 排序验证"等检查项，可以在提交评审前拦截 MUST FIX。

### Automation Gaps

plan 评审中的 spec→plan 覆盖矩阵（逐条 FR/AC 映射）每次都由人工完成。这个映射关系是结构化的（spec 条目 → Task 编号），可以通过脚本自动生成初稿，评审只需确认而非从零编写。

### Time Sinks

5 轮评审是主要时间消耗。其中前 2 轮处理 MUST FIX 是必要的，v3-v5 的确认轮次也是合理的质量投入。真正浪费的是 Issue #3（文件数描述不一致）这类文档精度问题——它从 v1 到 v5 每次都需要确认状态，但修复成本极低（改一个数字），应该在一发现时就修复而不是积压为 LOW。
