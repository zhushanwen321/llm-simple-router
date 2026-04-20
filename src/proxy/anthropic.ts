import Database from "better-sqlite3";
import type { FastifyPluginCallback } from "fastify";
import fp from "fastify-plugin";
import {
  handleProxyPost,
  type ProxyHandlerDeps,
  type ProxyErrorFormatter,
} from "./proxy-core.js";

import { RetryRuleMatcher } from "./retry-rules.js";

export interface AnthropicProxyOptions {
  db: Database.Database;
  streamTimeoutMs: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
  matcher?: RetryRuleMatcher;
}

const MESSAGES_PATH = "/v1/messages";

const anthropicErrors: ProxyErrorFormatter = {
  modelNotFound: (model) => ({
    statusCode: 404,
    body: { type: "error", error: { type: "not_found_error", message: `Model '${model}' is not configured` } },
  }),
  modelNotAllowed: (model) => ({
    statusCode: 403,
    body: { type: "error", error: { type: "forbidden_error", message: `Model '${model}' is not allowed for this API key` } },
  }),
  providerUnavailable: () => ({
    statusCode: 503,
    body: { type: "error", error: { type: "api_error", message: "Provider unavailable" } },
  }),
  providerTypeMismatch: () => ({
    statusCode: 500,
    body: { type: "error", error: { type: "api_error", message: "Provider type mismatch for this endpoint" } },
  }),
  upstreamConnectionFailed: () => ({
    statusCode: 502,
    body: { type: "error", error: { type: "upstream_error", message: "Failed to connect to upstream service" } },
  }),
  concurrencyQueueFull: (providerId) => ({
    statusCode: 503,
    body: { type: "error", error: { type: "api_error", message: `Provider '${providerId}' concurrency queue is full` } },
  }),
  concurrencyTimeout: (providerId, timeoutMs) => ({
    statusCode: 504,
    body: { type: "error", error: { type: "api_error", message: `Provider '${providerId}' concurrency wait timeout (${timeoutMs}ms)` } },
  }),
};

const anthropicProxyRaw: FastifyPluginCallback<AnthropicProxyOptions> = (app, opts, done) => {
  const { db, streamTimeoutMs, retryMaxAttempts, retryBaseDelayMs, matcher } = opts;

  app.post(MESSAGES_PATH, async (request, reply) => {
    const deps: ProxyHandlerDeps = { db, streamTimeoutMs, retryMaxAttempts, retryBaseDelayMs, matcher };
    return handleProxyPost(request, reply, "anthropic", MESSAGES_PATH, anthropicErrors, deps);
  });

  done();
};

export const anthropicProxy = fp(anthropicProxyRaw, { name: "anthropic-proxy" });
