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
- Modify: 所有测试文件中的 request_logs 表定义

- [ ] **Step 1: 创建迁移文件**

```sql
-- src/db/migrations/007_add_retry_fields.sql
ALTER TABLE request_logs ADD COLUMN is_retry INTEGER NOT NULL DEFAULT 0;
ALTER TABLE request_logs ADD COLUMN original_request_id TEXT;
```

- [ ] **Step 2: 更新所有测试文件中的 request_logs 表定义**

需要在 `request_logs` 表定义末尾新增 `is_retry INTEGER NOT NULL DEFAULT 0, original_request_id TEXT` 的文件（共 9 个）：

- `tests/anthropic-proxy.test.ts:39-55`
- `tests/openai-proxy.test.ts` (同上结构)
- `tests/logging.test.ts`
- `tests/integration.test.ts`
- `tests/admin-logs.test.ts`
- `tests/metrics.test.ts`
- `tests/models-proxy.test.ts`
- `tests/admin-mappings.test.ts`
- `tests/admin-providers.test.ts`

另外 `tests/db.test.ts` 使用 `initDatabase(":memory:")` 创建数据库（通过迁移），需更新迁移数量的断言（从 `6` 改为 `7`）。

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

在 `src/db/index.ts` 的 `RequestLog` 接口末尾新增：

```typescript
is_retry: number;
original_request_id: string | null;
```

- [ ] **Step 2: 更新 insertRequestLog 参数和 SQL**

参数类型新增 `is_retry?: number; original_request_id?: string | null;`。

SQL 追加两个字段（17 个占位符），`.run()` 追加 `log.is_retry ?? 0, log.original_request_id ?? null`。

- [ ] **Step 3: 更新 insertSuccessLog（proxy-core.ts）**

签名新增 `isRetry: boolean = false, originalRequestId: string | null = null`。内部 `insertRequestLog` 调用追加 `is_retry` 和 `original_request_id`。此步骤与 Step 2 在同一个 commit 中完成，确保 SQL 占位符数量一致。

- [ ] **Step 4: 运行测试**

Run: `npm test`
Expected: 全部通过（新参数有默认值，现有调用不受影响）

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

- [ ] **Step 1: 创建 retry.ts**

