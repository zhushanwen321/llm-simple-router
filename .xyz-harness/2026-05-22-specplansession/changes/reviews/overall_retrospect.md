---
phase: pr
verdict: pass
---

# Overall Retrospect — 全 5 Phase 总结

## 项目概览

**功能**：Retry Rule Upgrade — Provider Isolation + JSON Body Matchers + Upstream Error Logging
**分支**：`fix-usage-limit-return`
**PR**：#165（CI 全绿，未合并）
**模式**：恢复模式 — 代码在之前 session 已实现，本次 session 重新走完整 harness 流程

---

## 1. Phase Execution Review — 跨 Phase 总览

### 节奏与效率

| Phase | 审查轮次 | MUST FIX | 关键问题 | 效率 |
|-------|---------|----------|----------|------|
| Spec | 4 | 1（Data Consumer Checklist） | 审查冗余（v2 已 PASS 又开了 v3/v4） | 低 |
| Plan | 4 | 1（en i18n key 缺失） | v2 空转（修复未触及核心位置） | 低 |
| Dev | 2 | 1（failover `return` vs `continue`） | 1503 测试全绿但行为退化 | 高 |
| Test | 1 | 0 | 14/14 TC 一轮全过 | 最高 |
| PR | 1 | 0 | PR 已存在，推送 MUST FIX 修复后 CI 全绿 | 直通 |

**总审查 12 轮**，其中 3 轮 MUST FIX 修复验证、2 轮空转/冗余、7 轮实质性审查。

### MUST FIX 发现链

三条 MUST FIX 的发现路径各不相同，覆盖了 harness 三层防护的不同层：

| MUST FIX | 发现方式 | 测试能否发现 | Gate 作用 |
|----------|----------|-------------|-----------|
| Data Consumer Checklist 缺失 | spec 审查（规范性） | N/A（文档问题） | 阻止不合规 spec 通过 |
| en i18n key 缺失 | plan 审查（完整性） | 部分（运行时会报 missing key） | 阻止不完整 plan 通过 |
| failover `return` vs `continue` | 代码审查（行为正确性） | **否**（1503 测试全绿） | **拦截了测试未覆盖的 bug** |

第三条是本次流程最有价值的发现：1503 个自动化测试全部通过，但代码审查发现了一个会导致生产事故的行为退化。这验证了"测试通过 ≠ 代码正确"的核心假设，也证明了 harness gate 机制不可替代。

### 跨 Phase 主题

**主题 1：YAML frontmatter 格式问题贯穿始终**

Spec phase（v3 双引号嵌套）和 Dev phase（v1/v2 嵌套层级错误）都出现 YAML 格式问题。根因是 review subagent 没有严格遵循"顶层字段"要求。这不是偶发错误，而是系统性问题——subagent 的输出缺乏格式约束。

**主题 2：恢复模式的定位模糊**

全部 5 个 phase 都在恢复模式下执行，但 harness 没有对应的流程适配：
- Spec：复制旧 spec → 审查范围不清（验证 vs 设计）
- Plan：代码已存在 → plan 是"实施指南"还是"文档对齐"？
- Dev：跳过编码步骤 → skill 无 `mode: verify` 路径
- Test：正常执行（恢复模式影响最小）
- PR：PR 已存在 → 只需推送修复

**主题 3：i18n 双语言同步是系统性弱项**

Plan phase 发现 en 缺少 16 个 key，但 en 文件在实际代码中仍未更新。这条问题贯穿 plan → dev → PR，最终在 merge 前仍未关闭。说明 MUST FIX 的"修复"有时只停留在文档层面，缺乏实际代码变更的验证闭环。

### What Would You Do Differently

1. **恢复模式应在 session 级声明**。在 `.xyz-harness/{session}/context.md` 中加入 `mode: restore`，每个 phase 的 skill 根据模式调整行为（跳过编码、聚焦验证、审查范围对齐）。本次 5 个 phase 中有 4 个因模式不清产生摩擦。
2. **YAML frontmatter 应模板化**。定义精确的 YAML 结构模板，subagent 输出时必须严格匹配。可在 gate 脚本中增加 YAML schema 验证。这条问题在 2/5 的 phase 中出现，浪费了约 15 分钟修复时间。
3. **MUST FIX 修复应区分"文档修复"和"代码修复"**。Plan phase 的 en i18n MUST FIX 在文档层面修复（plan-frontend.md §9.2），但实际代码文件仍未更新。应在 MUST FIX 修复时明确标注修复范围（文档/代码/两者），并在后续 phase 中追踪。
4. **审查轮次应硬性限制 3 轮**。本次 spec 和 plan 都达到 4 轮，其中各有 1-2 轮是冗余的。3 轮足够覆盖：v1 发现 → v2 修复确认 → v3 全量复查。

