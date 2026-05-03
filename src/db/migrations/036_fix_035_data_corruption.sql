-- Fix data corruption caused by migration 035.
-- Migration 035 used `INSERT INTO providers_new SELECT * FROM providers`
-- which matches columns by position, not by name. The new table had a different
-- column order than the old table (where columns were added sequentially via
-- ALTER TABLE ADD COLUMN). This shifted every column from position 6 onward.
--
-- Old column order (via ALTER TABLE ADD COLUMN):
--   id, name, api_type, base_url, api_key, is_active, created_at, updated_at,
--   api_key_preview, models, max_concurrency, queue_timeout_ms, max_queue_size,
--   adaptive_enabled, adaptive_min
--
-- New column order (035):
--   id, name, api_type, base_url, api_key, api_key_preview, models, is_active,
--   max_concurrency, queue_timeout_ms, max_queue_size, adaptive_enabled,
--   adaptive_min, created_at, updated_at
--
-- Positional mapping of what actually went where:
--   old(6) is_active            → new api_key_preview
--   old(7) created_at           → new models
--   old(8) updated_at           → new is_active
--   old(9) api_key_preview      → new max_concurrency  ← visible bug
--   old(10) models              → new queue_timeout_ms
--   old(11) max_concurrency     → new max_queue_size
--   old(12) queue_timeout_ms    → new adaptive_enabled
--   old(13) max_queue_size      → new adaptive_min
--   old(14) adaptive_enabled    → new created_at
--   old(15) adaptive_min        → new updated_at
--
-- Guard: only fixes rows where max_concurrency contains text data
-- (api_key_preview leaked into an INTEGER column). Providers created after
-- 035 have correct INTEGER values and are not affected.

-- Step 1: Snapshot current data before fixing
CREATE TABLE _m036_snapshot AS SELECT rowid, * FROM providers;

-- Step 2: Only fix rows where max_concurrency is text (corrupted by api_key_preview).
-- Each column reads from the snapshot position where the OLD value actually ended up.
UPDATE providers SET
  api_key_preview  = (SELECT max_concurrency   FROM _m036_snapshot s WHERE s.rowid = providers.rowid),
  models           = (SELECT queue_timeout_ms  FROM _m036_snapshot s WHERE s.rowid = providers.rowid),
  is_active        = (SELECT CAST(api_key_preview  AS INTEGER) FROM _m036_snapshot s WHERE s.rowid = providers.rowid),
  max_concurrency  = (SELECT CAST(max_queue_size   AS INTEGER) FROM _m036_snapshot s WHERE s.rowid = providers.rowid),
  queue_timeout_ms = (SELECT CAST(adaptive_enabled AS INTEGER) FROM _m036_snapshot s WHERE s.rowid = providers.rowid),
  max_queue_size   = (SELECT CAST(adaptive_min     AS INTEGER) FROM _m036_snapshot s WHERE s.rowid = providers.rowid),
  adaptive_enabled = (SELECT CAST(created_at      AS INTEGER) FROM _m036_snapshot s WHERE s.rowid = providers.rowid),
  adaptive_min     = (SELECT CAST(updated_at      AS INTEGER) FROM _m036_snapshot s WHERE s.rowid = providers.rowid),
  created_at       = (SELECT models    FROM _m036_snapshot s WHERE s.rowid = providers.rowid),
  updated_at       = (SELECT is_active FROM _m036_snapshot s WHERE s.rowid = providers.rowid)
WHERE typeof((
  SELECT max_concurrency FROM _m036_snapshot s WHERE s.rowid = providers.rowid
)) = 'text';

-- Step 3: Cleanup
DROP TABLE _m036_snapshot;