```typescript
import type { ProxyResult, StreamProxyResult } from "./proxy-core.js";
import type { FastifyReply } from "fastify";

// ---------- Types ----------

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  retryableStatuses: Set<number>;   // 429, 503。502 仅通过 throw 判定（ETIMEDOUT 等）
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

// ---------- Shared helpers (reused by anthropic.ts / openai.ts) ----------

/** ZAI 中间层 400 临时网络错误判定（provider-specific） */
export function isRetryable400Body(body: string): boolean {
  try {
    const parsed = JSON.parse(body);
    const err = parsed?.error ?? (parsed?.type === "error" ? parsed.error : null);
    if (!err) return false;
    return err.code === "1234" || (err.message?.includes("请稍后重试") ?? false);
  } catch { return false; }
}

export function buildRetryConfig(maxRetries: number, baseDelayMs: number): RetryConfig {
  return {
    maxRetries,
    baseDelayMs,
    retryableStatuses: new Set([429, 503]),
    isRetryableBody: isRetryable400Body,
  };
}

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

// ---------- Internal helpers ----------

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

function extractHeaders(result: ProxyResult | StreamProxyResult): Record<string, string> {
  return "headers" in result ? (result as ProxyResult).headers : (result as StreamProxyResult).upstreamResponseHeaders ?? {};
}

function extractBody(result: ProxyResult | StreamProxyResult): string | null {
  return "body" in result ? (result as ProxyResult).body : (result as StreamProxyResult).responseBody ?? null;
}

// ---------- Core ----------

/**
 * 包装代理调用，对可恢复错误自动重试。
 *
 * 关键行为：
 * - 非流式：完全透明（完整响应后才判断）
 * - 流式：仅在上游返回非 200 且未向客户端写入任何数据时可重试
 * - 网络错误（throw）：仅 ETIMEDOUT/ECONNRESET/ECONNREFUSED 可重试
 * - 所有用尽后 throw 最后一次错误，让调用方 catch 处理
 * - reply 参数用于在重试前检查客户端是否已断开
 */
export async function retryableCall<T extends ProxyResult | StreamProxyResult>(
  fn: ProxyFn<T>,
  config: RetryConfig,
  reply?: FastifyReply,
): Promise<RetryResult<T>> {
  const attempts: Attempt[] = [];

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    const start = Date.now();

    try {
      const result = await fn();
      const elapsed = Date.now() - start;
      const body = extractBody(result);

      attempts.push({
        attemptIndex: attempt,
        statusCode: result.statusCode,
        error: null,
        latencyMs: elapsed,
        responseBody: body,
      });

      // 成功或不可重试状态码 → 直接返回
      if (result.statusCode < 400 || !isRetryableResult(result.statusCode, body ?? undefined, config)) {
        return { result, attempts };
      }

      // 可重试状态码但已用尽配额 → 返回最后一次结果（不 throw）
      if (attempt === config.maxRetries) {
        return { result, attempts };
      }

      // 重试前检查客户端是否已断开
      if (reply && (reply.raw.writableFinished || reply.raw.headersSent)) {
        return { result, attempts };
      }

      // 429 优先读 Retry-After header
      const headers = extractHeaders(result);
      const retryAfterMs = result.statusCode === 429 ? parseRetryAfter(headers) : null;
      const delay = retryAfterMs ?? getBackoffMs(config.baseDelayMs, attempt);
      await sleep(delay);
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

      // 用尽配额 → throw，让调用方 catch 处理
      if (attempt === config.maxRetries) throw err;

      // 检查客户端是否已断开
      if (reply && (reply.raw.writableFinished || reply.raw.headersSent)) throw err;

      await sleep(config.baseDelayMs);
    }
  }

  // 理论上不可达（循环内的所有路径都有 return/throw）
  throw new Error("retryableCall: unreachable");
}
```

- [ ] **Step 2: 创建 tests/retry.test.ts**

