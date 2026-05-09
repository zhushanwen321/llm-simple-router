import type { FormatAdapter } from "../types.js";

const ANTHROPIC_ERROR_META = {
  modelNotFound: { type: "not_found_error", code: "model_not_found" },
  modelNotAllowed: { type: "forbidden_error", code: "model_not_allowed" },
  providerUnavailable: { type: "api_error", code: "provider_unavailable" },
  providerTypeMismatch: { type: "api_error", code: "provider_type_mismatch" },
  upstreamConnectionFailed: { type: "upstream_error", code: "upstream_connection_failed" },
  concurrencyQueueFull: { type: "api_error", code: "concurrency_queue_full" },
  concurrencyTimeout: { type: "api_error", code: "concurrency_timeout" },
  promptTooLong: { type: "invalid_request_error", code: "context_window_exceeded" },
};

export const anthropicAdapter: FormatAdapter = {
  apiType: "anthropic",
  defaultPath: "/v1/messages",
  errorMeta: ANTHROPIC_ERROR_META,

  formatError(message) {
    return { type: "error", error: { type: "api_error", message } };
  },
};
