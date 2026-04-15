import { request as httpRequestFn, IncomingMessage } from "http";
import { request as httpsRequestFn } from "https";
import { PassThrough } from "stream";
import type { FastifyReply } from "fastify";
import type { Provider } from "../db/index.js";

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
}

export interface GetProxyResult {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}

// ---------- Constants ----------

const HTTPS_DEFAULT_PORT = 443;
const HTTP_DEFAULT_PORT = 80;
const UPSTREAM_BAD_GATEWAY = 502;
const UPSTREAM_SUCCESS = 200;

// ---------- Header utilities ----------

export const SKIP_UPSTREAM = new Set([
  "host",
  "content-length",
  "accept-encoding",
  "authorization",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
]);

export const SKIP_DOWNSTREAM = new Set([
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
]);

export function selectHeaders(
  raw: Record<string, string | string[] | undefined>,
  skip: Set<string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value == null || skip.has(key.toLowerCase())) continue;
    out[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

// 当前两个 provider 都使用 Bearer token（commit eaa4f7d 将 Anthropic 从 x-api-key 改为 Bearer）
// 如果未来需要支持其他鉴权方式，需要参数化 header 构造
/** 构建发往上游的请求 headers：过滤客户端 headers + 注入后端 API key */
export function buildUpstreamHeaders(
  clientHeaders: Record<string, string | string[] | undefined>,
  apiKey: string,
  payloadBytes: number
): Record<string, string> {
  const headers = selectHeaders(clientHeaders, SKIP_UPSTREAM);
  headers["Authorization"] = `Bearer ${apiKey}`;
  headers["Content-Type"] = "application/json";
  headers["Content-Length"] = String(payloadBytes);
  return headers;
}

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
  backend: Provider,
  apiKey: string,
  body: Record<string, unknown>,
  clientHeaders: Record<string, string | string[] | undefined>,
  upstreamPath: string
): Promise<ProxyResult> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${backend.base_url}${upstreamPath}`);
    const payload = JSON.stringify(body);
    const upstreamHeaders = buildUpstreamHeaders(clientHeaders, apiKey, Buffer.byteLength(payload));
    const options = buildRequestOptions(url, upstreamHeaders);

    const req = createUpstreamRequest(url, options);
    req.on("response", (res: IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode || UPSTREAM_BAD_GATEWAY,
          body: Buffer.concat(chunks).toString("utf-8"),
          headers: selectHeaders(
            res.headers as Record<string, string | string[] | undefined>,
            SKIP_DOWNSTREAM
          ),
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
  backend: Provider,
  apiKey: string,
  body: Record<string, unknown>,
  clientHeaders: Record<string, string | string[] | undefined>,
  reply: FastifyReply,
  timeoutMs: number,
  upstreamPath: string
): Promise<StreamProxyResult> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${backend.base_url}${upstreamPath}`);
    const payload = JSON.stringify(body);
    const upstreamHeaders = buildUpstreamHeaders(clientHeaders, apiKey, Buffer.byteLength(payload));
    const options = buildRequestOptions(url, upstreamHeaders);

    const upstreamReq = createUpstreamRequest(url, options);
    upstreamReq.on("response", (upstreamRes: IncomingMessage) => {
      const statusCode = upstreamRes.statusCode || UPSTREAM_BAD_GATEWAY;

      if (statusCode !== UPSTREAM_SUCCESS) {
        const chunks: Buffer[] = [];
        upstreamRes.on("data", (chunk: Buffer) => chunks.push(chunk));
        upstreamRes.on("end", () => {
          const errorBody = Buffer.concat(chunks).toString("utf-8");
          const errHeaders = selectHeaders(
            upstreamRes.headers as Record<string, string | string[] | undefined>,
            SKIP_DOWNSTREAM
          );
          resolve({ statusCode, responseBody: errorBody, upstreamResponseHeaders: errHeaders });
          for (const [key, value] of Object.entries(errHeaders)) {
            reply.header(key, value);
          }
          reply.status(statusCode).send(errorBody);
        });
        return;
      }

      const sseHeaders = selectHeaders(
        upstreamRes.headers as Record<string, string | string[] | undefined>,
        SKIP_DOWNSTREAM
      );
      sseHeaders["Content-Type"] = "text/event-stream";
      sseHeaders["Cache-Control"] = "no-cache";
      sseHeaders["Connection"] = "keep-alive";
      reply.raw.writeHead(statusCode, sseHeaders);

      const passThrough = new PassThrough();
      passThrough.pipe(reply.raw);

      const captureChunks: Buffer[] = [];
      let idleTimer: NodeJS.Timeout | null = null;
      let resolved = false;

      function cleanup() {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = null;
        if (!passThrough.destroyed) passThrough.destroy();
        if (!upstreamRes.destroyed) upstreamRes.destroy();
      }

      reply.raw.on("close", () => {
        if (!resolved) {
          cleanup();
          resolve({ statusCode, responseBody: undefined, upstreamResponseHeaders: sseHeaders });
        }
      });

      passThrough.on("error", () => {
        cleanup();
        if (!resolved) {
          resolved = true;
          resolve({ statusCode, responseBody: undefined, upstreamResponseHeaders: sseHeaders });
        }
      });

      function resetIdleTimer() {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          cleanup();
          if (!resolved) {
            resolved = true;
            resolve({ statusCode, responseBody: undefined, upstreamResponseHeaders: sseHeaders });
          }
        }, timeoutMs);
      }

      resetIdleTimer();

      upstreamRes.on("data", (chunk: Buffer) => {
        if (resolved) return;
        resetIdleTimer();
        passThrough.write(chunk);
        captureChunks.push(chunk);
      });

      upstreamRes.on("end", () => {
        if (resolved) return;
        resolved = true;
        if (idleTimer) clearTimeout(idleTimer);
        passThrough.end();
        reply.raw.end();
        resolve({
          statusCode,
          responseBody: Buffer.concat(captureChunks).toString("utf-8"),
          upstreamResponseHeaders: sseHeaders,
        });
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
  backend: Provider,
  apiKey: string,
  clientHeaders: Record<string, string | string[] | undefined>,
  upstreamPath: string
): Promise<GetProxyResult> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${backend.base_url}${upstreamPath}`);
    const headers = selectHeaders(clientHeaders, SKIP_UPSTREAM);
    headers["Authorization"] = `Bearer ${apiKey}`;
    const options = buildRequestOptions(url, headers, "GET");

    const req = createUpstreamRequest(url, options);
    req.on("response", (res: IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode || UPSTREAM_BAD_GATEWAY,
          body: Buffer.concat(chunks).toString("utf-8"),
          headers: selectHeaders(
            res.headers as Record<string, string | string[] | undefined>,
            SKIP_DOWNSTREAM
          ),
        });
      });
    });
    req.on("error", (err) => reject(err));
    req.end();
  });
}
