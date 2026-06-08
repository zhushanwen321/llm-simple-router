---
review:
  type: code_review
  round: 1
  timestamp: "2026-06-08"
  target: "metrics-aggregation-implementation"
  verdict: fail
  summary: "新增 metrics_10min 聚合表和双写/查询路由机制整体架构合理，但存在 1 个 MUST FIX（合并函数 avg_tps 公式错误）和 1 个测试维护问题（迁移计数硬编码未更新），需修复后重新审查"
---

# Code Review v1 — Metrics Aggregation Implementation

## 审查范围

20 个代码文件（10 后端 + 10 前端），涵盖 metrics_10min 聚合表的创建、双写、查询路由、Settings API、Dashboard 时间选择器重构。

---

## 问题列表

### ERROR-1: mergeSummaryResults 中 avg_tps 合并公式错误

- **文件**: `router/src/db/metrics.ts:197-198`
- **维度**: 路由映射正确性
- **严重程度**: error

**描述**: 跨分界线合并 detail + agg 的 summary 结果时，`avg_tps` 的合并公式为：

```typescript
existing.avg_tps = (mergedOutputTokens > 0 && mergedInputTokens + mergedOutputTokens > 0)
  ? mergedOutputTokens * MS_PER_SECOND / (mergedInputTokens + mergedOutputTokens) : null;
```

原始 SQL 中 avg_tps 的定义是 `output_tokens * 1000 / total_duration_ms`，但合并公式把 `(input_tokens + output_tokens)` 当作 `total_duration_ms` 使用，两者单位完全不同——前者是 token 数，后者是毫秒。当 input_tokens >> output_tokens 时，合并后的 avg_tps 会被严重低估。

**修复建议**: 改用加权平均（与 avg_ttft_ms 的处理方式一致），在 merge 前保存旧 request_count：

```typescript
existing.avg_tps = mergedRequestCount > 0
  ? ((existing.avg_tps ?? 0) * existing.request_count + (row.avg_tps ?? 0) * row.request_count) / mergedRequestCount
  : null;
```

注意：`existing.request_count` 需要在更新前先保存旧值（当前 avg_ttft_ms 行已经正确处理了顺序）。

---

### ERROR-2: 迁移测试计数硬编码未更新

- **文件**: `router/tests/db.test.ts:42`, `router/tests/metrics.test.ts:32`
- **维度**: 测试覆盖
- **严重程度**: error

**描述**: 新增 `055_metrics_10min.sql` 迁移后，迁移总数从 55 变为 56，但两个测试文件的硬编码 `toBe(55)` / `toHaveLength(55)` 未更新，导致测试失败：

```
FAIL: expected 56 to be 55    (db.test.ts:42)
FAIL: expected length 55, got 56  (metrics.test.ts:32)
```

**修复建议**: 将两处更新为 `toBe(56)` / `toHaveLength(56)`。

---

### WARN-1: getStats 跨分界线时明细查询范围不精确

- **文件**: `router/src/db/stats.ts:48-130`
- **维度**: 路由映射正确性
- **严重程度**: warning

**描述**: `getStats` 在跨越 cutoffTime 分界线时（第三分支），先对 `[startTime, endTime)` 全范围查明细表，再对 `[startTime, cutoffTime)` 查聚合表。如果明细清理尚未完成（服务器刚启动、清理定时器还没跑），明细表中可能存在早于 cutoffTime 的数据，导致与聚合表数据重复计算。

虽然当前实现依赖"清理一定先于查询"的隐式假设，正常运行下不会触发，但在极端时序下（进程重启后立刻有历史时间范围查询）可能出现。

**修复建议**: 跨越分支的明细查询应显式限制为 `[cutoffTime, endTime)`，即：

```typescript
const row = db.prepare(`... WHERE rm.created_at >= datetime(?) AND rm.created_at < datetime(?) ...`)
  .get(cutoffTime, endTime, ...);
```

而不是查询全范围后依赖清理来保证数据不重叠。

---

### WARN-2: Settings.vue 前端 lint 警告（magic number）

- **文件**: `frontend/src/views/Settings.vue:83`
- **维度**: 代码质量
- **严重程度**: warning

**描述**: `detailSegmentPct` computed 中直接使用 `100` 作为最大百分比，触发 `no-magic-numbers` lint 规则：

```typescript
return Math.max(0, Math.min(100, (metricsDetailDays.value / log) * 100));
```

同一文件中已定义 `PERCENT_MAX = 100` 常量（第 88 行 `aggregatedSegmentPct` 使用了），但 `detailSegmentPct` 遗漏了。

**修复建议**: 将 `100` 替换为 `PERCENT_MAX`。

---

### WARN-3: metrics-10min.ts 中 UPSERT SQL 未使用 getCachedStmt

