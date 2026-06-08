---
review:
  type: spec_review
  round: 1
  timestamp: "2026-06-08T14:15:00"
  target: ".xyz-harness/2026-06-08-metrics-aggregation/spec.md"
  verdict: fail
  summary: "spec 评审第1轮，3条MUST FIX，需修改后重审"

statistics:
  total_issues: 7
  must_fix: 3
  low: 3
  info: 1

issues:
  - id: 1
    severity: MUST_FIX
    location: "spec.md → FR-1 §1 聚合维度"
    title: "聚合维度遗漏 input_tokens_estimated 字段"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 2
    severity: MUST_FIX
    location: "spec.md → FR-1 §1 聚合指标"
    title: "聚合指标遗漏 thinking_tokens/text_tokens/tool_use_tokens 等 TPS 细分字段"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 3
    severity: MUST_FIX
    location: "spec.md → FR-4 受影响函数列表"
    title: "getDailyUsage 位于 admin/usage.ts 而非 stats.ts，函数归属文件标注错误"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 4
    severity: LOW
    location: "spec.md → FR-3 §2 活动图"
    title: "活动图交互规格缺乏降级方案（metrics_10min 为空时的新用户体验）"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 5
    severity: LOW
    location: "spec.md → FR-1 §1 聚合维度"
    title: "聚合维度缺少 api_type，但 FR-4 时序查询可能按 api_type 分组"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 6
    severity: LOW
    location: "spec.md → FR-1 §2 双写机制"
    title: "UPSERT 语句缺少具体冲突键定义（ON CONFLICT 的列列表）"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 7
    severity: INFO
    location: "spec.md → AC-4"
    title: "100ms 性能目标基于当前 216K 行数据量，未定义数据增长后的退化预期"
    status: open
    raised_in_round: 1
    resolved_in_round: null
---

# Spec 评审 v1

## 评审记录
- 评审时间：2026-06-08 14:15
- 评审类型：计划评审（仅 spec.md，无 plan.md）
- 评审对象：`.xyz-harness/2026-06-08-metrics-aggregation/spec.md`

## 1. spec 完整性检查

### 1.1 目标明确性 ✅

目标清晰：将 `request_metrics` 拆分为明细表 + 聚合表，Dashboard 查询按时间范围路由，解决大表查询性能问题。一段话可概括，无歧义。

### 1.2 范围合理性 ✅

范围适度：聚合表 + 双写 + 查询路由 + 时间选择器重构 + 保留配置。边界清晰，`usage_windows` 表仅标记不删除。

### 1.3 验收标准可量化 ⚠️

AC-1 ~ AC-6 基本可量化，但存在以下问题：

- AC-4 "所有查询响应时间 < 100ms" — 是 P50 还是 P99？单次测试还是持续基准？需明确度量方式
- AC-3 "立即刷新" — 不可量化，应定义最大延迟（如 < 200ms）或改为"点击后触发 API 请求"

### 1.4 待决议项 ✅

无 `[待决议]` 标记。

## 2. 架构合规性检查（对照 CLAUDE.md）

| 规范 | spec 是否遵守 | 说明 |
|------|-------------|------|
| 数据表通过迁移创建 | ✅ | FR-1 新建 metrics_10min 表 |
| DB JSON 字段用安全解析 | N/A | 无 JSON 字段 |
| settings 表存配置 | ✅ | FR-2 用 settings 表存 metrics_detail_days |
| 日志清理复用 log-cleaner | ✅ | FR-5 扩展现有 scheduleLogCleanup |

## 3. spec 与代码现状对照

### 3.1 现有 `request_metrics` 表列 vs spec 聚合指标

`request_metrics` 当前列（migration 027 + 030 + 031 + 043）：

```
id, request_log_id, provider_id, backend_model, api_type,
input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens,
ttft_ms, total_duration_ms, tokens_per_second, stop_reason,
is_complete, router_key_id, status_code, created_at,
input_tokens_estimated,           -- migration 030
thinking_tokens, text_tokens, tool_use_tokens,              -- migration 031
thinking_duration_ms, text_duration_ms, tool_use_duration_ms,
thinking_tps, text_tps, tool_use_tps, total_tps,
client_type,                      -- migration 043
cache_read_tokens_estimated
```

