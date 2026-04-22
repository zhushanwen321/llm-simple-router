# PR-1: TransportLayer 重构 - 详细实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 `src/proxy/transport.ts` 替换 `src/proxy/upstream-call.ts`，引入 `TransportResult` discriminated union 和 StreamProxy 显式状态机

**Architecture:** TransportLayer 封装非流式/流式/GET 三种上游调用，返回统一的 TransportResult（6 种 kind）。StreamProxy 是 5 状态显式状态机（BUFFERING/STREAMING/COMPLETED/EARLY_ERROR/ABORTED），通过 deferred resolve 绑定外层 Promise。PR-1 提供 compat wrapper 桥接旧 ProxyResult/StreamProxyResult 类型。

**Tech Stack:** TypeScript, Node.js http/https, PassThrough stream, Vitest, vi.fn/vi.doMock

**Spec:** `.superpowers/2026-04-22-proxy-concurrency-refactor/spec.md`

---

## 文件变更概览

| 操作 | 文件 |
|------|------|
| 新建 | `src/proxy/types.ts` |
| 新建 | `src/proxy/transport.ts` |
| 新建 | `tests/transport.test.ts` |
| 修改 | `src/proxy/proxy-core.ts` |
| 修改 | `src/proxy/proxy-logging.ts` |
| 修改 | `src/proxy/retry.ts` |
| 删除 | `src/proxy/upstream-call.ts` |

---

## Step 1: 创建 `src/proxy/types.ts` 共享类型文件

- [ ] 创建 `src/proxy/types.ts`，包含以下内容：

```typescript
import type { MetricsResult } from "../metrics/metrics-extractor.js";

// ---------- Shared types ----------

export type RawHeaders = Record<string, string | string[] | undefined>;

export const UPSTREAM_SUCCESS = 200;

// ---------- TransportResult (discriminated union) ----------

export type TransportResult =
  | { kind: "success"; statusCode: number; body: string; headers: Record<string, string>; sentHeaders: Record<string, string>; sentBody: string }
  | { kind: "stream_success"; statusCode: number; metrics?: MetricsResult; upstreamResponseHeaders?: Record<string, string>; sentHeaders: Record<string, string> }
  | { kind: "stream_error"; statusCode: number; body: string; headers: Record<string, string>; sentHeaders: Record<string, string> }
  | { kind: "stream_abort"; statusCode: number; metrics?: MetricsResult; upstreamResponseHeaders?: Record<string, string>; sentHeaders: Record<string, string> }
  | { kind: "error"; statusCode: number; body: string; headers: Record<string, string>; sentHeaders: Record<string, string>; sentBody: string }
  | { kind: "throw"; error: Error };

// ---------- StreamProxy states ----------

export type StreamState =
  | "BUFFERING"
  | "STREAMING"
  | "COMPLETED"
  | "EARLY_ERROR"
  | "ABORTED";
```

要点：
- `RawHeaders` 从 `proxy-logging.ts` 迁移到此处，作为单一真相源
- `UPSTREAM_SUCCESS` 从 `proxy-logging.ts` 迁移到此处
- `TransportResult` 是 PR 的核心类型，6 个 kind 覆盖所有上游调用结果
- `stream_success` / `stream_error` / `stream_abort` 携带 `sentHeaders` 以便日志记录
- `StreamState` 状态机枚举

- [ ] **Commit**

```bash
git add src/proxy/types.ts
git commit -m "feat: add shared types.ts with TransportResult and StreamState"
```

## Step 2: 从 `proxy-logging.ts` 去除 `RawHeaders` 和 `UPSTREAM_SUCCESS` 定义，改为从 `types.ts` 导入

- [ ] 修改 `src/proxy/proxy-logging.ts`：
  - 删除 `export const UPSTREAM_SUCCESS = 200;`
  - 删除 `export type RawHeaders = ...`
  - 添加 `import { UPSTREAM_SUCCESS, type RawHeaders } from "./types.js";`
  - 保持该文件对外的 re-export 不变：`export { UPSTREAM_SUCCESS } from "./types.js";` 和 `export type { RawHeaders } from "./types.js";`，使下游调用方无需改动

```typescript
// src/proxy/proxy-logging.ts 顶部改为：
import { UPSTREAM_SUCCESS, type RawHeaders } from "./types.js";
// re-export 保持下游不中断
export { UPSTREAM_SUCCESS } from "./types.js";
export type { RawHeaders } from "./types.js";
```

- [ ] **Commit**

```bash
git add src/proxy/proxy-logging.ts
git commit -m "refactor: migrate RawHeaders and UPSTREAM_SUCCESS to types.ts"
```

## Step 3: 修改 `proxy-core.ts` 从 `types.ts` 导入 `RawHeaders`

