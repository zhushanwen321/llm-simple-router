# 上游请求自动重试 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在代理层对上游 429/502/503/400(临时网络错误) 做透明重试，减少客户端感知的错误。

**Architecture:** 新增 `retry.ts` 模块封装重试逻辑（判定、退避、结果收集），在 `anthropic.ts`/`openai.ts` 调用层用 `retryableCall()` 包装 proxy 调用。每次尝试独立记录日志，通过 `is_retry` + `original_request_id` 关联重试链路。

**Tech Stack:** TypeScript, Fastify, better-sqlite3, Vitest

**Spec:** `.claude/.superpowers/2026-04-16-auto-retry/upstream-auto-retry-design.md`

---

### Task 1: 数据库迁移 — 新增 is_retry / original_request_id 字段

**Files:**
- Create: `src/db/migrations/007_add_retry_fields.sql`
- Modify: `tests/anthropic-proxy.test.ts:39-55` (test schema)

- [ ] **Step 1: 创建迁移文件**

```sql
-- src/db/migrations/007_add_retry_fields.sql
ALTER TABLE request_logs ADD COLUMN is_retry INTEGER NOT NULL DEFAULT 0;
ALTER TABLE request_logs ADD COLUMN original_request_id TEXT;
```

- [ ] **Step 2: 更新测试中的 createTestDb schema**

在 `tests/anthropic-proxy.test.ts` 和 `tests/openai-proxy.test.ts` 的 `createTestDb()` 中，`request_logs` 表定义末尾新增：

```sql
is_retry INTEGER NOT NULL DEFAULT 0,
original_request_id TEXT
```

同理更新 `tests/logging.test.ts`、`tests/integration.test.ts`、`tests/admin-logs.test.ts`、`tests/db.test.ts`、`tests/metrics.test.ts` 中的 request_logs 表定义。

- [ ] **Step 3: 运行现有测试确认迁移生效**

Run: `npm test`
Expected: 所有测试通过

- [ ] **Step 4: Commit**

```bash
git add src/db/migrations/007_add_retry_fields.sql tests/
git commit -m "feat(db): add is_retry and original_request_id to request_logs"
```

---

### Task 2: 更新 DB 层类型和函数

**Files:**
- Modify: `src/db/index.ts:106-120` (insertRequestLog), `src/db/index.ts:124-140` (RequestLog 接口)
- Modify: `src/proxy/proxy-core.ts:127-152` (insertSuccessLog)

- [ ] **Step 1: 更新 RequestLog 接口**

在 `src/db/index.ts` 的 `RequestLog` 接口（第 124 行）末尾新增：

```typescript
is_retry: number;
original_request_id: string | null;
```

- [ ] **Step 2: 更新 insertRequestLog 参数**

在 `src/db/index.ts` 的 `insertRequestLog` 函数（第 106 行），参数类型新增：

```typescript
is_retry?: number;
original_request_id?: string | null;
```

SQL 语句和 `.run()` 调用追加对应字段：

```sql
INSERT INTO request_logs (id, api_type, model, provider_id, status_code, latency_ms, is_stream,
  error_message, created_at, request_body, response_body, client_request, upstream_request,
  upstream_response, client_response, is_retry, original_request_id)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

```typescript
.run(..., log.is_retry ?? 0, log.original_request_id ?? null);
```

- [ ] **Step 3: 更新 insertSuccessLog（proxy-core.ts）**

`src/proxy/proxy-core.ts` 的 `insertSuccessLog` 函数签名新增 `isRetry` 和 `originalRequestId` 参数：

```typescript
export function insertSuccessLog(
  db: Database.Database, apiType: string, logId: string, model: string,
  provider: Provider, isStream: boolean, startTime: number,
  reqBody: string, clientReq: string, upstreamReq: string,
  status: number, respBody: string | null,
  upHdrs: Record<string, string>, cliHdrs: Record<string, string>,
  isRetry: boolean = false, originalRequestId: string | null = null,
)
```

在内部的 `insertRequestLog` 调用中追加 `is_retry: isRetry ? 1 : 0, original_request_id: originalRequestId`。

- [ ] **Step 4: 运行测试**

Run: `npm test`
Expected: 所有测试通过（新字段有默认值，现有调用不受影响）

- [ ] **Step 5: Commit**

```bash
git add src/db/index.ts src/proxy/proxy-core.ts
git commit -m "feat(db): update insertRequestLog/insertSuccessLog with retry fields"
```

---

### Task 3: 实现 retry.ts 核心模块（TDD）

**Files:**
- Create: `src/proxy/retry.ts`
- Create: `tests/retry.test.ts`

- [ ] **Step 1: 编写 retry.ts 的类型定义和导出**

创建 `src/proxy/retry.ts`，内容包含类型定义和核心函数骨架。注意不要导出仅供内部使用的 `sleep`。

```typescript
import type { ProxyResult, StreamProxyResult } from "./proxy-core.js";
import type { FastifyReply } from "fastify";

