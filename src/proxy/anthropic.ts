import Database from "better-sqlite3";
import type { FastifyPluginCallback } from "fastify";
import { randomUUID } from "crypto";
import fp from "fastify-plugin";
import { insertRequestLog } from "../db/index.js";
import { createErrorFormatter } from "./proxy-core.js";
import type { ErrorKind } from "./proxy-core.js";
import { handleProxyRequest, type RouteHandlerDeps } from "./proxy-handler.js";
import { createOrchestrator } from "./orchestrator.js";
import { RetryRuleMatcher } from "./retry-rules.js";
import { ProviderSemaphoreManager } from "./semaphore.js";
import type { RequestTracker } from "../monitor/request-tracker.js";
import type { UsageWindowTracker } from "./usage-window-tracker.js";
import { HTTP_BAD_GATEWAY } from "../constants.js";

export interface AnthropicProxyOptions {
  db: Database.Database;
  streamTimeoutMs: number;
  retryBaseDelayMs: number;
  matcher?: RetryRuleMatcher;
  semaphoreManager?: ProviderSemaphoreManager;
  tracker?: RequestTracker;
  usageWindowTracker?: UsageWindowTracker;
  sessionTracker?: import("./loop-prevention/session-tracker.js").SessionTracker;
}

const MESSAGES_PATH = "/v1/messages";

const ANTHROPIC_ERROR_TYPE: Record<ErrorKind, string> = {
  modelNotFound: "not_found_error",
  modelNotAllowed: "forbidden_error",
  providerUnavailable: "api_error",
  providerTypeMismatch: "api_error",
  upstreamConnectionFailed: "upstream_error",
  concurrencyQueueFull: "api_error",
  concurrencyTimeout: "api_error",
  promptTooLong: "invalid_request_error",
};

const anthropicErrors = createErrorFormatter(
  (kind, message) => ({ type: "error", error: { type: ANTHROPIC_ERROR_TYPE[kind], message } }),
);

const anthropicProxyRaw: FastifyPluginCallback<AnthropicProxyOptions> = (app, opts, done) => {
  const { db, streamTimeoutMs, retryBaseDelayMs, matcher, semaphoreManager, tracker, usageWindowTracker, sessionTracker } = opts;

  const orchestrator = createOrchestrator(semaphoreManager, tracker);

  app.post(MESSAGES_PATH, async (request, reply) => {
    if (!orchestrator) {
      const body = request.body as Record<string, unknown> | undefined;
      insertRequestLog(db, {
        id: randomUUID(), api_type: "anthropic", model: (body?.model as string) || null,
        provider_id: null, status_code: HTTP_BAD_GATEWAY, latency_ms: 0, is_stream: 0,
        error_message: "Orchestrator not available (missing semaphore or tracker)",
        created_at: new Date().toISOString(),
        client_request: JSON.stringify({ headers: request.headers }),
        router_key_id: request.routerKey?.id ?? null,
      });
      const e = anthropicErrors.providerUnavailable();
      return reply.code(e.statusCode).send(e.body);
    }
    const deps: RouteHandlerDeps = { db, streamTimeoutMs, retryBaseDelayMs, matcher, tracker, orchestrator, usageWindowTracker, sessionTracker };
    return handleProxyRequest(request, reply, "anthropic", MESSAGES_PATH, anthropicErrors, deps);
  });

  done();
};

export const anthropicProxy = fp(anthropicProxyRaw, { name: "anthropic-proxy" });