- [ ] 修改 `src/proxy/proxy-core.ts` 的导入行：
  - 从 `proxy-logging.js` 的导入中移除 `type RawHeaders`（因为它现在来自 `types.ts`）
  - 从 `proxy-logging.js` 的导入中移除 `UPSTREAM_SUCCESS`（同上）
  - 添加从 `types.ts` 的导入

```typescript
// 修改前：
import { logRetryAttempts, collectMetrics, handleIntercept, sanitizeHeadersForLog, UPSTREAM_SUCCESS, type RawHeaders } from "./proxy-logging.js";
export { UPSTREAM_SUCCESS } from "./proxy-logging.js";
export type { RawHeaders } from "./proxy-logging.js";

// 修改后：
import { logRetryAttempts, collectMetrics, handleIntercept, sanitizeHeadersForLog } from "./proxy-logging.js";
import { UPSTREAM_SUCCESS, type RawHeaders } from "./types.js";
export { UPSTREAM_SUCCESS } from "./types.js";
export type { RawHeaders } from "./types.js";
```

验证：`npx tsc --noEmit` 确认无类型错误。

- [ ] **Commit**

```bash
git add src/proxy/proxy-core.ts
git commit -m "refactor: update proxy-core imports to use types.ts"
```

## Step 4: 编写 `tests/transport.test.ts` 测试骨架

- [ ] 创建 `tests/transport.test.ts`，包含所有测试 describe 块和 it 块（先空实现）

测试策略：
- 不启动真实 HTTP 服务器
- mock `createUpstreamRequest` 返回模拟的 `upstreamReq` 对象
- mock `upstreamRes` 模拟 `IncomingMessage`（emit data/end/error 事件）
- mock `reply.raw` 模拟 `ServerResponse`（spy on writeHead, write, end）

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import type { TransportResult } from "../src/proxy/types.js";

// ---------- Mock factories ----------

function createMockUpstreamReq() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    write: vi.fn(),
    end: vi.fn(),
    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),
  });
}

function createMockUpstreamRes(overrides: {
  statusCode?: number;
  headers?: Record<string, string>;
}) {
  const emitter = new EventEmitter() as any;
  emitter.statusCode = overrides.statusCode ?? 200;
  emitter.headers = overrides.headers ?? { "content-type": "text/event-stream" };
  emitter.destroy = vi.fn();
  return emitter;
}

function createMockReplyRaw() {
  const emitter = new EventEmitter() as any;
  emitter.writeHead = vi.fn();
  emitter.write = vi.fn();
  emitter.end = vi.fn();
  emitter.headersSent = false;
  emitter.writableEnded = false;
  emitter.destroy = vi.fn();
  return emitter;
}
```

- [ ] **Commit**

```bash
git add tests/transport.test.ts
git commit -m "test: add transport test skeleton with mock factories"
```

## Step 5: 编写非流式 transport 测试用例

- [ ] 在 `tests/transport.test.ts` 中添加非流式测试：

> 完整测试代码见 [plan-pr1-tests.md](./plan-pr1-tests.md) 「非流式测试」章节

```typescript
// 骨架结构，完整断言见子文档
describe("TransportLayer.callNonStream", () => {
  it("returns success on 200 response", async () => { /* 见子文档 */ });
  it("returns error on 4xx/5xx response", async () => { /* 见子文档 */ });
  it("returns throw on network error", async () => { /* 见子文档 */ });
});
```

测试验证命令：`npx vitest run tests/transport.test.ts`（预期失败，因为 transport.ts 尚未实现）

> 测试代码实现在执行时由子文档 plan-pr1-tests.md 生成，此处不单独 commit。

## Step 6: 编写流式 transport 测试用例 - 正常完成路径

- [ ] 在 `tests/transport.test.ts` 中添加流式正常完成测试：

> 完整测试代码见 [plan-pr1-tests.md](./plan-pr1-tests.md) 「流式正常完成测试」章节

```typescript
// 骨架结构，完整断言见子文档
describe("TransportLayer.callStream", () => {
  it("returns stream_success on normal SSE completion", async () => { /* 见子文档 */ });
  it("returns stream_success without early error checker", async () => { /* 见子文档 */ });
});
```

> 测试代码实现在执行时由子文档 plan-pr1-tests.md 生成，此处不单独 commit。

## Step 7: 编写流式 transport 测试用例 - 早期错误和异常路径

- [ ] 在 `tests/transport.test.ts` 中添加错误路径测试：

> 完整测试代码见 [plan-pr1-tests.md](./plan-pr1-tests.md) 「流式错误路径测试」章节

```typescript
// 骨架结构，完整断言见子文档
describe("StreamProxy state machine - error paths", () => {
  it("returns stream_error on upstream non-200 status", async () => { /* 见子文档 */ });
  it("returns stream_error when early error detected in buffer phase", async () => { /* 见子文档 */ });
  it("returns stream_abort when client disconnects during streaming", async () => { /* 见子文档 */ });
  it("returns throw on upstream network error", async () => { /* 见子文档 */ });
  it("transitions BUFFERING→STREAMING after receiving full event", async () => { /* 见子文档 */ });
  it("transitions BUFFERING→STREAMING when buffer exceeds limit", async () => { /* 见子文档 */ });
});
```

> 测试代码实现在执行时由子文档 plan-pr1-tests.md 生成，此处不单独 commit。

## Step 8: 编写流式 transport 测试用例 - close handler 注册一次

- [ ] 在 `tests/transport.test.ts` 中添加：

> 完整测试代码见 [plan-pr1-tests.md](./plan-pr1-tests.md) 「close handler 测试」章节

```typescript
// 骨架结构，完整断言见子文档
describe("StreamProxy close handler", () => {
  it("registers reply.raw close handler only once", async () => { /* 见子文档 */ });
  it("terminal() prevents duplicate resolve", async () => { /* 见子文档 */ });
});
```

全部测试写完后验证编译：`npx tsc --noEmit`

> 测试代码实现在执行时由子文档 plan-pr1-tests.md 生成，此处不单独 commit。

## Step 9: 实现 `src/proxy/transport.ts` - 公共工具函数

- [ ] 创建 `src/proxy/transport.ts`，先实现共享部分：

```typescript
import { request as httpRequestFn } from "http";
import { request as httpsRequestFn } from "https";
import { PassThrough } from "stream";
import type { FastifyReply } from "fastify";
import type { RawHeaders, TransportResult, StreamState } from "./types.js";
import type { MetricsResult } from "../metrics/metrics-extractor.js";
import type { SSEMetricsTransform } from "../metrics/sse-metrics-transform.js";

