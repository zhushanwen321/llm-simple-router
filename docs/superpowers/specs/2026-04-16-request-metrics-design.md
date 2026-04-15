# 请求指标采集与可视化

## 背景

当前代理层是透明管道，不解析 SSE chunk 内容。`request_logs` 表存储了完整的 request/response 原文，但所有有价值的指标（token 数、TTFT、缓存命中率）都被"存了没用"。需要新增指标采集层，提取结构化数据并可视化。

## 调研结论

- **Anthropic** 不提供 thinking_tokens 分离值，`output_tokens` = thinking + text 总和
- **OpenAI** 通过 `completion_tokens_details.reasoning_tokens` 精确提供 reasoning token 数
- 两种 API 的 cache 信息均可获取（Anthropic: `cache_creation/read_input_tokens`；OpenAI: `prompt_tokens_details.cached_tokens`）
- **OpenAI 流式** 需注入 `stream_options.include_usage: true` 才能在最后一个 chunk 拿到 usage
- 开源项目（LiteLLM、one-api、Helicone）均采用"实时转发 + 旁路解析 + 流后聚合"模式

## 方案：Transform 流 + 实时 SSE 解析

在流式管道中插入 `SSEMetricsTransform`，逐 chunk 解析 SSE 事件，转发零延迟。

```
upstream → SSEMetricsTransform → PassThrough → reply.raw
                  ↓ 实时解析事件
                  ↓ 记录 TTFT / 时间戳
                  ↓ 提取 usage
                  ↓ 流结束后写入 metrics
```

非流式请求：直接从 JSON response body 提取 token 计数和 cache 信息。

## 数据模型

新增 `request_metrics` 表（独立于 `request_logs`，一对一关联）：

```sql
CREATE TABLE request_metrics (
  id TEXT PRIMARY KEY,
  request_log_id TEXT NOT NULL UNIQUE REFERENCES request_logs(id) ON DELETE CASCADE,
  provider_id TEXT NOT NULL,
  backend_model TEXT NOT NULL,
  api_type TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_creation_tokens INTEGER,
  cache_read_tokens INTEGER,
  ttft_ms INTEGER,
  total_duration_ms INTEGER,
  tokens_per_second REAL,
  stop_reason TEXT,
  is_complete INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_metrics_time_provider_model ON request_metrics(created_at, provider_id, backend_model);
CREATE INDEX idx_metrics_api_type_created_at ON request_metrics(api_type, created_at);
```

字段说明：

| 字段 | OpenAI 来源 | Anthropic 来源 | 备注 |
|------|------------|---------------|------|
| `api_type` | `"openai"` | `"anthropic"` | 冗余存储，避免 JOIN providers |
| `input_tokens` | `prompt_tokens` | `usage.input_tokens` | Anthropic 的 input_tokens 已包含 cache 部分 |
| `output_tokens` | `completion_tokens` | `output_tokens` | Anthropic 含 thinking |
| `cache_creation_tokens` | NULL | `cache_creation_input_tokens` | |
| `cache_read_tokens` | `prompt_tokens_details.cached_tokens` | `cache_read_input_tokens` | |
| `ttft_ms` | 首个 `content` chunk 时间戳 | 首个 `content_block_delta` 时间戳 | 跳过 role-only chunk；非流式为 NULL |
| `total_duration_ms` | 最后一个 chunk - 首个有内容 chunk | `message_stop` - `message_start` | 非流式为 NULL |
| `tokens_per_second` | `output / (duration / 1000)` | 同左 | 非流式为 NULL |
| `stop_reason` | `finish_reason` | `stop_reason` | |
| `is_complete` | 流正常结束时为 1 | 流正常结束时为 1 | 客户端断连或异常中断为 0 |

**非流式请求**：`ttft_ms`、`total_duration_ms`、`tokens_per_second` 均为 NULL，仅填充 token 计数和 cache 信息。

**流式中断**：客户端断连时，已有指标（如 TTFT）仍写入，`is_complete = 0`，缺失字段为 NULL。聚合查询默认过滤 `is_complete = 1`，可选包含不完整记录。

**向后兼容**：`request_metrics` 仅采集新请求的指标。历史 `request_logs` 不会回填。前端无数据时显示空状态提示。

## 模块设计

### 1. `src/metrics/sse-parser.ts` — SSE 行缓冲解析器

通用 SSE 解析，不耦合具体 API 格式：

