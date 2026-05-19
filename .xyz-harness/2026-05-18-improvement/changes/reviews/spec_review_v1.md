---
verdict: pass
must_fix: 0
---

# Spec Review — 前后端代码审查改进

## Summary

前后端合并 spec，分两层：Tier 1 共 6 项低风险修复（4 前端 + 2 后端），Tier 1 个架构决策（Pipeline 死代码）。需求边界清晰，AC 可测试。

## Issues Found

无 MUST FIX 问题。

### 建议（不阻塞）

1. **R6 内联版本删除策略**: spec 说"建议方案 1 删除内联调用"，但 `applyEnhancementPreprocess` 在 `create-proxy-handler.ts:136-190` 共 55 行，除了依赖注入问题外，可能还处理了一些 hook 没有覆盖的边界情况。plan 阶段需要仔细对比 hook 和内联版本的每一行逻辑，确认 hook 覆盖了所有分支。
   - 严重性: INFO
   - 风险: 如果 hook 遗漏了内联版本的某个分支，删除内联后会引入 bug

2. **D1 决策时机**: 如果选择"选项 C 标记+文档"，建议在 plan 中明确标记的格式和位置（统一注释模板），避免只加零散注释。
   - 严重性: INFO

3. **R4d getDefaultPatches 合并**: `useQuickSetup.ts` 的 `computeDefaultPatches` 额外处理 `isNonOpenaiEndpoint` 和 `openai-responses`。提取后前两处传 `isNonOpenaiEndpoint = false`，但需要确认 `apiType` 参数的类型收窄不会影响 behavior——前两处传 `string`，第三处之前是 union type `'openai' | 'openai-responses' | 'anthropic'`。
   - 严重性: INFO

## Verdict Justification

- Tier 1 六项需求均有明确现状/期望/修复方案/受影响文件
- Tier 2 仅做决策记录，不实施代码改动，风险可控
- 10 条 AC 全部可测试，覆盖功能正确性和质量门禁
- 影响范围和约束边界清晰
- 不引入新依赖、不改变用户行为（除 bug 修复外）