// ---------- Constants ----------

const UPSTREAM_BAD_GATEWAY = 502;
const HTTPS_DEFAULT_PORT = 443;
const HTTP_DEFAULT_PORT = 80;
const BUFFER_SIZE_LIMIT = 4096;

const SKIP_DOWNSTREAM = new Set([
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
]);

// ---------- Request utilities ----------

export interface UpstreamRequestOptions {
  hostname: string;
  port: number;
  path: string;
  method: string;
  headers: Record<string, string>;
}

export function createUpstreamRequest(url: URL, options: UpstreamRequestOptions) {
  return url.protocol === "https:" ? httpsRequestFn(options) : httpRequestFn(options);
}

export function buildRequestOptions(
  url: URL,
  headers: Record<string, string>,
  method = "POST",
): UpstreamRequestOptions {
  return {
    hostname: url.hostname,
    port: Number(url.port) || (url.protocol === "https:" ? HTTPS_DEFAULT_PORT : HTTP_DEFAULT_PORT),
    path: url.pathname,
    method,
    headers,
  };
}

function filterHeaders(raw: RawHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value == null || SKIP_DOWNSTREAM.has(key.toLowerCase())) continue;
    out[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}
```

- [ ] **Commit**

```bash
git add src/proxy/transport.ts
git commit -m "feat: add transport.ts with upstream request utilities"
```

## Step 10: 实现 `callNonStream` - 非流式传输

- [ ] 在 `src/proxy/transport.ts` 中添加 `callNonStream` 函数：

```typescript
export type BuildHeadersFn = (
  cliHdrs: RawHeaders,
  key: string,
  bytes?: number,
) => Record<string, string>;

export function callNonStream(
  backend: { base_url: string },
  apiKey: string,
  body: Record<string, unknown>,
  clientHeaders: RawHeaders,
  upstreamPath: string,
  buildHeaders: BuildHeadersFn,
): Promise<TransportResult> {
  return new Promise((resolve) => {
    const url = new URL(`${backend.base_url}${upstreamPath}`);
    const payload = JSON.stringify(body);
    const upstreamHeaders = buildHeaders(clientHeaders, apiKey, Buffer.byteLength(payload));
    const options = buildRequestOptions(url, upstreamHeaders);

    const req = createUpstreamRequest(url, options);

    req.on("response", (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const statusCode = res.statusCode || UPSTREAM_BAD_GATEWAY;
        const responseBody = Buffer.concat(chunks).toString("utf-8");
        const headers = filterHeaders(res.headers as RawHeaders);

        if (statusCode >= 200 && statusCode < 300) {
          resolve({
            kind: "success",
            statusCode,
            body: responseBody,
            headers,
            sentHeaders: upstreamHeaders,
            sentBody: payload,
          });
        } else {
          resolve({
            kind: "error",
            statusCode,
            body: responseBody,
            headers,
            sentHeaders: upstreamHeaders,
            sentBody: payload,
          });
        }
      });
    });

    req.on("error", (error) => resolve({ kind: "throw", error }));
    req.write(payload);
    req.end();
  });
}
```

与原 `proxyNonStream` 的区别：
- 不再 throw（不调用 reject），而是统一返回 `TransportResult`
- 网络异常返回 `{ kind: "throw", error }` 而非 reject promise
- 非 2xx 返回 `{ kind: "error", ... }` 而非 success + statusCode 判断

验证：`npx vitest run tests/transport.test.ts` 确认非流式测试通过

- [ ] **Commit**

```bash
git add src/proxy/transport.ts
git commit -m "feat: add callNonStream non-streaming transport"
```

## Step 11: 实现 `callGet` - GET 请求封装

- [ ] 在 `src/proxy/transport.ts` 中添加 GET 方法：

```typescript
export interface GetTransportResult {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}

