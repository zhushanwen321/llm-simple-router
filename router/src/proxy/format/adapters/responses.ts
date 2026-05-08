import type { FormatAdapter } from "../types.js";

const RESPONSES_ERROR_META = {
  modelNotFound: { type: "invalid_request_error", code: "model_not_found" },
  modelNotAllowed: { type: "invalid_request_error", code: "model_not_allowed" },
  providerUnavailable: { type: "server_error", code: "provider_unavailable" },
  providerTypeMismatch: { type: "server_error", code: "provider_type_mismatch" },
  upstreamConnectionFailed: { type: "upstream_error", code: "upstream_connection_failed" },
  concurrencyQueueFull: { type: "server_error", code: "concurrency_queue_full" },
  concurrencyTimeout: { type: "server_error", code: "concurrency_timeout" },
  promptTooLong: { type: "invalid_request_error", code: "context_window_exceeded" },
};

export const responsesAdapter: FormatAdapter = {
  apiType: "openai-responses",
  defaultPath: "/v1/responses",
  errorMeta: RESPONSES_ERROR_META,

  formatError(message, code) {
    return { error: { message, type: "invalid_request_error", code: code ?? "upstream_error" } };
  },
};
