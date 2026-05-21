---
verdict: pass
---

# 运行时诊断数据持久化 + 模型超时 UI 修复

## Background

代理层在运行时区分了多种请求结果类型、触发原因和决策信息，但这些数据未持久化到数据库。导致：

- **P1 基础分类维度缺失**: `TransportResult.kind`（6 种结果类型）和 `stream_abort` 的 3 种触发原因（idle timeout / client disconnect / loop detection）未写入 DB。`stream_success` 和 `stream_abort` 的 status_code 都是 200，DB 中完全不可区分。
- **P2 重试/故障诊断信息丢失**: `error.code`（ETIMEDOUT 等）、`headersSent` 标志、resilience decision（action + reason）未记录。
- **P3 有数据但不可查询**: `mapping_reason` 和 `failover_trigger` 埋在 JSON 列中，无法建索引、无法 WHERE 过滤。

此外，前端模型级 `stream_timeout_ms` 配置存在 UI 缺陷：`ModelCard.vue` 中 `v-if="streamTimeoutMs !== undefined"` 导致未配置超时的模型不显示超时输入框。

## Functional Requirements

### FR1: TransportResult.kind 持久化 (P1-#1)

在 `request_logs` 表新增 `transport_kind TEXT NULL` 列，存储 `TransportResult.kind` 的值：`success` / `stream_success` / `stream_error` / `stream_abort` / `error` / `throw`。

写入点：`logResilienceResult()` → `insertRequestLog()`。

### FR2: stream_abort 触发原因持久化 (P1-#2)

在 `request_logs` 表新增 `abort_reason TEXT NULL` 列。当 `transport_kind = "stream_abort"` 时存储触发原因：
- `"idle_timeout"` — 超时触发，携带 timeoutMs
- `"client_disconnect"` — 客户端断连
- `"loop_detection"` — 循环检测

写入点：`StreamProxy` 三条 abort 路径将 reason 传入 `TransportResult`，再到 `logResilienceResult()`。

### FR3: error.code 持久化 (P2-#3)

在 `request_logs` 表新增 `error_code TEXT NULL` 列，存储 `error.code`（如 `ETIMEDOUT` / `ECONNRESET` / `ECONNREFUSED`）。

写入点：`resilience.ts` 中 `ResilienceAttempt` 类型新增 `error_code` 字段，`decide()` 时填充。

### FR4: headersSent 持久化 (P2-#4)

在 `request_logs` 表新增 `headers_sent INTEGER NULL` 列（0/1），存储 response headers 是否已发送。

写入点：`resilience.ts` 中 `ResilienceAttempt` 类型新增 `headers_sent` 字段。

### FR5: resilience decision 持久化 (P2-#5)

在 `request_logs` 表新增两列：
- `resilience_action TEXT NULL` — 存储 decide() 返回的 action：`retry` / `failover` / `abort` / `done`
- `resilience_reason TEXT NULL` — 存储 decide() 返回的 reason 文本

写入点：`resilience.ts` 的 `decide()` 返回值传递到 `failover-loop.ts` → `logResilienceResult()`。

### FR6: mapping_reason 独立列 (P3-#6)

在 `request_logs` 表新增 `mapping_reason TEXT NULL` 列，提取映射解析原因。

枚举值来源：`mapping-resolver.ts` 中 `MappingResult.reason` 字段，实际枚举值需在实现阶段从代码中确认（当前已知：`direct_format` / `group_base_rule` / `overflow_redirect` / `failover_retry`）。spec 阶段不锁定枚举，以代码实际返回值为准。

写入点：`mapping-resolver.ts` 返回值中已包含 reason，在 `failover-loop.ts` 中提取并传递。

### FR7: failover 触发原因独立列 (P3-#7)

在 `request_logs` 表新增 `failover_trigger TEXT NULL` 列，存储 failover 触发的错误类型。

提取机制：`failover-loop.ts` catch 块中，对自定义 Error 类使用 `error.constructor.name`（如 `ProviderSwitchNeeded`），对系统 Error（如 `ETIMEDOUT`）使用 `error.code`。当 error 无明确类型名时存 `null`。

写入点：`failover-loop.ts` catch 这些错误时提取并存入日志字段。

### FR8: 模型级 stream_timeout_ms UI 修复

修复 `ModelCard.vue` 中 `v-if="streamTimeoutMs !== undefined"` 条件，使未配置超时的模型也显示超时输入框（显示为空）。影响两个页面：
- Provider 编辑页面（Providers.vue → ModelCapabilitiesEditor.vue → ModelCard.vue）
- 快速配置页面（QuickSetup.vue → ModelCard.vue）

## Acceptance Criteria

### AC1: transport_kind 写入验证
- 发送流式请求成功 → DB 中 `transport_kind = "stream_success"`
- 发送非流式请求成功 → DB 中 `transport_kind = "success"`
- 上游超时触发 abort → DB 中 `transport_kind = "stream_abort"`
- 上游流式返回错误状态码（如 500）→ DB 中 `transport_kind = "stream_error"`
- 非流式请求上游返回错误 → DB 中 `transport_kind = "error"`
- 请求抛出异常（如连接拒绝）→ DB 中 `transport_kind = "throw"`

