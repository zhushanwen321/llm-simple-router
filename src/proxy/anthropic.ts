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
  buildUpstreamHeaders, insertSuccessLog, UPSTREAM_SUCCESS, type ProxyResult, type RawHeaders,
} from "./proxy-core.js";

export interface AnthropicProxyOptions {
  db: Database.Database;
  encryptionKey: string;
  streamTimeoutMs: number;
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
  const { db, encryptionKey, streamTimeoutMs } = opts;
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

    try {
      if (isStream) {
        const metricsTransform = new SSEMetricsTransform("anthropic", startTime);
        const r = await proxyStream(provider, apiKey, body, cliHdrs, reply, streamTimeoutMs, MESSAGES_PATH, metricsTransform);
        const h = r.upstreamResponseHeaders ?? {};
        const sentH = r.sentHeaders ?? {};
        const upstreamReq = JSON.stringify({ url: `${provider.base_url}${MESSAGES_PATH}`, headers: sentH, body: reqBodyStr });
        if (r.statusCode !== UPSTREAM_SUCCESS) {
          for (const [k, v] of Object.entries(r.upstreamResponseHeaders ?? {})) reply.header(k, v);
          reply.status(r.statusCode).send(r.responseBody);
        }
        insertSuccessLog(db, "anthropic", logId, clientModel, provider, true, startTime, reqBodyStr, clientReq, upstreamReq, r.statusCode, r.responseBody ?? null, h, h);
        if (r.metricsResult) {
          try {
            insertMetrics(db, { ...r.metricsResult, request_log_id: logId, provider_id: provider.id, backend_model: mapping.backend_model, api_type: "anthropic" });
          } catch (err) {
            request.log.error({ err }, "Failed to insert metrics");
          }
        }
        return reply;
      }
      const r: ProxyResult = await proxyNonStream(provider, apiKey, body, cliHdrs, MESSAGES_PATH);
      const upstreamReq = JSON.stringify({ url: `${provider.base_url}${MESSAGES_PATH}`, headers: r.sentHeaders, body: reqBodyStr });
      insertSuccessLog(db, "anthropic", logId, clientModel, provider, false, startTime, reqBodyStr, clientReq, upstreamReq, r.statusCode, r.body, r.sentHeaders, r.headers);
      try {
        const metricsResult = MetricsExtractor.fromNonStreamResponse("anthropic", r.body);
        if (metricsResult) {
          insertMetrics(db, { ...metricsResult, request_log_id: logId, provider_id: provider.id, backend_model: mapping.backend_model, api_type: "anthropic" });
        }
      } catch (err) {
        request.log.error({ err }, "Failed to insert metrics");
      }
      for (const [k, v] of Object.entries(r.headers)) reply.header(k, v);
      return reply.status(r.statusCode).send(r.body);
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
