---
verdict: pass
---

# Metrics 分层存储 + Dashboard 时间选择器重构

## Background

`request_metrics` 表是系统中唯一的快速增长大表（日均 +5000 行，当前 216K 行）。所有 Dashboard 查询（统计卡片、时序图表、用量窗口、缓存命中率）都直接扫描此表。30 天查询耗时 1760ms，usage/windows 的 N+1 问题导致 597ms 响应。

根本方案：将 `request_metrics` 拆分为明细表（≤N 天完整数据）+ 聚合表（>N 天的 10 分钟桶），Dashboard 查询根据时间范围路由到对应表。

同时重构 Dashboard 时间选择器，从 usage-window 时间线改为快速按钮（5h/24h/7d/30d）+ 可视化活动图 + 自定义日期选择，并增加 secret/provider/model/client 筛选维度。

## Functional Requirements

### FR-1: 聚合表 `metrics_10min` 创建与写入

1. 新建 `metrics_10min` 表，按 10 分钟桶聚合 `request_metrics` 数据：
   - 聚合维度：`(bucket_time, router_key_id, provider_id, backend_model, client_type, api_type)`
     - `router_key_id` 可为 NULL，UPSERT 时用 COALESCE 转为空字符串避免 NULL ≠ NULL 冲突检测失败
   - 聚合指标：
     - 基础：`request_count, sum_input_tokens, sum_output_tokens, sum_cache_read_tokens, sum_total_duration_ms, sum_ttft_ms`
     - Token 细分：`sum_thinking_tokens, sum_text_tokens, sum_tool_use_tokens`
     - Duration 细分：`sum_thinking_duration_ms, sum_text_duration_ms, sum_tool_use_duration_ms`
     - Cache 细分：`sum_cache_creation_tokens`
   - `bucket_time` 为桶起始时间（精确到分钟，如 `2026-06-08 14:00`）

2. **双写机制**：每次 `insertMetrics()` 时，同步 UPSERT 到 `metrics_10min` 对应桶行。
   - 冲突键：`ON CONFLICT (bucket_time, router_key_id, provider_id, backend_model, client_type, api_type)`
   - 更新策略：`DO UPDATE SET request_count = request_count + 1, sum_input_tokens = sum_input_tokens + excluded.sum_input_tokens, ...`
   - `router_key_id` 为 NULL 时用空字符串 `''` 存储，读取时转回 NULL
   - 写入零延迟，无定时任务依赖

3. `request_metrics` 明细数据的清理由 `log-cleaner` 扩展：读取 `metrics_detail_days` 配置，按保留天数 DELETE 过期明细行。清理时机与现有日志清理共用 1 小时间隔。

### FR-2: Metrics 保留天数配置

1. Settings 页面现有的 Log Retention Card 改为双栏布局：
   - 左栏：Request Logs 保留天数（现有 `log_retention_days`，不变）
   - 右栏：Metrics Detail 保留天数（新增 `metrics_detail_days`，默认 7，范围 1-30）
   - 校验：`metrics_detail_days` ≤ `log_retention_days`
   - 底部可视化条：实色 = detail 期，半透明 = aggregated 期
   - 一个 Save 按钮保存两项

2. 后端新增 `getMetricsDetailDays()` / `setMetricsDetailDays()` 函数（`src/db/settings.ts`），存入 `settings` 表 key = `metrics_detail_days`。

### FR-3: Dashboard 时间选择器重构

替换当前 usage-window 时间线为新的时间选择器：

1. **快速按钮**：`5h | 24h | 7d | 30d` — 点击后直接以 now 为终点设置时间范围
2. **可视化活动图**：
   - 默认展示 30 天范围，底部有迷你柱状图表示请求密度（数据来源：`metrics_10min` 的 `request_count`）
   - 斜线阴影区域标识 >detail_days 的聚合数据区域
   - 可拖拽选区，左右 handle 调整起止时间
   - 选区内活动柱高亮，选区外变暗
3. **Custom 日期选择**：30d 按钮后新增 Custom 按钮，展开 `From [date] ~ To [date] [Apply]` 行
   - 日期自动预填当前选区
   - 校验：起始 < 结束、最大回溯 90 天、不能选未来
   - 选择快速按钮时自动收起 Custom 行
4. **usage_windows 表保留**：时间选择器不再依赖 `usage_windows`，但该表不删除（向后兼容）。前端 `loadUsageWindows()` 调用移除。

### FR-4: Dashboard 查询路由

后端查询根据时间范围自动分流：

| 时间范围 | 查询目标 | 扫描量 |
|---------|---------|-------|
| ≤ metrics_detail_days | `request_metrics` 明细表 | ≤ 35K 行 |
| > metrics_detail_days | `metrics_10min` 聚合表 | ≤ 8K 行/30天 |
| 跨越分界线 | SQL 层 UNION 两表结果（聚合表补齐旧段 + 明细表覆盖新段） | 按比例 |

受影响的查询函数：

| 函数 | 文件 | 聚合表适配 |
|------|------|-----------|
| `getMetricsSummary()` | `src/db/metrics.ts` | `avg_ttft_ms` = `sum_ttft_ms / request_count`；TPS 由 token 细分 + duration 细分重算 |
| `getMetricsTimeseries()` | `src/db/metrics.ts` | 聚合表 10 分钟桶直接作为数据点；TPS 细分（text_tps/thinking_tps 等）由 `sum_text_tokens / sum_text_duration_ms` 重算 |
| `getClientTypeBreakdown()` | `src/db/metrics.ts` | 聚合表 `GROUP BY client_type`，`SUM(request_count)` |
| `getStats()` | `src/db/stats.ts` | 同上 |
| `getWindowUsage()` | `src/db/usage-windows.ts` | N+1 问题自然消除（不再调用） |
| `getDailyUsage()` | `src/admin/usage.ts` | 聚合表按 `date(bucket_time)` 分组 |

