# 上游请求自动重试设计

## 背景

对 dev 环境 460 条请求日志分析，25 条非 200（错误率 5.4%），其中多类错误可通过自动重试消除客户端感知。

### 错误分布

| 状态码 | 数量 | 原因 | 可重试 |
|--------|------|------|--------|
| 429 | 8 | 上游限流 ("该模型当前访问量过大") | 是 |
| 401 | 10 | 上游认证失败 | 否 |
| 502 (ETIMEDOUT) | 1 | 网络连接超时 | 是 |
| 502 (代码bug) | 4 | `httpRequestParam is not defined` | 否（修代码） |
| 301 | 2 | KIMI base_url 缺尾部斜杠 | 否（修配置） |
| 400 | 1 | "网络错误，请稍后重试" code=1234 | 是 |
| 400 | 1 | "模型不存在" code=1211 | 否 |

## 设计

### 可重试错误分类

| 错误类型 | 判定条件 | 退避策略 | 最大重试 |
|---------|---------|---------|---------|
| 429 Rate Limit | statusCode===429 | 指数退避 1s/2s/4s | 3 次 |
| 502 网络错误 | catch: ETIMEDOUT/ECONNRESET/ECONNREFUSED | 固定 1s | 2 次 |
| 400 临时网络错误 | statusCode===400 且 body.error.code==="1234" 或 body.error.message 含 "请稍后重试" | 指数退避 1s/2s | 2 次 |
| 503 Service Unavailable | statusCode===503 | 指数退避 1s/2s/4s | 3 次 |

### 流式 vs 非流式

**非流式**：完全透明。上游返回完整响应后判断是否重试，此时未向客户端发送任何数据。

**流式**：仅在上游响应头到达但 SSE 数据未发送给客户端时可重试。当前 `proxyStream` 中非 200 路径（proxy-core.ts:211-224）不写 reply，所以安全。约束：
- `statusCode !== 200` 时才考虑重试
- `reply.sent === false`（防御性检查）
- 重试用尽后返回最后一次错误

### 实现结构

**新增 `src/proxy/retry.ts`**：
- `RetryConfig`: `{ maxRetries, retryableStatuses, isRetryableBody?, backoffMs }`
- `retryableCall(fn, config)`: 包装代理调用，检查结果决定是否重试
- `isRetryableError(statusCode, body?)`: 判定逻辑
- `sleep(ms)`: 退避等待

**修改 `src/proxy/anthropic.ts` 和 `src/proxy/openai.ts`**：
- try 块内用 `retryableCall()` 包装 `proxyNonStream` / `proxyStream` 调用
- proxy-core.ts 不改

**环境变量**：
- `RETRY_MAX_ATTEMPTS`（默认 3）
- `RETRY_BASE_DELAY_MS`（默认 1000）

### 日志策略

- 重试成功：只记录最终成功的日志
- 全部失败：记录最后一次失败日志，`error_message` 前缀 `"retried N times"`

### 不改动的部分

- proxy-core.ts、数据库 schema、前端
