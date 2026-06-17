import { request as httpRequestFn } from "http";
import { request as httpsRequestFn } from "https";
import type { Agent } from "http";
import { UPSTREAM_SUCCESS, filterHeaders } from "../types.js";
import { buildUpstreamUrl } from "../proxy-core.js";
import type { RawHeaders, TransportResult } from "../types.js";
import { DEFAULT_GET_TIMEOUT_MS } from "../../core/constants.js";
// Re-export callStream from stream-proxy.ts for external consumers
export { callStream } from "./stream.js";

// ---------- Transport options ----------

/** 非流式/流式调用通用可选项：客户端断连信号 + 上游无活动超时。 */
export interface TransportCallOpts {
  signal?: AbortSignal;
}

/** callNonStream 选项：timeoutMs=0/Infinity 表示禁用超时。 */
export interface NonStreamCallOpts extends TransportCallOpts {
  timeoutMs?: number;
}

/** callGet 选项：仅超时（admin 探测，无客户端 signal 关联）。 */
export interface GetCallOpts {
  timeoutMs?: number;
}

// ---------- Constants ----------

const UPSTREAM_BAD_GATEWAY = 502;
const UPSTREAM_SUCCESS_RANGE = 100;
const HTTPS_DEFAULT_PORT = 443;
const HTTP_DEFAULT_PORT = 80;

// ---------- Request utilities ----------

export interface UpstreamRequestOptions {
  hostname: string;
  port: number;
  path: string;
  method: string;
  headers: Record<string, string>;
}

export const _transportInternals = {
  createUpstreamRequest(url: URL, options: UpstreamRequestOptions, agent?: Agent) {
    const opts = agent ? { ...options, agent } : options;
    return url.protocol === "https:"
      ? httpsRequestFn(opts)
      : httpRequestFn(opts);
  },
};

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
  agent?: Agent,
  opts?: NonStreamCallOpts,
): Promise<TransportResult> {
  return new Promise((resolve) => {
    const url = new URL(buildUpstreamUrl(backend.base_url, upstreamPath));
    const payload = JSON.stringify(body);
    const upstreamHeaders = buildHeaders(
      clientHeaders,
      apiKey,
      Buffer.byteLength(payload),
    );
    const options = buildRequestOptions(url, upstreamHeaders);

    const req = _transportInternals.createUpstreamRequest(url, options, agent);

    // 上游无活动超时：0/Infinity 跳过（与 StreamProxy idleTimer 守卫对称）。
    // destroy 必须带 error 参数，否则不 emit 'error' 事件，Promise 永挂。
    const timeoutMs = opts?.timeoutMs;
    if (timeoutMs !== undefined && Number.isFinite(timeoutMs) && timeoutMs > 0) {
      req.setTimeout(timeoutMs);
      req.on("timeout", () => req.destroy(new Error("upstream inactivity timeout")));
    }

    // 客户端断连：abort 信号穿透到上游 socket，立即切断连接。
    // resolveOnce 在 Promise settle 时移除 abort listener，避免重试累积残留
    // （与 callStream 的 resolveOnce 模式对称）。
    const clientSignal = opts?.signal;
    const onClientAbort = clientSignal ? () => req.destroy(new Error("client aborted")) : undefined;
    const resolveOnce: typeof resolve = (r) => {
      if (onClientAbort && clientSignal && !clientSignal.aborted) {
        clientSignal.removeEventListener("abort", onClientAbort);
      }
      resolve(r);
    };
    if (onClientAbort && clientSignal) {
      if (clientSignal.aborted) {
        onClientAbort();
      } else {
        clientSignal.addEventListener("abort", onClientAbort, { once: true });
      }
    }

    req.on("response", (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        const statusCode = res.statusCode || UPSTREAM_BAD_GATEWAY;
        const responseBody = Buffer.concat(chunks).toString("utf-8");
        const headers = filterHeaders(res.headers as RawHeaders);

        if (statusCode >= UPSTREAM_SUCCESS && statusCode < UPSTREAM_SUCCESS + UPSTREAM_SUCCESS_RANGE) {
          resolveOnce({
            kind: "success",
            statusCode,
            body: responseBody,
            headers,
            sentHeaders: upstreamHeaders,
            sentBody: payload,
          });
        } else {
          resolveOnce({
            kind: "error",
            statusCode,
            body: responseBody,
            headers,
            sentHeaders: upstreamHeaders,
            sentBody: payload,
          });
        }
      });
      // 上游响应过程中连接中断时，IncomingMessage 发射 'error' 事件。
      // 无 listener 会导致 uncaught exception 使进程退出。
      res.on("error", (error) => resolveOnce({ kind: "throw", error }));
    });

    req.on("error", (error) => resolveOnce({ kind: "throw", error }));
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
  agent?: Agent,
  opts?: GetCallOpts,
): Promise<GetTransportResult> {
  return new Promise((resolve, reject) => {
    const url = new URL(buildUpstreamUrl(backend.base_url, upstreamPath));
    const headers = buildHeaders(clientHeaders, apiKey);
    const options = buildRequestOptions(url, headers, "GET");

    const req = _transportInternals.createUpstreamRequest(url, options, agent);
    // GET 探测默认 30s 超时；destroy(error) 触发 'error' 事件 → reject。
    req.setTimeout(opts?.timeoutMs ?? DEFAULT_GET_TIMEOUT_MS);
    req.on("timeout", () => req.destroy(new Error("GET timeout")));
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
      // 上游响应过程中连接中断时，IncomingMessage 发射 'error' 事件。
      // 无 listener 会导致 uncaught exception 使进程退出。
      res.on("error", (err) => reject(err));
    });
    req.on("error", (err) => reject(err));
    req.end();
  });
}
