import type { FormatAdapter } from "../types.js";
import { OPENAI_FAMILY_ERROR_META } from "./shared-error-meta.js";

export const openaiAdapter: FormatAdapter = {
  apiType: "openai",
  defaultPath: "/v1/chat/completions",
  errorMeta: OPENAI_FAMILY_ERROR_META,

  beforeSendProxy(body, isStream) {
    if (isStream && !body.stream_options) {
      body.stream_options = { include_usage: true };
    }
  },

  formatError(message, code) {
    return { error: { message, type: "upstream_error", code: code ?? "upstream_error" } };
  },
};