### AC2: abort_reason 写入验证
- idle timeout 触发 → DB 中 `abort_reason = "idle_timeout"`
- 客户端断连 → DB 中 `abort_reason = "client_disconnect"`
- 循环检测触发 → DB 中 `abort_reason = "loop_detection"`
- 非 abort 请求 → DB 中 `abort_reason IS NULL`

### AC3: error_code 写入验证
- 上游连接超时（ETIMEDOUT）→ DB 中 `error_code = "ETIMEDOUT"`
- 正常成功请求 → DB 中 `error_code IS NULL`

### AC4: headers_sent 写入验证
- 流式传输 headers 已发后出错 → DB 中 `headers_sent = 1`
- 请求在 headers 发送前失败 → DB 中 `headers_sent = 0` 或 `NULL`
- 非流式成功请求 → DB 中 `headers_sent IS NULL`

### AC5: resilience decision 写入验证
- 触发重试 → DB 中 `resilience_action = "retry"`，`resilience_reason` 非空
- 触发 failover → DB 中 `resilience_action = "failover"`
- 无需重试成功 → DB 中 `resilience_action IS NULL`

### AC6: mapping_reason 写入验证
- 直接格式匹配 → DB 中 `mapping_reason = "direct_format"`
- 映射组基础规则 → DB 中 `mapping_reason = "group_base_rule"`
- 溢出重定向 → DB 中 `mapping_reason = "overflow_redirect"`
- failover 重试 → DB 中 `mapping_reason = "failover_retry"`

### AC7: failover_trigger 写入验证
- 触发 ProviderSwitchNeeded → DB 中 `failover_trigger = "ProviderSwitchNeeded"`
- 正常请求无 failover → DB 中 `failover_trigger IS NULL`

### AC8: 模型超时 UI 修复验证
- 未配置 stream_timeout_ms 的模型在 Provider 编辑页面显示空超时输入框
- 未配置 stream_timeout_ms 的模型在快速配置页面显示空超时输入框
- 已配置 stream_timeout_ms 的模型正确显示秒数值
- 输入超时值后保存，重新加载后显示正确

## Data Consumer Checklist

CLAUDE.md 要求新增 DB 列时必须列出所有 4 类消费者并逐一验证。

### 1. DB 写入（request_logs INSERT）
| 新列 | 写入函数 | 来源 |
|------|----------|------|
| transport_kind | `insertRequestLog()` via `logResilienceResult()` | TransportResult.kind |
| abort_reason | 同上 | TransportResult.metadata.abort_reason |
| error_code | 同上 | ResilienceAttempt.error_code |
| headers_sent | 同上 | ResilienceAttempt.headers_sent |
| resilience_action | 同上 | resilience decide() 返回值 |
| resilience_reason | 同上 | resilience decide() 返回值 |
| mapping_reason | 同上 | mapping-resolver 返回值 |
| failover_trigger | 同上 | failover-loop catch 错误类型名 |

**验证方式**：`RequestLogInsert` 类型扩展 8 个可选字段，`insertRequestLog()` SQL 已覆盖（使用 `buildUpdateQuery` 白名单模式）。无需新增 SQL 语句。

### 2. SSE 实时监控推送（RequestTracker）
**不在本次范围内**（Out of Scope）。新字段不推送到 SSE 监控。`StreamMetricsSnapshot` 类型不变。

### 3. Admin API 查询（/admin/api/logs）
**不在本次范围内**（Out of Scope）。Admin API 的 `getRequestLogs()` 和 `getRequestLogById()` 已 LEFT JOIN request_metrics，新列在 request_logs 上会自动随 `SELECT *` 返回。但新增过滤参数（如 `?transport_kind=stream_abort`）不在此 PR。

### 4. 前端展示
**不在本次范围内**（Out of Scope）。前端日志页面不展示新字段。仅 FR8（ModelCard UI 修复）涉及前端。

## Constraints

- 所有 8 个新列在 `request_logs` 表上，均为 `NULL`，默认 `NULL`（无数据迁移负担）
- 使用单一 migration 文件添加所有列
- 写入逻辑集中在已有的 `insertRequestLog()` 路径，不新增 SQL 语句
- `ResilienceAttempt` 类型扩展需向后兼容（新字段可选）
- 前端 ModelCard.vue 修改不影响已配置超时值模型的显示
- 现有测试不受影响（新列 nullable，旧测试不涉及这些列）

### Out of Scope

- 前端日志页面展示新字段（后续独立处理）
- 前端监控 SSE 实时推送新字段
- Admin API 查询接口新增过滤参数
- request_metrics 表修改
- 历史数据回填
- `text_duration_ms` / `tool_use_duration_ms` / `text_tps` / `tool_use_tps` 死列清理

## Complexity Assessment

**中等**。8 个 DB 列 + 数据流串联 + 1 个前端 v-if 修复。

- DB 层：1 个 migration，结构简单
- 类型层：`ResilienceAttempt` 扩展，`RequestLogInsert` 扩展
- 后端写入层：`resilience.ts`（3 个字段）、`stream.ts`（2 个字段）、`mapping-resolver.ts`（1 个字段）、`failover-loop.ts`（串联所有字段到 logResilienceResult）—— 约 5 个文件
- 前端：1 个文件（ModelCard.vue）的 v-if 条件修改
- 测试：现有代理测试扩展断言新字段值

**风险点**：`failover-loop.ts` 是串联所有数据流的关键节点，改动需要仔细确保每条路径（success / retry / failover / throw）都正确传递新字段。
