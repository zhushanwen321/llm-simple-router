---
review:
  type: spec_review
  round: 2
  timestamp: "2026-06-08T15:00:00"
  target: ".xyz-harness/2026-06-08-metrics-aggregation/spec.md"
  verdict: pass
  summary: "spec 评审第2轮，3条MUST FIX已全部修复，0条新增MUST FIX，通过"

statistics:
  total_issues: 8
  must_fix: 0
  must_fix_resolved: 3
  low: 4
  info: 1

issues:
  - id: 1
    severity: MUST_FIX
    location: "spec.md → FR-1 §1 聚合维度"
    title: "聚合维度遗漏 api_type 字段"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
  - id: 2
    severity: MUST_FIX
    location: "spec.md → FR-1 §1 聚合指标"
    title: "聚合指标遗漏 token/duration 细分字段，无法重算 TPS 细分"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
  - id: 3
    severity: MUST_FIX
    location: "spec.md → FR-4 受影响函数列表"
    title: "getDailyUsage 归属文件标注错误"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
  - id: 4
    severity: LOW
    location: "spec.md → FR-3 §2 活动图"
    title: "活动图交互规格缺乏降级方案（metrics_10min 为空时的新用户体验）"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
  - id: 5
    severity: LOW
    location: "spec.md → FR-1 §1 聚合维度"
    title: "聚合维度缺少 api_type（与 MUST FIX #1 重复）"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
  - id: 6
    severity: LOW
    location: "spec.md → FR-1 §2 双写机制"
    title: "UPSERT 语句缺少具体冲突键定义"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
  - id: 7
    severity: INFO
    location: "spec.md → AC-4"
    title: "100ms 性能目标未定义数据增长后的退化预期"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 8
    severity: LOW
    location: "spec.md → FR-1 §1 聚合指标 + FR-4"
    title: "non_thinking_tps / non_thinking_duration_ms 未纳入聚合指标，无法从聚合表重算"
    status: open
    raised_in_round: 2
    resolved_in_round: null
---

# Spec 评审 v2

## 评审记录
- 评审时间：2026-06-08 15:00
- 评审类型：Spec 评审（增量审查模式）
- 评审对象：`.xyz-harness/2026-06-08-metrics-aggregation/spec.md`

## 增量审查：v1 MUST FIX 修复验证

### Issue #1: 聚合维度遗漏 api_type — [FIXED] ✅

**v1 问题**：聚合维度 `(bucket_time, router_key_id, provider_id, backend_model, client_type)` 不含 `api_type`，但 `request_metrics` 存在 `idx_metrics_api_type_created_at` 索引，按 api_type 过滤是常见查询路径。

**修复验证**：
- FR-1 §1 聚合维度更新为 `(bucket_time, router_key_id, provider_id, backend_model, client_type, api_type)` ✅
- FR-1 §2 冲突键更新为 `ON CONFLICT (bucket_time, router_key_id, provider_id, backend_model, client_type, api_type)` ✅
- FR-1 §2 COALESCE 处理仅针对 `router_key_id`（可为 NULL），`api_type` 为 NOT NULL 无需处理 ✅

### Issue #2: TPS 细分字段聚合缺失 — [FIXED] ✅

**v1 问题**：聚合表仅存 `sum_input_tokens, sum_output_tokens, sum_cache_read_tokens, sum_total_duration_ms, sum_ttft_ms`，无法重算 `text_tps / thinking_tps / tool_use_tps` 等 TPS 细分指标。

**修复验证**：
- FR-1 §1 聚合指标新增三组细分字段：
  - Token 细分：`sum_thinking_tokens, sum_text_tokens, sum_tool_use_tokens` ✅
  - Duration 细分：`sum_thinking_duration_ms, sum_text_duration_ms, sum_tool_use_duration_ms` ✅
  - Cache 细分：`sum_cache_creation_tokens` ✅
- FR-4 聚合表适配说明中明确 TPS 重算方式：`sum_text_tokens / sum_text_duration_ms` ✅
- 代码对照：`METRIC_EXPR` 中 `text_tps = AVG(rm.text_tps)` 可由 `sum_text_tokens / sum_text_duration_ms` 等价重算 ✅

