import { randomUUID } from "crypto";
import { request as httpRequestFn, IncomingMessage } from "http";
import { request as httpsRequestFn } from "https";
import { PassThrough } from "stream";
import type { FastifyReply, FastifyRequest } from "fastify";
import Database from "better-sqlite3";
import type { Provider } from "../db/index.js";
import { getProviderById, insertRequestLog, insertMetrics } from "../db/index.js";
import { decrypt } from "../utils/crypto.js";
import { getSetting } from "../db/settings.js";
import { SSEMetricsTransform } from "../metrics/sse-metrics-transform.js";
import { MetricsExtractor } from "../metrics/metrics-extractor.js";
import type { MetricsResult } from "../metrics/metrics-extractor.js";
import { getMappingGroup } from "../db/index.js";
import { resolveMapping } from "./mapping-resolver.js";
import { retryableCall, buildRetryConfig } from "./retry.js";
import type { RetryRuleMatcher } from "./retry-rules.js";
import type { Target } from "./strategy/types.js";

// ---------- Types ----------

export type RawHeaders = Record<string, string | string[] | undefined>;

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
  /** 流结束时从 SSEMetricsTransform 采集的指标，仅当传入了 metricsTransform 时存在 */
  metricsResult?: MetricsResult;
}

export interface GetProxyResult {
  statusCode: number;
  body: string;
  headers: Record<string, string>;
}

// ---------- Constants ----------

export const UPSTREAM_SUCCESS = 200;
// failover 判断上游请求失败的 HTTP 状态码阈值
const FAILOVER_FAIL_THRESHOLD = 400;
const HTTPS_DEFAULT_PORT = 443;
const HTTP_DEFAULT_PORT = 80;
const UPSTREAM_BAD_GATEWAY = 502;

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
  raw: RawHeaders,
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
  clientHeaders: RawHeaders,
  apiKey: string,
  payloadBytes?: number
): Record<string, string> {
  const headers = selectHeaders(clientHeaders, SKIP_UPSTREAM);
  headers["Authorization"] = `Bearer ${apiKey}`;
  if (payloadBytes !== undefined) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = String(payloadBytes);
  }
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

// ---------- Logging ----------

/** 插入成功请求日志，供 openai/anthropic 插件共享 */
export function insertSuccessLog(
  db: Database.Database,
  apiType: string,
  logId: string,
  model: string,
  provider: Provider,
  isStream: boolean,
  startTime: number,
  reqBody: string,
  clientReq: string,
  upstreamReq: string,
  status: number,
  respBody: string | null,
  upHdrs: Record<string, string>,
  cliHdrs: Record<string, string>,
  isRetry: boolean = false, originalRequestId: string | null = null,
  routerKeyId: string | null = null,
) {
  insertRequestLog(db, {
    id: logId, api_type: apiType, model, provider_id: provider.id,
    status_code: status, latency_ms: Date.now() - startTime,
    is_stream: isStream ? 1 : 0, error_message: null,
    created_at: new Date().toISOString(), request_body: reqBody,
    response_body: respBody, client_request: clientReq, upstream_request: upstreamReq,
    upstream_response: JSON.stringify({ statusCode: status, headers: upHdrs, body: respBody }),
    client_response: JSON.stringify({ statusCode: status, headers: cliHdrs, body: respBody }),
    is_retry: isRetry ? 1 : 0, original_request_id: originalRequestId,
    router_key_id: routerKeyId,
  });
}

// ---------- Non-stream proxy ----------