```typescript
import { describe, it, expect } from "vitest";
import { isRetryableResult, isRetryableThrow, retryableCall } from "../src/proxy/retry.js";
import type { RetryConfig } from "../src/proxy/retry.js";
import type { ProxyResult, StreamProxyResult } from "../src/proxy/proxy-core.js";

const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 2,
  baseDelayMs: 10,
  retryableStatuses: new Set([429, 503]),
  isRetryableBody: (body: string) => {
    try {
      const parsed = JSON.parse(body);
      return parsed?.error?.code === "1234" || (parsed?.error?.message?.includes("请稍后重试") ?? false);
    } catch { return false; }
  },
};

function mockResult(statusCode: number, body = ""): ProxyResult {
  return { statusCode, body, headers: {}, sentHeaders: {}, sentBody: "" };
}

function mockStreamResult(statusCode: number, responseBody?: string): StreamProxyResult {
  return { statusCode, responseBody, upstreamResponseHeaders: {}, sentHeaders: {} };
}

// ---------- isRetryableResult ----------

describe("isRetryableResult", () => {
  it("returns true for 429", () => expect(isRetryableResult(429, undefined, DEFAULT_CONFIG)).toBe(true));
  it("returns true for 503", () => expect(isRetryableResult(503, undefined, DEFAULT_CONFIG)).toBe(true));
  it("returns false for 200", () => expect(isRetryableResult(200, undefined, DEFAULT_CONFIG)).toBe(false));
  it("returns false for 401", () => expect(isRetryableResult(401, undefined, DEFAULT_CONFIG)).toBe(false));
  it("returns false for 502", () => expect(isRetryableResult(502, undefined, DEFAULT_CONFIG)).toBe(false));

  it("returns true for 400 with code=1234", () => {
    expect(isRetryableResult(400, JSON.stringify({ error: { code: "1234", message: "网络错误" } }), DEFAULT_CONFIG)).toBe(true);
  });

  it("returns true for 400 with 请稍后重试", () => {
    expect(isRetryableResult(400, JSON.stringify({ error: { code: "9999", message: "网络错误，请稍后重试" } }), DEFAULT_CONFIG)).toBe(true);
  });

  it("returns false for 400 with non-retryable body", () => {
    expect(isRetryableResult(400, JSON.stringify({ error: { code: "1211", message: "模型不存在" } }), DEFAULT_CONFIG)).toBe(false);
  });

  it("returns false for 400 without config", () => {
    expect(isRetryableResult(400, JSON.stringify({ error: { code: "1234" } }))).toBe(false);
  });
});

// ---------- isRetryableThrow ----------

describe("isRetryableThrow", () => {
  function sysErr(code: string) {
    const e = new Error(code) as NodeJS.ErrnoException;
    e.code = code;
    return e;
  }

  it("returns true for ETIMEDOUT", () => expect(isRetryableThrow(sysErr("ETIMEDOUT"))).toBe(true));
  it("returns true for ECONNRESET", () => expect(isRetryableThrow(sysErr("ECONNRESET"))).toBe(true));
  it("returns true for ECONNREFUSED", () => expect(isRetryableThrow(sysErr("ECONNREFUSED"))).toBe(true));
  it("returns false for regular Error", () => expect(isRetryableThrow(new Error("x"))).toBe(false));
  it("returns false for string", () => expect(isRetryableThrow("x")).toBe(false));
});

// ---------- retryableCall ----------

describe("retryableCall", () => {
  it("returns immediately on 200", async () => {
    const { result, attempts } = await retryableCall(() => Promise.resolve(mockResult(200)), DEFAULT_CONFIG);
    expect(result.statusCode).toBe(200);
    expect(attempts).toHaveLength(1);
  });

  it("retries on 429 and returns last result when all fail", async () => {
    const { result, attempts } = await retryableCall(() => Promise.resolve(mockResult(429, "rate limited")), DEFAULT_CONFIG);
    expect(result.statusCode).toBe(429);
    expect(attempts).toHaveLength(3);
  });

  it("succeeds after retry", async () => {
    let n = 0;
    const { result, attempts } = await retryableCall(
      () => Promise.resolve(mockResult(++n === 1 ? 429 : 200)),
      DEFAULT_CONFIG,
    );
    expect(result.statusCode).toBe(200);
    expect(attempts).toHaveLength(2);
    expect(attempts[0].statusCode).toBe(429);
    expect(attempts[1].statusCode).toBe(200);
  });

  it("retries on ETIMEDOUT and succeeds", async () => {
    let n = 0;
    const fn = () => {
      n++;
      if (n === 1) {
        const e = new Error("timeout") as NodeJS.ErrnoException;
        e.code = "ETIMEDOUT";
        return Promise.reject(e);
      }
      return Promise.resolve(mockResult(200));
    };
    const { result, attempts } = await retryableCall(fn, DEFAULT_CONFIG);
    expect(result.statusCode).toBe(200);
    expect(attempts).toHaveLength(2);
    expect(attempts[0].statusCode).toBeNull();
    expect(attempts[0].error).toBe("timeout");
  });

  it("throws immediately on non-retryable error", async () => {
    await expect(retryableCall(() => Promise.reject(new Error("fatal")), DEFAULT_CONFIG)).rejects.toThrow("fatal");
  });

  it("returns immediately on non-retryable status (401)", async () => {
    const { result, attempts } = await retryableCall(() => Promise.resolve(mockResult(401)), DEFAULT_CONFIG);
    expect(result.statusCode).toBe(401);
    expect(attempts).toHaveLength(1);
  });

  it("throws when all retries exhausted for retryable throw", async () => {
    const fn = () => {
      const e = new Error("timeout") as NodeJS.ErrnoException;
      e.code = "ETIMEDOUT";
      return Promise.reject(e);
    };
    await expect(retryableCall(fn, DEFAULT_CONFIG)).rejects.toThrow("timeout");
  });

  it("respects maxRetries=0 (single attempt, no retry)", async () => {
    const config = { ...DEFAULT_CONFIG, maxRetries: 0 };
    const { result, attempts } = await retryableCall(() => Promise.resolve(mockResult(429)), config);
    expect(result.statusCode).toBe(429);
    expect(attempts).toHaveLength(1);
  });
});
```

