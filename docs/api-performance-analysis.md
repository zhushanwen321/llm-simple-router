# Admin API 性能分析

测试日期：2026-06-08
环境：NUC5 Docker, SQLite
数据规模：request_logs ~1480 行, request_metrics ~216K 行, usage_windows ~240 行

## request_logs.backend_model 两阶段迁移

### 第一阶段（当前版本 v1.x）：写入

- DB 迁移 `054`：`ALTER TABLE request_logs ADD COLUMN backend_model TEXT`
- 所有 `insertRequestLog` 调用点传入 `backend_model`（从 `resolved.backend_model` 或 `attempt.target.backend_model`）
- **读取路径不变**：
  - 日志列表 `LOG_LIST_SELECT` 仍通过 `JOIN request_metrics` 获取 `backend_model`
  - 日志筛选 `buildLogWhereClause` 仍通过子查询 `request_metrics` 过滤（已改为 `= ?` 精确匹配 + 索引）
  - 前端 `loadModelOptions` 从 `mapping_groups` 获取 client_model / backend_model

### 第二阶段（下一版本 v2.x）：读取

**触发条件**：部署后运行 ≥7 天，确保历史日志的 `request_logs.backend_model` 大部分已填充。

待完成项：
1. `LOG_LIST_SELECT` 去掉 `JOIN request_metrics`，改为 `rl.backend_model`
2. `buildLogWhereClause` 的 backend_model 过滤改为 `WHERE rl.backend_model = ?`
3. `LOG_LIST_JOIN` 可考虑去掉 `LEFT JOIN request_metrics rm`（如果其他字段如 input_tokens 等也迁到 request_logs）
4. 前端 `loadModelOptions` 改为从 `SELECT DISTINCT backend_model FROM request_logs` 取（或专用 API）
5. 性能对比测试确认无回退

## 风险排名

| 优先级 | 风险 | 端点 | 耗时 | 根因 |
|--------|------|------|------|------|
| **P0** | HIGH | `GET /admin/api/usage/windows` | 597ms | N+1：240 窗口 × request_metrics 聚合 |
| **P0** | HIGH | `GET /admin/api/metrics/summary?period=7d` | 486ms | 两次全表扫描串行（summary + breakdown） |
| **P0** | HIGH | `GET /admin/api/metrics/timeseries?period=30d` | 1760ms | 179K 行回表计算 AVG(ttft) |
| **P0** | HIGH | `GET /admin/api/metrics/summary?period=30d` | 1760ms | 同上，已修复前端调用侧 |
| **P1** | MEDIUM | `GET /admin/api/monitor/active` | 317ms | 2.7MB JSON（携带完整请求体） |
| **P1** | MEDIUM | `GET /admin/api/monitor/recent` | 67ms | 1.2MB JSON（同上） |
| **P1** | MEDIUM | `GET /admin/api/settings/db-size` | 350-560ms | calcDirSize 遍历 12500 个文件 |
| **P2** | MEDIUM | `GET /admin/api/metrics/timeseries?period=7d` | 79-143ms | 46K 行扫描 + 计算列 GROUP BY |
| **P2** | MEDIUM | `GET /admin/api/usage/monthly` | 163ms | 46K 行 + GROUP BY date() |
| **P2** | MEDIUM | `GET /admin/api/logs?backend_model=xxx` | 391ms | LIKE '%xxx%' 全表扫描 metrics |
| **P2** | MEDIUM | `GET /admin/api/stats?period=weekly` | 103ms | 46K 行聚合 |
| **P3** | MEDIUM | `GET /admin/api/providers` (偶发) | 340ms 抖动 | N+1 provider_model_info |
| LOW | — | 其余所有 CRUD 端点 | 5-25ms | 无问题 |

## 核心结论

1. **request_metrics (21.6万行) 是唯一的大表**，所有 HIGH 风险都源于它
2. **增长速度**：~5000 行/天，6 个月后约 110 万行，MEDIUM 级问题会升级为 HIGH
3. **根本解决方案**：新建 `metrics_daily` 预聚合表，>7天查询走聚合表

---

## 1. 日志与监控类

### [LOW] GET /admin/api/logs（flat 视图）

- 耗时：16ms（curl 端到端）
- SQL：`SELECT ... FROM request_logs rl LEFT JOIN providers p LEFT JOIN request_metrics rm WHERE 1=1 ORDER BY rl.created_at DESC LIMIT 20`
- 索引：`idx_request_logs_created_at`（DESC SCAN，LIMIT 20 早停）
- 无问题