export function proxyNonStream(
  backend: Provider,
  apiKey: string,
  body: Record<string, unknown>,
  clientHeaders: RawHeaders,
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
          headers: selectHeaders(res.headers as RawHeaders, SKIP_DOWNSTREAM),
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
  clientHeaders: RawHeaders,
  reply: FastifyReply,
  timeoutMs: number,
  upstreamPath: string,
  metricsTransform?: SSEMetricsTransform
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
        // 非200路径：仅返回错误信息，不操作 reply
        const chunks: Buffer[] = [];
        upstreamRes.on("data", (chunk: Buffer) => chunks.push(chunk));
        upstreamRes.on("end", () => {
          const errorBody = Buffer.concat(chunks).toString("utf-8");
          resolve({
            statusCode,
            responseBody: errorBody,
            upstreamResponseHeaders: selectHeaders(upstreamRes.headers as RawHeaders, SKIP_DOWNSTREAM),
            sentHeaders: upstreamHeaders,
          });
        });
        return;
      }

      const sseHeaders = selectHeaders(upstreamRes.headers as RawHeaders, SKIP_DOWNSTREAM);
      sseHeaders["Content-Type"] = "text/event-stream";
      sseHeaders["Cache-Control"] = "no-cache";
      sseHeaders["Connection"] = "keep-alive";
      reply.raw.writeHead(statusCode, sseHeaders);

      const passThrough = new PassThrough();
      if (metricsTransform) {
        // 管道: upstreamRes → metricsTransform → passThrough → reply.raw
        metricsTransform.pipe(passThrough).pipe(reply.raw);
      } else {
        passThrough.pipe(reply.raw);
      }

      // 管道入口：有 metricsTransform 时写入它，否则直接写 passThrough
      const pipeEntry = metricsTransform ?? passThrough;

      const captureChunks: Buffer[] = [];
      let idleTimer: NodeJS.Timeout | null = null;
      let resolved = false;

      function cleanup() {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = null;
        if (!passThrough.destroyed) passThrough.destroy();
        if (metricsTransform && !metricsTransform.destroyed) metricsTransform.destroy();
        if (!upstreamRes.destroyed) upstreamRes.destroy();
      }

      /** 从 metricsTransform 中提取指标，供 resolve 时附带 */
      function collectMetrics(isComplete: boolean): MetricsResult | undefined {
        if (!metricsTransform) return undefined;
        const result = metricsTransform.getExtractor().getMetrics();
        if (!isComplete) {
          return { ...result, is_complete: 0 };
        }
        return result;
      }

      reply.raw.on("close", () => {
        if (!resolved) {
          cleanup();
          resolve({ statusCode, responseBody: undefined, upstreamResponseHeaders: sseHeaders, sentHeaders: upstreamHeaders, metricsResult: collectMetrics(false) });
        }
      });

      passThrough.on("error", () => {
        cleanup();
        if (!resolved) {
          resolved = true;
          resolve({ statusCode, responseBody: undefined, upstreamResponseHeaders: sseHeaders, sentHeaders: upstreamHeaders, metricsResult: collectMetrics(false) });
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
        pipeEntry.write(chunk);
        captureChunks.push(chunk);
      });

      upstreamRes.on("end", () => {
        if (resolved) return;
        resolved = true;
        if (idleTimer) clearTimeout(idleTimer);
        pipeEntry.end();
        reply.raw.end();
        resolve({
          statusCode,
          responseBody: Buffer.concat(captureChunks).toString("utf-8"),
          upstreamResponseHeaders: sseHeaders,
          sentHeaders: upstreamHeaders,
          metricsResult: collectMetrics(true),
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
  clientHeaders: RawHeaders,
  upstreamPath: string
): Promise<GetProxyResult> {
  return new Promise((resolve, reject) => {
    const url = new URL(`${backend.base_url}${upstreamPath}`);
    const headers = buildUpstreamHeaders(clientHeaders, apiKey);
    const options = buildRequestOptions(url, headers, "GET");

    const req = createUpstreamRequest(url, options);
    req.on("response", (res: IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode || UPSTREAM_BAD_GATEWAY,
          body: Buffer.concat(chunks).toString("utf-8"),
          headers: selectHeaders(res.headers as RawHeaders, SKIP_DOWNSTREAM),
        });
      });
    });
    req.on("error", (err) => reject(err));
    req.end();
  });
}

// ---------- Shared proxy handler ----------

export interface ProxyErrorResponse {
  statusCode: number;
  body: unknown;
}

export interface ProxyErrorFormatter {
  modelNotFound(model: string): ProxyErrorResponse;
  modelNotAllowed(model: string): ProxyErrorResponse;
  providerUnavailable(): ProxyErrorResponse;
  providerTypeMismatch(): ProxyErrorResponse;
  upstreamConnectionFailed(): ProxyErrorResponse;
}

export interface ProxyHandlerDeps {
  db: Database.Database;
  streamTimeoutMs: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
  matcher?: RetryRuleMatcher;
}

const HTTP_BAD_GATEWAY = 502;

/**
 * 共享 POST handler，参数化 apiType/errorFormat/upstreamPath 等差异，
 * 消除 openai.ts / anthropic.ts 中约 120 行重复代码。
 *
 * 当分组策略为 failover 时，在 while 循环中依次尝试不同 target，
 * 直到成功（或 headers 已发送）才返回。
 */
