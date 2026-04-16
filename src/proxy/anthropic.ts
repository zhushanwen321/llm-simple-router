import { randomUUID } from "crypto";
import type { FastifyPluginCallback, FastifyReply } from "fastify";
import Database from "better-sqlite3";
import fp from "fastify-plugin";
import {
  getModelMapping, getProviderById, insertRequestLog, insertMetrics,
} from "../db/index.js";
import { decrypt } from "../utils/crypto.js";
import { SSEMetricsTransform } from "../metrics/sse-metrics-transform.js";
import { MetricsExtractor } from "../metrics/metrics-extractor.js";
import {
  proxyNonStream, proxyStream,
  buildUpstreamHeaders, insertSuccessLog, UPSTREAM_SUCCESS,
  type ProxyResult, type StreamProxyResult, type RawHeaders,
} from "./proxy-core.js";
import { retryableCall, buildRetryConfig } from "./retry.js";

export interface AnthropicProxyOptions {
  db: Database.Database;
  encryptionKey: string;
  streamTimeoutMs: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
}

const HTTP_NOT_FOUND = 404;
const HTTP_SERVICE_UNAVAILABLE = 503;
const HTTP_INTERNAL_ERROR = 500;
const HTTP_BAD_GATEWAY = 502;
const MESSAGES_PATH = "/v1/messages";

function anthropicError(msg: string, type: string, status: number) {
  return { statusCode: status, body: { type: "error", error: { type, message: msg } } };
}

function sendError(reply: FastifyReply, e: ReturnType<typeof anthropicError>) {
  return reply.status(e.statusCode).send(e.body);
}

const anthropicProxyRaw: FastifyPluginCallback<AnthropicProxyOptions> = (app, opts, done) => {
  const { db, encryptionKey, streamTimeoutMs, retryMaxAttempts, retryBaseDelayMs } = opts;
  app.post(MESSAGES_PATH, async (request, reply) => {
    request.raw.socket.on("error", (err) => request.log.debug({ err }, "client socket error"));
    const startTime = Date.now();
    const logId = randomUUID();
    const body = request.body as Record<string, unknown>;
    const originalBody = JSON.parse(JSON.stringify(body));
    const clientModel = (body.model as string) || "unknown";
    const mapping = getModelMapping(db, clientModel);
    if (!mapping) return sendError(reply, anthropicError(`Model '${clientModel}' is not configured`, "not_found_error", HTTP_NOT_FOUND));

    const provider = getProviderById(db, mapping.provider_id);
    if (!provider || !provider.is_active) return sendError(reply, anthropicError("Provider unavailable", "api_error", HTTP_SERVICE_UNAVAILABLE));
    if (provider.api_type !== "anthropic") return sendError(reply, anthropicError("Provider type mismatch for this endpoint", "api_error", HTTP_INTERNAL_ERROR));

    body.model = mapping.backend_model;
    const apiKey = decrypt(provider.api_key, encryptionKey);
    const isStream = body.stream === true;
    const reqBodyStr = JSON.stringify(body);
    const cliHdrs: RawHeaders = request.headers as RawHeaders;
    const clientReq = JSON.stringify({ headers: cliHdrs, body: originalBody });

    const retryConfig = buildRetryConfig(retryMaxAttempts, retryBaseDelayMs);
    const upstreamReqBase = JSON.stringify({ url: `${provider.base_url}${MESSAGES_PATH}`, headers: buildUpstreamHeaders(cliHdrs, apiKey, Buffer.byteLength(reqBodyStr)), body: reqBodyStr });

    try {
      const { result: r, attempts } = isStream
        ? await retryableCall(
            () => {
              const metricsTransform = new SSEMetricsTransform("anthropic", startTime);
              return proxyStream(provider, apiKey, body, cliHdrs, reply, streamTimeoutMs, MESSAGES_PATH, metricsTransform);
            },
            retryConfig,
            reply,
          )
        : await retryableCall(
            () => proxyNonStream(provider, apiKey, body, cliHdrs, MESSAGES_PATH),
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
            id: attemptLogId, api_type: "anthropic", model: clientModel, provider_id: provider.id,
            status_code: HTTP_BAD_GATEWAY, latency_ms: attempt.latencyMs,
            is_stream: isStream ? 1 : 0, error_message: attempt.error,
            created_at: new Date().toISOString(), request_body: reqBodyStr,
            client_request: clientReq, upstream_request: upstreamReqBase,
            is_retry: isOriginal ? 0 : 1, original_request_id: isOriginal ? null : logId,
          });
        } else if (attempt.statusCode !== UPSTREAM_SUCCESS) {
          insertRequestLog(db, {
            id: attemptLogId, api_type: "anthropic", model: clientModel, provider_id: provider.id,
            status_code: attempt.statusCode, latency_ms: attempt.latencyMs,
            is_stream: isStream ? 1 : 0, error_message: null,
            created_at: new Date().toISOString(), request_body: reqBodyStr,
            response_body: attempt.responseBody, client_request: clientReq, upstream_request: upstreamReqBase,
            upstream_response: JSON.stringify({ statusCode: attempt.statusCode, body: attempt.responseBody }),
            client_response: JSON.stringify({ statusCode: attempt.statusCode, body: attempt.responseBody }),
            is_retry: isOriginal ? 0 : 1, original_request_id: isOriginal ? null : logId,
          });
        } else {
          const h = isStream
            ? ((r as StreamProxyResult).upstreamResponseHeaders ?? {})
            : ((r as ProxyResult).headers);
          insertSuccessLog(db, "anthropic", attemptLogId, clientModel, provider, isStream, startTime,
            reqBodyStr, clientReq, upstreamReqBase, r.statusCode, attempt.responseBody, h, h,
            !isOriginal, isOriginal ? null : logId);
          lastSuccessLogId = attemptLogId;
        }
      }

      // 将最终结果发送给客户端
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

      // 仅对最终成功请求采集 metrics
      if (r.statusCode === UPSTREAM_SUCCESS) {
        if (isStream) {
          const streamResult = r as StreamProxyResult;
          if (streamResult.metricsResult) {
            try { insertMetrics(db, { ...streamResult.metricsResult, request_log_id: lastSuccessLogId, provider_id: provider.id, backend_model: mapping.backend_model, api_type: "anthropic" }); }
            catch (err) { request.log.error({ err }, "Failed to insert metrics"); }
          }
        } else {
          try {
            const mr = MetricsExtractor.fromNonStreamResponse("anthropic", (r as ProxyResult).body);
            if (mr) insertMetrics(db, { ...mr, request_log_id: lastSuccessLogId, provider_id: provider.id, backend_model: mapping.backend_model, api_type: "anthropic" });
          } catch (err) { request.log.error({ err }, "Failed to insert metrics"); }
        }
      }
      return reply;
    } catch (err: unknown) {
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
  });

  done();
};

export const anthropicProxy = fp(anthropicProxyRaw, { name: "anthropic-proxy" });