### [LOW] GET /admin/api/logs（grouped 视图）

- 耗时：13ms（curl 端到端）
- SQL：CTE `page_ids` + 子查询 `child_count`
- 索引：`idx_logs_original_time`（original_request_id + created_at DESC）
- 无问题

### [MEDIUM] GET /admin/api/logs?backend_model=xxx

- 耗时：391ms（curl 端到端），COUNT 查询 235ms
- SQL：`WHERE rl.id IN (SELECT request_log_id FROM request_metrics WHERE backend_model LIKE '%xxx%')`
- EXPLAIN：`SCAN request_metrics`（全表扫描 216K 行）
- 问题：`backend_model LIKE '%xxx%'` 前缀通配符无法利用 B-tree 索引，且子查询执行两次（COUNT + 数据）
- 建议：前端改为精确匹配（下拉选择具体值），或加 `request_metrics(backend_model)` 索引配合前缀匹配

### [LOW] GET /admin/api/logs/:id

- 耗时：<1ms，主键查询
- 无问题

### [LOW] GET /admin/api/logs/:id/children

- 走 `idx_logs_original_time` 索引，无问题

### [LOW] DELETE /admin/api/logs/before

- 分批删除 + incremental_vacuum，日志量小无问题

### [LOW] GET /admin/api/stats?period=window

- 耗时：8ms，COVERING INDEX 命中
- 无问题

### [MEDIUM] GET /admin/api/stats?period=weekly

- 耗时：103ms
- 扫描 ~46421 行，5 个聚合值
- 当前可接受，随 metrics 增长会线性恶化

### [LOW] GET /admin/api/stats?period=monthly

- 耗时：72ms，COVERING INDEX 效率更高
- 无问题

### [HIGH] GET /admin/api/metrics/summary?period=7d

- 耗时：486ms（curl），其中 summary 查询 349ms + client_type_breakdown 149ms
- 两个查询串行执行，合计扫描 ~92K 行，条件完全相同
- EXPLAIN：`idx_metrics_created_at_router_key` 不覆盖 GROUP BY 列，需 TEMP B-TREE
- 建议：合并为单次查询，JS 层聚合 client_type_breakdown，省掉第二次全表扫描

### [HIGH] GET /admin/api/metrics/summary?period=30d

- 耗时：1760ms（curl），扫描 179K 行
- 前端已修复：Logs 页面改用 `getMappingGroups()` 提取 model 列表

### [HIGH] GET /admin/api/metrics/timeseries?period=30d

- 耗时：1760ms（SQL 层）
- SQL：`AVG(rm.ttft_ms)` 需回表取 ttft_ms，索引不覆盖
- 建议：预聚合表或限制前端最大查询范围

### [MEDIUM] GET /admin/api/metrics/timeseries?period=7d

- 耗时：79-143ms
- COVERING INDEX 命中但数据量仍大（46K 行）

### [MEDIUM] GET /admin/api/monitor/active

- 耗时：317ms，响应体 2.7MB
- 数据来源：内存 Map，无 DB 查询
- 问题：每个 active request 携带完整 clientRequest（263KB）、upstreamRequest（285KB）、streamContent（49KB）
- 建议：列表 API 剥离大字段，详情 API `/monitor/request/:id` 保留

### [MEDIUM] GET /admin/api/monitor/recent

- 耗时：67ms，响应体 1.2MB
- 同 active，建议剥离大字段

### [LOW] GET /admin/api/monitor/stats|concurrency|runtime

- 耗时：4-6ms，内存操作
- 无问题

---

## 2. 仪表盘与用量类

### [HIGH] GET /admin/api/usage/windows（无参数）

- 耗时：597ms
- N+1 查询：先取 240 个窗口，再对每个窗口执行 `SELECT COUNT(*), SUM(...) FROM request_metrics WHERE provider_id = ? AND created_at >= ? AND created_at < ?`
- 240 次 × ~2ms = ~486ms
- 无参数时 `resolveTimeRange` 走 startTime="1970-01-01", endTime="2099-12-31"，拉出全部窗口
- 建议：
  1. 限制默认范围（最近 24 个窗口）
  2. 改为窗口内嵌子查询或 CTE，消除 N+1