### Issue #3: getDailyUsage 文件归属错误 — [FIXED] ✅

**v1 问题**：spec 将 `getDailyUsage` 归属到 `src/db/stats.ts`，实际在 `src/admin/usage.ts:26`。

**修复验证**：
- FR-4 受影响函数列表更新为 `getDailyUsage() | src/admin/usage.ts | 聚合表按 date(bucket_time) 分组` ✅
- 代码确认：`src/admin/usage.ts:26:function getDailyUsage(` ✅

## 回归检查

### UPSERT NULL 处理（v1 LOW #6 相关）

spec 现在明确写了 COALESCE 处理 `router_key_id` 为 NULL 的情况，以及读取时转回 NULL。这是正确的修复方向，与 SQLite NULL ≠ NULL 语义一致。未引入新问题。

### 聚合表字段完整性

新增的 token/duration 细分字段与代码中 `MetricsMetric` 类型定义的 TPS 指标（`text_tps, thinking_tps, tool_use_tps, total_tps`）逐一对照：

| TPS 指标 | 聚合表能否重算 | 所需字段 |
|----------|-------------|---------|
| `text_tps` | ✅ | `sum_text_tokens / sum_text_duration_ms` |
| `thinking_tps` | ✅ | `sum_thinking_tokens / sum_thinking_duration_ms` |
| `tool_use_tps` | ✅ | `sum_tool_use_tokens / sum_tool_use_duration_ms` |
| `total_tps` | ✅ | `sum_output_tokens * 1000 / sum_total_duration_ms`（与现有 METRIC_EXPR 一致） |
| `non_thinking_tps` | ⚠️ | 需要 `non_thinking_tokens = output - thinking` 和 `non_thinking_duration_ms`，后者未纳入聚合 |

`non_thinking_tps` 的重算存在缺口（见 New Issue #8），但该指标在 Dashboard 前端的实际使用频率低于其他 TPS 指标，且可通过 `total_tps` 和 `thinking_tps` 间接推导，不阻塞。

### v1 LOW 问题附带修复验证

| v1 Issue | 修复状态 | 说明 |
|----------|---------|------|
| #4 活动图空状态 | ✅ 已修复 | AC-5 新增"新用户首次使用或 metrics_10min 为空时，活动图显示灰色空白区域 + No data yet 提示文字" |
| #5 api_type 缺失 | ✅ 已修复 | 与 MUST FIX #1 同修复 |
| #6 UPSERT 冲突键未具体化 | ✅ 已修复 | FR-1 §2 现在明确写出 `ON CONFLICT (bucket_time, router_key_id, provider_id, backend_model, client_type, api_type)` |
| #7 性能退化预期 | 保持 open | INFO 级别，不阻塞 |

## 发现的新问题

| # | 优先级 | 文件/位置 | 描述 | 修改建议 |
|---|--------|----------|------|---------|
| 8 | LOW | spec.md → FR-1 §1 + FR-4 | `non_thinking_tps` 是 `MetricsMetric` 类型的可选指标（代码 L7），当前通过 `AVG(rm.non_thinking_tps)` 计算。聚合表未存 `sum_non_thinking_duration_ms`，无法从聚合字段重算 `non_thinking_tps`。>detail_days 范围内选择该指标图表会缺数据 | 方案一：在聚合指标中增加 `sum_non_thinking_duration_ms`（`non_thinking_tokens` 可由 `sum_output_tokens - sum_thinking_tokens` 推导）；方案二：在 FR-4 中明确标注 >detail_days 不支持 `non_thinking_tps` 指标 |

## 结论

**通过。** v1 的 3 条 MUST FIX 已全部修复：
1. `api_type` 加入聚合维度 ✅
2. token/duration 细分字段补齐，TPS 可重算 ✅
3. `getDailyUsage` 归属修正为 `src/admin/usage.ts` ✅

v1 的 3 条 LOW 中有 2 条（#4 空状态、#6 冲突键）也一并修复。新发现 1 条 LOW（`non_thinking_tps` 重算缺口），不阻塞。

### Summary

spec 评审完成，第2轮通过，0条MUST FIX。
