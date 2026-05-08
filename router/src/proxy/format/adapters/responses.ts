import type { FormatAdapter } from "../types.js";
import { OPENAI_FAMILY_ERROR_META } from "./shared-error-meta.js";

export const responsesAdapter: FormatAdapter = {
  apiType: "openai-responses",
  defaultPath: "/v1/responses",
  errorMeta: OPENAI_FAMILY_ERROR_META,

  formatError(message, code) {
    return { error: { message, type: "invalid_request_error", code: code ?? "upstream_error" } };
  },
};
