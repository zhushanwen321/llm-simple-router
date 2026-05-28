---
verdict: pass
must_fix: 0
---

# Spec Review — thinking-level-display

## Summary

Spec covers three independent features (thinking level display, model filter fix, latency column) with clear FRs, comprehensive ACs, and well-defined scope boundaries.

## Issues Found

### SUGGESTION-1: AC-B4 与 FR-B3 存在轻微矛盾 (low)
FR-B3 说"两个模型下拉框的选项各自独立，不受 provider 过滤影响"，但 AC-B4 说"选项列表仍然随 provider 过滤结果间接变化"。这两者不矛盾但表述容易混淆——FR-B3 移除的是按 provider.models 配置过滤，AC-B4 说的是 provider 过滤条件仍然影响查询范围（选择 provider 后只查该 provider 的日志，自然只返回该 provider 下的模型）。

**建议**：实现时注意区分这两层含义。

### SUGGESTION-2: thinking level 提取逻辑与 thinking-resolver.ts 的关系 (low)
FR-A1 说"复用已有解析规则（优先级等），不在新位置重新实现解析"，但又说在 `buildActiveRequest()` 中提取。实际上需要在提取点写一个简单的提取函数（按 api_type 分支取不同字段），这不算重新实现解析逻辑，但需要在 plan 阶段明确提取函数的位置。

## Completeness Check

| 要素 | 状态 |
|------|------|
| Outcomes | PASS — 三个功能都有明确终点状态 |
| Scope boundaries | PASS — Out of Scope 列出 7 项 |
| Constraints | PASS — 5 条约束 |
| Decisions made | PASS — 方案 A、两个独立过滤器、格式化规则 |
| Verification | PASS — 14 个 AC 覆盖全部场景 |
| Business use cases | PASS — 标注为纯技术需求 |

## Conclusion

Spec 完整、无歧义、AC 可测试。must_fix = 0。
