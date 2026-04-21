import { request as httpRequestFn, IncomingMessage } from "http";
import { request as httpsRequestFn } from "https";
import { PassThrough } from "stream";
import type { FastifyReply } from "fastify";
import type { RawHeaders } from "./proxy-core.js";
import type { MetricsResult } from "../metrics/metrics-extractor.js";
import { SSEMetricsTransform } from "../metrics/sse-metrics-transform.js";

// ---------- Types ----------

export interface UpstreamRequestOptions {
  hostname: string;
  port: number;
  path: string;
  method: string;
  headers: Record<string, string>;
}

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
  /** true 表示流未正常结束就被中断（客户端断连或 pipe 错误） */
  abnormalClose?: boolean;
}

export interface GetProxyResult {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}

// ---------- Constants ----------

const UPSTREAM_SUCCESS = 200;
const UPSTREAM_BAD_GATEWAY = 502;
const HTTPS_DEFAULT_PORT = 443;
const HTTP_DEFAULT_PORT = 80;
const BUFFER_SIZE_LIMIT = 4096;

// ---------- Request utilities ----------

/** 根据 URL scheme 选择 http 或 https 模块 */
export function createUpstreamRequest(url: URL, options: UpstreamRequestOptions) {
  return url.protocol === "https:" ? httpsRequestFn(options) : httpRequestFn(options);
}

/** 从 URL + headers 构造 Node.js http.request 所需的 options */
export function buildRequestOptions(
  url: URL,
  headers: Record<string, string>,
  method = "POST"
): UpstreamRequestOptions {
  return {
    hostname: url.hostname,
    port: Number(url.port) || (url.protocol === "https:" ? HTTPS_DEFAULT_PORT : HTTP_DEFAULT_PORT),
    path: url.pathname,
    method,
    headers,
  };
}

// ---------- Non-stream proxy ----------

