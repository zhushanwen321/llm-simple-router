import type { FastifyPluginCallback, FastifyReply } from "fastify";
import Database from "better-sqlite3";
import fp from "fastify-plugin";
import { getActiveProviders } from "../db/index.js";
import { getSetting } from "../db/settings.js";
import { decrypt } from "../utils/crypto.js";
import { proxyGetRequest, createErrorFormatter, type ProxyErrorResponse } from "./proxy-core.js";
import type { ErrorKind } from "./proxy-core.js";
import type { RawHeaders } from "./types.js";
import { handleProxyRequest, type RouteHandlerDeps } from "./proxy-handler.js";
import { createOrchestrator } from "./orchestrator.js";
import { RetryRuleMatcher } from "./retry-rules.js";
import { ProviderSemaphoreManager } from "./semaphore.js";
import type { RequestTracker } from "../monitor/request-tracker.js";
import { HTTP_NOT_FOUND, HTTP_BAD_GATEWAY } from "../constants.js";

export interface OpenaiProxyOptions {
  db: Database.Database;
  streamTimeoutMs: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
  matcher?: RetryRuleMatcher;
  semaphoreManager?: ProviderSemaphoreManager;
  tracker?: RequestTracker;
}

const CHAT_COMPLETIONS_PATH = "/v1/chat/completions";
const MODELS_PATH = "/v1/models";

const OPENAI_ERROR_META: Record<ErrorKind, { type: string; code: string }> = {
  modelNotFound: { type: "invalid_request_error", code: "model_not_found" },
  modelNotAllowed: { type: "invalid_request_error", code: "model_not_allowed" },
  providerUnavailable: { type: "server_error", code: "provider_unavailable" },
  providerTypeMismatch: { type: "server_error", code: "provider_type_mismatch" },
  upstreamConnectionFailed: { type: "upstream_error", code: "upstream_connection_failed" },
  concurrencyQueueFull: { type: "server_error", code: "concurrency_queue_full" },
  concurrencyTimeout: { type: "server_error", code: "concurrency_timeout" },
};

const openaiErrors = createErrorFormatter(
  (kind, message) => ({ error: { message, ...OPENAI_ERROR_META[kind] } }),
);

function sendError(reply: FastifyReply, e: ProxyErrorResponse) {
  return reply.status(e.statusCode).send(e.body);
}

const openaiProxyRaw: FastifyPluginCallback<OpenaiProxyOptions> = (app, opts, done) => {
  const { db, streamTimeoutMs, retryMaxAttempts, retryBaseDelayMs, matcher, semaphoreManager, tracker } = opts;

  const orchestrator = createOrchestrator(semaphoreManager, tracker);

  app.post(CHAT_COMPLETIONS_PATH, async (request, reply) => {
    if (!orchestrator) return sendError(reply, openaiErrors.providerUnavailable());
    const deps: RouteHandlerDeps = { db, streamTimeoutMs, retryMaxAttempts, retryBaseDelayMs, matcher, tracker, orchestrator };
    return handleProxyRequest(request, reply, "openai", CHAT_COMPLETIONS_PATH, openaiErrors, deps, {
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
    const apiKey = decrypt(provider.api_key, getSetting(db, "encryption_key")!);
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