// ---------- Types ----------

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  retryableStatuses: Set<number>;
  isRetryableBody?: (body: string) => boolean;
}

export interface Attempt {
  attemptIndex: number;
  statusCode: number | null;
  error: string | null;
  latencyMs: number;
  responseBody: string | null;
}

export interface RetryResult<T> {
  result: T;
  attempts: Attempt[];
}

export type ProxyFn<T = ProxyResult | StreamProxyResult> = () => Promise<T>;

// ---------- Constants ----------

const RETRYABLE_THROW_CODES = new Set(["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED"]);

// ---------- Predicates ----------

export function isRetryableResult(statusCode: number, body?: string, config?: RetryConfig): boolean {
  if (config?.retryableStatuses.has(statusCode)) return true;
  if (statusCode === 400 && body && config?.isRetryableBody?.(body)) return true;
  return false;
}

export function isRetryableThrow(err: unknown): boolean {
  if (err && typeof err === "object" && "code" in err) {
    return RETRYABLE_THROW_CODES.has((err as NodeJS.ErrnoException).code ?? "");
  }
  return false;
}

// ---------- Helpers ----------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBackoffMs(baseDelayMs: number, attempt: number): number {
  return baseDelayMs * Math.pow(2, attempt);
}

function parseRetryAfter(headers: Record<string, string> | undefined): number | null {
  if (!headers) return null;
  const val = headers["retry-after"] ?? headers["Retry-After"];
  if (!val) return null;
  const seconds = parseInt(val, 10);
  return isNaN(seconds) ? null : seconds * 1000;
}

// ---------- Core ----------

export async function retryableCall<T extends ProxyResult | StreamProxyResult>(
  fn: ProxyFn<T>,
  config: RetryConfig,
  reply?: FastifyReply,
): Promise<RetryResult<T>> {
  const attempts: Attempt[] = [];
  let lastResult: T | null = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    const start = Date.now();

    try {
      const result = await fn();
      const elapsed = Date.now() - start;
      const body = "body" in result ? (result as ProxyResult).body : (result as StreamProxyResult).responseBody ?? null;

      attempts.push({
        attemptIndex: attempt,
        statusCode: result.statusCode,
        error: null,
        latencyMs: elapsed,
        responseBody: body,
      });

      // 成功或不可重试状态码 → 返回
      if (result.statusCode < 400 || !isRetryableResult(result.statusCode, body ?? undefined, config)) {
        return { result, attempts };
      }

      lastResult = result;

      // 重试前检查是否还有配额，以及客户端是否已断开
      if (attempt < config.maxRetries) {
        if (reply && (reply.raw.writableFinished || reply.raw.headersSent)) break;

        // 429 优先用 Retry-After header
        const headers = "headers" in result
          ? (result as ProxyResult).headers
          : (result as StreamProxyResult).upstreamResponseHeaders;
        const retryAfterMs = result.statusCode === 429 ? parseRetryAfter(headers) : null;
        const delay = retryAfterMs ?? getBackoffMs(config.baseDelayMs, attempt);
        await sleep(delay);
      }
    } catch (err: unknown) {
      const elapsed = Date.now() - start;
      const errMsg = err instanceof Error ? err.message : String(err);

      attempts.push({
        attemptIndex: attempt,
        statusCode: null,
        error: errMsg,
        latencyMs: elapsed,
        responseBody: null,
      });

      // 不可重试的 throw → 直接抛出
      if (!isRetryableThrow(err)) throw err;

      if (attempt < config.maxRetries) {
        if (reply && (reply.raw.writableFinished || reply.raw.headersSent)) throw err;
        await sleep(config.baseDelayMs);
      }

      // 将 throw 转为 502 ProxyResult 供后续日志记录
      // 但最后一次仍需 throw 让调用方 catch 处理
      if (attempt === config.maxRetries) throw err;
    }
  }

  // 所有用尽，返回最后一次结果
  return { result: lastResult!, attempts };
}
```

- [ ] **Step 2: 编写测试 tests/retry.test.ts**

```typescript
import { describe, it, expect } from "vitest";
import { isRetryableResult, isRetryableThrow, retryableCall } from "../src/proxy/retry.js";
import type { RetryConfig, ProxyFn, ProxyResult } from "../src/proxy/retry.js";
import { ProxyResult } from "../src/proxy/proxy-core.js";

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 2,
  baseDelayMs: 10, // 测试用短延迟
  retryableStatuses: new Set([429, 503]),
  isRetryableBody: (body: string) => {
    try {
      const parsed = JSON.parse(body);
      return parsed?.error?.code === "1234" || (parsed?.error?.message?.includes("请稍后重试") ?? false);
    } catch { return false; }
  },
};