export function proxyNonStream(
  backend: { base_url: string },
  apiKey: string,
  body: Record<string, unknown>,
  clientHeaders: RawHeaders,
  upstreamPath: string,
  buildHeaders: (cliHdrs: RawHeaders, key: string, bytes?: number) => Record<string, string>,
): Promise<ProxyResult> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${backend.base_url}${upstreamPath}`);
    const payload = JSON.stringify(body);
    const upstreamHeaders = buildHeaders(clientHeaders, apiKey, Buffer.byteLength(payload));
    const options = buildRequestOptions(url, upstreamHeaders);

    const req = createUpstreamRequest(url, options);
    req.on("response", (res: IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode || UPSTREAM_BAD_GATEWAY,
          body: Buffer.concat(chunks).toString("utf-8"),
          headers: filterHeaders(res.headers as RawHeaders),
          sentHeaders: { ...upstreamHeaders },
          sentBody: payload,
        });
      });
    });
    req.on("error", (err) => reject(err));
    req.write(payload);
    req.end();
  });
}

// ---------- Stream proxy (SSE) ----------

export function proxyStream(
  backend: { base_url: string },
  apiKey: string,
  body: Record<string, unknown>,
  clientHeaders: RawHeaders,
  reply: FastifyReply,
  timeoutMs: number,
  upstreamPath: string,
  buildHeaders: (cliHdrs: RawHeaders, key: string, bytes?: number) => Record<string, string>,
  metricsTransform?: SSEMetricsTransform,
  checkEarlyError?: (bufferedData: string) => boolean,
): Promise<StreamProxyResult> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${backend.base_url}${upstreamPath}`);
    const payload = JSON.stringify(body);
    const upstreamHeaders = buildHeaders(clientHeaders, apiKey, Buffer.byteLength(payload));
    const options = buildRequestOptions(url, upstreamHeaders);

    const upstreamReq = createUpstreamRequest(url, options);
    upstreamReq.on("response", (upstreamRes: IncomingMessage) => {
      const statusCode = upstreamRes.statusCode || UPSTREAM_BAD_GATEWAY;

      if (statusCode !== UPSTREAM_SUCCESS) {
        const chunks: Buffer[] = [];
        upstreamRes.on("data", (chunk: Buffer) => chunks.push(chunk));
        upstreamRes.on("end", () => {
          const errorBody = Buffer.concat(chunks).toString("utf-8");
          resolve({
            statusCode,
            responseBody: errorBody,
            upstreamResponseHeaders: filterHeaders(upstreamRes.headers as RawHeaders),
            sentHeaders: upstreamHeaders,
          });
        });
        return;
      }

      const sseHeaders = filterHeaders(upstreamRes.headers as RawHeaders);
      sseHeaders["Content-Type"] = "text/event-stream";
      sseHeaders["Cache-Control"] = "no-cache";
      sseHeaders["Connection"] = "keep-alive";

      let headersSent = false;
      let bufferPhase = !!checkEarlyError;
      const bufferChunks: Buffer[] = [];

      const passThrough = new PassThrough();
      const pipeEntry = metricsTransform ?? passThrough;

      const captureChunks: Buffer[] = [];
      let idleTimer: NodeJS.Timeout | null = null;
      let resolved = false;

      function startStreaming() {
        if (headersSent) return;
        headersSent = true;
        bufferPhase = false;
        reply.raw.writeHead(statusCode, sseHeaders);
        if (metricsTransform) {
          metricsTransform.pipe(passThrough).pipe(reply.raw);
        } else {
          passThrough.pipe(reply.raw);
        }
        for (const c of bufferChunks) pipeEntry.write(c);
        bufferChunks.length = 0;
      }

      // 无早期错误检测时，立即开始流式转发
      if (!checkEarlyError) startStreaming();

      function cleanup() {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = null;
        if (!passThrough.destroyed) passThrough.destroy();
        if (metricsTransform && !metricsTransform.destroyed) metricsTransform.destroy();
        if (!upstreamRes.destroyed) upstreamRes.destroy();
      }

      function collectMetrics(isComplete: boolean): MetricsResult | undefined {
        if (!metricsTransform) return undefined;
        const result = metricsTransform.getExtractor().getMetrics();
        if (!isComplete) {
          return { ...result, is_complete: 0 };
        }
        return result;
      }

      const makeResult = (
        body: string,
        metrics?: ReturnType<typeof collectMetrics>,
      ) => ({
        statusCode,
        responseBody: body,
        upstreamResponseHeaders: sseHeaders,
        sentHeaders: upstreamHeaders,
        ...(metrics ? { metricsResult: metrics } : {}),
      });

      // 客户端断连时标记 abnormalClose，让调用方能区分正常完成和异常中断
      reply.raw.on("close", () => {
        if (!resolved) {
          cleanup();
          resolve({ statusCode, responseBody: undefined, upstreamResponseHeaders: sseHeaders, sentHeaders: upstreamHeaders, metricsResult: collectMetrics(false), abnormalClose: true });
        }
      });

      passThrough.on("error", () => {
        cleanup();
        if (!resolved) {
          resolved = true;
          resolve({ statusCode, responseBody: undefined, upstreamResponseHeaders: sseHeaders, sentHeaders: upstreamHeaders, metricsResult: collectMetrics(false), abnormalClose: true });
        }
      });

      function resetIdleTimer() {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          cleanup();
          if (!resolved) {
            resolved = true;
            resolve({ statusCode, responseBody: undefined, upstreamResponseHeaders: sseHeaders, sentHeaders: upstreamHeaders, metricsResult: collectMetrics(false) });
          }
        }, timeoutMs);
      }

      resetIdleTimer();

      upstreamRes.on("data", (chunk: Buffer) => {
        if (resolved) return;
        resetIdleTimer();
        captureChunks.push(chunk);

        if (bufferPhase) {
          bufferChunks.push(chunk);
          const buf = Buffer.concat(bufferChunks);
          const text = buf.toString("utf-8");
          if (text.includes("\n\n")) {
            const earlyChecker = checkEarlyError;
            if (earlyChecker?.(text)) {
              // 检测到错误——不发 headers，直接 resolve（可重试）
              resolved = true;
              cleanup();
              resolve(makeResult(text));
              return;
            }
            // 非错误——flush 缓冲，开始流式转发
            startStreaming();
          } else if (buf.length >= BUFFER_SIZE_LIMIT) {
            // 缓冲区超限仍未检测到 \n\n，放弃检测直接转发
            startStreaming();
          }
          return;
        }

        pipeEntry.write(chunk);
      });

      upstreamRes.on("end", () => {
        if (resolved) return;
        resolved = true;
        if (idleTimer) clearTimeout(idleTimer);

        // 如果还在缓冲阶段（流很短，没有 \n\n），也尝试检测错误
        if (bufferPhase && checkEarlyError) {
          const text = Buffer.concat(captureChunks).toString("utf-8");
          if (checkEarlyError(text)) {
            cleanup();
            resolve(makeResult(text));
            return;
          }
          startStreaming();
        }

        pipeEntry.end();
        if (headersSent) reply.raw.end();
        resolve(makeResult(Buffer.concat(captureChunks).toString("utf-8"), collectMetrics(true)));
      });

      upstreamRes.on("error", (err) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        reject(err);
      });
    });

    upstreamReq.on("error", (err) => reject(err));
    upstreamReq.write(payload);
    upstreamReq.end();
  });
}

// ---------- GET proxy ----------

export function proxyGetRequest(
  backend: { base_url: string },
  apiKey: string,
  clientHeaders: RawHeaders,
  upstreamPath: string,
  buildHeaders: (cliHdrs: RawHeaders, key: string) => Record<string, string>,
): Promise<GetProxyResult> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${backend.base_url}${upstreamPath}`);
    const headers = buildHeaders(clientHeaders, apiKey);
    const options = buildRequestOptions(url, headers, "GET");

    const req = createUpstreamRequest(url, options);
    req.on("response", (res: IncomingMessage) => {
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

// ---------- Shared header filter ----------

const SKIP_DOWNSTREAM = new Set([
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
]);

function filterHeaders(raw: RawHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value == null || SKIP_DOWNSTREAM.has(key.toLowerCase())) continue;
    out[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}