export function callGet(
  backend: { base_url: string },
  apiKey: string,
  clientHeaders: RawHeaders,
  upstreamPath: string,
  buildHeaders: (cliHdrs: RawHeaders, key: string) => Record<string, string>,
): Promise<GetTransportResult> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${backend.base_url}${upstreamPath}`);
    const headers = buildHeaders(clientHeaders, apiKey);
    const options = buildRequestOptions(url, headers, "GET");

    const req = createUpstreamRequest(url, options);
    req.on("response", (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode || UPSTREAM_BAD_GATEWAY,
          body: Buffer.concat(chunks).toString("utf-8"),
          headers: filterHeaders(res.headers as RawHeaders),
        });
      });
    });
    req.on("error", (err) => reject(err));
    req.end();
  });
}
```

注意：`callGet` 保持原 `proxyGetRequest` 的 throw-on-error 行为，因为 GET 路径（`/v1/models`）不在 retry/failover 循环内。

- [ ] **Commit**

```bash
git add src/proxy/transport.ts
git commit -m "feat: add callGet for GET proxy requests"
```

## Step 12: 实现 StreamProxy 状态机 - 核心结构

- [ ] 在 `src/proxy/transport.ts` 中添加 StreamProxy 类骨架：

```typescript
type StreamTerminalKind = "stream_success" | "stream_error" | "stream_abort";

class StreamProxy {
  private state: StreamState = "BUFFERING";
  private resolved = false;
  private resolveFn: ((result: TransportResult) => void) | null = null;
  private pendingResult: TransportResult | null = null;

  private readonly bufferChunks: Buffer[] = [];
  private readonly captureChunks: Buffer[] = [];
  private idleTimer: NodeJS.Timeout | null = null;
  private headersSent = false;
  private closeHandlerRegistered = false;

  private readonly sseHeaders: Record<string, string>;
  private readonly passThrough = new PassThrough();
  private readonly pipeEntry: PassThrough | SSEMetricsTransform;

  constructor(
    private readonly statusCode: number,
    upstreamHeaders: RawHeaders,
    private readonly upstreamHeaders: Record<string, string>,
    private readonly reply: FastifyReply,
    private readonly metricsTransform: SSEMetricsTransform | undefined,
    private readonly checkEarlyError: ((data: string) => boolean) | undefined,
    private readonly timeoutMs: number,
  ) {
    this.sseHeaders = filterHeaders(upstreamHeaders);
    this.sseHeaders["Content-Type"] = "text/event-stream";
    this.sseHeaders["Cache-Control"] = "no-cache";
    this.sseHeaders["Connection"] = "keep-alive";
    this.pipeEntry = metricsTransform ?? this.passThrough;
  }

  bindResolve(resolve: (result: TransportResult) => void): void {
    this.resolveFn = resolve;
    if (this.pendingResult) resolve(this.pendingResult);
  }
}
```

状态转换守卫方法：

```typescript
private transition(newState: StreamState): void {
  const VALID: Record<StreamState, StreamState[]> = {
    BUFFERING: ["STREAMING", "EARLY_ERROR"],
    STREAMING: ["COMPLETED", "ABORTED"],
    COMPLETED: [],
    EARLY_ERROR: [],
    ABORTED: [],
  };
  if (!VALID[this.state].includes(newState)) {
    throw new Error(`Invalid state transition: ${this.state} → ${newState}`);
  }
  this.state = newState;
}

private isTerminal(): boolean {
  return this.state === "COMPLETED" || this.state === "EARLY_ERROR" || this.state === "ABORTED";
}
```

单入口 resolve：