- [ ] **Step 3: 运行测试**

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
- Modify: 所有通过 `buildApp` 构造 Config 的测试文件

- [ ] **Step 1: 更新 Config 接口和 getConfig**

`src/config.ts` 接口新增 `RETRY_MAX_ATTEMPTS: number; RETRY_BASE_DELAY_MS: number;`，getConfig 返回值新增对应解析。

- [ ] **Step 2: 更新 proxy 插件注册**

`src/index.ts` 中 openaiProxy 和 anthropicProxy 的注册选项新增 `retryMaxAttempts` 和 `retryBaseDelayMs`。

- [ ] **Step 3: 更新 .env.example**

新增 `RETRY_MAX_ATTEMPTS=3` 和 `RETRY_BASE_DELAY_MS=1000`。

- [ ] **Step 4: 更新所有受影响的测试文件**

需要更新的文件分两类：

**A. 直接注册 proxy 插件的测试**（需在注册选项中新增 `retryMaxAttempts: 0`）：
- `tests/anthropic-proxy.test.ts:82-92` (buildTestApp)
- `tests/openai-proxy.test.ts` (同上)

**B. 通过 buildApp({ config }) 构造的测试**（Config 对象需新增字段）：
- `tests/integration.test.ts:17-28` (makeTestConfig) — 新增 `RETRY_MAX_ATTEMPTS: 0, RETRY_BASE_DELAY_MS: 0`
- `tests/admin-logs.test.ts:11-23` (makeConfig) — 同上
- `tests/logging.test.ts` — 如果使用 buildApp 则同理
- `tests/config.test.ts` — 验证默认值的断言需新增

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

新增 `retryMaxAttempts: number; retryBaseDelayMs: number;`，解构到插件函数中。

- [ ] **Step 2: 导入 retry 模块，构建 retryConfig**

```typescript
import { retryableCall, buildRetryConfig, type RetryResult } from "./retry.js";
import type { ProxyResult, StreamProxyResult } from "./proxy-core.js";
```

在 try 块开头构建配置：

```typescript
const retryConfig = buildRetryConfig(retryMaxAttempts, retryBaseDelayMs);
```

- [ ] **Step 3: 改写 try 块**

将流式和非流式路径统一用 `retryableCall` 包装。非流式也传入 `reply` 以检测客户端断开：

```typescript
if (isStream) {
  const { result: r, attempts } = await retryableCall(
    () => {
      const metricsTransform = new SSEMetricsTransform("anthropic", startTime);
      return proxyStream(provider, apiKey, body, cliHdrs, reply, streamTimeoutMs, MESSAGES_PATH, metricsTransform);
    },
    retryConfig,
    reply,
  );
  // ... 日志和 metrics 处理
} else {
  const { result: r, attempts } = await retryableCall(
    () => proxyNonStream(provider, apiKey, body, cliHdrs, MESSAGES_PATH),
    retryConfig,
    reply,
  );
  // ... 日志和 metrics 处理
}
```

- [ ] **Step 4: 日志记录和 metrics 处理**

遍历 attempts 记录每次尝试。upstreamReq 使用函数开头构建的统一版本（简化）。

关键：**只有最终成功的请求才插入 metrics**。metrics 使用最后一次 proxy 调用返回的 `r.metricsResult`（流式）或通过 `MetricsExtractor.fromNonStreamResponse` 解析（非流式）。

