import type { Provider } from "../db/index.js";
import { callGet as upstreamGet } from "./transport/http.js";
import type { GetTransportResult } from "./transport/http.js";
import type { RawHeaders } from "./types.js";

// ---------- Types ----------

export interface ProxyErrorResponse {
  statusCode: number;
  body: unknown;
}

export interface ProxyErrorFormatter {
  modelNotFound(model: string): ProxyErrorResponse;
  modelNotAllowed(model: string): ProxyErrorResponse;
  providerUnavailable(): ProxyErrorResponse;
  providerTypeMismatch(): ProxyErrorResponse;
  upstreamConnectionFailed(): ProxyErrorResponse;
  concurrencyQueueFull(providerId: string): ProxyErrorResponse;
  concurrencyTimeout(providerId: string, timeoutMs: number): ProxyErrorResponse;
  promptTooLong(): ProxyErrorResponse;
}

// ---------- Error formatter factory ----------

export type ErrorKind =
  | "modelNotFound" | "modelNotAllowed" | "providerUnavailable"
  | "providerTypeMismatch" | "upstreamConnectionFailed"
  | "concurrencyQueueFull" | "concurrencyTimeout" | "promptTooLong";

/**
 * 工厂函数，消除 openai/anthropic 错误格式化的重复代码。
 * statusCode 和 message 两个 provider 完全一致，仅 body 格式不同，
 * 由 formatBody 回调根据 kind 参数映射各自的 type/code 并组装 body。
 */
export function createErrorFormatter(
  formatBody: (kind: ErrorKind, message: string) => Record<string, unknown>,
): ProxyErrorFormatter {
  return {
    modelNotFound: (model) => ({
      statusCode: 404,
      body: formatBody("modelNotFound", `Model '${model}' is not configured`),
    }),
    modelNotAllowed: (model) => ({
      statusCode: 403,
      body: formatBody("modelNotAllowed", `Model '${model}' is not allowed for this API key`),
    }),
    providerUnavailable: () => ({
      statusCode: 503,
      body: formatBody("providerUnavailable", "Provider unavailable"),
    }),
    providerTypeMismatch: () => ({
      statusCode: 500,
      body: formatBody("providerTypeMismatch", "Provider type mismatch for this endpoint"),
    }),
    upstreamConnectionFailed: () => ({
      statusCode: 502,
      body: formatBody("upstreamConnectionFailed", "Failed to connect to upstream service"),
    }),
    concurrencyQueueFull: (providerId) => ({
      statusCode: 503,
      body: formatBody("concurrencyQueueFull", `Provider '${providerId}' concurrency queue is full`),
    }),
    concurrencyTimeout: (providerId, timeoutMs) => ({
      statusCode: 504,
      body: formatBody("concurrencyTimeout", `Provider '${providerId}' concurrency wait timeout (${timeoutMs}ms)`),
    }),
    promptTooLong: () => ({
      statusCode: 400,
      body: formatBody("promptTooLong", "Prompt is too long: the input tokens exceed the model context window limit."),
    }),
  };
}

// ---------- URL utilities ----------

/**
 * 拼接上游 URL，自动处理 base_url 已包含 API 路径的情况。
 * 用户可能将 base_url 配置为 `https://host/v1/messages`，
 * 此时不应再追加 upstreamPath（`/v1/messages`），否则路径重复。
 */
export function buildUpstreamUrl(baseUrl: string, upstreamPath: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");
  if (normalized.endsWith(upstreamPath)) return normalized;
  return `${normalized}${upstreamPath}`;
}

// ---------- Header utilities ----------

export const SKIP_UPSTREAM = new Set([
  "host",
  "content-length",
  "accept-encoding",
  "authorization",
  "x-api-key",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
]);

export function selectHeaders(
  raw: RawHeaders,
  skip: Set<string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value == null || skip.has(key.toLowerCase())) continue;
    out[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

export function buildUpstreamHeaders(
  clientHeaders: RawHeaders,
  apiKey: string,
  payloadBytes?: number,
  apiType?: "openai" | "anthropic"
): Record<string, string> {
  const headers = selectHeaders(clientHeaders, SKIP_UPSTREAM);
  if (apiType === "anthropic") {
    headers["x-api-key"] = apiKey;
  } else {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  if (payloadBytes !== undefined) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = String(payloadBytes);
  }
  return headers;
}

// ---------- GET proxy (thin wrapper) ----------

export function proxyGetRequest(
  backend: Provider,
  apiKey: string,
  clientHeaders: RawHeaders,
  upstreamPath: string
): Promise<GetTransportResult> {
  return upstreamGet(backend, apiKey, clientHeaders, upstreamPath, buildUpstreamHeaders);
}
