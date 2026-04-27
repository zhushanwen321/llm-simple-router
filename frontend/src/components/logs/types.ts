export const PROVIDER_ID_ROUTER = 'router'

export interface LogEntry {
  id: string
  api_type: string
  model: string | null
  provider_id: string | null
  status_code: number | null
  latency_ms: number | null
  is_stream: number
  error_message: string | null
  created_at: string
  is_retry: number
  is_failover: number
  original_request_id: string | null
  original_model: string | null
  upstream_request: string | null
  backend_model: string | null
  provider_name: string | null
  child_count?: number
  client_request: string | null
  upstream_response: string | null
  input_tokens: number | null
  output_tokens: number | null
  cache_read_tokens: number | null
  ttft_ms: number | null
  tokens_per_second: number | null
  stop_reason: string | null
  metrics_complete: number
  stream_text_content: string | null
  session_id: string | null
  input_tokens_estimated: number | null
}
