import type { FormatAdapter } from "../types.js";

const OPENAI_ERROR_META = {
  modelNotFound: { type: "invalid_request_error", code: "model_not_found" },
  modelNotAllowed: { type: "invalid_request_error", code: "model_not_allowed" },
  providerUnavailable: { type: "server_error", code: "provider_unavailable" },
  providerTypeMismatch: { type: "server_error", code: "provider_type_mismatch" },
  upstreamConnectionFailed: { type: "upstream_error", code: "upstream_connection_failed" },
  concurrencyQueueFull: { type: "server_error", code: "concurrency_queue_full" },
  concurrencyTimeout: { type: "server_error", code: "concurrency_timeout" },
  promptTooLong: { type: "invalid_request_error", code: "context_window_exceeded" },
};

export const openaiAdapter: FormatAdapter = {
  apiType: "openai",
  defaultPath: "/v1/chat/completions",
  errorMeta: OPENAI_ERROR_META,

  beforeSendProxy(body, isStream) {
    if (isStream && !body.stream_options) {
      body.stream_options = { include_usage: true };
    }
  },

  formatError(message, code) {
    return { error: { message, type: "upstream_error", code: code ?? "upstream_error" } };
  },
};
