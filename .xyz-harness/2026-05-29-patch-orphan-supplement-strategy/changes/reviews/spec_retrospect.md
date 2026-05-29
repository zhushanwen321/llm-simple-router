---
phase: spec
verdict: pass
---

# Spec Phase Retrospect — patch-orphan-supplement-strategy

## 1. Phase Execution Review

### Summary

将 `patchOrphanToolResultsOA` 从"删除"策略重构为"补配对"策略的 spec。本 phase 的核心价值来自前期在用户对话中完成的深度调研（不属于 spec 正式步骤），包括：

1. **源码级调研**：阅读 Claude Code 的 `ensureToolResultPairing`（~300 行）和 LiteLLM 的 `_ensure_tool_results_have_corresponding_tool_calls`，确认业界策略
2. **实际数据验证**：查询路由器 SQLite DB，确认本地孤儿消息 0 条、deepseek 400 仅 2 条且来自 claude-code 客户端
3. **ID 可行性分析**：确认 `tool_calls[].id` 在实际数据中 100% 非空，补策略复用已有 ID 不需生成新 ID
4. **各工具对比**：Claude Code（补）、LiteLLM（缓存+补）、pi-mono/LangChain（不处理），确立路由器应采用的方向

Spec 写作本身一次性通过，review must_fix=0。

### Problems Encountered

- **Compact 失败导致 Phase 推进卡住**：Gate PASS 后连续 3 次 compact 失败（"Compaction cancelled"），phase advancement 被 rollback。这导致同一 phase 被重复执行 3 次，浪费约 10 轮对话。根因是上下文过大（前期调研积累了大量源码阅读和 DB 查询结果），compact 无法在 token 预算内完成。

### What Would You Do Differently

- **前期调研产出应更早 compact**：用户对话中的深度分析（Claude Code 源码、LiteLLM 源码、DB 查询）消耗了大量上下文。应该在调研完成后主动建议 compact，或者在进入 workflow 之前用新 session 开始，避免调研上下文拖累 workflow 的 compact 能力。

### Key Risks for Later Phases

1. **上下文仍然很大**：如果后续 phase 的 compact 继续失败，可能需要用新 session + handoff 文档的方式继续
2. **混合场景**：补配对 + Step 4 重排同时发生时的插入位置冲突，plan 阶段需明确执行顺序
3. **Anthropic 版本未改**：`patchOrphanToolResults`（Anthropic 版本）仍用删除策略，长期应对齐

## 2. Harness Usuality Review

### Flow Friction

- **Compact 失败是主要摩擦**。3 次 compact 失败导致 phase 反复 rollback，用户体验差。建议：当 compact 连续失败时，workflow 应允许跳过 compact 直接推进，或者自动触发 handoff 到新 session。

### Gate Quality

- **正常**。Gate 检查 `spec_review_v*.md` 存在性，逻辑正确。无 false positive。

### Prompt Clarity

- **正常**。Brainstorming skill 流程清晰。本 phase 因前序对话已覆盖调研，实际只用了 Write spec + Review + Retrospect 三个步骤。

### Automation Gaps

- **Compact 重试策略缺失**：workflow 在 compact 失败后直接 rollback，没有降级策略（如跳过 compact、或自动 handoff 到新 session）。

### Time Sinks

- **Compact 失败重试**：3 次 × 约 3 轮/次 = ~9 轮浪费在重复提交上。这不是 spec 内容的问题，而是 workflow infra 的问题。