```typescript
private terminal(kind: StreamTerminalKind, extra: Record<string, unknown> = {}): void {
  if (this.resolved) return;
  this.resolved = true;
  this.cleanup();

  const base = {
    statusCode: this.statusCode,
    upstreamResponseHeaders: this.sseHeaders,
    sentHeaders: this.upstreamHeaders,
  };

  let result: TransportResult;
  switch (kind) {
    case "stream_success":
      result = { kind: "stream_success", ...base, metrics: extra.metrics as MetricsResult | undefined };
      break;
    case "stream_error":
      result = { kind: "stream_error", ...base, body: extra.body as string, headers: this.sseHeaders };
      break;
    case "stream_abort":
      result = { kind: "stream_abort", ...base, metrics: extra.metrics as MetricsResult | undefined };
      break;
  }

  if (this.resolveFn) {
    this.resolveFn(result);
  } else {
    this.pendingResult = result;
  }
}
```

- [ ] **Commit**

```bash
git add src/proxy/transport.ts
git commit -m "feat: add StreamProxy state machine core with deferred resolve"
```

## Step 13: 实现 StreamProxy - cleanup、metrics、startStreaming

- [ ] 在 StreamProxy 类中添加辅助方法：

```typescript
private cleanup(): void {
  if (this.idleTimer) clearTimeout(this.idleTimer);
  this.idleTimer = null;
  if (!this.passThrough.destroyed) this.passThrough.destroy();
  if (this.metricsTransform && !this.metricsTransform.destroyed) this.metricsTransform.destroy();
}

private collectMetrics(isComplete: boolean): MetricsResult | undefined {
  if (!this.metricsTransform) return undefined;
  const result = this.metricsTransform.getExtractor().getMetrics();
  return isComplete ? result : { ...result, is_complete: 0 };
}

private startStreaming(): void {
  if (this.headersSent) return;
  this.transition("STREAMING");
  this.headersSent = true;
  this.reply.raw.writeHead(this.statusCode, this.sseHeaders);
  if (this.metricsTransform) {
    this.metricsTransform.pipe(this.passThrough).pipe(this.reply.raw);
  } else {
    this.passThrough.pipe(this.reply.raw);
  }
  for (const c of this.bufferChunks) this.pipeEntry.write(c);
  this.bufferChunks.length = 0;
}

private resetIdleTimer(): void {
  if (this.idleTimer) clearTimeout(this.idleTimer);
  this.idleTimer = setTimeout(() => {
    if (this.resolved) return;
    this.terminal("stream_abort", { metrics: this.collectMetrics(false) });
  }, this.timeoutMs);
}
```

## Step 14: 实现 StreamProxy - 事件处理 handlers

- [ ] 在 StreamProxy 类中添加事件注册方法：

```typescript
registerCloseHandler(): void {
  if (this.closeHandlerRegistered) return;
  this.closeHandlerRegistered = true;
  this.reply.raw.on("close", () => {
    if (this.resolved) return;
    if (this.state === "BUFFERING") {
      this.transition("ABORTED");
    } else if (this.state === "STREAMING") {
      this.transition("ABORTED");
    }
    this.terminal("stream_abort", { metrics: this.collectMetrics(false) });
  });
}

onData(chunk: Buffer): void {
  if (this.resolved) return;
  this.resetIdleTimer();
  this.captureChunks.push(chunk);

  if (this.state === "BUFFERING") {
    this.bufferChunks.push(chunk);
    const buf = Buffer.concat(this.bufferChunks);
    const text = buf.toString("utf-8");
    if (text.includes("\n\n")) {
      if (this.checkEarlyError?.(text)) {
        this.transition("EARLY_ERROR");
        this.terminal("stream_error", { body: text });
        return;
      }
      this.startStreaming();
    } else if (buf.length >= BUFFER_SIZE_LIMIT) {
      this.startStreaming();
    }
    return;
  }

  this.pipeEntry.write(chunk);
}

onEnd(): void {
  if (this.resolved) return;
  if (this.idleTimer) clearTimeout(this.idleTimer);

  if (this.state === "BUFFERING" && this.checkEarlyError) {
    const text = Buffer.concat(this.captureChunks).toString("utf-8");
    if (this.checkEarlyError(text)) {
      this.transition("EARLY_ERROR");
      this.terminal("stream_error", { body: text });
      return;
    }
    this.startStreaming();
  }

  if (this.state === "STREAMING") {
    this.transition("COMPLETED");
  }
  this.pipeEntry.end();
  if (this.headersSent) this.reply.raw.end();
  this.terminal("stream_success", {
    metrics: this.collectMetrics(true),
  });
}

onUpstreamError(err: Error): void {
  if (this.resolved) return;
  this.resolved = true;
  this.cleanup();
  if (this.resolveFn) {
    this.resolveFn({ kind: "throw", error: err });
  } else {
    this.pendingResult = { kind: "throw", error: err };
  }
}
```

- [ ] **Commit**

```bash
git add src/proxy/transport.ts
git commit -m "feat: add StreamProxy event handlers and cleanup"
```

