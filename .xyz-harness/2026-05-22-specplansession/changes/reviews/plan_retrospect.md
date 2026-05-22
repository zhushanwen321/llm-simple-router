---
phase: plan
verdict: pass
---

# Plan Phase Retrospect

## 背景

Plan phase 在恢复模式下执行：代码已在之前 session 实现，本次补充 plan 文档（作为实施指南，即使代码已存在）。L2 复杂度采用子文档模式（plan.md + plan-backend.md + plan-frontend.md + plan-api-contract.md）。审查 4 轮，最终以 0 条 open MUST FIX 通过。

---

## 1. Phase Execution Review

### Summary

- **plan.md**：7 个 Task、3 个 Execution Group（BG1/BG2/FG1）、Wave 调度
- **plan-backend.md**（17KB）：9 个章节，覆盖 DB Schema 到 Admin API 全链路
- **plan-frontend.md**（13KB）：组件架构、Provider 列/Select、Tab 切换、i18n key 设计
- **plan-api-contract.md**（9KB）：4 个端点的 request/response schema 变更
- **e2e-test-plan.md**：7 个 Scenario，**test_cases_template.json**：14 个 TC
- **审查**：v1 FAIL (1 MUST FIX) → v2 FAIL (未修复) → v3 PASS → v4 PASS (全量复查)

### Problems Encountered

| 问题 | 影响 | 根因 |
|------|------|------|
| MUST FIX #1: en i18n 缺少 16 个 key | v1 提出 | plan-frontend.md §9 只写了 zh-CN，遗漏 en |
| v2 空转：MUST FIX 仍 open | 浪费 1 整轮审查 | 我更新了 plan.md File Structure 表提及 i18n 文件，但未在 plan-frontend.md 中补充 §9.2 en key 列表。审查者验证实际文件后判定未修复 |
| §9.2 编号重复 | LOW #5 | plan-frontend.md §9.2 出现两次（旧草稿残留） |
| 集成测试路径不一致 | LOW #3 | plan.md 写 `tests/integration/retry-rule-provider.test.ts`，实际文件在 `router/tests/integration-retry-rules.test.ts` |

### What Would You Do Differently

1. **i18n 双语言必须在 plan 撰写时同步列出**。本次先写 zh-CN 后补 en，en 被遗漏。下次 §9 模板强制要求两种语言并列。
2. **MUST FIX 修复后提交修复证据再进入下轮审查**。v2 空转的根因是：我修改了 plan.md（提及文件存在），但审查者检查的是 plan-frontend.md 的 §9.2 内容（不存在）。如果修复后先自检"审查者会验证什么"，就能避免空转。
3. **恢复模式下 plan 与实际代码的路径对齐应作为独立步骤**。plan 中的文件路径（如测试路径）应与 `git ls-files` 交叉验证，而非仅凭记忆。

### Key Risks for Later Phases

| 风险 | 来源 | 建议应对 |
|------|------|----------|
| en i18n 实际文件仍缺少 key | MUST FIX 仅在 plan 文档层面修复 | Dev 阶段首件任务：更新 en/retryRules.json |
| BodyMatcherEditor.vue 独立 vs 内联 | plan 声明独立组件，实现内联在 RetryRules.vue | Dev 阶段按实际代码更新 plan |
| 前端测试路径不一致 | plan.md vs plan-frontend.md 声明不同 | Dev 开始前统一路径 |

---

## 2. Harness Usability Review

### Flow Friction

1. **"恢复已有实现"的 plan 定位模糊**。审查者需要同时评估"plan 作为指南是否正确"和"plan 与已有代码是否一致"，两个目标有冲突。建议 session 级声明 `mode: restore`，让审查聚焦文档正确性。
2. **MUST FIX 修复→复查的闭环有断点**。v1 提出 MUST FIX 后，v2 审查时我的修改未触及核心问题（只改了 plan.md 引用，未改 plan-frontend.md 内容）。建议 gate 要求提交修复 diff 再进入下轮。
3. **子文档模式的一致性维护成本高**。4 个子文档之间的文件路径、Task 编号容易不同步。跨文档一致性应作为 plan 自检的最后一步。

### Gate Quality

- Gate 正确阻止了 v1 和 v2 通过（MUST FIX 未解决）。i18n 双语言同步问题被 gate 拦截是本次最有价值的发现。
- YAML frontmatter 没有出现格式问题（吸取了 spec phase 的教训）。
- v4 全量复查有增量价值（发现 2 条新 LOW），但超过 3 轮上限。

### Prompt Clarity

- L2 子文档结构指引清晰，每个 subagent 只需读对应子文档
- Execution Group 的 subagent 配置模板格式一致，减少构造 task prompt 时的决策负担
- 缺少"跨文档文件路径一致性校验"步骤

### Automation Gaps

1. **i18n key 覆盖率检查**（P0）：给定两个 locale JSON，脚本自动对比扁平 key 集合。v1 就能发现 en 缺 16 key。
2. **跨文档路径一致性检查**（P1）：提取 plan.md File Structure 中的路径，与子文档交叉校验。
3. **§编号去重检查**（P1）：正则提取标题编号，检测重复。

### Time Sinks

- **4 轮审查**，其中 v2 空转是最大的浪费（修复未触及核心位置）
- **"恢复已有实现"的定位模糊**导致 v1/v2 花费时间在 plan vs 代码一致性上，v4 才重新聚焦

### 效率评分

| 维度 | 评分(1-10) | 说明 |
|------|-----------|------|
| Plan 质量 | 7 | 7 Task + 14 TC 覆盖完整，但跨文档一致性有瑕疵 |
| 流程效率 | 4 | 4 轮审查，其中 1 轮空转，恢复模式增加定位成本 |
| Gate 价值 | 9 | 正确拦截 2 次（v1/v2），i18n 问题是真实 gap |
| 自动化空间 | 7 | 3 处可自动化（i18n 检查、路径校验、编号去重） |
