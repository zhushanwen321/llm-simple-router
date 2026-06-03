# 日志存储架构优化设计

> 日期：2026-04-30
> 分支：feat/refactor-request-log-pipeline

## 1. 背景与问题

当前 `request_logs` 表是空间大头（3GB+/天），主要因为每条记录包含 3 个大 TEXT 字段：
- `client_request`：完整请求 headers + body（2~20 KB）
- `upstream_request`：上游请求 headers + body（2~20 KB）
- `upstream_response`：上游响应 body（非流式 1~50 KB，流式≈0）

加上 `request_metrics` 表有 8 个字段与 `request_logs` 双写冗余。

**核心矛盾：**
- 成功请求（~95%）的详情很少回看，但占了绝大部分空间
- 失败请求（~5%）需要详细保留用于排查
- LLM 全文检索主要搜失败日志，成功偶尔搜

**目标：** 3D 数据 DB 体积控制在 1GB 以内，文件存储作为辅助通道。

## 2. 整体架构

```
请求完成
  │
  ├─► DB 写入（始终执行）
  │     ├─ 失败/异常日志：摘要 + 全文（client_request, upstream_request, upstream_response）
  │     └─ 成功日志：只写摘要字段（~0.7 KB）
  │
  └─► 文件写入（可开关，始终执行所有日志）
        所有日志 → JSONL 文件（按 10 分钟分片）
        历史分片 → gzip 压缩
        保留策略：统一按配置天数清理
```

### 2.1 空间预算

假设 150,000 条/天，5% 失败率：

| 存储 | 计算 | 大小 |
|------|------|------|
| DB - 失败全文 | 7,500/天 × 20KB × 3D | ~450 MB |
| DB - 成功摘要 | 142,500/天 × 0.7KB × 3D | ~300 MB |
| **DB 合计** | | **~750 MB** ✅ |
| 文件（压缩后） | 150,000/天 × 20KB × 0.3 × 3D | ~2.7 GB |

## 3. 详情保留判定逻辑

两层判定，复用现有 `RetryRuleMatcher`：

```
请求完成 → HTTP status_code
              │
              ├─ status_code >= 400 → 「保留全文」→ DB 写大 TEXT
              │
              └─ status_code < 400 → RetryRuleMatcher.match(body) 检查
                    │
                    ├─ 命中任一 body_pattern → 「保留全文」→ DB 写大 TEXT
                    │
                    └─ 未命中 → 「只存摘要」→ DB 不写大 TEXT
```

**实现：** 日志层调用 `RetryRuleMatcher.match(statusCode, body)`，复用现有重试规则，零新增配置。

## 4. request_logs / request_metrics 去冗余

### 4.1 字段清理

从 `request_logs` 删除的冗余字段（已在 `request_metrics` 中保留）：

| 删除的字段 | 原因 |
|-----------|------|
| `input_tokens` | → request_metrics |
| `output_tokens` | → request_metrics |
| `cache_read_tokens` | → request_metrics |
| `ttft_ms` | → request_metrics |
| `tokens_per_second` | → request_metrics |
| `stop_reason` | → request_metrics |
| `backend_model` | → request_metrics |
| `metrics_complete` | → request_metrics.is_complete |
| `input_tokens_estimated` | → request_metrics |

`request_logs` 保留的特有字段：

| 保留的字段 | 原因 |
|-----------|------|
| `stream_text_content` | 失败日志需要 |
| `pipeline_snapshot` | 管道调试需要 |
| 所有路由/状态字段 | 核心日志用途 |

### 4.2 职责分离

| 表 | 职责 | 查询场景 |
|----|------|---------|
| `request_logs` | 路由日志（谁发的、发到哪、成功没、延迟多少） | 日志列表、详情、LLM 检索 |
| `request_metrics` | 模型指标（token 用量、速度、缓存命中率） | 聚合统计、Dashboard |

### 4.3 前端查询改动

日志列表和详情页的 SQL 需要加一个 LEFT JOIN：

```sql
-- 改前
SELECT rl.*, rl.input_tokens, rl.output_tokens, ...
FROM request_logs rl WHERE ...

-- 改后
SELECT rl.id, rl.model, rl.status_code, rl.latency_ms, ...,
       rm.input_tokens, rm.output_tokens, rm.ttft_ms, ...
FROM request_logs rl
LEFT JOIN request_metrics rm ON rm.request_log_id = rl.id
WHERE ...
```

串联键：`request_logs.id = request_metrics.request_log_id`

### 4.4 前端影响

| 页面 | 改动 |
|------|------|
| 日志列表 | SQL 加 LEFT JOIN，展示无变化 |
| 日志详情（失败） | SQL 加 LEFT JOIN，展示无变化 |
| 日志详情（成功） | 请求/响应原文区域显示「不可用」或隐藏 |
| 实时监控 | 无改动（走内存 tracker） |
| Dashboard 统计 | 无改动（已查 request_metrics） |

