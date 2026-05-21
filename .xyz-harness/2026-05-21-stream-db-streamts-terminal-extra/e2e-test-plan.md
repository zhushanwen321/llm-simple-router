---
verdict: pass
---

# E2E Test Plan — runtime diagnostic data persistence

## Test Scenarios

### TS1: transport_kind 完整枚举覆盖 (AC1)

| 场景 | 输入 | 期望 transport_kind |
|------|------|-------------------|
| 非流式成功 | POST /v1/chat/completions, stream=false, 上游 200 | success |
| 流式成功 | POST /v1/chat/completions, stream=true, 上游 200 SSE | stream_success |
| 非流式错误 | POST /v1/chat/completions, stream=false, 上游 500 | error |
| 流式错误状态码 | POST /v1/chat/completions, stream=true, 上游 500 | stream_error |
| 上游连接拒绝 | POST /v1/chat/completions, 上游 ECONNREFUSED | throw |
| 流式 abort (timeout) | POST /v1/chat/completions, stream=true, 超时触发 | stream_abort |

### TS2: abort_reason 三种触发路径 (AC2)

| 场景 | 触发方式 | 期望 abort_reason |
|------|----------|-----------------|
| idle timeout | mock 上游不响应，设置短超时 | idle_timeout |
| client disconnect | 请求发起后立即 abort | client_disconnect |
| loop detection | mock 上游返回循环 pattern | loop_detection |
| 非 abort | 正常流式请求 | NULL |

### TS3: error_code / headers_sent (AC3, AC4)

| 场景 | 期望 error_code | 期望 headers_sent |
|------|---------------|-----------------|
| 上游 ETIMEDOUT | ETIMEDOUT | NULL |
| 流式 headers 已发后出错 | NULL | 1 |
| 请求在 headers 前失败 | NULL | 0 |
| 正常成功 | NULL | NULL |

### TS4: resilience decision (AC5)

| 场景 | 期望 resilience_action | 期望 resilience_reason |
|------|---------------------|---------------------|
| 触发重试 | retry | 非空 |
| 触发 failover | failover | 非空 |
| 无需重试成功 | NULL | NULL |

### TS5: mapping_reason (AC6)

| 场景 | 期望 mapping_reason |
|------|-------------------|
| 直接格式匹配 | direct_format |
| 映射组基础规则 | group_base_rule |
| 溢出重定向 | overflow_redirect |
| failover 重试 | failover_retry |

### TS6: failover_trigger (AC7)

| 场景 | 期望 failover_trigger |
|------|---------------------|
| ProviderSwitchNeeded 触发 | ProviderSwitchNeeded |
| 正常请求无 failover | NULL |

### TS7: 模型超时 UI (AC8)

| 场景 | 操作 | 期望 |
|------|------|------|
| 未配置超时的模型 | 打开 Provider 编辑页 | 超时输入框显示为空 |
| 已配置超时 30s | 打开 Provider 编辑页 | 输入框显示 30 |
| 修改超时值 | 输入 60 → 保存 → 重新加载 | 显示 60 |
| 快速配置页未配置超时 | 打开快速配置页 | 超时输入框显示为空 |

## Test Environment

- 后端：`buildTestApp()` + 内存 SQLite + mock HTTP server
- 前端：手动验证（dev server + 浏览器）或 Playwright
- 数据验证：直接查询 `request_logs` 表断言新字段值
