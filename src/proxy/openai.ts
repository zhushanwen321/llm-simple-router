import { randomUUID } from "crypto";
import type { FastifyPluginCallback, FastifyReply } from "fastify";
import Database from "better-sqlite3";
import fp from "fastify-plugin";
import {
  getActiveProviders, getModelMapping, getProviderById,
  insertRequestLog, type Provider,
} from "../db/index.js";
import { decrypt } from "../utils/crypto.js";
import {
  proxyNonStream, proxyStream, proxyGetRequest,
  buildUpstreamHeaders, type ProxyResult,
} from "./proxy-core.js";

export interface OpenaiProxyOptions {
  db: Database.Database;
  encryptionKey: string;
  streamTimeoutMs: number;
}

const HTTP_NOT_FOUND = 404;
const HTTP_SERVICE_UNAVAILABLE = 503;
const HTTP_INTERNAL_ERROR = 500;
const HTTP_BAD_GATEWAY = 502;
const CHAT_COMPLETIONS_PATH = "/v1/chat/completions";
const MODELS_PATH = "/v1/models";

function openaiError(msg: string, type: string, code: string, status: number) {
  return { statusCode: status, body: { error: { message: msg, type, code } } };
}

function sendError(reply: FastifyReply, e: ReturnType<typeof openaiError>) {
  return reply.status(e.statusCode).send(e.body);
}

function insertSuccessLog(
  db: Database.Database, logId: string, model: string, provider: Provider, isStream: boolean,
  startTime: number, reqBody: string, clientReq: string, upstreamReq: string, status: number,
  respBody: string | null, upHdrs: Record<string, string>, cliHdrs: Record<string, string>,
) {
  insertRequestLog(db, {
    id: logId, api_type: "openai", model, provider_id: provider.id,
    status_code: status, latency_ms: Date.now() - startTime,
    is_stream: isStream ? 1 : 0, error_message: null,
    created_at: new Date().toISOString(), request_body: reqBody,
    response_body: respBody, client_request: clientReq, upstream_request: upstreamReq,
    upstream_response: JSON.stringify({ statusCode: status, headers: upHdrs, body: respBody }),
    client_response: JSON.stringify({ statusCode: status, headers: cliHdrs, body: respBody }),
  });
}

const openaiProxyRaw: FastifyPluginCallback<OpenaiProxyOptions> = (app, opts, done) => {
  const { db, encryptionKey, streamTimeoutMs } = opts;
  app.post(CHAT_COMPLETIONS_PATH, async (request, reply) => {
    request.raw.socket.on("error", (err) => request.log.debug({ err }, "client socket error"));
    const startTime = Date.now();
    const logId = randomUUID();
    const body = request.body as Record<string, unknown>;
    const originalBody = JSON.parse(JSON.stringify(body));
    const clientModel = (body.model as string) || "unknown";
    const mapping = getModelMapping(db, clientModel);
    if (!mapping) return sendError(reply, openaiError(`Model '${clientModel}' is not configured`, "invalid_request_error", "model_not_found", HTTP_NOT_FOUND));

    const provider = getProviderById(db, mapping.provider_id);
    if (!provider || !provider.is_active) return sendError(reply, openaiError("Provider unavailable", "server_error", "provider_unavailable", HTTP_SERVICE_UNAVAILABLE));
    if (provider.api_type !== "openai") return sendError(reply, openaiError("Provider type mismatch for this endpoint", "server_error", "provider_type_mismatch", HTTP_INTERNAL_ERROR));

    body.model = mapping.backend_model;
    const apiKey = decrypt(provider.api_key, encryptionKey);
    const isStream = body.stream === true;
    const reqBodyStr = JSON.stringify(body);
    const cliHdrs = request.headers as Record<string, string | string[] | undefined>;
    const upReqHdrs = buildUpstreamHeaders(cliHdrs, apiKey, Buffer.byteLength(reqBodyStr));
    const clientReq = JSON.stringify({ headers: cliHdrs, body: originalBody });
    const upstreamReq = JSON.stringify({ url: `${provider.base_url}${CHAT_COMPLETIONS_PATH}`, headers: upReqHdrs, body: reqBodyStr });

    try {
      if (isStream) {
        const r = await proxyStream(provider, apiKey, body, cliHdrs, reply, streamTimeoutMs, CHAT_COMPLETIONS_PATH);
        const h = r.upstreamResponseHeaders ?? {};
        insertSuccessLog(db, logId, clientModel, provider, true, startTime, reqBodyStr, clientReq, upstreamReq, r.statusCode, r.responseBody ?? null, h, h);
        return reply;
      }
      const r: ProxyResult = await proxyNonStream(provider, apiKey, body, cliHdrs, CHAT_COMPLETIONS_PATH);
      insertSuccessLog(db, logId, clientModel, provider, false, startTime, reqBodyStr, clientReq, upstreamReq, r.statusCode, r.body, r.sentHeaders, r.headers);
      for (const [k, v] of Object.entries(r.headers)) reply.header(k, v);
      return reply.status(r.statusCode).send(r.body);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      insertRequestLog(db, {
        id: logId, api_type: "openai", model: clientModel, provider_id: provider.id,
        status_code: HTTP_BAD_GATEWAY, latency_ms: Date.now() - startTime,
        is_stream: isStream ? 1 : 0, error_message: errMsg || "Upstream connection failed",
        created_at: new Date().toISOString(), request_body: reqBodyStr,
        client_request: clientReq, upstream_request: upstreamReq,
      });
      return sendError(reply, openaiError("Failed to connect to upstream service", "upstream_error", "upstream_connection_failed", HTTP_BAD_GATEWAY));
    }
  });

  app.get(MODELS_PATH, async (request, reply) => {
    const providers = getActiveProviders(db, "openai");
    if (providers.length === 0) return sendError(reply, openaiError("No active OpenAI provider configured", "invalid_request_error", "no_provider", HTTP_NOT_FOUND));
    const provider = providers[0];
    const apiKey = decrypt(provider.api_key, encryptionKey);
    const cliHdrs = request.headers as Record<string, string | string[] | undefined>;
    try {
      const result = await proxyGetRequest(provider, apiKey, cliHdrs, MODELS_PATH);
      for (const [k, v] of Object.entries(result.headers)) reply.header(k, v);
      return reply.status(result.statusCode).send(result.body);
    } catch (err: unknown) {
      request.log.error({ err: err instanceof Error ? err.message : String(err) }, "Failed to reach OpenAI backend for /v1/models");
      return sendError(reply, openaiError("Failed to reach backend service", "server_error", "upstream_error", HTTP_BAD_GATEWAY));
    }
  });

  done();
};

export const openaiProxy = fp(openaiProxyRaw, { name: "openai-proxy" });
