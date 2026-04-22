import Database from "better-sqlite3";
import type { FastifyPluginCallback } from "fastify";
import fp from "fastify-plugin";
import { createErrorFormatter } from "./proxy-core.js";
import type { ErrorKind } from "./proxy-core.js";
import { handleProxyRequest, type RouteHandlerDeps } from "./proxy-handler.js";
import { createOrchestrator } from "./orchestrator.js";
import { RetryRuleMatcher } from "./retry-rules.js";
import { ProviderSemaphoreManager } from "./semaphore.js";
import type { RequestTracker } from "../monitor/request-tracker.js";

export interface AnthropicProxyOptions {
  db: Database.Database;
  streamTimeoutMs: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
  matcher?: RetryRuleMatcher;
  semaphoreManager?: ProviderSemaphoreManager;
  tracker?: RequestTracker;
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
};

const anthropicErrors = createErrorFormatter(
  (kind, message) => ({ type: "error", error: { type: ANTHROPIC_ERROR_TYPE[kind], message } }),
);

const anthropicProxyRaw: FastifyPluginCallback<AnthropicProxyOptions> = (app, opts, done) => {
  const { db, streamTimeoutMs, retryMaxAttempts, retryBaseDelayMs, matcher, semaphoreManager, tracker } = opts;

  const orchestrator = createOrchestrator(semaphoreManager, tracker);

  app.post(MESSAGES_PATH, async (request, reply) => {
    if (!orchestrator) {
      const e = anthropicErrors.providerUnavailable();
      return reply.status(e.statusCode).send(e.body);
    }
    const deps: RouteHandlerDeps = { db, streamTimeoutMs, retryMaxAttempts, retryBaseDelayMs, matcher, tracker, orchestrator };
    return handleProxyRequest(request, reply, "anthropic", MESSAGES_PATH, anthropicErrors, deps);
  });

  done();
};

export const anthropicProxy = fp(anthropicProxyRaw, { name: "anthropic-proxy" });
