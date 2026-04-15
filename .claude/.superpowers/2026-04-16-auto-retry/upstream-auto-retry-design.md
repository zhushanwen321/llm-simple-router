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
| 429 Rate Limit | statusCode===429 | 指数退避 1s/2s/4s，优先读 Retry-After header | 3 次 |
| 502 网络错误 | throw 且 err.code 为 ETIMEDOUT/ECONNRESET/ECONNREFUSED | 固定 1s | 2 次 |
| 400 临时网络错误 | statusCode===400 且 body.error.code==="1234" 或 body.error.message 含 "请稍后重试" | 指数退避 1s/2s | 2 次 |
| 503 Service Unavailable | statusCode===503 | 指数退避 1s/2s/4s | 3 次 |

400 code=1234 的判定是 provider-specific 的临时方案（ZAI 中间层），未来需按 provider 扩展。

### 流式 vs 非流式

**非流式**：完全透明。上游返回完整响应后判断是否重试，此时未向客户端发送任何数据。

**流式**：仅在上游响应头到达但 SSE 数据未发送给客户端时可重试。当前 `proxyStream` 中非 200 路径（proxy-core.ts:211-224）不写 reply，所以安全。约束：
- `statusCode !== 200` 时才考虑重试
- `reply.raw.headersSent === false`（防御性检查，用底层 raw response 而非 Fastify 的 `reply.sent`）
- 重试用尽后返回最后一次错误

**幂等性假设**：设计假定只在未消耗上游 token 的情况下重试（statusCode !== 200 意味着上游未开始生成）。

### 实现结构

**新增 `src/proxy/retry.ts`**：

```typescript
// retryableCall 包裹的 fn 签名
type ProxyFn = () => Promise<ProxyResult | StreamProxyResult>;

// 返回值携带每次尝试的结果，供调用方记录日志
interface RetryResult<T> {
  result: T;           // 最终结果（成功或最后一次失败）
  attempts: Attempt[];  // 每次尝试的快照
}

interface Attempt {
  attemptIndex: number;   // 0=原始请求, 1=第一次重试...
  statusCode: number | null;
  error: string | null;
  latencyMs: number;
  responseBody: string | null;
}

// 重试判定：同时处理 resolved 和 rejected 情况
function isRetryableResult(statusCode: number, body?: string): boolean;
function isRetryableThrow(err: unknown): boolean;
// err.code 提取：Node.js SystemError 有 .code 属性 ("ETIMEDOUT" 等)

function sleep(ms: number): Promise<void>;
function retryableCall<T>(fn: ProxyFn, config: RetryConfig): Promise<RetryResult<T>>;
```

**RetryConfig 接口**：
```typescript
interface RetryConfig {
  maxRetries: number;          // 全局上限（环境变量覆盖）
  baseDelayMs: number;         // 基础退避时间
  retryableStatuses: Set<number>;  // 可重试的 HTTP 状态码
  isRetryableBody?: (body: string) => boolean;  // body 级判定（400 code=1234）
}
```

各错误类型的 RetryConfig 硬编码在 `retry.ts` 中，环境变量 `RETRY_MAX_ATTEMPTS`（默认 3）和 `RETRY_BASE_DELAY_MS`（默认 1000）作为全局上限。

**修改 `src/proxy/anthropic.ts` 和 `src/proxy/openai.ts`**：

retryableCall 只包裹 proxy 调用本身，不包裹后续的 send/reply 逻辑。调用方在 retry 返回后才执行 send。

流式请求 retry 时需注意 metricsTransform 的生命周期：每次 retry 调用需创建新的 `SSEMetricsTransform` 实例（旧实例可能处于异常状态），因此在 retry 回调内部创建 transform 而非外部。

```typescript
// 伪代码示意
const { result, attempts } = await retryableCall(
  () => {
    // 每次调用都创建新的 metricsTransform
    const metricsTransform = isStream ? new SSEMetricsTransform("anthropic", startTime) : undefined;
    return isStream
      ? proxyStream(provider, apiKey, body, cliHdrs, reply, timeout, path, metricsTransform)
      : proxyNonStream(provider, apiKey, body, cliHdrs, path);
  },
  retryConfig
);
```

**环境变量**：
- `RETRY_MAX_ATTEMPTS`（默认 3）— 全局重试上限
- `RETRY_BASE_DELAY_MS`（默认 1000）— 基础退避毫秒数

### 日志策略

所有尝试都记录日志，通过数据库字段关联。

**数据库变更**：`request_logs` 表新增两个字段：
```sql
ALTER TABLE request_logs ADD COLUMN is_retry INTEGER NOT NULL DEFAULT 0;
ALTER TABLE request_logs ADD COLUMN original_request_id TEXT;
```

- `is_retry`：1 表示这是 router 发起的重试请求，0 表示原始请求
- `original_request_id`：重试请求指向原始请求的 ID（原始请求自身的此字段为 NULL）

**日志行为**：
- 每次尝试（包括原始请求和每次重试）都独立写入 `request_logs`
- 原始请求记录时 `is_retry=0, original_request_id=NULL`
- 重试请求记录时 `is_retry=1, original_request_id=<原始请求ID>`
- 重试成功时，最终成功的请求也作为新行记录（`is_retry=1`）
- 通过 `original_request_id` 可追溯完整的重试链路

### 429 Retry-After

非流式 429 响应的 `ProxyResult.headers` 和流式非 200 的 `StreamProxyResult.upstreamResponseHeaders` 中包含上游 headers。优先读取 `retry-after` header 值（秒数）作为退避时间，退回到指数退避。

### 客户端超时考虑

重试总延迟（如 3 次重试 + 退避 = ~7 秒额外延迟）可能导致客户端超时断开。`retryableCall` 在每次重试前检查 `reply.raw.writableFinished`，若客户端已断开则终止重试，避免浪费上游配额。

### 不改动的部分

- proxy-core.ts
- 前端（后续可按需在日志列表中展示重试链路）