```typescript
const upstreamReq = JSON.stringify({ url: `${provider.base_url}${MESSAGES_PATH}`, headers: buildUpstreamHeaders(cliHdrs, apiKey, Buffer.byteLength(reqBodyStr)), body: reqBodyStr });

for (const attempt of attempts) {
  const isOriginal = attempt.attemptIndex === 0;
  const attemptLogId = isOriginal ? logId : randomUUID();
  const retryFlag = isOriginal ? 0 : 1;
  const origId = isOriginal ? null : logId;

  if (attempt.error) {
    // throw 场景
    insertRequestLog(db, {
      id: attemptLogId, api_type: "anthropic", model: clientModel, provider_id: provider.id,
      status_code: 502, latency_ms: attempt.latencyMs,
      is_stream: isStream ? 1 : 0, error_message: attempt.error,
      created_at: new Date().toISOString(), request_body: reqBodyStr,
      client_request: clientReq, upstream_request: upstreamReq,
      is_retry: retryFlag, original_request_id: origId,
    });
  } else if (attempt.statusCode !== 200) {
    // 非 200 resolved
    insertRequestLog(db, {
      id: attemptLogId, api_type: "anthropic", model: clientModel, provider_id: provider.id,
      status_code: attempt.statusCode, latency_ms: attempt.latencyMs,
      is_stream: isStream ? 1 : 0, error_message: null,
      created_at: new Date().toISOString(), request_body: reqBodyStr,
      response_body: attempt.responseBody,
      client_request: clientReq, upstream_request: upstreamReq,
      upstream_response: JSON.stringify({ statusCode: attempt.statusCode, body: attempt.responseBody }),
      client_response: JSON.stringify({ statusCode: attempt.statusCode, body: attempt.responseBody }),
      is_retry: retryFlag, original_request_id: origId,
    });
  } else {
    // 最终成功
    const h = ("headers" in r) ? (r as ProxyResult).headers : (r as StreamProxyResult).upstreamResponseHeaders ?? {};
    insertSuccessLog(db, "anthropic", attemptLogId, clientModel, provider, isStream, startTime,
      reqBodyStr, clientReq, upstreamReq, r.statusCode, attempt.responseBody, h, h,
      !isOriginal, isOriginal ? null : logId);
  }
}

// 只有最终成功的请求才插入 metrics
if (r.statusCode === 200) {
  if (isStream && "metricsResult" in r && (r as StreamProxyResult).metricsResult) {
    try {
      insertMetrics(db, { ...(r as StreamProxyResult).metricsResult!, request_log_id: lastSuccessLogId, provider_id: provider.id, backend_model: mapping.backend_model, api_type: "anthropic" });
    } catch (err) { request.log.error({ err }, "Failed to insert metrics"); }
  } else if (!isStream) {
    try {
      const mr = MetricsExtractor.fromNonStreamResponse("anthropic", (r as ProxyResult).body);
      if (mr) insertMetrics(db, { ...mr, request_log_id: lastSuccessLogId, provider_id: provider.id, backend_model: mapping.backend_model, api_type: "anthropic" });
    } catch (err) { request.log.error({ err }, "Failed to insert metrics"); }
  }
}
```

其中 `lastSuccessLogId` 是最后一次成功 attempt 的 logId（即日志遍历中 `statusCode === 200` 的那个 attemptLogId）。

- [ ] **Step 5: 处理流式非 200 的 reply.send**

重试结束后如果最终仍非 200，需要将错误响应发给客户端（当前代码在 retry 外处理）：

```typescript
if (isStream && r.statusCode !== UPSTREAM_SUCCESS) {
  for (const [k, v] of Object.entries((r as StreamProxyResult).upstreamResponseHeaders ?? {})) reply.header(k, v);
  reply.status(r.statusCode).send((r as StreamProxyResult).responseBody);
}
if (!isStream) {
  for (const [k, v] of Object.entries((r as ProxyResult).headers)) reply.header(k, v);
  return reply.status(r.statusCode).send((r as ProxyResult).body);
}
return reply;
```

- [ ] **Step 6: 更新 catch 块**

catch 块仅处理不可重试的 throw（非 ETIMEDOUT 等）或 `retryMaxAttempts === 0` 时的网络错误。代码与现有 catch 块相同，但不再需要处理被 retryableCall 消化的错误。

- [ ] **Step 7: 运行测试**

Run: `npx vitest run tests/anthropic-proxy.test.ts`
Expected: 全部通过（retryMaxAttempts=0 时行为不变）