describe("isRetryableResult", () => {
  it("should return true for 429", () => {
    expect(isRetryableResult(429, undefined, DEFAULT_CONFIG)).toBe(true);
  });

  it("should return true for 503", () => {
    expect(isRetryableResult(503, undefined, DEFAULT_CONFIG)).toBe(true);
  });

  it("should return false for 200", () => {
    expect(isRetryableResult(200, undefined, DEFAULT_CONFIG)).toBe(false);
  });

  it("should return false for 401", () => {
    expect(isRetryableResult(401, undefined, DEFAULT_CONFIG)).toBe(false);
  });

  it("should return true for 400 with retryable body (code=1234)", () => {
    const body = JSON.stringify({ error: { code: "1234", message: "网络错误" } });
    expect(isRetryableResult(400, body, DEFAULT_CONFIG)).toBe(true);
  });

  it("should return true for 400 with retryable body (请稍后重试)", () => {
    const body = JSON.stringify({ error: { code: "9999", message: "网络错误，请稍后重试" } });
    expect(isRetryableResult(400, body, DEFAULT_CONFIG)).toBe(true);
  });

  it("should return false for 400 with non-retryable body", () => {
    const body = JSON.stringify({ error: { code: "1211", message: "模型不存在" } });
    expect(isRetryableResult(400, body, DEFAULT_CONFIG)).toBe(false);
  });

  it("should return false for 400 without config", () => {
    const body = JSON.stringify({ error: { code: "1234" } });
    expect(isRetryableResult(400, body)).toBe(false);
  });
});

describe("isRetryableThrow", () => {
  it("should return true for ETIMEDOUT", () => {
    const err = new Error("timeout") as NodeJS.ErrnoException;
    err.code = "ETIMEDOUT";
    expect(isRetryableThrow(err)).toBe(true);
  });

  it("should return true for ECONNRESET", () => {
    const err = new Error("reset") as NodeJS.ErrnoException;
    err.code = "ECONNRESET";
    expect(isRetryableThrow(err)).toBe(true);
  });

  it("should return true for ECONNREFUSED", () => {
    const err = new Error("refused") as NodeJS.ErrnoException;
    err.code = "ECONNREFUSED";
    expect(isRetryableThrow(err)).toBe(true);
  });

  it("should return false for regular Error", () => {
    expect(isRetryableThrow(new Error("something"))).toBe(false);
  });

  it("should return false for non-Error", () => {
    expect(isRetryableThrow("string error")).toBe(false);
  });
});