- **文件**: `router/src/db/metrics-10min.ts:90` (`upsertAggBucket`)
- **维度**: 代码质量
- **严重程度**: warning

**描述**: `upsertAggBucket` 中的 UPSERT SQL 通过 `getCachedStmt()` 执行（好的），但在 `metrics-10min.ts:101` 传递 `0` 作为 `tool_use_duration_ms` 的硬编码值，注释说"MetricsInsert 不提供细分"。这个值永远是 0，意味着聚合表中 `sum_tool_use_duration_ms` 永远为 0，导致 `tool_use_tps` 和 `non_thinking_tps` 的聚合查询永远返回 NULL。

如果这些 TPS 指标在聚合表中不打算支持，建议在 `AGG_METRIC_EXPR` 中对 `tool_use_tps` 和 `non_thinking_tps` 返回固定 NULL 并加注释说明，避免误导。

---

### WARN-4: StatsResponse 前端类型未包含 is_approximate 字段

- **文件**: `frontend/src/api/client.ts:274-281`
- **维度**: 向后兼容性
- **严重程度**: warning

**描述**: 后端 `getStats` 返回的 `Stats` 接口新增了 `is_approximate: boolean` 字段（`router/src/db/stats.ts:35`），但前端 `StatsResponse` 接口未同步更新。虽然 TypeScript 不会报错（前端只是不使用该字段），但如果后续前端需要展示"数据为近似值"提示，会缺少类型声明。

**修复建议**: 在 `StatsResponse` 中添加 `is_approximate?: boolean` 字段。

---

### INFO-1: useTimeSelector 中 detailDays 硬编码为常量 7

- **文件**: `frontend/src/composables/useTimeSelector.ts:32`
- **维度**: 代码质量
- **严重程度**: info

**描述**: `const detailDays = 7` 硬编码在 composable 中，不跟随后端 `metrics_detail_days` 设置动态变化。`ActivityTimeline` 使用此值渲染聚合区域标记线（`aggregationZoneStyle`），如果用户在后端修改了 detail days（比如从 7 改为 3），前端的时间线标记不会同步更新。

当前可接受：设置变更后刷新页面即可。未来可考虑从后端 API 获取此值。

---

### INFO-2: upsertAggBucket 错误处理策略（静默降级）

- **文件**: `router/src/db/metrics.ts:92-98`
- **维度**: 代码质量
- **严重程度**: info

**描述**: `insertMetrics` 中聚合表写入失败时仅 `console.error` 并存储到 `lastAggError`，不阻塞主流程。这是合理的降级策略（明细表写入为主），但 `getAggWriteError()` 目前没有任何消费者调用它，也没有健康检查端点暴露这个状态。

**建议**: 可以在 `/health` 或 monitor 端点中暴露聚合写入状态，方便运维排查。

---

## 架构层面评价

### 分层正确性 ✅
- `metrics-10min.ts` 仅被 `db` 层（`metrics.ts`、`stats.ts`）和 `admin` 层（`metrics.ts` 的 activity 端点）引用，proxy 层无直接依赖。
- 查询路由逻辑正确放在 `db` 层（`metrics.ts`、`stats.ts`），admin 层只做参数解析和响应格式化。
- 双写路径（`insertMetrics` → `rawInsertMetrics` + `upsertAggBucket`）设计合理，聚合写入失败不影响明细写入。

### DB 迁移安全性 ✅
- `055_metrics_10min.sql` 使用 `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`，幂等安全。
- 复合主键 `(bucket_time, router_key_id, provider_id, backend_model, client_type, api_type)` 粒度合理。

### 向后兼容性 ✅
- `is_approximate` 为新增字段，前端忽略不影响现有功能。
- Settings 页面新增 metrics detail days 双栏布局，旧版 API 无破坏性变更。
- `getMetricsDetailDays` 有合理默认值 `7`，未设置时行为一致。

### router_key_id NULL/'' 一致性 ✅
- `upsertAggBucket` 中 `COALESCE(?, '')` 确保空值转为空字符串。
- `queryAggRouterKeyIdCondition` 使用 `COALESCE(m.router_key_id, '') = COALESCE(?, '')` 保证比较一致。
- 明细表查询直接用 `rm.router_key_id = ?`，与插入时存储的 NULL 一致。

### 前端重构质量 ✅
- `useTimeSelector` composable 封装清晰，ActivityTimeline 组件交互合理（点击拖选、quick range 切换）。
- Dashboard facade 重构（`useDashboard` → `useDashboardData` + `useDashboardFilters` + `useTimeSelector`）分层合理，职责清晰。

---

## 审查结论

**Verdict: FAIL**

需修复 ERROR-1（avg_tps 合并公式）和 ERROR-2（测试迁移计数）后重新审查。WARN 级别问题建议一并修复。
