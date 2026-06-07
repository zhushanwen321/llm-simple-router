import type { Provider } from "../db/index.js";
import { callGet as upstreamGet } from "./transport/http.js";
import type { GetTransportResult } from "./transport/http.js";
import type { RawHeaders } from "./types.js";
import type { ErrorKind } from "./format/types.js";

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
  unsupportedModality(): ProxyErrorResponse;
}

// ---------- Error formatter factory ----------

export type { ErrorKind } from "./format/types.js";

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
    unsupportedModality: () => ({
      statusCode: 400,
      body: formatBody("unsupportedModality", "Request contains multimodal content but no available model supports the required modality."),
    }),
  };
}

// ---------- URL utilities ----------

/**
 * 已知上游 API 路径后缀（不含 /v1 等版本前缀）。
 * 用于检测 base_url 中是否已包含完整路径。
 */
const KNOWN_API_SUFFIXES = [
  "/chat/completions",
  "/messages",
  "/responses",
] as const;

/**
 * 拼接上游 URL，自动处理 base_url 已包含部分或完整 API 路径的情况。
 *
 * 兼容场景：
 * - base_url = `https://host/v1`, upstreamPath = `/v1/chat/completions` → `https://host/v1/chat/completions`
 * - base_url = `https://host/v1/chat/completions`, upstreamPath = `/v1/chat/completions` → `https://host/v1/chat/completions`
 * - base_url = `https://host/chat/completions`, upstreamPath = `/v1/chat/completions` → `https://host/chat/completions`
 * - base_url = `https://host/v1/`, upstreamPath = `/v1/chat/completions` → `https://host/v1/chat/completions`
 * - base_url = `https://host/api/paas/v4`, upstreamPath = `/api/paas/v4/chat/completions` → `https://host/api/paas/v4/chat/completions`
 */
export function buildUpstreamUrl(baseUrl: string, upstreamPath: string): string {
  const normalized = baseUrl.replace(/\/+$/, "");

  // 1) 完全匹配：base_url 已包含完整 upstreamPath
  if (normalized.endsWith(upstreamPath)) return normalized;

  // 2) 检测 base_url 是否已包含已知 API 路径后缀
  //    例如 `https://host/v1/chat/completions` → 已包含，直接返回
  for (const suffix of KNOWN_API_SUFFIXES) {
    if (normalized.endsWith(suffix)) return normalized;
  }

  // 3) 从 upstreamPath 中找到 base_url 的重叠部分，只追加非重叠尾部
  //    例如 base_url = `https://host/api/paas/v4`, upstreamPath = `/api/paas/v4/chat/completions`
  //    → 重叠 `/api/paas/v4`，追加 `/chat/completions`
  //    例如 base_url = `https://host/v1`, upstreamPath = `/v1/chat/completions`
  //    → 重叠 `/v1`，追加 `/chat/completions`
  const overlap = findPathOverlap(normalized, upstreamPath);
  if (overlap.length > 0) {
    const rest = upstreamPath.slice(overlap.length);
    return `${normalized}${rest}`;
  }

  // 4) 确保拼接处有且仅有一个 /
  if (!upstreamPath.startsWith("/")) return `${normalized}/${upstreamPath}`;
  return `${normalized}${upstreamPath}`;
}

/**
 * 找出 base_url 末尾与 upstreamPath 开头的最长重叠路径段。
 * 例如 base_url = `https://host/api/v4`, upstreamPath = `/api/v4/chat/completions` → 返回 `/api/v4`
 */
function findPathOverlap(baseUrl: string, upstreamPath: string): string {
  // 将 upstreamPath 按 / 拆分，逐段检查是否与 baseUrl 末尾匹配
  const segments = upstreamPath.split("/");
  // segments[0] 是空字符串（因为 upstreamPath 以 / 开头），至少需要 2 段才有意义
  const MIN_OVERLAP_SEGMENTS = 2;
  for (let len = segments.length - 1; len >= MIN_OVERLAP_SEGMENTS; len--) {
    const candidate = segments.slice(0, len).join("/");
    if (candidate.length > 0 && baseUrl.endsWith(candidate)) {
      return candidate;
    }
  }
  return "";
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
  apiType?: "openai" | "openai-responses" | "anthropic"
): Record<string, string> {
  const headers = selectHeaders(clientHeaders, SKIP_UPSTREAM);
  if (apiType === "anthropic") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] ??= "2023-06-01";
  } else {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  if (payloadBytes !== undefined) {
    headers["Content-Type"] = "application/json";
    headers["Content-Length"] = payloadBytes.toString();
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
