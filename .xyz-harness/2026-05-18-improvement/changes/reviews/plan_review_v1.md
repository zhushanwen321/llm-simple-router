---
verdict: pass
must_fix: 0
---

# Plan Review — 前后端代码审查改进

## Summary

Plan 分 4 组（A 后端修复 / B 前端提取 / C 前端 bug / D 决策记录），执行顺序合理，依赖关系清晰。0 MUST FIX。

## Issues Found

### INFO 级（不阻塞）

1. **R6 hook 执行顺序风险**: Plan 中将 `proxyPipeline.emit("pre_route", ctx)` 的 `.catch()` 改为 try-catch 并处理 `PipelineAbort`。但 `pre_route` 阶段还有 `client-detection` hook（priority 更高，先执行）。如果 `client-detection` 抛异常，当前 catch 也会将其作为 PipelineAbort 处理——需要确认 `client-detection` 不会抛 PipelineAbort（它只设置 metadata，不应抛异常）。

   **评估**: `client-detection` 只做 `metadata.set()`，不抛异常。风险可接受。

2. **R4c formatContextWindow 行为变更**: CascadingModelSelect.vue 原来小于 1M 的值全部显示为 K（如 500 → "0.5K"），合并后改为直接显示原始数字（500 → "500"）。这是一个可见的 UI 行为变化，但更合理（500 tokens 不应该显示为 0.5K）。

   **评估**: 变化合理，不是 bug。如果用户之前习惯看到 "0.5K"，现在看到 "500"，体验更好。

3. **C2 认证重构的边界情况**: 如果 router guard 中 `api.getStats()` 请求失败（网络错误而非 401），guard 会将用户踢到 `/login`。这是当前行为，不是新问题。

   **评估**: 保持现有行为即可。

## Verdict Justification

- 4 组任务分工清晰，Group A 和 B 可并行
- 每个任务的文件列表、操作类型、详细步骤完整
- R6 的关键风险点（hook 与内联重复执行）已有明确的解决方案（删除内联 + 修改 catch 逻辑）
- 验证步骤覆盖 build/lint/test 三道门禁
- Subagent 分配合理（3 个 agent，2 批次）
