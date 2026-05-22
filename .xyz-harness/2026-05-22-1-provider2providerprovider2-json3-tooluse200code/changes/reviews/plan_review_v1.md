---
verdict: pass
must_fix: 0
---

# Plan Review — retry-rule-upgrade

## Summary

Plan 结构清晰，5 个 Task 覆盖 spec 全部 9 个 FR 和 8 个 AC。Execution Groups 分组合理（3 个后端组 + 1 个前端组），Wave 编排依赖关系正确。无 MUST FIX 问题。

## Issues Found

### SHOULD FIX (1)

1. **BG2 中 stream_error 修复的具体实现缺少 adapter.formatError() 的调用细节**
   - plan.md Task 3 提到"使用 adapter.formatError() 格式化错误体"，但未说明 adapter 是哪个 adapter（openai adapter? anthropic adapter? 如何选择?）
   - orchestrator.ts 中已有 `adapter` 参数传入 handle()，可以直接使用。实现时需注意 api_type 对应的 adapter 选择。
   - 风险低：实现者阅读 orchestrator.ts 代码即可理解。

### NICE TO HAVE (2)

2. **Task 粒度可以更细化 BG2 的工作量**
   - BG2 包含 8 个文件变更（含 2 个测试文件），是最大的 Group。建议 Task 2（纯函数+matcher）和 Task 3（调用链适配）可以拆成两个 Wave 内的子步骤，确保 Task 2 测试通过后再开始 Task 3。
   - 当前设计已经是两个 Task，只是同一 Group 内串行。可接受。

3. **e2e-test-plan 中缺少前端交互测试场景**
   - AC6/AC7 的前端测试在 test_cases_template.json 中没有对应 UI 类型用例。但前端组件测试通常在 dev phase 手动验证，e2e-test-plan 聚焦后端集成是合理的。

## Spec-Plan Consistency

| Spec FR | Plan Coverage | 状态 |
|---------|--------------|------|
| FR1 Provider 隔离 | BG2 Task 2 (matcher) + BG1 Task 1 (schema) | 覆盖 |
| FR2 JSON 字段匹配 | BG2 Task 2 (body-matcher.ts) | 覆盖 |
| FR3 RetryRuleMatcher 升级 | BG2 Task 2 | 覆盖 |
| FR4 stream_error 修复 | BG2 Task 3 | 覆盖 |
| FR5 upstream_error_logs | BG1 Task 1 + BG2 Task 3 | 覆盖 |
| FR6 前端适配 | FG1 Task 5 | 覆盖 |
| FR7 DB Schema | BG1 Task 1 | 覆盖 |
| FR8 Admin API | BG3 Task 4 | 覆盖 |
| FR9 StateRegistry 刷新 | BG2 Task 2 (load() 重写) | 覆盖 |

## Execution Groups 合理性

| 检查项 | 结果 |
|--------|------|
| 前后端分组正确 | PASS: BG1-3 后端, FG1 前端 |
| 文件数 ≤ 10 | PASS: BG1=4, BG2=8, BG3=1, FG1=3 |
| Group 间无文件冲突 | PASS: 每个 Group 文件互不重叠 |
| Wave 依赖正确 | PASS: BG1 → {BG2, BG3} → FG1 |
| Subagent 配置完整 | PASS: 每个 Group 含 agent/model/上下文/文件列表 |

## Conclusion

Plan 质量合格，可进入 Phase 3 实现。SHOULD FIX #1 在实现时自然解决。