- [ ] **Step 8: Commit**

```bash
git add src/proxy/anthropic.ts
git commit -m "feat(proxy): integrate retry logic in anthropic proxy"
```

---

### Task 6: 在 openai.ts 中集成重试逻辑

**Files:**
- Modify: `src/proxy/openai.ts:17-21` (接口), `src/proxy/openai.ts:67-113` (try 块)

与 Task 5 完全对称。导入 `retryableCall` 和 `buildRetryConfig`（从 retry.ts），相同的改写模式。

- [ ] **Step 1-6: 同 Task 5 对称操作**

注意 openai.ts 的 stream_options 注入（第 59-61 行）需保留在 retryableCall 外部（body 构建阶段）。

- [ ] **Step 7: 运行测试**

Run: `npx vitest run tests/openai-proxy.test.ts`
Expected: 全部通过

- [ ] **Step 8: Commit**

```bash
git add src/proxy/openai.ts
git commit -m "feat(proxy): integrate retry logic in openai proxy"
```

---

### Task 7: 编写重试集成测试

**Files:**
- Create: `tests/retry-integration.test.ts`

- [ ] **Step 1: 编写集成测试**

完整测试代码，包含辅助函数（从 anthropic-proxy.test.ts 复制核心部分）：

```typescript
import { describe, it, expect, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { createServer, Server, IncomingMessage, ServerResponse } from "http";
import Database from "better-sqlite3";
import { encrypt } from "../src/utils/crypto.js";
import { anthropicProxy } from "../src/proxy/anthropic.js";

const TEST_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS providers (id TEXT PRIMARY KEY, name TEXT NOT NULL, api_type TEXT NOT NULL CHECK(api_type IN ('openai','anthropic')), base_url TEXT NOT NULL, api_key TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS model_mappings (id TEXT PRIMARY KEY, client_model TEXT NOT NULL UNIQUE, backend_model TEXT NOT NULL, provider_id TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, FOREIGN KEY (provider_id) REFERENCES providers(id));
    CREATE TABLE IF NOT EXISTS request_logs (id TEXT PRIMARY KEY, api_type TEXT NOT NULL, model TEXT, provider_id TEXT, status_code INTEGER, latency_ms INTEGER, is_stream INTEGER, error_message TEXT, created_at TEXT NOT NULL, request_body TEXT, response_body TEXT, client_request TEXT, upstream_request TEXT, upstream_response TEXT, client_response TEXT, is_retry INTEGER NOT NULL DEFAULT 0, original_request_id TEXT);
    CREATE TABLE IF NOT EXISTS request_metrics (id TEXT PRIMARY KEY, request_log_id TEXT NOT NULL UNIQUE REFERENCES request_logs(id) ON DELETE CASCADE, provider_id TEXT NOT NULL, backend_model TEXT NOT NULL, api_type TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER, cache_creation_tokens INTEGER, cache_read_tokens INTEGER, ttft_ms INTEGER, total_duration_ms INTEGER, tokens_per_second REAL, stop_reason TEXT, is_complete INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT(datetime('now')));`);
  return db;
}

function createMockBackend(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.listen(0, () => { const a = server.address(); a && typeof a === "object" ? resolve({ server, port: a.port }) : reject(new Error("no addr")); });
  });
}

function closeServer(s: Server): Promise<void> { return new Promise((r, j) => s.close(e => e ? j(e) : r())); }

function setupProvider(db: Database.Database, baseUrl: string) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO providers (id,name,api_type,base_url,api_key,is_active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run("svc-1", "Mock", "anthropic", baseUrl, encrypt("sk-test", TEST_KEY), 1, now, now);
  db.prepare(`INSERT INTO model_mappings (id,client_model,backend_model,provider_id,is_active,created_at) VALUES (?,?,?,?,?,?)`)
    .run("map-1", "sonnet", "mock-model", "svc-1", 1, now);
}

const SUCCESS_BODY = { id: "msg_1", type: "message", role: "assistant", content: [{ type: "text", text: "Hi" }], model: "mock", stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };

