import { request as httpRequestFn } from "http";
import { request as httpsRequestFn } from "https";
import { PassThrough } from "stream";
import type { FastifyReply } from "fastify";
import { UPSTREAM_SUCCESS } from "./types.js";
import type { RawHeaders, StreamState, TransportResult } from "./types.js";
import type { MetricsResult } from "../metrics/metrics-extractor.js";
import type { SSEMetricsTransform } from "../metrics/sse-metrics-transform.js";

// ---------- Constants ----------

const UPSTREAM_BAD_GATEWAY = 502;
const UPSTREAM_SUCCESS_RANGE = 100;
const BUFFER_SIZE_LIMIT = 4096;
const HTTPS_DEFAULT_PORT = 443;
const HTTP_DEFAULT_PORT = 80;

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

// 可变引用，方便测试替换。模块内通过此对象间接调用。
export const _transportInternals = {
  createUpstreamRequest(url: URL, options: UpstreamRequestOptions) {
    return url.protocol === "https:"
      ? httpsRequestFn(options)
      : httpRequestFn(options);
  },
};

export function createUpstreamRequest(
  url: URL,
  options: UpstreamRequestOptions,
) {
  return _transportInternals.createUpstreamRequest(url, options);
}

export function buildRequestOptions(
  url: URL,
  headers: Record<string, string>,
  method = "POST",
): UpstreamRequestOptions {
  return {
    hostname: url.hostname,
    port:
      Number(url.port) ||
      (url.protocol === "https:" ? HTTPS_DEFAULT_PORT : HTTP_DEFAULT_PORT),
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

// ---------- BuildHeaders type ----------

export type BuildHeadersFn = (
  cliHdrs: RawHeaders,
  key: string,
  bytes?: number,
) => Record<string, string>;

// ---------- callNonStream ----------

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
    const upstreamHeaders = buildHeaders(
      clientHeaders,
      apiKey,
      Buffer.byteLength(payload),
    );
    const options = buildRequestOptions(url, upstreamHeaders);

    const req = _transportInternals.createUpstreamRequest(url, options);

    req.on("response", (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const statusCode = res.statusCode || UPSTREAM_BAD_GATEWAY;
        const responseBody = Buffer.concat(chunks).toString("utf-8");
        const headers = filterHeaders(res.headers as RawHeaders);

        if (statusCode >= UPSTREAM_SUCCESS && statusCode < UPSTREAM_SUCCESS + UPSTREAM_SUCCESS_RANGE) {
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

// ---------- callGet ----------

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

    const req = _transportInternals.createUpstreamRequest(url, options);
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

// ---------- StreamProxy state machine ----------

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
    rawUpstreamHeaders: RawHeaders,
    private readonly sentUpstreamHeaders: Record<string, string>,
    private readonly reply: FastifyReply,
    private readonly metricsTransform: SSEMetricsTransform | undefined,
    private readonly checkEarlyError: ((data: string) => boolean) | undefined,
    private readonly timeoutMs: number,
  ) {
    this.sseHeaders = filterHeaders(rawUpstreamHeaders);
    this.sseHeaders["Content-Type"] = "text/event-stream";
    this.sseHeaders["Cache-Control"] = "no-cache";
    this.sseHeaders["Connection"] = "keep-alive";
    this.pipeEntry = metricsTransform ?? this.passThrough;
  }

  bindResolve(resolve: (result: TransportResult) => void): void {
    this.resolveFn = resolve;
    if (this.pendingResult) resolve(this.pendingResult);
  }

  // --- 状态转换与终止 ---

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

  private terminal(kind: StreamTerminalKind, extra: Record<string, unknown> = {}): void {
    if (this.resolved) return;
    this.resolved = true;
    this.cleanup();

    const base = {
      statusCode: this.statusCode,
      upstreamResponseHeaders: this.sseHeaders,
      sentHeaders: this.sentUpstreamHeaders,
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

  private cleanup(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (!this.passThrough.destroyed) this.passThrough.destroy();
    if (this.metricsTransform && !this.metricsTransform.destroyed) this.metricsTransform.destroy();
  }

  // --- 指标与计时 ---

  private collectMetrics(isComplete: boolean): MetricsResult | undefined {
    if (!this.metricsTransform) return undefined;
    const result = this.metricsTransform.getExtractor().getMetrics();
    return isComplete ? result : { ...result, is_complete: 0 };
  }

  /** @internal callStream 需要调用 */
  resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.resolved) return;
      this.terminal("stream_abort", { metrics: this.collectMetrics(false) });
    }, this.timeoutMs);
  }

  // --- 流式传输启动 ---

  /** @internal callStream 需要调用 */
  startStreaming(): void {
    if (this.headersSent) return;
    this.transition("STREAMING");
    this.headersSent = true;
    this.reply.raw.writeHead(this.statusCode, this.sseHeaders);
    if (this.metricsTransform) {
      this.metricsTransform.pipe(this.passThrough, { end: true });
    }
    // 手动转发而非 pipe，避免 Node.js 在 dest 上自动注册 close/finish handler
    this.passThrough.on("data", (chunk: Buffer) => {
      this.reply.raw.write(chunk);
    });
    this.passThrough.on("end", () => {
      if (this.headersSent) this.reply.raw.end();
    });
    for (const c of this.bufferChunks) this.pipeEntry.write(c);
    this.bufferChunks.length = 0;
  }

  // --- 事件处理 handlers ---

  registerCloseHandler(): void {
    if (this.closeHandlerRegistered) return;
    this.closeHandlerRegistered = true;
    this.reply.raw.on("close", () => {
      if (this.resolved) return;
      if (this.state === "BUFFERING" || this.state === "STREAMING") {
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

    // 正常完成时先 resolve Promise，再结束管道。
    // 顺序很重要：resolve 让调用者（proxy-core）的 await 继续，
    // 后续的 pipeEntry.end() → reply.raw.end() 确保响应数据完整发送。
    // 如果先 end 再 resolve，Fastify inject 可能在 resolve 之前返回。
    this.resolved = true;
    const metrics = this.collectMetrics(true);
    const result: TransportResult = {
      kind: "stream_success",
      statusCode: this.statusCode,
      upstreamResponseHeaders: this.sseHeaders,
      sentHeaders: this.sentUpstreamHeaders,
      metrics,
    };
    if (this.resolveFn) {
      this.resolveFn(result);
    } else {
      this.pendingResult = result;
    }

    this.pipeEntry.end();
    if (this.headersSent) this.reply.raw.end();

    // 延迟清理，不阻塞 resolve 链路
    setImmediate(() => this.cleanup());
  }

  onUpstreamError(err: Error): void {
    if (this.resolved) return;
    this.resolved = true;
    this.cleanup();
    const result: TransportResult = { kind: "throw", error: err };
    if (this.resolveFn) {
      this.resolveFn(result);
    } else {
      this.pendingResult = result;
    }
  }
}

// ---------- callStream ----------

/**
 * 调用流式上游请求。支持两种 resolve 方式：
 * 1. 默认：返回 `Promise<TransportResult>`
 * 2. 传入 `compatResolve`：在 terminal 时直接调用该函数，避免 `.then()` 微任务延迟
 */
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
  compatResolve?: (result: TransportResult) => void,
): Promise<TransportResult> {
  return new Promise((resolve) => {
    const effectiveResolve = compatResolve ?? resolve;
    const url = new URL(`${backend.base_url}${upstreamPath}`);
    const payload = JSON.stringify(body);
    const upstreamHeaders = buildHeaders(clientHeaders, apiKey, Buffer.byteLength(payload));
    const options = buildRequestOptions(url, upstreamHeaders);

    const upstreamReq = _transportInternals.createUpstreamRequest(url, options);

    upstreamReq.on("response", (upstreamRes) => {
      const statusCode = upstreamRes.statusCode || UPSTREAM_BAD_GATEWAY;

      if (statusCode !== UPSTREAM_SUCCESS) {
        const chunks: Buffer[] = [];
        upstreamRes.on("data", (chunk: Buffer) => chunks.push(chunk));
        upstreamRes.on("end", () => {
          effectiveResolve({
            kind: "stream_error",
            statusCode,
            body: Buffer.concat(chunks).toString("utf-8"),
            headers: filterHeaders(upstreamRes.headers as RawHeaders),
            sentHeaders: upstreamHeaders,
          });
        });
        return;
      }

      const proxy = new StreamProxy(
        statusCode,
        upstreamRes.headers as RawHeaders,
        upstreamHeaders,
        reply,
        metricsTransform,
        checkEarlyError,
        timeoutMs,
      );

      proxy.bindResolve(effectiveResolve);
      proxy.registerCloseHandler();

      // 无 early error checker 时直接开始流式传输
      if (!checkEarlyError) proxy.startStreaming();

      proxy.resetIdleTimer();

      upstreamRes.on("data", (chunk: Buffer) => proxy.onData(chunk));
      upstreamRes.on("end", () => proxy.onEnd());
      upstreamRes.on("error", (err: Error) => proxy.onUpstreamError(err));
    });

    upstreamReq.on("error", (error) => effectiveResolve({ kind: "throw", error }));
    upstreamReq.write(payload);
    upstreamReq.end();
  });
}

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
  return new Promise((resolve, reject) => {
    function onResult(r: TransportResult): void {
      if (r.kind === "throw") { reject(r.error); return; }
      const metrics = (r.kind === "stream_success" || r.kind === "stream_abort") ? r.metrics : undefined;
      resolve({
        statusCode: r.statusCode,
        responseBody: r.kind === "stream_success" ? undefined : ("body" in r ? r.body : undefined),
        upstreamResponseHeaders: ("upstreamResponseHeaders" in r ? r.upstreamResponseHeaders : undefined) ?? ("headers" in r ? r.headers : {}) ?? {},
        sentHeaders: r.sentHeaders,
        metricsResult: metrics ?? undefined,
        abnormalClose: r.kind === "stream_abort",
      });
    }
    // compatResolve 让 callStream 在 terminal 时直接调用 onResult，
    // 而不是通过 .then() 微任务，确保 Fastify inject 时序正确。
    callStream(backend, apiKey, body, clientHeaders, reply, timeoutMs, upstreamPath, buildHeaders, metricsTransform, checkEarlyError, onResult);
  });
}
