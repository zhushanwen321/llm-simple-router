-- 056: Backfill metrics_10min from historical request_metrics data.
-- Aggregates all existing request_metrics rows into 10-minute buckets.

INSERT INTO metrics_10min (
  bucket_time,
  router_key_id,
  provider_id,
  backend_model,
  client_type,
  api_type,
  request_count,
  sum_input_tokens,
  sum_output_tokens,
  sum_cache_read_tokens,
  sum_cache_creation_tokens,
  sum_total_duration_ms,
  sum_ttft_ms,
  sum_thinking_tokens,
  sum_text_tokens,
  sum_tool_use_tokens,
  sum_thinking_duration_ms,
  sum_text_duration_ms,
  sum_tool_use_duration_ms
)
SELECT
  datetime(floor(unixepoch(rm.created_at) / 600) * 600, 'unixepoch'),
  COALESCE(rm.router_key_id, ''),
  rm.provider_id,
  rm.backend_model,
  rm.client_type,
  rm.api_type,
  COUNT(*),
  COALESCE(SUM(rm.input_tokens), 0),
  COALESCE(SUM(rm.output_tokens), 0),
  COALESCE(SUM(rm.cache_read_tokens), 0),
  COALESCE(SUM(rm.cache_creation_tokens), 0),
  COALESCE(SUM(rm.total_duration_ms), 0),
  COALESCE(SUM(rm.ttft_ms), 0),
  COALESCE(SUM(rm.thinking_tokens), 0),
  COALESCE(SUM(rm.text_tokens), 0),
  COALESCE(SUM(rm.tool_use_tokens), 0),
  COALESCE(SUM(rm.thinking_duration_ms), 0),
  COALESCE(SUM(rm.text_duration_ms), 0),
  COALESCE(SUM(rm.tool_use_duration_ms), 0)
FROM request_metrics rm
GROUP BY
  datetime(floor(unixepoch(rm.created_at) / 600) * 600, 'unixepoch'),
  COALESCE(rm.router_key_id, ''),
  rm.provider_id,
  rm.backend_model,
  rm.client_type,
  rm.api_type
ON CONFLICT (bucket_time, router_key_id, provider_id, backend_model, client_type, api_type)
DO UPDATE SET
  request_count = request_count + excluded.request_count,
  sum_input_tokens = sum_input_tokens + excluded.sum_input_tokens,
  sum_output_tokens = sum_output_tokens + excluded.sum_output_tokens,
  sum_cache_read_tokens = sum_cache_read_tokens + excluded.sum_cache_read_tokens,
  sum_cache_creation_tokens = sum_cache_creation_tokens + excluded.sum_cache_creation_tokens,
  sum_total_duration_ms = sum_total_duration_ms + excluded.sum_total_duration_ms,
  sum_ttft_ms = sum_ttft_ms + excluded.sum_ttft_ms,
  sum_thinking_tokens = sum_thinking_tokens + excluded.sum_thinking_tokens,
  sum_text_tokens = sum_text_tokens + excluded.sum_text_tokens,
  sum_tool_use_tokens = sum_tool_use_tokens + excluded.sum_tool_use_tokens,
  sum_thinking_duration_ms = sum_thinking_duration_ms + excluded.sum_thinking_duration_ms,
  sum_text_duration_ms = sum_text_duration_ms + excluded.sum_text_duration_ms,
  sum_tool_use_duration_ms = sum_tool_use_duration_ms + excluded.sum_tool_use_duration_ms;