describe("retryableCall", () => {
  const mockProxyResult = (statusCode: number, body: string = ""): import("../src/proxy/proxy-core.js").ProxyResult => ({
    statusCode,
    body,
    headers: {},
    sentHeaders: {},
    sentBody: "",
  });

  it("should return immediately on success (200)", async () => {
    const fn = () => Promise.resolve(mockProxyResult(200));
    const { result, attempts } = await retryableCall(fn, DEFAULT_CONFIG);
    expect(result.statusCode).toBe(200);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].attemptIndex).toBe(0);
  });

  it("should retry on 429 and return last result if all fail", async () => {
    const fn = () => Promise.resolve(mockProxyResult(429, '{"error":"rate limit"}'));
    const { result, attempts } = await retryableCall(fn, DEFAULT_CONFIG);
    expect(result.statusCode).toBe(429);
    expect(attempts).toHaveLength(3); // 1 original + 2 retries
  });

  it("should return success after retry", async () => {
    let callCount = 0;
    const fn = () => {
      callCount++;
      if (callCount === 1) return Promise.resolve(mockProxyResult(429));
      return Promise.resolve(mockProxyResult(200, '{"ok":true}'));
    };
    const { result, attempts } = await retryableCall(fn, DEFAULT_CONFIG);
    expect(result.statusCode).toBe(200);
    expect(attempts).toHaveLength(2);
    expect(attempts[0].statusCode).toBe(429);
    expect(attempts[1].statusCode).toBe(200);
  });

  it("should retry on retryable throw (ETIMEDOUT)", async () => {
    let callCount = 0;
    const fn = () => {
      callCount++;
      if (callCount === 1) {
        const err = new Error("timeout") as NodeJS.ErrnoException;
        err.code = "ETIMEDOUT";
        return Promise.reject(err);
      }
      return Promise.resolve(mockProxyResult(200));
    };
    const { result, attempts } = await retryableCall(fn, DEFAULT_CONFIG);
    expect(result.statusCode).toBe(200);
    expect(attempts).toHaveLength(2);
    expect(attempts[0].statusCode).toBeNull();
    expect(attempts[0].error).toBe("timeout");
  });

  it("should throw immediately on non-retryable throw", async () => {
    const fn = () => Promise.reject(new Error("unknown"));
    await expect(retryableCall(fn, DEFAULT_CONFIG)).rejects.toThrow("unknown");
  });

  it("should throw on non-retryable status code (401)", async () => {
    const fn = () => Promise.resolve(mockProxyResult(401));
    const { result, attempts } = await retryableCall(fn, DEFAULT_CONFIG);
    expect(result.statusCode).toBe(401);
    expect(attempts).toHaveLength(1);
  });
});
```

- [ ] **Step 3: 运行测试，确认全部通过**

Run: `npx vitest run tests/retry.test.ts`
Expected: 全部通过

- [ ] **Step 4: Commit**

```bash
git add src/proxy/retry.ts tests/retry.test.ts
git commit -m "feat(proxy): add retry module with retryableCall, predicates, and tests"
```

---

### Task 4: 更新 config 和 app 入口，注入重试配置

**Files:**
- Modify: `src/config.ts` (新增 Config 字段)
- Modify: `src/index.ts:48-57` (传递给 proxy 插件)

- [ ] **Step 1: 更新 Config 接口和 getConfig**

在 `src/config.ts` 的 `Config` 接口新增：

```typescript
RETRY_MAX_ATTEMPTS: number;
RETRY_BASE_DELAY_MS: number;
```

在 `getConfig()` 返回对象中新增：

```typescript
RETRY_MAX_ATTEMPTS: parseInt(process.env.RETRY_MAX_ATTEMPTS || "3", 10),
RETRY_BASE_DELAY_MS: parseInt(process.env.RETRY_BASE_DELAY_MS || "1000", 10),
```

- [ ] **Step 2: 更新 proxy 插件注册，传递 retry 配置**

`src/index.ts` 中 openaiProxy 和 anthropicProxy 的注册选项新增：

```typescript
app.register(openaiProxy, {
  db,
  encryptionKey: config.ENCRYPTION_KEY,
  streamTimeoutMs: config.STREAM_TIMEOUT_MS,
  retryMaxAttempts: config.RETRY_MAX_ATTEMPTS,
  retryBaseDelayMs: config.RETRY_BASE_DELAY_MS,
});
```

同理 anthropicProxy。

- [ ] **Step 3: 更新 .env.example**

新增：
```
RETRY_MAX_ATTEMPTS=3
RETRY_BASE_DELAY_MS=1000
```

- [ ] **Step 4: 更新测试中的 buildTestApp 调用**

在 `tests/anthropic-proxy.test.ts` 和 `tests/openai-proxy.test.ts` 的 `buildTestApp` 中，注册选项新增 `retryMaxAttempts: 0`（测试中默认不重试，保持现有行为）。

- [ ] **Step 5: 运行测试**

Run: `npm test`
Expected: 全部通过

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/index.ts .env.example tests/
git commit -m "feat(config): add RETRY_MAX_ATTEMPTS and RETRY_BASE_DELAY_MS env vars"
```

