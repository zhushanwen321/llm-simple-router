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
}
