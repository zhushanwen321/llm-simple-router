---
verdict: pass
---

# E2E Test Plan — retry-rule-upgrade

## Test Scenarios

### Scenario 1: Provider 隔离匹配 (AC1)

**覆盖 AC:** AC1

**前置条件:**
- 创建通用规则：status_code=429, body_pattern=`"rate_limit_error"`, max_retries=2
- 创建绑定规则：provider_id=kimi, status_code=429, body_matchers=`[{"path":"error.type","operator":"equals","value":"rate_limit_error"}]`, max_retries=0

**步骤:**
1. 向 kimi provider 发送请求，触发 429 + `{"error":{"type":"rate_limit_error"}}`
2. 验证：不触发重试（绑定规则 max_retries=0），客户端立即收到 429
3. 向 deepseek provider 发送请求，触发 429 + `{"error":{"type":"rate_limit_error"}}`
4. 验证：触发通用规则，重试 2 次

### Scenario 2: JSON 字段匹配 (AC2)

**覆盖 AC:** AC2

**前置条件:**
- 创建规则：body_matchers=`[{"path":"error.type","operator":"contains","value":"rate_limit"},{"path":"type","operator":"equals","value":"error"}]`

**步骤:**
1. 发送 JSON body `{"error":{"type":"rate_limit_error"},"type":"error"}` → 匹配
2. 发送 JSON body `{"error":{"type":"auth_error"},"type":"error"}` → 不匹配（contains 不满足）
3. 发送非 JSON body `Rate limit exceeded` → 不匹配（JSON parse 失败）
4. 发送 JSON body `{"error":{"type":"rate_limit_error"}}` → 不匹配（第二个条件不满足）

### Scenario 3: 429 usage-limit 修复 (AC3)

**覆盖 AC:** AC3

**前置条件:**
- 为 kimi 绑定规则：max_retries=0（不重试 usage-limit）
- 删除或修改旧的通用 rate_limit_error 规则

**步骤:**
1. 向 kimi 发送请求触发 429 usage-limit
2. 验证：客户端在 5 秒内收到 429 响应（不等待 7 分钟）
3. 检查 request_logs：只有 1 次 attempt

### Scenario 4: stream_error 响应返回 (AC4)

**覆盖 AC:** AC4

**前置条件:**
- 配置 kimi provider，stream=true
- 不配置任何重试规则（或配置 max_retries=0 的绑定规则）

**步骤:**
1. 向 kimi 发送流式请求，上游在 SSE 开始前返回 429
2. 验证：客户端收到 JSON 格式错误响应（非 SSE 格式）
3. 检查 request_logs：client_status_code = 429

### Scenario 5: upstream_error_logs 写入 (AC5)

**覆盖 AC:** AC5

**前置条件:**
- 正常配置的 provider

**步骤:**
1. 触发一个最终失败的请求（status >= 400，重试耗尽）
2. 查询 upstream_error_logs 表
3. 验证：provider_id、status_code、error_type、error_message、retry_count 正确

### Scenario 6: 向后兼容 (AC8)

**覆盖 AC:** AC8

**前置条件:**
- 保留现有规则（provider_id=NULL, body_matchers=NULL）

**步骤:**
1. 发送匹配现有规则的请求
2. 验证：行为与升级前一致（正则匹配正常工作）
3. 调用现有 API（不传新字段）创建规则
4. 验证：创建成功，provider_id=NULL, body_matchers=NULL

## Test Environment

- **测试框架:** Vitest (单元/集成) + Fastify inject (HTTP 模拟)
- **数据库:** SQLite :memory: (测试隔离)
- **Mock 后端:** http.createServer 模拟上游响应
- **前端:** 组件测试（不需要 E2E 浏览器）
