---
phase: spec
verdict: pass
---

# Spec Phase Retrospect — patch-orphan-supplement-strategy

## 1. Phase Execution Review

### Summary

将 `patchOrphanToolResultsOA` 从"删除"策略重构为"补配对"策略的 spec 写作。本 phase 的高价值工作集中在前期的调研分析（不属于 spec 写作的正式步骤，而是用户发起的代码审查对话中自然产出），包括：

1. **源码级调研**：阅读 Claude Code 的 `ensureToolResultPairing`（`messages.ts:5133`，~300 行）和 LiteLLM 的 `_ensure_tool_results_have_corresponding_tool_calls`，理解业界主流策略
2. **实际数据验证**：查询路由器本地 SQLite DB（`upstream_error_logs`、`request_logs`），确认孤儿消息在本地数据中为 0、deepseek 400 错误仅 2 条且来自 `claude-code` 客户端
3. **ID 可行性分析**：确认 OpenAI 格式 `tool_calls[].id` 在实际数据中 100% 非空，补策略复用已有 ID 不需要生成新 ID
4. **KV cache 影响**：确认固定 content 字符串对 cache 友好

核心决策：反向（有 tool_calls 无 tool 消息）→ 补合成 tool 消息；正向（有 tool 消息无 tool_calls）→ 删（与 Claude Code 一致）。

### Problems Encountered

- **无**。前期调研在用户对话中已完成，spec 写作阶段直接基于已有结论产出，无返工。

### What Would You Do Differently

- **不需要改动**。本 phase 的效率得益于用户在 spec 前做了完整的代码审查和调研讨论。如果从零开始（没有前序对话），需要额外 2-3 轮 on-demand scan 来建立同等深度的上下文。

### Key Risks for Later Phases

1. **混合场景**：补配对 + Step 4 重排同时发生时，插入位置可能冲突。plan 阶段需要明确执行顺序
2. **Anthropic 格式未改**：`patchOrphanToolResults`（Anthropic 版本）仍使用删除策略，长期应对齐。但本次约束明确只改 OpenAI 版本
3. **Tool Call Cache 的复杂度**：FR-3 标记为可选增强，plan 阶段需要评估实现成本并决定是否纳入

## 2. Harness Usability Review

### Flow Friction

- **极低**。本 phase 跳过了常规的 Step 1（Quick Overview）和 Step 2（Clarifying Questions），因为用户在 spec 前的对话中已经完成了完整的调研和需求讨论。Spec 直接基于已有结论写就，reviewer 一次通过。

### Gate Quality

- **正常**。Gate 要求 `spec_review_v*.md` 存在，dispatch subagent 完成后通过。无 false positive。

### Prompt Clarity

- **正常**。brainstorming skill 的流程清晰，但本 phase 实际只用了 Step 5（Write spec）和 Spec Review，其余步骤因前序对话已覆盖而跳过。

### Automation Gaps

- **无显著 gap**。

### Time Sinks

- **无**。Spec 写作本身 < 5 分钟，review < 3 分钟。前期调研（约 30 分钟对话）是必要的投入，不属于 harness 流程的时间消耗。