## Step 15: 实现 `callStream` - 流式传输入口函数

- [ ] 在 `src/proxy/transport.ts` 中添加 `callStream` 函数：

```typescript
export function callStream(
  backend: { base_url: string },
  apiKey: string,
  body: Record<string, unknown>,
  clientHeaders: RawHeaders,
  reply: FastifyReply,
  timeoutMs: number,
  upstreamPath: string,
  buildHeaders: BuildHeadersFn,
  metricsTransform?: SSEMetricsTransform,
  checkEarlyError?: (bufferedData: string) => boolean,
): Promise<TransportResult> {
  // 处理流式请求的上游非 200 情况（不进入状态机）
  // 和 200 情况（进入 StreamProxy 状态机）

  return new Promise((resolve) => {
    const url = new URL(`${backend.base_url}${upstreamPath}`);
    const payload = JSON.stringify(body);
    const upstreamHeaders = buildHeaders(clientHeaders, apiKey, Buffer.byteLength(payload));
    const options = buildRequestOptions(url, upstreamHeaders);

    const upstreamReq = createUpstreamRequest(url, options);

    upstreamReq.on("response", (upstreamRes) => {
      const statusCode = upstreamRes.statusCode || UPSTREAM_BAD_GATEWAY;

      // 非 200：收集完整 body，返回 stream_error
      if (statusCode !== 200) {
        const chunks: Buffer[] = [];
        upstreamRes.on("data", (chunk: Buffer) => chunks.push(chunk));
        upstreamRes.on("end", () => {
          resolve({
            kind: "stream_error",
            statusCode,
            body: Buffer.concat(chunks).toString("utf-8"),
            headers: filterHeaders(upstreamRes.headers as RawHeaders),
            sentHeaders: upstreamHeaders,
          });
        });
        return;
      }

      // 200：创建 StreamProxy 状态机
      const proxy = new StreamProxy(
        statusCode,
        upstreamRes.headers as RawHeaders,
        upstreamHeaders,
        reply,
        metricsTransform,
        checkEarlyError,
        timeoutMs,
      );

      // deferred resolve：bindResolve 将外层 Promise 的 resolve 绑定到 StreamProxy
      // 事件是异步的，所以 bindResolve 始终在 terminal() 之前被调用
      proxy.bindResolve(resolve);

      proxy.registerCloseHandler();

      // 无早期错误检测时，立即开始流式转发
      if (!checkEarlyError) proxy.startStreaming();

      proxy.resetIdleTimer();

      upstreamRes.on("data", (chunk: Buffer) => proxy.onData(chunk));
      upstreamRes.on("end", () => proxy.onEnd());
      upstreamRes.on("error", (err: Error) => proxy.onUpstreamError(err));
    });

    upstreamReq.on("error", (error) => resolve({ kind: "throw", error }));
    upstreamReq.write(payload);
    upstreamReq.end();
  });
}
```

注意：StreamProxy 使用 deferred resolve 模式。构造器不接收 Promise，而是在 callStream 中通过 `proxy.bindResolve(resolve)` 绑定外层 Promise 的 resolve。`terminal()` 通过 `resolveFn`/`pendingResult` 保证即使 bindResolve 前就到达终态也不会丢失结果（实际上不会发生，因为事件是异步的）。

- [ ] **Commit**

```bash
git add src/proxy/transport.ts
git commit -m "feat: add callStream entry point with StreamProxy integration"
```


## Step 16: 运行测试验证 StreamProxy 实现

- [ ] 执行：

```bash
npx vitest run tests/transport.test.ts
```

逐个修复测试失败，直到全部通过。重点关注：
- 状态转换守卫是否正确拦截非法转换
- close handler 是否只注册一次
- terminal() 是否防止重复 resolve
- BUFFERING → STREAMING 转换时 writeHead 是否被调用
- BUFFERING → EARLY_ERROR 时 writeHead 不应被调用

## Step 17: 修改 `proxy-core.ts` - 替换 upstream-call 导入

- [ ] 修改 `src/proxy/proxy-core.ts`：

将 `upstream-call.js` 的导入替换为 `transport.js`：

```typescript
// 删除：
import {
  proxyNonStream as upstreamNonStream,
  proxyStream as upstreamStream,
  proxyGetRequest as upstreamGet,
  type ProxyResult,
  type StreamProxyResult,
  type GetProxyResult,
} from "./upstream-call.js";

// 替换为：
import {
  callNonStream,
  callStream,
  callGet as upstreamGet,
} from "./transport.js";
import type { TransportResult } from "./types.js";
```

- [ ] 删除 `proxy-core.ts` 中对旧类型的 re-export：

```typescript
// 删除：
export type { ProxyResult, StreamProxyResult, GetProxyResult };
```

- [ ] 在 `proxy-core.ts` 顶部添加新的 re-export：

