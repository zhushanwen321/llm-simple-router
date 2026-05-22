---
phase: dev
verdict: pass
---

# Dev Phase Retrospect

## 背景

Dev phase 在恢复模式下执行：代码已在之前 session 实现（commit `0c3d999` 合并了 `8bf95cf` 的核心实现）。本次 session 的任务是**验证已有代码**而非从零编码。发现了 1 条 MUST FIX（failover-loop.ts provider unavailable 处理逻辑退化），修复后通过。

---

## 1. Phase Execution Review

### Summary

- **防护预检**：ESLint + vue-tsc 已配置，pre-commit hook 缺失（通过 `.githooks/install-hooks.sh` 安装）
- **测试验证**：127 个测试文件、1503 个测试全部通过
- **代码审查 v1**：FAIL — 1 条 MUST FIX
- **MUST FIX 修复**：failover-loop.ts `return rejectAndReply` → `insertRejectedLog + excludeTargets.push + continue`
- **代码审查 v2**：PASS — MUST FIX 已修复
- **YAML frontmatter 修复**：code_review_v1.md 和 v2.md 的 `verdict`/`must_fix` 嵌套在 `review:` 下而非顶层，手动修复
- **Gate**：4/4 检查通过

### MUST FIX 详情

**failover-loop.ts L323**：provider unavailable 处理从 `continue`（排除 target 后尝试下一个）退化为 `return rejectAndReply`（立即返回错误）。

**影响**：当 mapping group 配置了多个 provider 且某个 provider 不可用时，旧逻辑会尝试下一个 provider（failover），新逻辑直接返回 503。这破坏了 failover 多 target 轮询行为，但不在 spec 范围内。

**根因推测**：原始 commit `0c3d999` 在整合代码时，将 `insertRejectedLog + excludeTargets.push + continue` 替换为 `rejectAndReply`（可能是为了统一错误处理路径），但没有意识到这会跳过 failover 循环。

**修复**：恢复为 `insertRejectedLog + excludeTargets.push + continue`，保留完整的 reject 日志写入和 pipeline snapshot。

### Problems Encountered

| 问题 | 影响 | 解决方式 |
|------|------|----------|
| MUST FIX: failov-loop provider unavailable `return` vs `continue` | 破坏多 target failover 行为 | 恢复 `continue` 逻辑，保留 reject 日志 |
| 1503 测试全绿但 MUST FIX 存在 | 测试覆盖盲区：无"多 target failover + provider unavailable"组合场景 | 修复后手动验证 49 个相关测试通过 |
| YAML frontmatter 嵌套层级错误 | gate 脚本无法找到顶层 `verdict`/`must_fix` | 手动将字段提升到 YAML 顶层 |
| diff 过大（5533 行） | 审查 subagent 处理困难 | 过滤掉测试和 lock 文件，保留 2252 行核心 diff |

### What Would You Do Differently

1. **审查 subagent 应接收更聚焦的 diff**。5533 行全量 diff 过大，过滤后仍有 2252 行。理想做法是按变更类型分组（DB schema / 业务逻辑 / Admin API / 前端），每个 subagent 只审查一组。
2. **failover-loop.ts 的控制流变更应在 commit message 中显式说明**。原始 commit 将 `continue` 改为 `return`，这种控制流变更应标注为 `BREAKING` 或至少在 commit message 中提及。
3. **审查 YAML frontmatter 格式应作为 subagent 的硬性约束**。两份 review 文件都把 `verdict`/`must_fix` 嵌套在 `review:` 对象内，说明 subagent 没有严格遵循"顶层字段"的要求。应在 task prompt 中用代码块示例强调格式。

### Key Risks for Later Phases

| 风险 | 来源 | 建议应对 |
|------|------|----------|
| failover 多 target + provider unavailable 场景缺少自动化测试 | MUST FIX 未被现有测试捕获 | Test phase 补充此场景的集成测试 |
| en i18n 实际文件仍未更新 | Plan phase 遗留 | 需在 merge 前更新 en/retryRules.json |
| YAML frontmatter 格式不稳定 | 两份 review 都出了问题 | 考虑模板化 review 输出格式 |

---

## 2. Harness Usability Review

### Flow Friction

1. **恢复模式下 dev phase 流程定位不清**。Skill 假设从零编码（TDD 循环、subagent 派遣），但实际是验证已有代码。我跳过了 Step 1-2（编码），直接从 Step 3（测试）开始。Skill 应支持 `mode: verify` 路径，明确跳过编码步骤。
2. **Code review subagent 的 diff 传递方式原始**。需要手动将 git diff 导出到临时文件，再在 task prompt 中指定文件路径。建议增加自动化：主 agent 指定 commit range，subagent 自行执行 `git diff`。
3. **YAML frontmatter 格式问题反复出现**（spec phase 和 dev phase 都有）。说明这不是偶然错误，而是 review 输出模板不够明确。

### Gate Quality

- **Gate 拦截了 failover MUST FIX 是本次流程最重要的价值证明**。1503 测试全绿但存在行为退化 bug，只有人工审查才能发现。这验证了"测试通过 ≠ 代码正确"的假设。
- Gate 也拦截了 YAML 格式问题（手动修复后才通过），但 gate 脚本本身不校验 YAML 格式——它是运行时才发现解析失败的。

### Prompt Clarity

- Dev phase skill 的步骤划分清晰：防护预检 → TDD/编码 → 测试 → 审查 → test_results → self-check → gate
- **但恢复模式（代码已存在）的处理是空白**。Skill 没有指引"代码已实现时应跳过哪些步骤"。
- 审查 subagent 的 MUST FIX 详情模板效果优秀——我拿到审查结果后零上下文就能直接动手修复。

### Automation Gaps

1. **"控制流变更扫描"步骤**。对 `return`/`continue`/`break` 的变更做结构化检查，能自动发现 failov-loop 的 MUST FIX。可作为 pre-commit hook 的一部分。
2. **Review 输出格式模板化**。定义 YAML frontmatter 的精确结构（`verdict` 和 `must_fix` 必须在顶层），避免 subagent 自由发挥导致格式错误。
3. **Diff 分组自动化**。按变更文件类型（DB/business logic/API/frontend）自动分组，为审查 subagent 生成聚焦的 diff。

### Time Sinks

- **审查 YAML frontmatter 修复**：两份文件都需手动修复嵌套层级，约 10 分钟。完全可以通过模板化避免。
- **Diff 准备**：手动 git diff → 过滤 → 导出临时文件 → 在 task prompt 中指定路径，约 5 分钟。应自动化。

### 效率评分

| 维度 | 评分(1-10) | 说明 |
|------|-----------|------|
| 代码质量 | 7 | MUST FIX 是真实 bug，但 FR1-FR9 实现完整 |
| 流程效率 | 7 | 2 轮审查（1 修复 + 1 确认），闭环紧凑 |
| Gate 价值 | 10 | 拦截了测试未覆盖的行为退化 bug |
| 自动化空间 | 6 | 控制流扫描、review 模板化、diff 分组 3 处可自动化 |
