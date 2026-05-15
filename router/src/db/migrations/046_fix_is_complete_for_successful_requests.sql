-- Fix historical request_metrics where is_complete=0 despite successful responses.
-- Root cause: StreamProxy.onEnd() collected metrics before SSE parser flush,
-- causing is_complete to always be 0 for providers using OpenAI SSE format.
-- Only fix records with clear success signals (status 200 + output tokens + duration).
UPDATE request_metrics
SET is_complete = 1
WHERE is_complete = 0
  AND status_code = 200
  AND output_tokens > 0
  AND total_duration_ms > 0;
