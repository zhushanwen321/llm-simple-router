/* eslint-disable no-magic-numbers -- HTTP status codes are domain vocabulary for this classifier */
export type ErrorCategory =
  | "authentication"
  | "permission"
  | "not_found"
  | "validation"
  | "context_too_long"
  | "content_filter"
  | "rate_limit"
  | "quota_exceeded"
  | "overloaded"
  | "timeout"
  | "server_error"
  | "unknown";

export interface ClassifiedError {
  category: ErrorCategory;
  retryable: boolean;
  statusCode: number;
  originalType?: string;
  originalCode?: string;
}

export function classifyError(statusCode: number, errorBody: string): ClassifiedError {
  let parsed: Record<string, unknown> = {};
  // eslint-disable-next-line taste/no-silent-catch -- non-JSON body: classify by status code only
  try { parsed = JSON.parse(errorBody); } catch { /* classify by status code only */ }

  // Anthropic wraps errors in { type: "error", error: { type, message } }
  // OpenAI uses { error: { type, code, message } } directly
  const errObj = (parsed.error as Record<string, unknown>) ?? parsed;
  const type = String(errObj.type ?? parsed.type ?? "");
  const code = String(errObj.code ?? "");

  // 429: distinguish rate_limit (retryable) from quota_exceeded (not retryable)
  if (statusCode === 429) {
    if (type === "insufficient_quota" || code === "insufficient_quota") {
      return { category: "quota_exceeded", retryable: false, statusCode, originalType: type, originalCode: code };
    }
    return { category: "rate_limit", retryable: true, statusCode, originalType: type, originalCode: code };
  }

  // 529: Anthropic overloaded
  if (statusCode === 529) {
    return { category: "overloaded", retryable: true, statusCode, originalType: type, originalCode: code };
  }

  // Structured type/code matching (works across status codes)
  if (type === "authentication_error") {
    return { category: "authentication", retryable: false, statusCode, originalType: type };
  }
  if (type === "permission_error") {
    return { category: "permission", retryable: false, statusCode, originalType: type };
  }
  if (type === "not_found_error") {
    return { category: "not_found", retryable: false, statusCode, originalType: type };
  }
  if (type === "timeout_error") {
    return { category: "timeout", retryable: true, statusCode, originalType: type };
  }

  // 400: sub-classify based on error content
  if (statusCode === 400) {
    if (code === "context_length_exceeded" || type === "context_length_exceeded") {
      return { category: "context_too_long", retryable: false, statusCode, originalType: type, originalCode: code };
    }
    if (
      type.includes("content_filter") || code.includes("content_filter") ||
      type.includes("policy") || code.includes("policy")
    ) {
      return { category: "content_filter", retryable: false, statusCode, originalType: type, originalCode: code };
    }
    return { category: "validation", retryable: false, statusCode, originalType: type, originalCode: code };
  }

  // HTTP status code fallback
  if (statusCode === 401) return { category: "authentication", retryable: false, statusCode };
  if (statusCode === 403) return { category: "permission", retryable: false, statusCode };
  if (statusCode === 404) return { category: "not_found", retryable: false, statusCode };
  if (statusCode === 408 || statusCode === 504) return { category: "timeout", retryable: true, statusCode };
  if (statusCode === 500 || statusCode === 502 || statusCode === 503) {
    return { category: "server_error", retryable: true, statusCode };
  }

  return { category: "unknown", retryable: false, statusCode };
}
