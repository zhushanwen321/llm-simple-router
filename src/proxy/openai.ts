import type { FastifyPluginCallback, FastifyReply } from "fastify";
import Database from "better-sqlite3";
import fp from "fastify-plugin";
import { getActiveProviders } from "../db/index.js";
import { decrypt } from "../utils/crypto.js";
import {
  proxyGetRequest,
  type RawHeaders,
  handleProxyPost,
  type ProxyHandlerDeps,
  type ProxyErrorResponse,
  type ProxyErrorFormatter,
} from "./proxy-core.js";

import { RetryRuleMatcher } from "./retry-rules.js";

export interface OpenaiProxyOptions {
  db: Database.Database;
  encryptionKey: string;
  streamTimeoutMs: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
  matcher?: RetryRuleMatcher;
}

const HTTP_NOT_FOUND = 404;
const HTTP_BAD_GATEWAY = 502;
const CHAT_COMPLETIONS_PATH = "/v1/chat/completions";
const MODELS_PATH = "/v1/models";

const openaiErrors: ProxyErrorFormatter = {
  modelNotFound: (model) => ({
    statusCode: 404,
    body: { error: { message: `Model '${model}' is not configured`, type: "invalid_request_error", code: "model_not_found" } },
  }),
  modelNotAllowed: (model) => ({
    statusCode: 403,
    body: { error: { message: `Model '${model}' is not allowed for this API key`, type: "invalid_request_error", code: "model_not_allowed" } },
  }),
  providerUnavailable: () => ({
    statusCode: 503,
    body: { error: { message: "Provider unavailable", type: "server_error", code: "provider_unavailable" } },
  }),
  providerTypeMismatch: () => ({
    statusCode: 500,
    body: { error: { message: "Provider type mismatch for this endpoint", type: "server_error", code: "provider_type_mismatch" } },
  }),
  upstreamConnectionFailed: () => ({
    statusCode: 502,
    body: { error: { message: "Failed to connect to upstream service", type: "upstream_error", code: "upstream_connection_failed" } },
  }),
};

function sendError(reply: FastifyReply, e: ProxyErrorResponse) {
  return reply.status(e.statusCode).send(e.body);
}

const openaiProxyRaw: FastifyPluginCallback<OpenaiProxyOptions> = (app, opts, done) => {
  const { db, encryptionKey, streamTimeoutMs, retryMaxAttempts, retryBaseDelayMs, matcher } = opts;

  app.post(CHAT_COMPLETIONS_PATH, async (request, reply) => {
    const deps: ProxyHandlerDeps = { db, encryptionKey, streamTimeoutMs, retryMaxAttempts, retryBaseDelayMs, matcher };
    return handleProxyPost(request, reply, "openai", CHAT_COMPLETIONS_PATH, openaiErrors, deps, {
      beforeSendProxy: (body, isStream) => {
        if (isStream && !body.stream_options) {
          body.stream_options = { include_usage: true };
        }
      },
    });
  });

  app.get(MODELS_PATH, async (request, reply) => {
    const providers = getActiveProviders(db, "openai");
    if (providers.length === 0) return sendError(reply, {
      statusCode: HTTP_NOT_FOUND,
      body: { error: { message: "No active OpenAI provider configured", type: "invalid_request_error", code: "no_provider" } },
    });
    const provider = providers[0];
    const apiKey = decrypt(provider.api_key, encryptionKey);
    const cliHdrs: RawHeaders = request.headers as RawHeaders;
    try {
      const result = await proxyGetRequest(provider, apiKey, cliHdrs, MODELS_PATH);
      for (const [k, v] of Object.entries(result.headers)) reply.header(k, v);
      return reply.status(result.statusCode).send(result.body);
    } catch (err: unknown) {
      request.log.error({ err: err instanceof Error ? err.message : String(err) }, "Failed to reach OpenAI backend for /v1/models");
      return sendError(reply, {
        statusCode: HTTP_BAD_GATEWAY,
        body: { error: { message: "Failed to reach backend service", type: "server_error", code: "upstream_error" } },
      });
    }
  });

  done();
};

export const openaiProxy = fp(openaiProxyRaw, { name: "openai-proxy" });