export async function handleProxyPost(
  request: FastifyRequest,
  reply: FastifyReply,
  apiType: "openai" | "anthropic",
  upstreamPath: string,
  errors: ProxyErrorFormatter,
  deps: ProxyHandlerDeps,
  options?: {
    beforeSendProxy?: (body: Record<string, unknown>, isStream: boolean) => void;
  },
): Promise<FastifyReply> {
  const { db, streamTimeoutMs, retryMaxAttempts, retryBaseDelayMs, matcher } = deps;

  request.raw.socket.on("error", (err) => request.log.debug({ err }, "client socket error"));
  const clientModel = ((request.body as Record<string, unknown>).model as string) || "unknown";

  // 查询分组策略（只查一次）
  const group = getMappingGroup(db, clientModel);
  const isFailover = group?.strategy === "failover";
  const excludeTargets: Target[] = [];

  while (true) {
    const startTime = Date.now();
    const logId = randomUUID();
    const routerKeyId = request.routerKey?.id ?? null;
    const body = request.body as Record<string, unknown>;
    const originalBody = JSON.parse(JSON.stringify(body));

    const resolved = resolveMapping(db, clientModel, { now: new Date(), excludeTargets });
    if (!resolved) {
      if (isFailover && excludeTargets.length > 0) {
        // 所有 failover target 都已尝试，reply 已在上一轮发送
        return reply;
      }
      const e = errors.modelNotFound(clientModel);
      return reply.status(e.statusCode).send(e.body);
    }

    // 白名单校验（只在首次循环检查，allowed_models 基于 clientModel 而非 backend_model）
    if (excludeTargets.length === 0) {
      const allowedModels = request.routerKey?.allowed_models;
      if (allowedModels) {
        try {
          const models: string[] = JSON.parse(allowedModels);
          if (models.length > 0 && !models.includes(resolved.backend_model)) {
            const e = errors.modelNotAllowed(resolved.backend_model);
            return reply.status(e.statusCode).send(e.body);
          }
        } catch { request.log.warn("Invalid allowed_models JSON, allowing all models"); }
      }
    }

    const provider = getProviderById(db, resolved.provider_id);
    if (!provider || !provider.is_active) {
      const e = errors.providerUnavailable();
      return reply.status(e.statusCode).send(e.body);
    }
    if (provider.api_type !== apiType) {
      const e = errors.providerTypeMismatch();
      return reply.status(e.statusCode).send(e.body);
    }

    body.model = resolved.backend_model;
    const apiKey = decrypt(provider.api_key, getSetting(db, "encryption_key")!);
    const isStream = body.stream === true;

    // 允许调用方在发送代理请求前修改 body（如 openai 的 stream_options 注入）
    options?.beforeSendProxy?.(body, isStream);

    const reqBodyStr = JSON.stringify(body);
    const cliHdrs: RawHeaders = request.headers as RawHeaders;
    const clientReq = JSON.stringify({ headers: cliHdrs, body: originalBody });
    const retryConfig = buildRetryConfig(retryMaxAttempts, retryBaseDelayMs, matcher);
    const upstreamReqBase = JSON.stringify({ url: `${provider.base_url}${upstreamPath}`, headers: buildUpstreamHeaders(cliHdrs, apiKey, Buffer.byteLength(reqBodyStr)), body: reqBodyStr });

    try {
      const { result: r, attempts } = isStream
        ? await retryableCall(
            () => {
              const metricsTransform = new SSEMetricsTransform(apiType, startTime);
              return proxyStream(provider, apiKey, body, cliHdrs, reply, streamTimeoutMs, upstreamPath, metricsTransform);
            },
            retryConfig,
            reply,
          )
        : await retryableCall(
            () => proxyNonStream(provider, apiKey, body, cliHdrs, upstreamPath),
            retryConfig,
            reply,
          );

      // 记录所有尝试的日志
      let lastSuccessLogId = logId;
      for (const attempt of attempts) {
        const isOriginal = attempt.attemptIndex === 0;
        const attemptLogId = isOriginal ? logId : randomUUID();

        if (attempt.error) {
          insertRequestLog(db, {
            id: attemptLogId, api_type: apiType, model: clientModel, provider_id: provider.id,
            status_code: HTTP_BAD_GATEWAY, latency_ms: attempt.latencyMs,
            is_stream: isStream ? 1 : 0, error_message: attempt.error,
            created_at: new Date().toISOString(), request_body: reqBodyStr,
            client_request: clientReq, upstream_request: upstreamReqBase,
            is_retry: isOriginal ? 0 : 1, original_request_id: isOriginal ? null : logId,
            router_key_id: routerKeyId,
          });
        } else if (attempt.statusCode !== UPSTREAM_SUCCESS) {
          insertRequestLog(db, {
            id: attemptLogId, api_type: apiType, model: clientModel, provider_id: provider.id,
            status_code: attempt.statusCode, latency_ms: attempt.latencyMs,
            is_stream: isStream ? 1 : 0, error_message: null,
            created_at: new Date().toISOString(), request_body: reqBodyStr,
            response_body: attempt.responseBody, client_request: clientReq, upstream_request: upstreamReqBase,
            upstream_response: JSON.stringify({ statusCode: attempt.statusCode, body: attempt.responseBody }),
            client_response: JSON.stringify({ statusCode: attempt.statusCode, body: attempt.responseBody }),
            is_retry: isOriginal ? 0 : 1, original_request_id: isOriginal ? null : logId,
            router_key_id: routerKeyId,
          });
        } else {
          const h = isStream
            ? ((r as StreamProxyResult).upstreamResponseHeaders ?? {})
            : ((r as ProxyResult).headers);
          insertSuccessLog(db, apiType, attemptLogId, clientModel, provider, isStream, startTime,
            reqBodyStr, clientReq, upstreamReqBase, r.statusCode, attempt.responseBody, h, h,
            !isOriginal, isOriginal ? null : logId, routerKeyId);
          lastSuccessLogId = attemptLogId;
        }
      }

      // --- Failover 检查 ---
      if (isFailover && r.statusCode >= FAILOVER_FAIL_THRESHOLD && !reply.raw.headersSent) {
        excludeTargets.push(resolved);
        continue;
      }

      // 发送响应
      if (isStream) {
        if (r.statusCode !== UPSTREAM_SUCCESS) {
          for (const [k, v] of Object.entries((r as StreamProxyResult).upstreamResponseHeaders ?? {})) reply.header(k, v);
          reply.status(r.statusCode).send((r as StreamProxyResult).responseBody);
        }
      } else {
        const pr = r as ProxyResult;
        for (const [k, v] of Object.entries(pr.headers)) reply.header(k, v);
        return reply.status(pr.statusCode).send(pr.body);
      }

      // metrics 采集
      if (r.statusCode === UPSTREAM_SUCCESS) {
        if (isStream) {
          const streamResult = r as StreamProxyResult;
          if (streamResult.metricsResult) {
            try { insertMetrics(db, { ...streamResult.metricsResult, request_log_id: lastSuccessLogId, provider_id: provider.id, backend_model: resolved.backend_model, api_type: apiType }); }
            catch (err) { request.log.error({ err }, "Failed to insert metrics"); }
          }
        } else {
          try {
            const mr = MetricsExtractor.fromNonStreamResponse(apiType, (r as ProxyResult).body);
            if (mr) insertMetrics(db, { ...mr, request_log_id: lastSuccessLogId, provider_id: provider.id, backend_model: resolved.backend_model, api_type: apiType });
          } catch (err) { request.log.error({ err }, "Failed to insert metrics"); }
        }
      }
      return reply;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const sentH = buildUpstreamHeaders(cliHdrs, apiKey, Buffer.byteLength(reqBodyStr));
      const upstreamReq = JSON.stringify({ url: `${provider.base_url}${upstreamPath}`, headers: sentH, body: reqBodyStr });
      insertRequestLog(db, {
        id: logId, api_type: apiType, model: clientModel, provider_id: provider.id,
        status_code: HTTP_BAD_GATEWAY, latency_ms: Date.now() - startTime,
        is_stream: isStream ? 1 : 0, error_message: errMsg || "Upstream connection failed",
        created_at: new Date().toISOString(), request_body: reqBodyStr,
        client_request: clientReq, upstream_request: upstreamReq,
        router_key_id: routerKeyId,
      });

      // --- Failover 检查（异常路径）---
      if (isFailover && !reply.raw.headersSent) {
        excludeTargets.push(resolved);
        continue;
      }

      const e = errors.upstreamConnectionFailed();
      return reply.status(e.statusCode).send(e.body);
    }
  }
}