---

### Task 5: 在 anthropic.ts 中集成重试逻辑

**Files:**
- Modify: `src/proxy/anthropic.ts:16-20` (接口), `src/proxy/anthropic.ts:59-105` (try 块)

- [ ] **Step 1: 更新 AnthropicProxyOptions 接口**

在 `src/proxy/anthropic.ts` 的 `AnthropicProxyOptions` 新增：

```typescript
retryMaxAttempts: number;
retryBaseDelayMs: number;
```

在插件函数中解构：`const { db, encryptionKey, streamTimeoutMs, retryMaxAttempts, retryBaseDelayMs } = opts;`

- [ ] **Step 2: 导入 retry 模块**

在 `src/proxy/anthropic.ts` 顶部导入：

```typescript
import { retryableCall, isRetryableResult, type RetryConfig } from "./retry.js";
```

构建 RetryConfig 常量（在插件函数外或内）：

```typescript
// ZAI 中间层的 400 临时网络错误判定
function isRetryable400Body(body: string): boolean {
  try {
    const parsed = JSON.parse(body);
    const err = parsed?.error ?? parsed?.type === "error" ? parsed.error : null;
    if (!err) return false;
    return err.code === "1234" || (err.message?.includes("请稍后重试") ?? false);
  } catch { return false; }
}

function buildRetryConfig(maxRetries: number, baseDelayMs: number): RetryConfig {
  return {
    maxRetries,
    baseDelayMs,
    retryableStatuses: new Set([429, 503]),
    isRetryableBody: isRetryable400Body,
  };
}
```

- [ ] **Step 3: 改写 try 块中的代理调用**

将当前的直接调用改为 retryableCall 包装。注意 metricsTransform 在每次重试时需新建。

非流式路径：

```typescript
const retryConfig = buildRetryConfig(retryMaxAttempts, retryBaseDelayMs);
const { result: r, attempts } = await retryableCall(
  () => proxyNonStream(provider, apiKey, body, cliHdrs, MESSAGES_PATH),
  retryConfig,
);
```

流式路径：

```typescript
const { result: r, attempts } = await retryableCall(
  () => {
    const metricsTransform = new SSEMetricsTransform("anthropic", startTime);
    return proxyStream(provider, apiKey, body, cliHdrs, reply, streamTimeoutMs, MESSAGES_PATH, metricsTransform);
  },
  retryConfig,
  reply,
);
```

- [ ] **Step 4: 更新日志记录逻辑**

遍历 `attempts` 数组，为每次尝试记录独立日志：

