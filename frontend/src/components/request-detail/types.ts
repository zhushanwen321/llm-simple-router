import type { ActiveRequest } from '@/types/monitor'
import type { LogEntry } from '@/components/logs/types'

export type DataSource = 'realtime' | 'history'

const MS_PER_SECOND = 1000
const HTTP_ERROR_THRESHOLD = 400

export interface UnifiedRequestOverview {
  id: string
  model: string
  backendModel: string | null
  originalModel: string | null
  statusCode: number | null
  isStream: boolean
  apiType: 'openai' | 'anthropic'
  providerName: string | null
  clientIp: string | undefined
  sessionId: string | null
  latencyMs: number | null
  ttftMs: number | null
  inputTokens: number | null
  outputTokens: number | null
  tokensPerSecond: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  stopReason: string | null
  isComplete: boolean
  attempts: { statusCode: number | null; error: string | null; latencyMs: number; providerId: string }[]
  status: 'pending' | 'completed' | 'failed'
  clientRequest: string | null
  upstreamRequest: string | null
  responseBody: string | null
  upstreamResponse: string | null
  errorMessage: string | null
  createdAt: string | null
}

export function fromActiveRequest(
  req: ActiveRequest,
  nonStreamBody?: string | null,
): UnifiedRequestOverview {
  const lastAttempt = req.attempts.length > 0
    ? req.attempts[req.attempts.length - 1]
    : undefined
  const m = req.streamMetrics

  let tokensPerSecond: number | null = null
  if (m && m.outputTokens && m.ttftMs && req.completedAt) {
    const outputTime = (req.completedAt - req.startTime - m.ttftMs) / MS_PER_SECOND
    if (outputTime > 0) tokensPerSecond = m.outputTokens / outputTime
  }

  return {
    id: req.id,
    model: req.model,
    backendModel: null,
    originalModel: null,
    statusCode: req.status === 'completed' ? (lastAttempt?.statusCode ?? null) : null,
    isStream: req.isStream,
    apiType: req.apiType,
    providerName: req.providerName,
    clientIp: req.clientIp,
    sessionId: null,
    latencyMs: req.completedAt ? req.completedAt - req.startTime : null,
    ttftMs: m?.ttftMs ?? null,
    inputTokens: m?.inputTokens ?? null,
    outputTokens: m?.outputTokens ?? null,
    tokensPerSecond,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    stopReason: m?.stopReason ?? null,
    isComplete: m?.isComplete ?? false,
    attempts: req.attempts.map(a => ({
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
  }
}

/**
 * 从日志字段提取实际的响应 body。
 * upstream_response 可能只是 {"statusCode":200, "body":null} 形式的 headers 元数据，
 * 需要检测 body 字段是否存在真实内容。
 */
function extractResponseBody(upstreamResponse: string | null): string | null {
  if (!upstreamResponse) return null
  try {
    const parsed = JSON.parse(upstreamResponse)
    // headers 元数据包装格式：{ statusCode, headers, body }
    if (typeof parsed.statusCode === 'number' && parsed.headers && !parsed.content && !parsed.choices) {
      return typeof parsed.body === 'string' ? parsed.body : null
    }
    return upstreamResponse
  } catch { return upstreamResponse }
}

export function fromLogEntry(entry: LogEntry): UnifiedRequestOverview {
  // TODO: LogEntry 当前未关联 request_metrics 表，input/output tokens 等字段暂为 null。
  // 后续如需展示历史请求的完整指标，应联表查询 request_metrics。
  const inputTokens: number | null = null
  const outputTokens: number | null = null
  const ttftMs: number | null = null

  let tokensPerSecond: number | null = null
  if (entry.latency_ms && outputTokens && ttftMs) {
    const outputTime = (entry.latency_ms - ttftMs) / MS_PER_SECOND
    if (outputTime > 0) tokensPerSecond = outputTokens / outputTime
  }

  return {
    id: entry.id,
    model: entry.original_model ?? entry.model ?? 'unknown',
    backendModel: entry.backend_model,
    originalModel: entry.original_model,
    statusCode: entry.status_code,
    isStream: !!entry.is_stream,
    apiType: entry.api_type as 'openai' | 'anthropic',
    providerName: entry.provider_name,
    clientIp: undefined,
    sessionId: null,
    latencyMs: entry.latency_ms,
    ttftMs,
    inputTokens,
    outputTokens,
    tokensPerSecond,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    stopReason: null,
    isComplete: true,
    attempts: [],
    status: (entry.status_code ?? 0) >= HTTP_ERROR_THRESHOLD ? 'failed' : 'completed',
    clientRequest: entry.client_request,
    upstreamRequest: entry.upstream_request,
    responseBody: extractResponseBody(entry.upstream_response),
    upstreamResponse: entry.upstream_response,
    errorMessage: entry.error_message,
    createdAt: entry.created_at,
  }
}