### FR-5: Dashboard 筛选维度

保留并完善现有筛选功能：
- **Provider**：顶部 pill 按钮（现有）
- **Model**：Filter 弹出面板中 chip 选择（现有）
- **Secret Key**：Filter 弹出面板中 chip 选择（现有）
- **Client Type**：Filter 弹出面板中 chip 选择（现有）

所有筛选参数同时传递给明细表查询和聚合表查询。

## Acceptance Criteria

### AC-1: 聚合表写入
- `insertMetrics()` 调用后，`metrics_10min` 中对应桶行的 `request_count` 增加 1，各 `sum_*` 字段累加
- 同一桶内多次写入（同一 10 分钟窗口、同一 provider+model+key+client_type），只更新一行
- 并发写入不丢数据（SQLite WAL 模式下 UPSERT 原子性）

### AC-2: Metrics 保留配置
- Settings 页面左右两栏显示 Log 和 Metrics 保留天数
- metrics_detail_days 默认 7，最小 1，最大 30
- metrics_detail_days > log_retention_days 时校验失败，显示错误提示
- 保存后，下次清理周期生效（≤ 1 小时）

### AC-3: 时间选择器
- 点击 5h/24h/7d/30d 快速按钮，统计卡片和图表立即刷新
- 活动图展示 30 天范围的请求密度分布
- >detail_days 的区域有视觉区分（斜线阴影 + "AGGREGATED" 标签）
- 拖拽 handle 可调整选区，释放后刷新数据
- Custom 按钮展开日期输入行，Apply 后刷新数据
- 选择快速按钮时 Custom 行自动收起

### AC-4: 查询路由
- 时间范围 ≤ detail_days 时，SQL 中只出现 `request_metrics`（不访问 `metrics_10min`）
- 时间范围 > detail_days 时，SQL 中只出现 `metrics_10min`（不访问 `request_metrics`）
- 跨越分界线时，两表结果合并，数据不重复不遗漏
- 所有查询响应时间 < 100ms（对比优化前 596-1760ms）

### AC-5: 清理
- `log-cleaner` 在每次清理周期中，额外 DELETE `request_metrics` 中 `created_at < (now - metrics_detail_days)` 的行
- 清理后执行 `PRAGMA incremental_vacuum`
- 新用户首次使用或 `metrics_10min` 为空时，活动图显示灰色空白区域 + "No data yet" 提示文字
- `metrics_10min` 聚合数据永久保留（30 天仅 ~8K 行，无需清理）。清理逻辑只涉及 `request_metrics` 明细和 `request_logs`

### AC-6: 向后兼容
- 升级后旧数据不丢失：已有的 `request_metrics` 行保留直到过期
- `usage_windows` 表和相关 DB 函数不删除，仅前端不再调用
- API 接口签名不变（`/admin/api/metrics/summary`、`/admin/api/stats` 等参数格式不变）

## Constraints

- **数据库**：SQLite（单文件），不支持并发写入，WAL 模式
- **聚合粒度**：10 分钟桶不可配置（硬编码）。桶的计算方式：`datetime(floor(unixepoch(created_at) / 600) * 600, 'unixepoch')`
- **聚合表保留策略**：`metrics_10min` 数据永久保留，不随日志清理
- **性能目标**：所有 Dashboard 查询 < 100ms（当前数据量 216K 行下）
- **前端技术栈**：Vue 3 + shadcn-vue + Tailwind CSS + Chart.js（不变）
- **时间选择器**：不支持秒级精度，最小粒度为分钟

## 业务用例

### UC-1: 查看近期性能趋势
- **Actor**: 系统管理员
- **场景**: 想了解过去 24 小时各模型的 token 使用和 TPS 变化
- **预期结果**: 选择 24h → 统计卡片显示总 token/请求数/成功率 → 时序图表展示趋势 → 所有数据来自明细表，响应 < 50ms

### UC-2: 分析月度用量
- **Actor**: 系统管理员
- **场景**: 月底查看过去 30 天各 provider 的 token 消耗分布
- **预期结果**: 选择 30d → 聚合区域高亮 → 统计数据来自聚合表 → 响应 < 100ms

### UC-3: 调整 metrics 保留策略
- **Actor**: 系统管理员
- **场景**: 存储空间紧张，需要缩短 metrics 明细保留天数
- **预期结果**: Settings 页面将 metrics detail 从 7 天改为 3 天 → 下个清理周期自动删除 >3 天的明细 → 仪表盘 >3 天的查询自动走聚合表

### UC-4: 自定义时间范围对比
- **Actor**: 系统管理员
- **场景**: 想对比 6/1-6/7 和 6/8-6/14 两周的用量差异
- **预期结果**: 点击 Custom → 选择 6/1 ~ 6/7 → Apply → 查看数据 → 再选 6/8 ~ 6/14 → 对比

## Complexity Assessment

- **后端 DB 层**：中等。新建表 + 双写 UPSERT + 查询路由分流。最复杂的是跨分界线合并查询
- **后端清理层**：低。扩展现有 `log-cleaner`，增加 metrics 明细清理逻辑
- **前端 Dashboard**：中等。时间选择器完全重写，筛选面板重构。图表和卡片逻辑不变（数据格式不变）
- **前端 Settings**：低。扩展现有 Card 布局为双栏
- **测试**：中等。聚合写入、查询路由、时间边界、清理逻辑都需要覆盖