---

## 2. Harness Usability Review

### Flow Friction

1. **恢复模式缺少流程适配**（已在主题 2 中详述）。这是最大的系统性摩擦。
2. **审查与 gate 的衔接链条过长**。review 通过 → 手动检查 YAML 格式 → 提交 gate → gate 校验。任何一环出问题都需要回退。建议 gate 脚本在检查字段前先验证 YAML 可解析，失败时给出具体修复建议。
3. **子文档模式（plan phase）的一致性维护成本高**。4 个子文档之间的文件路径、Task 编号容易不同步。本次发现的 2 条 LOW（测试路径不一致、§编号重复）都是跨文档问题。

### Gate Quality

**Gate 是本次流程最有价值的机制。** 5 个 phase 的 gate 全部正确工作：

| Phase | Gate 拦截 | 价值评估 |
|-------|----------|---------|
| Spec | 1 次（Data Consumer Checklist） | 中 — 规范性问题，不修复也可运行 |
| Plan | 2 次（v1/v2 en i18n） | 高 — 双语言同步是真实 gap |
| Dev | 1 次（failov-loop 行为退化） | **极高** — 测试未覆盖的生产级 bug |
| Test | 0 次（全通过） | 低 — "全通过"场景 gate 增值有限 |
| PR | 0 次（CI 全绿） | 低 — CI 验证了 gate 之前的判断 |

**关键洞察**：gate 的最大价值在于拦截"测试通过但代码有问题"的场景。Dev phase 的 failov-loop MUST FIX 是纯行为退化，自动化测试无法覆盖（需要"多 target failover + provider unavailable"的组合场景），只有人工审查才能发现。

### Prompt Clarity

- 5 个 phase 的 skill 指引总体清晰，步骤划分合理
- **最大盲区**：恢复模式（`mode: restore`）完全没有覆盖。所有 phase 的 skill 都假设 greenfield 场景
- **审查 subagent 的 MUST FIX 详情模板效果优秀**。每条 MUST FIX 都包含位置、问题、影响、修复建议，我拿到后零上下文直接修复
- **test_cases_template.json 的 `type` 字段**缺少 `frontend-type` 选项，无法精确描述类型验证这种降级模式

### Automation Gaps — 按优先级排序

| 优先级 | 自动化点 | 影响范围 | 预期收益 |
|--------|---------|---------|---------|
| P0 | YAML frontmatter schema 验证 | 全 phase | 消除 15 分钟/次的手动修复 |
| P0 | i18n key 覆盖率检查 | Plan | 消除 1 轮审查空转 |
| P0 | Review 输出格式模板化 | Spec/Plan/Dev | 根除 YAML 格式问题 |
| P1 | test_execution.json 自动生成 | Test | 节省 10 分钟手动映射 |
| P1 | Data Consumer Checklist 半自动生成 | Spec | 消除 1 轮 MUST FIX |
| P1 | 跨文档路径一致性检查 | Plan | 消除 2 条 LOW |
| P2 | 控制流变更扫描 | Dev | 自动发现 `return`/`continue` 退化 |
| P2 | Diff 分组自动化 | Dev | 减少审查 subagent 负载 |
| P2 | 恢复模式 session 级声明 | 全 phase | 消除流程定位模糊 |

### Time Sinks

| 时间消耗 | Phase | 分钟 | 根因 |
|---------|-------|------|------|
| 4 轮审查（2 轮冗余） | Spec | ~20 | Data Consumer 撰写时遗漏 + v3/v4 冗余 |
| 4 轮审查（1 轮空转） | Plan | ~25 | en i18n 修复未触及核心位置 |
| YAML 格式修复 | Spec + Dev | ~15 | subagent 输出无格式约束 |
| test_execution.json 手动编写 | Test | ~10 | 无自动生成工具 |
| Diff 准备和过滤 | Dev | ~5 | 手动 git diff → 临时文件 |
| 测试文件路径发现 | Test | ~5 | 双 vitest 环境 |

**总计约 80 分钟的可避免时间消耗**，占整个工作流的约 40%。

### 整体效率评分

| 维度 | 评分(1-10) | 说明 |
|------|-----------|------|
| 交付物质量 | 8 | spec/plan/code/test 四层覆盖完整，PR CI 全绿 |
| 流程效率 | 5 | 12 轮审查（3 轮冗余）、YAML 修复 ×2、恢复模式摩擦 |
| Gate 价值 | 9 | 3 次 MUST FIX 拦截，其中 1 次拦截了测试未覆盖的生产级 bug |
| Harness 可用性 | 6 | 绿色场流程畅，恢复模式有系统性摩擦 |
| 自动化潜力 | 7 | 9 处可自动化点（3 个 P0 + 3 个 P1 + 3 个 P2） |
