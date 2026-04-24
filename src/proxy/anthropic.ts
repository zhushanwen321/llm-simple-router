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
import type { UsageWindowTracker } from "./usage-window-tracker.js";

export interface AnthropicProxyOptions {
  db: Database.Database;
  streamTimeoutMs: number;
  retryBaseDelayMs: number;
  matcher?: RetryRuleMatcher;
  semaphoreManager?: ProviderSemaphoreManager;
  tracker?: RequestTracker;
  usageWindowTracker?: UsageWindowTracker;
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
  const { db, streamTimeoutMs, retryBaseDelayMs, matcher, semaphoreManager, tracker, usageWindowTracker } = opts;

  const orchestrator = createOrchestrator(semaphoreManager, tracker);

  app.post(MESSAGES_PATH, async (request, reply) => {
    if (!orchestrator) {
      const e = anthropicErrors.providerUnavailable();
      return reply.code(e.statusCode).send(e.body);
    }
    const deps: RouteHandlerDeps = { db, streamTimeoutMs, retryBaseDelayMs, matcher, tracker, orchestrator, usageWindowTracker };
    return handleProxyRequest(request, reply, "anthropic", MESSAGES_PATH, anthropicErrors, deps);
  });

  done();
};

export const anthropicProxy = fp(anthropicProxyRaw, { name: "anthropic-proxy" });