## 5. 文件存储

### 5.1 目录结构

```
~/.llm-simple-router/logs/
├── 2026-04-30/
│   ├── 00-00.jsonl       ← 00:00~00:09 正在写入
│   ├── 00-10.jsonl       ← 00:10~00:19 正在写入
│   ├── ...
│   ├── 14-10.jsonl.gz    ← 已压缩的历史窗口
│   └── 14-20.jsonl       ← 当前 10 分钟窗口（正在写入）
├── 2026-04-29/
│   └── ...（全部 .jsonl.gz）
└── 2026-04-27/
    └── ...（3D 前的，待删除）
```

每小时 6 个文件（00、10、20、30、40、50），每个文件覆盖 10 分钟窗口。

### 5.2 单文件体积

- 每 10 分钟：150,000/天 ÷ 144 ≈ 1,040 条 × 20KB ≈ 20 MB
- 压缩后：~6 MB

### 5.3 JSONL 每行格式

```json
{
  "id": "uuid-xxx",
  "api_type": "openai",
  "status_code": 200,
  "created_at": "2026-04-30T14:23:45.123Z",
  "client_request": "{ headers: {...}, body: {...} }",
  "upstream_request": "{ url: '...', headers: {...}, body: {...} }",
  "upstream_response": "{ statusCode: 200, headers: {...}, body: '...' }",
  "stream_text_content": "...",
  "pipeline_snapshot": "[{stage:'enhancement',...}]"
}
```

### 5.4 写入方式

- 写入时：`fs.appendFile()` 追加一行 JSON 到当前窗口的 `.jsonl` 文件
- 不压缩写入，避免 gzip 开销
- 写入失败不影响 DB 写入（文件写入是辅助通道）

### 5.5 压缩任务（每 10 分钟执行）

| 规则 | 动作 |
|------|------|
| `.jsonl` 且窗口已结束（当前时间 > 文件名对应的时间段） | gzip 压缩为 `.jsonl.gz`，删除原 `.jsonl` |

### 5.6 LLM 检索方式

- 失败日志全文：直接 `SELECT` DB（大 TEXT 字段保留）
- 成功日志全文（0.5D 内文件）：`zgrep` 或 `grep` 文件
- 成功日志全文（3D 内文件）：`zgrep` 压缩文件

## 6. 清理机制

### 6.1 DB 清理（已有，微调）

保持现有的 `log_retention_days` 定时清理，删除 3D 前的所有日志记录。

### 6.2 文件清理（新增）

| 规则 | 动作 |
|------|------|
| 目录日期 < 当前日期 - `log_file_retention_days` | 整个目录删除 |

### 6.3 配置项

| key | 默认值 | 说明 |
|-----|--------|------|
| `log_retention_days` | 3 | DB 日志保留天数（已有） |
| `log_file_retention_days` | 3 | 文件保留天数（新增） |
| `detail_log_enabled` | 1 | 是否启用文件写入（新增，0=关，1=开） |

### 6.4 后台任务汇总

| 任务 | 频率 | 职责 |
|------|------|------|
| 日志清理 | 1 小时 | 按 `log_retention_days` 删除 DB 旧记录 |
| DB 大小监控 | 30 分钟 | 按 `db_max_size_mb` 触发额外清理 |
| 文件压缩 | 10 分钟 | 压缩已结束窗口的 `.jsonl` → `.jsonl.gz` |
| 文件清理 | 10 分钟 | 按 `log_file_retention_days` 删除旧目录 |

文件压缩和清理可以合并为一个任务，每 10 分钟执行一次。

## 7. 实现计划概要

### Phase 1：DB 层改造
- 新增 migration：从 `request_logs` 删除 9 个冗余字段
- 修改 `insertRequestLog`：成功日志不写大 TEXT 字段
- 修改日志查询 SQL：加 LEFT JOIN `request_metrics`
- 新增 `shouldPreserveDetail()` 判定函数

### Phase 2：文件写入层
- 新增 `src/storage/log-file-writer.ts`：JSONL 文件写入器
- 在 `insertSuccessLog` / `insertRejectedLog` 中并行调用文件写入
- 新增 `src/storage/log-file-compressor.ts`：定时压缩 + 清理任务

### Phase 3：前端适配
- 修改日志列表/详情 API：SQL 加 JOIN
- 成功日志详情页：大 TEXT 区域适配空值

### Phase 4：配置 & 集成
- 新增 `detail_log_enabled`、`log_file_retention_days` 配置项
- 在 `buildApp()` 中注册文件写入器和压缩任务
