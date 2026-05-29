---
review:
  type: spec_review
  round: 2
  timestamp: "2026-05-28T11:15:00"
  target: ".xyz-harness/2026-05-28-fix-modality-overflow-failover-filtering/spec.md"
  verdict: pass
  summary: "Spec 第 2 轮评审通过，第 1 轮 MUST FIX 和 LOW 均已修复，未引入新问题"

statistics:
  total_issues: 2
  must_fix: 0
  low: 0
  verified_fixed: 2

issues:
  - id: 1
    severity: MUST_FIX
    location: "spec.md FR-2 + FR-3"
    title: "FR-2 Anthropic 错误格式与 FR-3 createErrorFormatter 机制矛盾"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
    resolution: "FR-2 已修正：Anthropic 格式不再单独区分，统一为 `{ error: { message, type, code } }` 结构，通过 `createErrorFormatter` 生成。AC-4（OpenAI）和 AC-5（Anthropic）的 body 格式已保持一致。同时 FR-2 中 Anthropic errorMeta 值明确指定为 `{ type: \"invalid_request_error\", code: \"unsupported_modality\" }`。"

  - id: 2
    severity: LOW
    location: "spec.md Complexity Assessment"
    title: "受影响文件数估算偏低（3 个 vs 实际 5-6 个）"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
    resolution: "Complexity Assessment 已从 3 个文件更正为 6 个文件，并列出完整路径列表：(1) modality-redirect.ts, (2) failover-loop.ts, (3) proxy-core.ts, (4) format/types.ts, (5) shared-error-meta.ts, (6) anthropic.ts。"
---

# Spec 评审 v2

## 评审记录

- 评审时间：2026-05-28 11:15
- 评审类型：计划评审（spec 完整性，第 2 轮）
- 评审对象：`.xyz-harness/2026-05-28-fix-modality-overflow-failover-filtering/spec.md`
- 评审范围：验证第 1 轮 MUST FIX 修复 + 检查引入的新问题

---

## 1. MUST FIX 修复验证

### MUST FIX #1（FR-2 格式矛盾）— ✅ 已修复

**变更内容**：FR-2 从先前要求 Anthropic 独立格式 `{ type: "error", error: { type, message } }`，修正为与 `createErrorFormatter` 机制一致的统一格式：

- **Body**: `{ "error": { "message": "...", "type": "invalid_request_error", "code": "unsupported_modality" } }`
- **Anthropic errorMeta**: `{ type: "invalid_request_error", code: "unsupported_modality" }`

**验证**：
- AC-4（OpenAI）和 AC-5（Anthropic）的 body 格式完全一致 ✅
- AC-5 注明通过 `createErrorFormatter` + `ANTHROPIC_ERROR_META` 生成，明确了实现路径 ✅
- API 错误规范约束已同步更新：`由 FormatAdapter.errorMeta 配置`（不再要求两套格式） ✅

### LOW #2（文件数估算）— ✅ 已修复

**变更内容**：Complexity Assessment 从模糊的"3 个文件"更正为精确的"6 个文件"，逐一路径列出。

**验证**：6 个文件覆盖了：
- 核心逻辑（modality-redirect.ts）
- 空列表处理（failover-loop.ts）
- ErrorKind 两处声明（proxy-core.ts + format/types.ts）
- errorMeta 两处配置（shared-error-meta.ts + anthropic.ts）
- 与实际需要改动的文件一致 ✅

## 2. 引入新问题检查

无未修复的 MUST FIX 或 LOW 问题。

修改后的 spec 整体一致性良好：
- FR-1 行为表（6 种场景）与 AC-1~AC-3、AC-6~AC-7 对应关系清晰 ✅
- FR-2 空列表报错格式与 FR-3 createErrorFormatter 机制一致 ✅
- AC-8（Overflow 叠加）验证了过滤后列表仍经过 overflow 处理 ✅
- AC-9（promptTooLong 回归）确保不影响现有行为 ✅
- FR-4 PipelineSnapshot 6 个 reason 值与行为表一一对应 ✅

## 结论

**第 2 轮评审通过**。第 1 轮发现的所有问题（1 条 MUST FIX + 1 条 LOW）均已修复，修改未引入新问题。Spec 可进入 plan 阶段。