**spec FR-1 §1 聚合指标**：`request_count, sum_input_tokens, sum_output_tokens, sum_cache_read_tokens, sum_total_duration_ms, sum_ttft_ms`

遗漏的关键字段：
- `input_tokens_estimated`（布尔标记，聚合时可忽略，但 `cache_read_tokens_estimated` 同理 — 需明确）
- `thinking_tokens / text_tokens / tool_use_tokens`（token 细分，`getMetricsTimeseries` 用 `METRIC_EXPR` 引用了 `text_tps`/`thinking_tps` 等）
- `thinking_tps / text_tps / tool_use_tps / total_tps / non_thinking_tps / non_thinking_tps`（TPS 细分）
- `cache_creation_tokens`（`getMetricsSummary` 中虽未显式聚合，但作为输入 token 的组成可能有统计价值）

### 3.2 现有查询函数验证

| spec 提及的函数 | 实际位置 | 匹配 |
|----------------|---------|------|
| `getMetricsSummary()` | `src/db/metrics.ts` | ✅ |
| `getMetricsTimeseries()` | `src/db/metrics.ts` | ✅ |
| `getClientTypeBreakdown()` | `src/db/metrics.ts` | ✅ |
| `getStats()` | `src/db/stats.ts` | ✅ |
| `getWindowUsage()` | `src/db/usage-windows.ts` | ✅ |
| `getDailyUsage()` | **`src/admin/usage.ts`**（非 `src/db/stats.ts`） | ❌ |

## 4. 发现的问题

| # | 优先级 | 文件/位置 | 描述 | 修改建议 |
|---|--------|----------|------|---------|
| 1 | MUST FIX | spec.md → FR-1 §1 聚合维度 | **聚合维度遗漏 `api_type`**。现有 `getMetricsTimeseries` 的索引 `idx_metrics_api_type_created_at` 表明按 `api_type` 查询是常见场景，但聚合维度 `(bucket_time, router_key_id, provider_id, backend_model, client_type)` 不含 `api_type`。如果前端按 api_type 过滤时序图，聚合表无法返回正确数据 | 在聚合维度中增加 `api_type`，或明确说明 FR-5 筛选维度不包含 api_type 并论证为何不需要 |
| 2 | MUST FIX | spec.md → FR-1 §1 聚合指标 | **聚合指标遗漏 TPS 细分字段**。`getMetricsTimeseries` 支持 `text_tps`/`thinking_tps`/`tool_use_tps`/`total_tps` 等指标，这些字段的值无法从 `sum_output_tokens / sum_total_duration_ms` 推算（它们是按行计算的瞬时值）。聚合表如果不存这些字段的 sum/avg，则 >detail_days 范围的 TPS 细分图表数据会丢失 | 增加聚合指标：`sum_thinking_tokens, sum_text_tokens, sum_tool_use_tokens` 等 token 细分 + duration 细分，使聚合表能重算 TPS；或接受降级（>detail 天数不支持 TPS 细分），并在 spec 中明确标注 |
| 3 | MUST FIX | spec.md → FR-4 受影响函数列表 | **`getDailyUsage` 归属文件错误**。spec 写"受影响的查询函数（`src/db/metrics.ts` + `src/db/stats.ts` + `src/db/usage-windows.ts`）"并将 `getDailyUsage` 列于其中，但该函数实际在 `src/admin/usage.ts`。plan 阶段若按此定位会遗漏修改 | 修正函数归属：`getDailyUsage` → `src/admin/usage.ts` |
| 4 | LOW | spec.md → FR-3 §2 活动图 | **活动图无数据降级方案缺失**。新用户首次使用或 metrics_10min 为空时，活动图显示什么？空状态应有明确描述（如显示"暂无数据"占位、灰色空白区域等） | 补充 FR-3 §2 的空状态处理描述 |
| 5 | LOW | spec.md → FR-1 §2 双写机制 | **UPSERT 冲突键未具体化**。`ON CONFLICT ... DO UPDATE SET request_count += 1` 中 `...` 是哪些列？应明确写出 `ON CONFLICT (bucket_time, router_key_id, provider_id, backend_model, client_type)` 以确保实现无歧义 | 在 spec 中写出完整的 UPSERT SQL 骨架或明确冲突键列 |
| 6 | LOW | spec.md → FR-1 §1 | **聚合维度中 `router_key_id` 可为 NULL**。`request_metrics.router_key_id` 允许 NULL（migration 027 定义为 `TEXT` 无 NOT NULL）。UPSERT 按含 NULL 的列做冲突检测时，SQLite 的 NULL ≠ NULL 语义会导致冲突检测失败，每次都 INSERT 而非 UPDATE | 明确处理 NULL router_key_id：UPSERT 前用 COALESCE 转为空字符串，或在 spec 中说明使用 `IS NOT DISTINCT FROM`（SQLite 3.39+） |
| 7 | INFO | spec.md → AC-4 | **性能目标未定义退化预期**。100ms 目标基于 216K 行，但数据量持续增长后聚合表本身也会变大（30 天 ~8K 行，一年 ~100K 行）。长期维护时缺乏退化参考线 | 考虑在 Constraints 中补充增长预期说明，或在 AC 中注明"在当前数据量 216K 行下" |

