import type { ActiveRequest } from "@/types/monitor";
import type { LogEntry } from "@/components/logs/types";

export type DataSource = "realtime" | "history";

export const MS_PER_SECOND = 1000;
export const HTTP_ERROR_THRESHOLD = 400;

export interface UnifiedRequestOverview {
  id: string;
  model: string;
  backendModel: string | null;
  originalModel: string | null;
  statusCode: number | null;
  isStream: boolean;
  apiType: "openai" | "anthropic";
  providerName: string | null;
  clientIp: string | undefined;
  sessionId: string | null;
  latencyMs: number | null;
  ttftMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  tokensPerSecond: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  stopReason: string | null;
  isComplete: boolean;
  attempts: {
    statusCode: number | null;
    error: string | null;
    latencyMs: number;
    providerId: string;
  }[];
  status: "pending" | "completed" | "failed";
  clientRequest: string | null;
  upstreamRequest: string | null;
  responseBody: string | null;
  upstreamResponse: string | null;
  errorMessage: string | null;
  createdAt: string | null;
  inputTokensEstimated: boolean;
}

export function fromActiveRequest(
  req: ActiveRequest,
  nonStreamBody?: string | null,
): UnifiedRequestOverview {
  const lastAttempt =
    req.attempts.length > 0 ? req.attempts[req.attempts.length - 1] : undefined;
  const m = req.streamMetrics;

  let tokensPerSecond = m?.tokensPerSecond ?? null;
  if (!tokensPerSecond && m && m.outputTokens && m.ttftMs && req.completedAt) {
    const outputTime =
      (req.completedAt - req.startTime - m.ttftMs) / MS_PER_SECOND;
    if (outputTime > 0) tokensPerSecond = m.outputTokens / outputTime;
  }

  return {
    id: req.id,
    model: req.model,
    backendModel: null,
    originalModel: null,
    statusCode:
      req.status === "completed" ? (lastAttempt?.statusCode ?? null) : null,
    isStream: req.isStream,
    apiType: req.apiType,
    providerName: req.providerName,
    clientIp: req.clientIp,
    sessionId: req.sessionId ?? null,
    latencyMs: req.completedAt ? req.completedAt - req.startTime : null,
    ttftMs: m?.ttftMs ?? null,
    inputTokens: m?.inputTokens ?? null,
    outputTokens: m?.outputTokens ?? null,
    tokensPerSecond,
    cacheReadTokens: m?.cacheReadTokens ?? null,
    cacheWriteTokens: null,
    stopReason: m?.stopReason ?? null,
    isComplete: m?.isComplete ?? false,
    attempts: req.attempts.map((a) => ({
      statusCode: a.statusCode,
      error: a.error,
      latencyMs: a.latencyMs,
      providerId: a.providerId,
    })),
    status: req.status,
    clientRequest: null,
    upstreamRequest: null,
    responseBody: nonStreamBody ?? null,
    upstreamResponse: null,
    errorMessage: null,
    createdAt: null,
    inputTokensEstimated: false,
  };
}

/**
 * 从日志字段提取实际的响应 body。
 * upstream_response 可能只是 {"statusCode":200, "body":null} 形式的 headers 元数据，
 * 需要检测 body 字段是否存在真实内容。
 */
function extractResponseBody(upstreamResponse: string | null): string | null {
  if (!upstreamResponse) return null;
  try {
    const parsed = JSON.parse(upstreamResponse);
    // headers 元数据包装格式：{ statusCode, headers, body }
    if (
      typeof parsed.statusCode === "number" &&
      parsed.headers &&
      !parsed.content &&
      !parsed.choices
    ) {
      return typeof parsed.body === "string" ? parsed.body : null;
    }
    return upstreamResponse;
  } catch {
    return upstreamResponse;
  }
}

/** Router 内部错误前缀，这些是 early error detection 等机制生成的诊断标签，不应对用户展示 */
const ROUTER_INTERNAL_ERROR_PREFIXES = [
  "stream_error: upstream returned 200 but body contains error",
];

function isRouterInternalError(msg: string | null | undefined): boolean {
  if (!msg) return false;
  return ROUTER_INTERNAL_ERROR_PREFIXES.some((prefix) =>
    msg.startsWith(prefix),
  );
}

export function fromLogEntry(entry: LogEntry): UnifiedRequestOverview {
  const inputTokens = entry.input_tokens ?? null;
  const outputTokens = entry.output_tokens ?? null;
  const ttftMs = entry.ttft_ms ?? null;

  let tokensPerSecond = entry.tokens_per_second ?? null;
  if (!tokensPerSecond && outputTokens && ttftMs && entry.latency_ms) {
    const outputTime = (entry.latency_ms - ttftMs) / MS_PER_SECOND;
    if (outputTime > 0) tokensPerSecond = outputTokens / outputTime;
  }

  // 非流式：从 upstream_response.body 提取完整 JSON 响应
  // 流式：upstream_response.body 为 null，回退到 stream_text_content（纯文本）
  const responseBody =
    extractResponseBody(entry.upstream_response) ??
    entry.stream_text_content ??
    null;

  return {
    id: entry.id,
    model: entry.original_model ?? entry.model ?? "unknown",
    backendModel: entry.backend_model,
    originalModel: entry.original_model,
    statusCode: entry.status_code,
    isStream: !!entry.is_stream,
    apiType:
      entry.api_type === "openai" || entry.api_type === "anthropic"
        ? entry.api_type
        : "openai",
    providerName: entry.provider_name,
    clientIp: undefined,
    sessionId: entry.session_id ?? null,
    latencyMs: entry.latency_ms,
    ttftMs,
    inputTokens,
    outputTokens,
    tokensPerSecond,
    cacheReadTokens: entry.cache_read_tokens ?? null,
    cacheWriteTokens: null,
    stopReason: entry.stop_reason ?? null,
    isComplete: !!entry.metrics_complete,
    attempts: [],
    status:
      (entry.status_code ?? 0) >= HTTP_ERROR_THRESHOLD ? "failed" : "completed",
    clientRequest: entry.client_request,
    upstreamRequest: entry.upstream_request,
    responseBody,
    upstreamResponse: entry.upstream_response,
    errorMessage: isRouterInternalError(entry.error_message)
      ? null
      : entry.error_message,
    createdAt: entry.created_at,
    inputTokensEstimated: entry.input_tokens_estimated === 1,
  };
}