- 维护行缓冲区，处理跨 chunk 的 SSE 行分割
- 解析 `event:` 和 `data:` 字段
- 识别 `[DONE]` 结束标记
- emit 结构化事件 `{event, data}` 给上层

**前置条件**：当前代理在 `SKIP_UPSTREAM` 中过滤了 `accept-encoding`，上游返回未压缩的 SSE 数据。解析器假设输入为 UTF-8 明文。如果未来启用压缩转发，需在 Transform 前添加 gunzip。

### 2. `src/metrics/metrics-extractor.ts` — 指标提取器

按 `api_type` 分派到 OpenAI/Anthropic 处理器：

**Anthropic 处理：**
- `message_start` → 记录 input_tokens, cache_*, 请求开始时间
- 首个 `content_block_delta` → 记录 TTFT
- `message_delta` → 记录 output_tokens, stop_reason, 流结束时间
- `message_stop` → 计算总耗时和 TPS

**OpenAI 处理：**
- 首个有 `content` 的 chunk → 记录 TTFT（跳过 role-only chunk）
- `finish_reason` 出现的 chunk → 记录 stop_reason
- 最后一个含 `usage` 的 chunk → 提取全部 token 数

### 3. `openai.ts` / `anthropic.ts` — 集成

- 各自创建 `SSEMetricsTransform` 并传入 `api_type`，插入管道
- **OpenAI 流式请求注入策略**：仅当 `body.stream_options` 不存在时注入 `{"include_usage": true}`，已存在则保留客户端原始设置。注入在 `body.model` 替换之后、序列化之前
- 流结束后调用 `db.insertMetrics()` 写入指标，`insertMetrics()` 在 try-catch 中执行，失败时 `request.log.error` 记录但不影响代理流程
- 非流式：从 response JSON 提取指标后写入

### 4. `src/db/index.ts` — 数据库层

- 新增 `insertMetrics()` 函数
- 新增迁移文件 `006_create_request_metrics.sql`
- 新增查询函数：`getMetricsSummary()`, `getMetricsTimeseries()`

## 后端 API

### GET /admin/api/metrics/summary

按 provider + model 聚合的摘要统计。

参数：`period`（1h/6h/24h/7d/30d）、可选 `provider_id`、`backend_model`

返回字段：`request_count`、`avg_ttft_ms`、`p50_ttft_ms`、`p95_ttft_ms`、`avg_tps`、`total_input_tokens`、`total_output_tokens`、`total_cache_hit_tokens`、`cache_hit_rate`

**`success_rate`** 从 `request_logs.status_code` 计算（不依赖 metrics 表），基数 = 时间范围内所有 request_logs 数量。

### GET /admin/api/metrics/timeseries

时间桶聚合的时序数据。

参数：`period`、`metric`（ttft/tps/tokens/cache_rate/request_count）、可选 `provider_id`、`backend_model`

桶大小自动根据 period 调整：1h→1min、6h→5min、24h→15min、7d→1h

返回字段：`time_bucket`、`avg_value`、`count`

## 前端

### 新增页面：`/admin/metrics`

**图表库：Chart.js（vue-chartjs）**

页面布局：

1. **顶部控制栏** — 时间范围选择器（1h/6h/24h/7d/30d）+ 模型下拉筛选
2. **指标卡片** — TTFT 折线图 + 吞吐量折线图（并排）
3. **Token 使用图** — 堆叠面积图（输入/输出/缓存命中）
4. **模型对比表** — 每行一个 model，列显示请求数、TTFT、TPS、缓存命中率

路由注册在 `frontend/src/router/index.ts`，新增 `Metrics.vue` 视图。

**导航入口**：修改侧边栏/导航布局组件，在 Dashboard 和 Services 之间添加 Metrics 入口。

### API 客户端

在 `frontend/src/api/client.ts` 新增：
- `getMetricsSummary(params)`
- `getMetricsTimeseries(params)`

## 测试策略

### 单元测试（高优先级）

1. **SSE 行缓冲解析器** — 跨 chunk 行分割、空行、`[DONE]`、不完整行
2. **Anthropic 指标提取器** — 各种 SSE 事件序列（正常流程、无 thinking、中断后无 message_delta）
3. **OpenAI 指标提取器** — 含/不含 `stream_options` usage chunk、role-only 首个 chunk
4. **非流式指标提取** — OpenAI 和 Anthropic 的 JSON response 解析

### 集成测试

5. **`insertMetrics()` 数据库操作** — 通过 in-memory db 注入测试
6. **API 端点** — summary 和 timeseries 查询参数验证和返回格式
