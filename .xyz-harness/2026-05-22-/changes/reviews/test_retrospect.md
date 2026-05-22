---
phase: test
verdict: pass
---

# Test Phase Retrospect

## 1. Phase Execution Review

### Summary

执行了 7 个测试用例（TC-1-01 到 TC-2-05），全部 round 1 通过：

- **TC-1-01 / TC-1-02（API 测试）**：通过新增自动化测试验证。TC-1-01 在已有的 "returns success with rule from LLM" 测试中补充了 `expect(body.data.rule.provider_id).toBe(providerId)` 断言。TC-1-02 新增独立测试，构造 `provider_id: null` 的 request log，验证返回 `provider_id: null`。新增测试后 `ai-retry-rule.test.ts` 从 13 个增长到 15 个测试。
- **TC-2-01 到 TC-2-05（UI/集成测试）**：通过代码审查验证。逐行确认 AiRulePreviewDialog.vue 的 template（Select 组件结构）、script（form 默认值、watch 覆盖、loadProviders 降级、handleSave 映射）和 UnifiedRequestDialog.vue 的 provider_id 透传链路。

全量回归：128 files / 1552 tests pass，vue-tsc 0 errors。

### Problems Encountered

无。所有测试一次通过，没有 round 2。

### What Would You Do Differently

**对 UI 测试用例的 verification_method 标注不够正式。** test_cases_template.json 中的 TC-2-01 到 TC-2-05 标记为 `type: "ui"` / `type: "integration"`，但实际执行方式是代码审查。应该在 template 中显式标注 `verification_method: "code_review"` 而非隐式决定。这会让 test_execution.json 的读者更容易理解为什么 execute_steps 是代码审查步骤而非自动化步骤。

### Key Risks

- **UI 测试覆盖度依赖代码审查质量**：5 个 UI 测试用例通过代码审查验证，没有 Playwright 自动化覆盖。如果未来 AiRulePreviewDialog 的逻辑变更（比如默认值从 `"__all__"` 改为其他值），这些测试不会自动失败。不过当前改动范围小且 code review 已逐行验证，风险可控。

## 2. Harness Usability Review

### Flow Friction

无。Phase 4 skill 的步骤清晰：加载 template → 执行测试 → 记录结果 → gate check。test_execution.json 的字段要求（布尔值、非空 execute_steps）在 skill 中有明确示例，按格式写即可。

### Gate Quality

Gate 一次通过。检查项包括：JSON 格式、caseId 与 template 的 cross-reference、每个 caseId 最终 round 的 passed 值为 true、execute_steps 非空数组。所有检查都通过，没有误报。

### Prompt Clarity

Skill 中明确说明 `type: "ui"` 的测试不强制 Playwright，代码审查是合理的替代方案。这与项目的实际情况一致（无 Playwright 配置）。

### Automation Gaps

- **UI 测试无自动化**：本项目前端没有 Playwright/E2E 测试框架，UI 测试完全依赖代码审查。对于本次小改动可以接受，但如果未来 UI 变更频繁，建议引入 Playwright。
- **test_execution.json 手动编写**：API 测试的执行步骤需要手动记录到 JSON 中，不能从 vitest 输出自动生成。对于 7 个 TC 可以接受，但如果 TC 数量增长到 30+，手动维护会成为负担。

### Time Sinks

无。总耗时约 10 分钟（新增 2 个测试 ~5 分钟 + 编写 test_execution.json ~3 分钟 + gate check ~2 分钟）。在 5 个 phase 中效率第二高。
