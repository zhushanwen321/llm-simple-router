---
verdict: pass
must_fix: 0
---

# Spec Review — codex-client

## Summary

需求清晰，范围小且明确：新增 Codex CLI 客户端类型到快速配置页面，变更集中在前端类型定义 + i18n + UI 配色。

## Issues Found

无 MUST FIX 级别问题。

**Minor:**
1. FR3 的默认映射表覆盖了 7 个供应商，但实际 Codex 客户端选择某个具体套餐后只会用到该套餐的模型列表。映射表的"默认后端模型"应该是 `buildMappingEntries()` 中按客户端模型索引去匹配套餐 models 数组的位置——需要确认当前逻辑是否支持跨供应商的默认映射，还是简单的位置索引映射。
   → **评估**: 当前代码 `buildMappingEntries()` 使用 `enabledModels[clientModelNames.indexOf(cmName)]` 做位置索引匹配，所以 DEFAULT_CLIENT_MAPPINGS 中 5 个客户端模型会按顺序映射到套餐的 5 个模型。如果套餐模型少于 5 个会 fallback 到最后一个模型。这是现有逻辑，不需要修改。FR3 的映射表更多是给用户的参考文档。

## Conclusion

Spec 合理，变更范围可控。纯前端变更，不涉及后端 API 和 DB schema。可以进入 Phase 2。
