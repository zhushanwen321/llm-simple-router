-- Fix data corruption caused by migration 036.
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
<<<<<<< HEAD
<<<<<<< HEAD
=======
>>>>>>> dabf184 (fix(shutdown): second Ctrl+C force-exits immediately)
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
<<<<<<< HEAD
=======
-- This migration reverses the shift with explicit column mapping.

-- Step 1: Save referencing table data
CREATE TABLE IF NOT EXISTS _tmp_m036_model_info AS SELECT * FROM provider_model_info;
CREATE TABLE IF NOT EXISTS _tmp_m036_transform_rules AS SELECT * FROM provider_transform_rules;

-- Step 2: Drop referencing tables
DROP TABLE IF EXISTS provider_model_info;
DROP TABLE IF EXISTS provider_transform_rules;

-- Step 3: Recreate providers with corrected data
-- Each column reads from the position where the OLD value actually ended up
CREATE TABLE providers_fixed (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  api_type TEXT NOT NULL CHECK(api_type IN ('openai', 'openai-responses', 'anthropic')),
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  api_key_preview TEXT,
  models TEXT NOT NULL DEFAULT '[]',
  is_active INTEGER NOT NULL DEFAULT 1,
  max_concurrency INTEGER NOT NULL DEFAULT 0,
  queue_timeout_ms INTEGER NOT NULL DEFAULT 0,
  max_queue_size INTEGER NOT NULL DEFAULT 100,
  adaptive_enabled INTEGER NOT NULL DEFAULT 0,
  adaptive_min INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO providers_fixed
SELECT
  id,                                     -- id (correct position)
  name,                                   -- name (correct position)
  api_type,                               -- api_type (correct position)
  base_url,                               -- base_url (correct position)
  api_key,                                -- api_key (correct position)
  -- api_key_preview: old(9) api_key_preview ended up in max_concurrency
  max_concurrency AS api_key_preview,
  -- models: old(10) models ended up in queue_timeout_ms
  queue_timeout_ms AS models,
  -- is_active: old(6) is_active ended up in api_key_preview
  CAST(api_key_preview AS INTEGER) AS is_active,
  -- max_concurrency: old(11) max_concurrency ended up in max_queue_size
  CAST(max_queue_size AS INTEGER) AS max_concurrency,
  -- queue_timeout_ms: old(12) queue_timeout_ms ended up in adaptive_enabled
  CAST(adaptive_enabled AS INTEGER) AS queue_timeout_ms,
  -- max_queue_size: old(13) max_queue_size ended up in adaptive_min
  CAST(adaptive_min AS INTEGER) AS max_queue_size,
  -- adaptive_enabled: old(14) adaptive_enabled ended up in created_at
  CAST(created_at AS INTEGER) AS adaptive_enabled,
  -- adaptive_min: old(15) adaptive_min ended up in updated_at
  CAST(updated_at AS INTEGER) AS adaptive_min,
  -- created_at: old(7) created_at ended up in models
  models AS created_at,
  -- updated_at: old(8) updated_at ended up in is_active
  is_active AS updated_at
FROM providers;

-- Step 4: Swap tables
DROP TABLE providers;
ALTER TABLE providers_fixed RENAME TO providers;

-- Step 5: Recreate referencing tables
CREATE TABLE provider_model_info (
  provider_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  context_window INTEGER NOT NULL,
  PRIMARY KEY (provider_id, model_name),
  FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS provider_transform_rules (
  provider_id TEXT PRIMARY KEY REFERENCES providers(id) ON DELETE CASCADE,
  inject_headers TEXT,
  request_defaults TEXT,
  drop_fields TEXT,
  field_overrides TEXT,
  plugin_name TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Step 6: Restore referencing data
INSERT INTO provider_model_info SELECT * FROM _tmp_m036_model_info;
INSERT OR IGNORE INTO provider_transform_rules SELECT * FROM _tmp_m036_transform_rules;

-- Step 7: Cleanup
DROP TABLE _tmp_m036_model_info;
DROP TABLE _tmp_m036_transform_rules;
>>>>>>> c5fc153 (fix(db): fix column order corruption in migration 035)
=======
>>>>>>> dabf184 (fix(shutdown): second Ctrl+C force-exits immediately)
