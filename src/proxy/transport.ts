import { request as httpRequestFn } from "http";
import { request as httpsRequestFn } from "https";
import type { FastifyReply } from "fastify";
import { UPSTREAM_SUCCESS, filterHeaders } from "./types.js";
import type { RawHeaders, TransportResult } from "./types.js";
import type { MetricsResult } from "../metrics/metrics-extractor.js";
import type { SSEMetricsTransform } from "../metrics/sse-metrics-transform.js";
import { callStream } from "./stream-proxy.js";

// Re-export callStream from stream-proxy.ts for external consumers
export { callStream } from "./stream-proxy.js";

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

// ---------- Backward-compatible wrappers ----------

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
    callStream(backend, apiKey, body, clientHeaders, reply, timeoutMs, upstreamPath, buildHeaders, metricsTransform, checkEarlyError, onResult);
  });
}