```typescript
// 原始请求的 logId 已在函数开头生成
for (const attempt of attempts) {
  const isOriginal = attempt.attemptIndex === 0;
  const attemptLogId = isOriginal ? logId : randomUUID();

  if (attempt.error) {
    // throw 场景
    insertRequestLog(db, {
      id: attemptLogId, api_type: "anthropic", model: clientModel, provider_id: provider.id,
      status_code: 502, latency_ms: attempt.latencyMs,
      is_stream: isStream ? 1 : 0, error_message: attempt.error,
      created_at: new Date().toISOString(), request_body: reqBodyStr,
      client_request: clientReq, upstream_request: upstreamReq,
      is_retry: isOriginal ? 0 : 1, original_request_id: isOriginal ? null : logId,
    });
  } else if (attempt.statusCode !== 200) {
    // 非200 resolved 场景
    insertRequestLog(db, {
      id: attemptLogId, api_type: "anthropic", model: clientModel, provider_id: provider.id,
      status_code: attempt.statusCode, latency_ms: attempt.latencyMs,
      is_stream: isStream ? 1 : 0, error_message: null,
      created_at: new Date().toISOString(), request_body: reqBodyStr,
      response_body: attempt.responseBody, client_request: clientReq,
      upstream_request: upstreamReq, is_retry: isOriginal ? 0 : 1,
      original_request_id: isOriginal ? null : logId,
    });
  } else {
    // 最终成功的请求
    insertSuccessLog(db, "anthropic", attemptLogId, clientModel, provider, isStream, startTime,
      reqBodyStr, clientReq, upstreamReq, r.statusCode, attempt.responseBody, h, h,
      !isOriginal, isOriginal ? null : logId);
  }
}
```

注意：`upstreamReq` 的构建需要移到 retry 之前（它不随尝试变化），但 sentHeaders 会变。对于日志精确度，简化处理：upstreamReq 在每次尝试时记录实际发送的 headers。由于 retryableCall 内部已返回每个 attempt 的结果，可以在 attempts 中记录更精确的信息。

实际实现时需注意：`upstreamReq` 的 sentHeaders 在 `proxyNonStream` 返回的 `ProxyResult.sentHeaders` 中，而 `proxyStream` 返回的 `StreamProxyResult.sentHeaders` 中。但 `Attempt` 接口目前只记录了 statusCode/error/latencyMs/responseBody。可以扩展 `Attempt` 以携带更多上下文，或简化为统一使用函数开头的 headers。

**简化方案**：upstreamReq 使用函数开头构建的统一版本（包含 base_url 和 request body），只有 headers 部分不完全精确但对排查足够。这样避免过度扩展 Attempt 接口。

- [ ] **Step 5: 更新 catch 块**

catch 块现在只处理 retryableCall 本身 throw 的不可重试错误。如果 `retryMaxAttempts === 0`，行为与改动前完全一致（无重试）。

```typescript
} catch (err: unknown) {
  // 不可重试的网络错误或 retry 用尽后的 throw
  const errMsg = err instanceof Error ? err.message : String(err);
  const sentH = buildUpstreamHeaders(cliHdrs, apiKey, Buffer.byteLength(reqBodyStr));
  const upstreamReq = JSON.stringify({ url: `${provider.base_url}${MESSAGES_PATH}`, headers: sentH, body: reqBodyStr });
  insertRequestLog(db, {
    id: logId, api_type: "anthropic", model: clientModel, provider_id: provider.id,
    status_code: HTTP_BAD_GATEWAY, latency_ms: Date.now() - startTime,
    is_stream: isStream ? 1 : 0, error_message: errMsg || "Upstream connection failed",
    created_at: new Date().toISOString(), request_body: reqBodyStr,
    client_request: clientReq, upstream_request: upstreamReq,
  });
  return sendError(reply, anthropicError("Failed to connect to upstream service", "upstream_error", HTTP_BAD_GATEWAY));
}
```

- [ ] **Step 6: 运行测试**

Run: `npx vitest run tests/anthropic-proxy.test.ts`
Expected: 全部通过（retryMaxAttempts=0 时行为不变）

- [ ] **Step 7: Commit**

```bash
git add src/proxy/anthropic.ts
git commit -m "feat(proxy): integrate retry logic in anthropic proxy"
```

---

### Task 6: 在 openai.ts 中集成重试逻辑

**Files:**
- Modify: `src/proxy/openai.ts:17-21` (接口), `src/proxy/openai.ts:67-113` (try 块)

与 Task 5 完全对称的结构：

- [ ] **Step 1: 更新 OpenaiProxyOptions 接口**

新增 `retryMaxAttempts` 和 `retryBaseDelayMs`，解构到插件函数中。

- [ ] **Step 2: 导入 retry 模块，复用 buildRetryConfig / isRetryable400Body**

考虑将 `buildRetryConfig` 和 `isRetryable400Body` 提取到 `retry.ts` 中导出，避免在两个文件中重复。