```typescript
export type { TransportResult } from "./types.js";
export type { GetTransportResult } from "./transport.js";
```

- [ ] **Commit**

```bash
git add src/proxy/proxy-core.ts
git commit -m "refactor: replace upstream-call imports with transport"
```

## Step 18: 适配 `proxy-core.ts` 中 handleProxyPost 的调用方式

- [ ] 修改 `handleProxyPost` 中 `upstreamNonStream` 调用处，适配新接口：

原代码调用 `upstreamNonStream` 返回 `ProxyResult`（可能 throw），新接口 `callNonStream` 返回 `TransportResult`（永远不 throw）。

```typescript
// 修改前（proxy-core.ts 中的 retryableCall 回调）：
() => upstreamNonStream(provider, apiKey, body, cliHdrs, upstreamPath, buildUpstreamHeaders)

// 修改后 — 需要适配层把 TransportResult 映射回 ProxyResult 或 throw
// 因为 retry.ts 仍然使用旧的 ProxyResult/StreamProxyResult 类型
// PR-1 阶段保持 retry.ts 不变，所以在 transport 层提供适配函数
```

这里有一个关键决策点：PR-1 是否保持 `retry.ts` 的接口不变？

**决策：保持不变。** 在 transport.ts 中提供向后兼容的 wrapper 函数：

```typescript
// transport.ts 中添加向后兼容 wrapper
export function proxyNonStreamCompat(
  backend: { base_url: string },
  apiKey: string,
  body: Record<string, unknown>,
  clientHeaders: RawHeaders,
  upstreamPath: string,
  buildHeaders: BuildHeadersFn,
): Promise<ProxyResult> {
  return callNonStream(backend, apiKey, body, clientHeaders, upstreamPath, buildHeaders)
    .then((result) => {
      if (result.kind === "throw") throw result.error;
      // success 和 error 都映射为 ProxyResult
      return {
        statusCode: result.statusCode,
        body: result.body,
        headers: result.headers,
        sentHeaders: result.sentHeaders,
        sentBody: result.sentBody,
      };
    });
}
```

类似地为 stream 提供 compat wrapper。这样 `proxy-core.ts` 的改动最小。

## Step 19: 实现向后兼容 wrapper 函数

- [ ] 在 `src/proxy/transport.ts` 中添加 compat wrapper：

```typescript
// ---------- Backward-compatible wrappers (PR-1 only, removed in PR-2) ----------

export interface ProxyResult {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
  sentHeaders: Record<string, string>;
  sentBody: string;
}

export interface StreamProxyResult {
  statusCode: number;
  responseBody?: string;
  upstreamResponseHeaders?: Record<string, string>;
  sentHeaders?: Record<string, string>;
  metricsResult?: MetricsResult;
  abnormalClose?: boolean;
}

export function proxyNonStreamCompat(
  backend: { base_url: string },
  apiKey: string,
  body: Record<string, unknown>,
  clientHeaders: RawHeaders,
  upstreamPath: string,
  buildHeaders: BuildHeadersFn,
): Promise<ProxyResult> {
  return callNonStream(backend, apiKey, body, clientHeaders, upstreamPath, buildHeaders)
    .then((r) => {
      if (r.kind === "throw") throw r.error;
      return {
        statusCode: r.statusCode,
        body: "body" in r ? r.body : "",
        headers: "headers" in r ? r.headers : {},
        sentHeaders: r.sentHeaders,
        sentBody: "sentBody" in r ? r.sentBody : "",
      };
    });
}

export function proxyStreamCompat(
  backend: { base_url: string },
  apiKey: string,
  body: Record<string, unknown>,
  clientHeaders: RawHeaders,
  reply: FastifyReply,
  timeoutMs: number,
  upstreamPath: string,
  buildHeaders: BuildHeadersFn,
  metricsTransform?: SSEMetricsTransform,
  checkEarlyError?: (bufferedData: string) => boolean,
): Promise<StreamProxyResult> {
  return callStream(backend, apiKey, body, clientHeaders, reply, timeoutMs, upstreamPath, buildHeaders, metricsTransform, checkEarlyError)
    .then((r) => {
      if (r.kind === "throw") throw r.error;
      return {
        statusCode: r.statusCode,
        responseBody: r.kind === "stream_success" ? undefined : ("body" in r ? r.body : undefined),
        upstreamResponseHeaders: r.upstreamResponseHeaders ?? r.headers ?? {},
        sentHeaders: r.sentHeaders,
        metricsResult: r.metrics ?? undefined,
        abnormalClose: r.kind === "stream_abort",
      };
    });
}
```

- [ ] **Commit**

```bash
git add src/proxy/transport.ts
git commit -m "feat: add backward-compatible compat wrappers for PR-1 bridge"
```