describe("Retry integration", () => {
  let app: FastifyInstance;
  let db: Database.Database;

  afterEach(async () => { if (app) await app.close(); if (db) db.close(); });

  it("retries 429 and succeeds on second attempt", async () => {
    let calls = 0;
    const { server, port } = await createMockBackend((_req, res) => {
      calls++;
      if (calls === 1) {
        res.writeHead(429, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "Too many" } }));
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(SUCCESS_BODY));
      }
    });

    db = createTestDb();
    setupProvider(db, `http://127.0.0.1:${port}`);
    app = Fastify();
    app.register(anthropicProxy, { db, encryptionKey: TEST_KEY, streamTimeoutMs: 5000, retryMaxAttempts: 2, retryBaseDelayMs: 10 });

    const resp = await app.inject({ method: "POST", url: "/v1/messages", headers: { "content-type": "application/json" }, payload: { model: "sonnet", messages: [{ role: "user", content: "Hi" }], max_tokens: 100 } });
    expect(resp.statusCode).toBe(200);
    expect(calls).toBe(2);

    const logs = db.prepare("SELECT * FROM request_logs ORDER BY created_at").all() as any[];
    expect(logs).toHaveLength(2);
    expect(logs[0].is_retry).toBe(0);
    expect(logs[0].status_code).toBe(429);
    expect(logs[1].is_retry).toBe(1);
    expect(logs[1].original_request_id).toBe(logs[0].id);
    expect(logs[1].status_code).toBe(200);

    await closeServer(server);
  });

  it("returns 429 after exhausting retries", async () => {
    const { server, port } = await createMockBackend((_req, res) => {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "Too many" } }));
    });

    db = createTestDb();
    setupProvider(db, `http://127.0.0.1:${port}`);
    app = Fastify();
    app.register(anthropicProxy, { db, encryptionKey: TEST_KEY, streamTimeoutMs: 5000, retryMaxAttempts: 1, retryBaseDelayMs: 10 });

    const resp = await app.inject({ method: "POST", url: "/v1/messages", headers: { "content-type": "application/json" }, payload: { model: "sonnet", messages: [{ role: "user", content: "Hi" }], max_tokens: 100 } });
    expect(resp.statusCode).toBe(429);

    const logs = db.prepare("SELECT * FROM request_logs ORDER BY created_at").all() as any[];
    expect(logs).toHaveLength(2); // original + 1 retry
    expect(logs[0].is_retry).toBe(0);
    expect(logs[1].is_retry).toBe(1);

    await closeServer(server);
  });

  it("retries 400 with retryable body (code=1234)", async () => {
    let calls = 0;
    const { server, port } = await createMockBackend((_req, res) => {
      calls++;
      if (calls === 1) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ type: "error", error: { message: "网络错误，请稍后重试", code: "1234" } }));
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(SUCCESS_BODY));
      }
    });

    db = createTestDb();
    setupProvider(db, `http://127.0.0.1:${port}`);
    app = Fastify();
    app.register(anthropicProxy, { db, encryptionKey: TEST_KEY, streamTimeoutMs: 5000, retryMaxAttempts: 2, retryBaseDelayMs: 10 });

    const resp = await app.inject({ method: "POST", url: "/v1/messages", headers: { "content-type": "application/json" }, payload: { model: "sonnet", messages: [{ role: "user", content: "Hi" }], max_tokens: 100 } });
    expect(resp.statusCode).toBe(200);
    expect(calls).toBe(2);
    await closeServer(server);
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

- [ ] **Step 1: 运行全部测试**

Run: `npm test`
Expected: 全部通过

- [ ] **Step 2: 检查 TypeScript 编译**

Run: `npx tsc --noEmit`
Expected: 无类型错误

- [ ] **Step 3: 更新 CLAUDE.md**

在环境变量部分新增：
```
可选重试配置：`RETRY_MAX_ATTEMPTS`（默认 3）、`RETRY_BASE_DELAY_MS`（默认 1000）
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: update CLAUDE.md with retry env vars"
```