- [ ] **Step 3: 改写 try 块中的代理调用**

与 Task 5 对称，替换为 `retryableCall` 包装。

- [ ] **Step 4: 更新日志记录逻辑**

与 Task 5 对称，遍历 attempts 记录每次尝试。

- [ ] **Step 5: 运行测试**

Run: `npx vitest run tests/openai-proxy.test.ts`
Expected: 全部通过

- [ ] **Step 6: Commit**

```bash
git add src/proxy/openai.ts
git commit -m "feat(proxy): integrate retry logic in openai proxy"
```

---

### Task 7: 编写重试集成测试

**Files:**
- Create: `tests/retry-integration.test.ts`

- [ ] **Step 1: 编写集成测试**

测试完整的重试流程：mock 后端先返回 429/502，然后返回 200，验证客户端收到 200 且日志中记录了多次尝试。

```typescript
import { describe, it, expect, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { createServer, Server } from "http";
import Database from "better-sqlite3";
import { encrypt } from "../src/utils/crypto.js";
import { anthropicProxy } from "../src/proxy/anthropic.js";

// 复用 anthropic-proxy.test.ts 的 createTestDb, createMockBackend, closeServer
// ...

describe("Retry integration", () => {
  let app: FastifyInstance;
  let mockDb: Database.Database;

  afterEach(async () => {
    if (app) await app.close();
    if (mockDb) mockDb.close();
  });

  it("should retry on 429 and succeed on second attempt", async () => {
    let callCount = 0;
    const { server, port } = await createMockBackend((req, res) => {
      callCount++;
      if (callCount === 1) {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "Too many requests" } }));
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "msg_test", type: "message", role: "assistant", content: [{ type: "text", text: "OK" }], model: "test", stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }));
      }
    });

    mockDb = createTestDb();
    insertMockBackend(mockDb, `http://127.0.0.1:${port}`);
    insertModelMapping(mockDb, "sonnet", "test-model");

    app = Fastify();
    app.register(anthropicProxy, {
      db: mockDb, encryptionKey: TEST_ENCRYPTION_KEY,
      streamTimeoutMs: 5000, retryMaxAttempts: 2, retryBaseDelayMs: 10,
    });

    const response = await app.inject({
      method: "POST", url: "/v1/messages",
      headers: { "content-type": "application/json" },
      payload: { model: "sonnet", messages: [{ role: "user", content: "Hi" }], max_tokens: 100 },
    });

    expect(response.statusCode).toBe(200);
    expect(callCount).toBe(2);

    // 验证日志中有 2 条记录
    const logs = mockDb.prepare("SELECT * FROM request_logs ORDER BY created_at").all();
    expect(logs).toHaveLength(2);
    expect(logs[0].is_retry).toBe(0);
    expect(logs[0].status_code).toBe(429);
    expect(logs[1].is_retry).toBe(1);
    expect(logs[1].original_request_id).toBe(logs[0].id);
    expect(logs[1].status_code).toBe(200);

    await closeServer(server);
  });

  it("should retry on ETIMEDOUT and succeed", async () => {
    // 使用一个不可达端口模拟超时，第二次用一个正常的 mock server
    // 或者：第一个 mock 立即关闭连接触发 ECONNRESET
    // ...
  });
});
```

- [ ] **Step 2: 运行测试**

Run: `npx vitest run tests/retry-integration.test.ts`
Expected: 全部通过

- [ ] **Step 3: Commit**

```bash
git add tests/retry-integration.test.ts
git commit -m "test: add retry integration tests"
```

---

### Task 8: 全量测试和清理

**Files:**
- 可能微调各文件的 import 或类型

- [ ] **Step 1: 运行全部测试**

Run: `npm test`
Expected: 全部通过

- [ ] **Step 2: 检查 TypeScript 编译**

Run: `npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 3: 更新 CLAUDE.md 中的环境变量文档**

在 `CLAUDE.md` 的环境变量部分新增：
```
可选重试配置：`RETRY_MAX_ATTEMPTS`（默认 3）、`RETRY_BASE_DELAY_MS`（默认 1000）
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: update CLAUDE.md with retry env vars"
```