## Step 20: 更新 `proxy-core.ts` 使用 compat wrapper

- [ ] 修改 `src/proxy/proxy-core.ts` 的导入和调用：

```typescript
// 替换 upstream-call 导入为 transport compat wrapper
import {
  proxyNonStreamCompat as upstreamNonStream,
  proxyStreamCompat as upstreamStream,
  callGet as upstreamGet,
  type ProxyResult,
  type StreamProxyResult,
} from "./transport.js";
```

删除旧的 `GetProxyResult` 导入，替换为：

```typescript
import type { GetTransportResult } from "./transport.js";
```

更新 `proxyGetRequest` 函数签名：

```typescript
export function proxyGetRequest(
  backend: Provider,
  apiKey: string,
  clientHeaders: RawHeaders,
  upstreamPath: string,
): Promise<GetTransportResult> {
  return upstreamGet(backend, apiKey, clientHeaders, upstreamPath, buildUpstreamHeaders);
}
```

保持 re-export（向后兼容）：

```typescript
export type { ProxyResult, StreamProxyResult } from "./transport.js";
export type { GetTransportResult as GetProxyResult } from "./transport.js";
```

- [ ] **Commit**

```bash
git add src/proxy/proxy-core.ts
git commit -m "refactor: wire proxy-core to use transport compat wrappers"
```

## Step 21: 更新 `proxy-logging.ts` 的类型导入

- [ ] 修改 `src/proxy/proxy-logging.ts`：

```typescript
// 修改前：
import type { ProxyResult, StreamProxyResult } from "./upstream-call.js";

// 修改后：
import type { ProxyResult, StreamProxyResult } from "./transport.js";
```

- [ ] **Commit**

```bash
git add src/proxy/proxy-logging.ts
git commit -m "refactor: update proxy-logging type imports to transport.js"
```

## Step 22: 更新 `retry.ts` 的类型导入

- [ ] 修改 `src/proxy/retry.ts`：

```typescript
// 修改前：
import type { ProxyResult, StreamProxyResult } from "./proxy-core.js";

// 修改后：
import type { ProxyResult, StreamProxyResult } from "./transport.js";
```

- [ ] **Commit**

```bash
git add src/proxy/retry.ts
git commit -m "refactor: update retry.ts type imports to transport.js"
```

## Step 23: 删除 `src/proxy/upstream-call.ts`

- [ ] 删除文件：`src/proxy/upstream-call.ts`

- [ ] 全局搜索确认无残留导入：

```bash
grep -r "upstream-call" src/ tests/ --include="*.ts"
```

确认结果为空。

## Step 24: 全量验证

- [ ] 按顺序执行：

```bash
# 1. 类型检查
npx tsc --noEmit

# 2. 全量测试
npx vitest run

# 3. ESLint
npm run lint
```

三个命令都必须通过（lint 零警告容忍）。

## Step 25: 清理和提交

- [ ] 检查是否有未使用的导入或导出
- [ ] 确认 `src/proxy/types.ts` 是 `RawHeaders`、`UPSTREAM_SUCCESS`、`TransportResult`、`StreamState` 的唯一定义源
- [ ] 确认所有 re-export 链正确（proxy-logging.ts re-export from types.ts, proxy-core.ts re-export from transport.js）
- [ ] 提交代码

---

## 关键实现细节备注

### StreamProxy 构造时序

StreamProxy 使用 deferred resolve 模式。构造器不接收 Promise，callStream 在创建 StreamProxy 后立即调用 `bindResolve(resolve)` 绑定外层 Promise 的 resolve。

```
callStream 创建 Promise → new StreamProxy → proxy.bindResolve(resolve) → 事件注册
```

`terminal()` 在 `bindResolve` 之前被调用的场景不存在（因为事件是异步的），但 `pendingResult` 字段提供防御性保证。

### 状态转换守卫

合法转换：
- `BUFFERING → STREAMING`：收到完整 SSE 事件且非错误，或缓冲区超限
- `BUFFERING → EARLY_ERROR`：checkEarlyError 返回 true
- `STREAMING → COMPLETED`：upstream end 事件
- `STREAMING → ABORTED`：客户端断连或 pipe 错误

非法转换直接 throw，因为这说明逻辑有 bug。

### close handler 注册一次

通过 `closeHandlerRegistered` 布尔守卫保证 `reply.raw.on("close", ...)` 只注册一次。这对 failover 重试场景至关重要（同一个 reply.raw 不能累积多个 close listener）。

### compat wrapper 寿命

`proxyNonStreamCompat` / `proxyStreamCompat` / `ProxyResult` / `StreamProxyResult` 是 PR-1 的临时桥接。PR-2 重构 retry 层时会删除这些 wrapper，所有代码直接使用 `TransportResult`。
