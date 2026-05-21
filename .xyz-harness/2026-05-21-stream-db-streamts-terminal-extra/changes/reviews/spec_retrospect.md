---
phase: spec
verdict: pass
---

# Phase 1 Retrospect — 运行时诊断数据持久化 + 模型超时 UI 修复

## 1. Phase Execution Review

### Summary

Phase 1 产出 `spec.md`，覆盖 7 个运行时诊断数据遗漏点（P1/P2/P3）和 1 个前端 UI 修复（FR8）。用户以详尽的"遗漏总结"文档作为输入，大幅缩短了探索阶段。设计决策快速收敛：全部 8 个新列加在 `request_logs` 表（方案 A），P3 使用独立列提取（方案 A），全部 7 点一次性处理。

spec 包含：8 条 FR、8 条 AC、Data Consumer Checklist（4 类消费者）、6 项 Out of Scope 排除。经过 2 轮审查后通过。

### Problems Encountered

| 问题 | 严重性 | 如何解决 |
|------|--------|---------|
| 初版 spec 缺少 Data Consumer Checklist | MUST FIX | CLAUDE.md 强制规则：新增 DB 列必须列出 4 类消费者。第 2 轮补充完整 |
| AC1 只覆盖 3/6 种 transport_kind | LOW | 补充 `stream_error`、`error`、`throw` 三种场景 |
| mapping_reason 枚举值来源不明确 | LOW | 明确枚举值以 mapping-resolver.ts 实际返回值为准，spec 阶段不锁定 |
| failover_trigger 提取机制未定义 | LOW | 明确自定义 Error 用 constructor.name、系统 Error 用 code |
| spec_review_v2 frontmatter 嵌套 YAML | 阻塞 gate | gate 脚本期望顶层 `verdict`/`must_fix`，修复为扁平格式 |
| gate check 脚本路径错误 | 流程 | `check_gate.py` 不存在，改用 `gate-script.sh` |

### What Would You Do Differently

1. **用户输入质量是最大变量** — 本次用户提供了完整的 P1/P2/P3 分级分析，只需确认范围和方案选择。如果用户只模糊描述"stream 数据存得不全"，questioning 阶段会多 3-4 轮。
2. **Data Consumer Checklist 应在初版就包含** — 不依赖审查来发现。未来 spec 阶段应内建此检查。
3. **Gate 脚本应提前确认可用** — `check_gate.py` vs `gate-script.sh` 的路径差异导致第一次 gate 调用失败。应在 spec 阶段初就运行一次 gate 确认可用。

### Key Risks for Later Phases

1. **`failover-loop.ts` 是中心集成点** — 8 个新字段全部汇总到此文件的 `logResilienceResult()` 调用。如果 failover-loop.ts 的改动遗漏了某条分支路径（如 retry 分支 vs 直接返回分支），对应字段会静默为 NULL。Plan 阶段必须明确列出每条路径的数据流。
2. **数据流回溯深度** — `abort_reason` 需要从 `StreamProxy` 的三条 abort 路径回溯到 `TransportResult`，再传递到 `failover-loop.ts`。这条链路最长，最容易丢失数据。
3. **Out of Scope 边界漂移** — 如果 dev 阶段"顺手"给前端日志页加了新列展示，就会偏离 spec 的 Out of Scope 声明。需在 plan review 阶段确认边界。

## 2. Harness Usability Review

### Flow Friction

- **Questioning 阶段效率高** — 用户以结构化文档输入（P1/P2/P3 + 编号），使得 branching 问题减少到 3 个（范围 → 方案 A/B/C → 确认 OK）。
- **Subagent 使用判断失误** — 对"模型级 chunk 超时"的简单 grep 扫描派发了 subagent（被 abort），随后改用 bash 直接完成。教训：简单文件搜索不需要 subagent。
- **Approach exploration 跳过** — 用户已选择了方案 A，实际上直接呈现了完整设计而非 2-3 个方案对比。这在用户充分知情时合理，但缺失了 formal 的方案讨论步骤。

### Gate Quality

- **Gate check 首次通过率 0/2** — 两次 gate 调用都遇到了问题：第一次路径错（`check_gate.py` 不存在），第二次 frontmatter 格式错（嵌套 YAML）。两次都在 1 轮内修复。
- **Gate 对嵌套 YAML 无感知** — `spec_review_v2.md` 的前端 matter 将 `verdict` 和 `must_fix` 嵌套在 `review` 和 `statistics` 下，gate 脚本读取的是顶层字段，报了 2 个 false negative。如果 gate 能检测 `verdict` 在嵌套路径中也应提示。
- **Pass 文件正常生成** — `gate-script.sh` 正确生成了 `stage-1.pass`。

### Prompt Clarity

- brainstorming skill 指令的 `HARD-GATE` 规则清晰，有效阻止了"跳过 spec 直接写代码"的倾向
- six-element check + AMBIGUOUS 标记的表格结构清晰，但实际操作中无 AMBIGUOUS 标记需要解决（spec 定义充分）
- "one question at a time" 规则被遵守，但 3 个问题总耗时短，这不是瓶颈

### Automation Gaps

| Gap | 影响 | 建议 |
|-----|------|------|
| gate 脚本路径不统一 | 首次 gate 调用浪费 1 轮 | `coding-workflow-gate` 工具应在内部自动探测正确的 gate 脚本路径，而非依赖 skill 中的路径 |
| 审查输出 frontmatter 格式不强制 | v2 需要手动修复 frontmatter | subagent 审查时应在 task prompt 中明确要求**扁平顶层** `verdict` / `must_fix` |
| 无自动 spec 六元素检查 | 依赖人工 + 审查 subagent 双重检查 | 考虑在 gate 脚本中加入 spec.md 的六元素存在性检查 |

### Time Sinks

无显著时间浪费。2 轮审查是此需求复杂度的正常水平（第 1 轮发现 MUST FIX，第 2 轮通过）。总交互约 6 轮问答。
