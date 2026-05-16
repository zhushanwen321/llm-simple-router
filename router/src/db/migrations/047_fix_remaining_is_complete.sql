-- Fix remaining historical request_metrics where is_complete=0 despite
-- successful HTTP responses (status_code=200).
--
-- Migration 046 already fixed records with output_tokens>0 AND total_duration_ms>0,
-- but missed:
--   1. Records created after migration 046 ran (the root cause: SSE parser swallowed
--      [DONE] events, so metrics extractor never set complete=true)
--   2. Records with status_code=200 but null/zero tokens or duration (e.g. empty
--      responses, or streams where [DONE] was the only event)
--
-- Since the dashboard no longer filters by is_complete (see dashboard query fixes),
-- this is primarily a data integrity fix.
UPDATE request_metrics
SET is_complete = 1
WHERE is_complete = 0
  AND status_code = 200;