> 优先级定义：
> - **MUST FIX**：不修复则评审不通过，会阻塞流程
> - **LOW**：建议修复，但不阻塞
> - **INFO**：观察记录，无需操作

### MUST FIX 问题详细分析

#### Issue #1: 聚合维度遗漏 api_type

当前 `request_metrics` 有索引 `idx_metrics_api_type_created_at ON request_metrics(api_type, created_at)`，说明按 `api_type` 查询是设计上的预期路径。`getMetricsTimeseries` 的调用方可能按 api_type 过滤（如只看 chat 类型的时序）。聚合维度不含 `api_type` 时，这些查询在 >detail_days 范围内会返回错误结果（混合了所有 api_type 的数据）。

**修复方向**：在聚合维度 `(bucket_time, router_key_id, provider_id, backend_model, client_type, api_type)` 中增加 `api_type`。

#### Issue #2: TPS 细分字段聚合缺失

`getMetricsTimeseries` 中 `METRIC_EXPR` 定义了 `text_tps`, `thinking_tps`, `tool_use_tps`, `non_thinking_tps` 等指标，这些是对每行数据独立计算的瞬时 TPS。聚合表中只存 `sum_output_tokens + sum_total_duration_ms`，能重算 `avg_tps`，但无法重算 `text_tps`（需要 `sum_text_tokens / sum_text_duration_ms`）。

对于 >detail_days 的查询，用户选择 "Text TPS" 图表时会得到错误或空数据。

**修复方向**：增加 `sum_thinking_tokens, sum_text_tokens, sum_tool_use_tokens, sum_thinking_duration_ms, sum_text_duration_ms, sum_tool_use_duration_ms` 等聚合字段。

#### Issue #3: getDailyUsage 文件归属错误

spec 在 FR-4 中写道：

> 受影响的查询函数（`src/db/metrics.ts` + `src/db/stats.ts` + `src/db/usage-windows.ts`）

但 `getDailyUsage` 实际定义在 `src/admin/usage.ts:26`，不在这个列表中。plan 阶段如果仅扫描上述三个文件，会遗漏该函数的路由改造。

**修复方向**：将 `src/admin/usage.ts` 加入受影响文件列表，或将 `getDailyUsage` 移入 `src/db/stats.ts`（需评估影响）。

## 5. 结论

需修改后重审。3 条 MUST FIX 涉及聚合维度的字段完整性（直接影响 >detail_days 范围的查询正确性）和函数归属错误（影响 plan 阶段文件覆盖度）。建议修复后进入 plan 阶段。

### Summary

spec 评审完成，第1轮，3条MUST FIX，需修改后重审。
