export interface ContentBlock {
  type: 'thinking' | 'text' | 'tool_use'
  content: string
  name?: string
}

export interface StreamContentSnapshot {
  rawChunks: string
  textContent: string
  totalChars: number
  blocks?: ContentBlock[]
}

export interface ActiveRequest {
  id: string
  apiType: 'openai' | 'anthropic'
  model: string
  providerId: string
  providerName: string
  isStream: boolean
  queued?: boolean
  startTime: number
  status: 'pending' | 'completed' | 'failed'
  retryCount: number
  attempts: AttemptSnapshot[]
  streamMetrics?: StreamMetricsSnapshot
  streamContent?: StreamContentSnapshot
  clientIp?: string
  completedAt?: number
}

export interface AttemptSnapshot {
  statusCode: number | null
  error: string | null
  latencyMs: number
  providerId: string
}

export interface StreamMetricsSnapshot {
  inputTokens: number | null
  outputTokens: number | null
  ttftMs: number | null
  stopReason: string | null
  isComplete: boolean
}

export interface ProviderConcurrencySnapshot {
  providerId: string
  providerName: string
  maxConcurrency: number
  active: number
  queued: number
  queueTimeoutMs: number
  maxQueueSize: number
}

export interface ProviderStats {
  providerName: string
  totalRequests: number
  successCount: number
  errorCount: number
  avgLatencyMs: number
  retryCount: number
  topErrors: Array<{ code: number; count: number }>
}

export interface StatsSnapshot {
  totalRequests: number
  successCount: number
  errorCount: number
  retryCount: number
  failoverCount: number
  avgLatencyMs: number
  p50LatencyMs: number
  p99LatencyMs: number
  byProvider: Record<string, ProviderStats>
  byStatusCode: Record<number, number>
}

export interface RuntimeMetrics {
  uptimeMs: number
  memoryUsage: { rss: number; heapTotal: number; heapUsed: number; external: number; arrayBuffers: number }
  activeHandles: number
  activeRequests: number
  eventLoopDelayMs: number
}
