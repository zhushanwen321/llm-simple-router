import { PassThrough, Transform } from "stream";
import type { FastifyReply } from "fastify";
import { UPSTREAM_SUCCESS, filterHeaders } from "../types.js";
import { buildUpstreamUrl } from "../proxy-core.js";
import type { RawHeaders, StreamState, TransportResult, MetricsResult } from "../types.js";
import type { SSEMetricsTransform } from "../../metrics/sse-metrics-transform.js";
import type { StreamLoopGuard } from "@llm-router/core/loop-prevention";
import {
  _transportInternals,
  buildRequestOptions,
  type BuildHeadersFn,
} from "./http.js";

const UPSTREAM_BAD_GATEWAY = 502;
const BUFFER_SIZE_LIMIT = 4096;

// ---------- StreamProxy ----------

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
  private readonly formatTransform: Transform | undefined;

  // 流式阶段 SSE error 扫描缓冲（跨 chunk 边界匹配）
  private sseScanBuffer = "";
  private static readonly SSE_SCAN_MAX = 8 * 1024; // eslint-disable-line no-magic-numbers -- 8KB scan buffer

  constructor(
    private readonly statusCode: number,
    rawUpstreamHeaders: RawHeaders,
    private readonly sentUpstreamHeaders: Record<string, string>,
    private readonly reply: FastifyReply,
    private readonly metricsTransform: SSEMetricsTransform | undefined,
    private readonly checkEarlyError: ((data: string) => boolean) | undefined,
    private readonly timeoutMs: number,
    private readonly loopGuard: StreamLoopGuard | undefined,
    formatTransform?: Transform,
    private readonly timeoutContext?: { modelId: string; providerId: string },
    private readonly onTimeoutAbort?: () => void,
  ) {
    this.formatTransform = formatTransform;
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

  private transition(newState: StreamState): void {
    const VALID: Record<StreamState, StreamState[]> = {
      BUFFERING: ["STREAMING", "EARLY_ERROR", "ABORTED"],
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

  private terminal(kind: StreamTerminalKind, extra: Record<string, unknown> = {}, deferred = false): void {
    if (this.resolved) return;
    this.resolved = true;

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
        result = { kind: "stream_error", ...base, body: extra.body as string, headers: this.sseHeaders, headersSent: this.headersSent || undefined };
        break;
      case "stream_abort":
        result = { kind: "stream_abort", ...base, metrics: extra.metrics as MetricsResult | undefined, timeoutContext: extra.timeoutContext as { modelId: string; providerId: string } | undefined, timeoutMs: extra.timeoutMs as number | undefined };
        break;
    }

    // deferred 模式：先 resolve 让 handler 链路（日志写入等）在 microtask 中执行，
    // cleanup 由调用方在 setImmediate（macrotask）中处理。
    if (deferred) {
      if (this.resolveFn) {
        this.resolveFn(result);
      } else {
        this.pendingResult = result;
      }
    } else {
      // stream_abort 且 headers 已发送时，必须 end reply 避免客户端挂起
      // 但如果有 timeoutContext，让 handler 层负责写入错误 SSE 后再 end
      if (kind === "stream_abort" && this.headersSent && !extra.timeoutContext) {
        // eslint-disable-next-line taste/no-silent-catch -- reply may already be destroyed, warn is sufficient
        try { this.reply.raw.end(); } catch { console.warn("[stream-proxy] reply.raw.end() failed, likely already destroyed"); }
      }
      this.cleanup();
      if (this.resolveFn) {
        this.resolveFn(result);
      } else {
        this.pendingResult = result;
      }
    }
  }

  private cleanup(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (this.formatTransform && !this.formatTransform.destroyed) this.formatTransform.destroy();
    if (!this.passThrough.destroyed) this.passThrough.destroy();
    if (this.metricsTransform && !this.metricsTransform.destroyed) this.metricsTransform.destroy();
  }

  private collectMetrics(isComplete: boolean): MetricsResult | undefined {
    if (!this.metricsTransform) return undefined;
    const result = this.metricsTransform.getExtractor().getMetrics();
    return isComplete ? result : { ...result, is_complete: 0 };
  }

  resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (this.resolved) return;
      // 在 terminal() 调用 reply.raw.end() 之前，同步写入超时错误 SSE
      // 必须同步执行，确保 inject() 能正确收集响应体
      if (this.onTimeoutAbort) {
        try { this.onTimeoutAbort(); } catch { /* reply may be destroyed */ } // eslint-disable-line taste/no-silent-catch
      }
      this.terminal("stream_abort", { metrics: this.collectMetrics(false), timeoutContext: this.timeoutContext, timeoutMs: this.timeoutMs });
    }, this.timeoutMs);
  }

  startStreaming(): void {
    if (this.headersSent) return;
    if (this.reply.raw.headersSent) {
      // headers 已由其他代码路径（如前一次 retry 的 StreamProxy）发送，
      // 仅更新状态机避免 BUFFERING 阶段的重复逻辑
      this.transition("STREAMING");
      this.headersSent = true;
      return;
    }
    this.transition("STREAMING");
    this.headersSent = true;
    this.reply.raw.writeHead(this.statusCode, this.sseHeaders);
    if (this.metricsTransform) {
      this.metricsTransform.pipe(this.formatTransform ?? this.passThrough, { end: true });
    }
    if (this.formatTransform) {
      this.formatTransform.pipe(this.passThrough, { end: true });
    }
    // 手动转发而非 pipe，避免 Node.js 在 dest 上自动注册 close/finish handler
    this.passThrough.on("data", (chunk: Buffer) => {
      try {
        this.reply.raw.write(chunk);
      } catch { // eslint-disable-line taste/no-silent-catch
        // 客户端已断开，写已销毁的 socket 会抛出异常，可安全忽略
      }
    });
    // 不在 passThrough end 事件中调用 reply.raw.end()，
    // 因为 onEnd() 统一管理响应结束时机，确保日志在 reply end 之前写入
    for (const c of this.bufferChunks) this.pipeEntry.write(c);
    this.bufferChunks.length = 0;
  }

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

    if (this.state === "BUFFERING") {
      this.captureChunks.push(chunk);
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

    // STREAMING 阶段：扫描 SSE error event（处理跨 chunk 边界）
    if (this.state === "STREAMING" && this.checkEarlyError) {
      this.sseScanBuffer += chunk.toString("utf-8");
      // 保留最近 SSE_SCAN_MAX 字符，避免无限增长
      if (this.sseScanBuffer.length > StreamProxy.SSE_SCAN_MAX) {
        this.sseScanBuffer = this.sseScanBuffer.slice(-StreamProxy.SSE_SCAN_MAX);
      }
      // 快速启发式：只在扫描窗口出现 SSE error 标记时才执行正则匹配
      if (this.sseScanBuffer.includes("event: error") || this.sseScanBuffer.includes('"type":"error"')) {
        if (this.checkEarlyError(this.sseScanBuffer)) {
          this.terminal("stream_error", { body: this.sseScanBuffer });
          // headers 已发送：必须结束 reply 避免 client hang
          if (this.headersSent) {
            setImmediate(() => {
              try { this.reply.raw.end(); } catch { // eslint-disable-line taste/no-silent-catch
                // reply 可能已 destroyed，安全忽略
              }
            });
          }
          return;
        }
      }
    }

    this.pipeEntry.write(chunk);
    if (this.loopGuard?.isTriggered()) {
      this.terminal("stream_abort", { metrics: this.collectMetrics(false) });
      return;
    }
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

    // 通过 terminal 的 deferred 模式统一 resolve：
    // 先 resolve Promise，让 handler 链路（日志写入等）在 microtask 中执行。
    // reply.raw.end() 延迟到 setImmediate（macrotask），确保 microtask 先完成。
    // light-my-request 监听 reply.raw 的 end 事件判定响应完成，
    // 这保证了 inject() 返回时日志已经写入 DB。
    const metrics = this.collectMetrics(true);
    this.terminal("stream_success", { metrics }, true);

    // 延迟结束管道和响应，属于 reply 层面操作，不属于 StreamProxy 状态管理
    setImmediate(() => {
      this.pipeEntry.end();
      if (this.headersSent) {
        try { this.reply.raw.end(); } catch { // eslint-disable-line taste/no-silent-catch
          // reply 可能已 destroyed，安全忽略
        }
      }
      this.cleanup();
    });
  }

  onUpstreamError(err: Error): void {
    if (this.resolved) return;
    this.resolved = true;
    this.cleanup();
    const result: TransportResult = { kind: "throw", error: err, headersSent: this.headersSent };
    if (this.resolveFn) {
      this.resolveFn(result);
    } else {
      this.pendingResult = result;
    }
  }
}

// ---------- callStream ----------

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
  loopGuard?: StreamLoopGuard,
  formatTransform?: import("stream").Transform,
  timeoutContext?: { modelId: string; providerId: string },
  onTimeoutAbort?: () => void,
): Promise<TransportResult> {
  return new Promise((resolve) => {
    const effectiveResolve = compatResolve ?? resolve;
    const url = new URL(buildUpstreamUrl(backend.base_url, upstreamPath));
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
        loopGuard, formatTransform, timeoutContext, onTimeoutAbort,
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