### [MEDIUM] GET /admin/api/metrics/timeseries?period=weekly&metric=input_tokens

- 耗时：303ms
- 扫描 ~42536 行，GROUP BY 计算列 `(unixepoch(created_at)/N)*N` 无法走索引
- 6 个月后预计 1.5-2s

### [MEDIUM] GET /admin/api/usage/monthly

- 耗时：163ms
- 扫描 ~46469 行，`GROUP BY date(created_at)` 计算列需 TEMP B-TREE

### [LOW] GET /admin/api/upgrade/status

- 耗时：5ms，内存 + 单行 DB
- 无问题

### [LOW] GET /admin/api/recommended/providers

- 耗时：8ms，纯内存操作
- 无问题

---

## 3. CRUD 配置类

### [MEDIUM] GET /admin/api/settings/db-size

- 耗时：350-560ms
- `calcDirSize()` 递归遍历 12500+ 个日志文件（`readdirSync` + `statSync`）
- 建议：缓存结果 5-10 分钟

### [LOW] GET /admin/api/providers

- 耗时：8-10ms（偶发 340ms 抖动，疑似 WAL checkpoint）
- N+1：每个 provider 查一次 `provider_model_info`（8+1=9 次 SQL）
- 列表接口返回完整 api_key 明文（含解密开销）
- 建议：合并为一条 SQL；列表返回 `api_key_preview`

### [LOW] 其余 CRUD 端点

- providers/mappings/groups/retry-rules/router-keys/settings/transform-rules
- 全部 5-25ms，小表无性能问题

---

## 优化方案（按投入产出比排序）

### P0：消除 /usage/windows 的 N+1

当前：240 次循环查询 request_metrics
方案：限制默认查询范围（最近 24 窗口）+ 窗口内嵌子查询
预期：597ms → <50ms
复杂度：低

### P0：合并 metrics/summary 的双查询

当前：getMetricsSummary() 和 getClientTypeBreakdown() 条件相同，串行两次扫描
方案：单次查询，JS 层从 summary 结果聚合 client_type_breakdown
预期：省 ~150ms
复杂度：低

### P1：monitor/active + recent 剥离大字段

当前：列表 API 返回完整请求体（2.7MB）
方案：列表只返回元数据，详情 API `/monitor/request/:id` 保留完整数据
预期：2.7MB → <5KB，317ms → <10ms
复杂度：低

### P1：calcDirSize 加缓存

当前：每次调用遍历 12500 个文件
方案：结果缓存 5-10 分钟
预期：350ms → <5ms
复杂度：极低

### P2：request_metrics 预聚合表（根本方案）

新建 `metrics_daily` 预聚合表：

```sql
CREATE TABLE metrics_daily (
  bucket_date TEXT,
  provider_id TEXT,
  backend_model TEXT,
  api_type TEXT,
  request_count INTEGER,
  avg_ttft_ms REAL,
  total_input_tokens INTEGER,
  total_output_tokens INTEGER,
  total_cache_read_tokens INTEGER,
  total_duration_ms INTEGER,
  PRIMARY KEY (bucket_date, provider_id, backend_model)
);
```

> 7 天查询走聚合表，7 天内仍从明细表实时计算。
> 所有 weekly/monthly/30d 查询受益。
> 预期：所有 >100ms 的 metrics 查询降至 <20ms。
> 复杂度：中（需定时刷新逻辑 + 迁移）

### P3：backend_model 过滤改精确匹配

前端 Logs 页面 backend_model 筛选改为下拉选择具体值，避免 `LIKE '%xxx%'` 全表扫描。
复杂度：极低

---

## request_metrics 现有索引

| 索引名 | 列 |
|--------|-----|
| `idx_metrics_time_provider_model` | `(created_at, provider_id, backend_model)` |
| `idx_metrics_api_type_created_at` | `(api_type, created_at)` |
| `idx_metrics_router_key` | `(router_key_id)` |
| `idx_metrics_created_at_router_key` | `(created_at, router_key_id)` |
| `idx_metrics_agg` | `(is_complete, created_at DESC, provider_id, backend_model)` |

问题：`idx_metrics_agg` 以 `is_complete` 开头，metrics/summary 不过滤 is_complete 导致无法使用。考虑新建 `(created_at DESC, provider_id, backend_model, client_type)` 使 GROUP BY 走索引。
