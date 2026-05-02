-- Expand api_type CHECK constraint to include 'openai-responses'
-- SQLite doesn't support ALTER TABLE ... ALTER CONSTRAINT, so we recreate the table.
-- We must temporarily drop referencing foreign key tables and recreate them after.

-- Note: This migration runs inside db.transaction() in the migration runner,
-- so we don't need our own BEGIN/COMMIT. PRAGMA foreign_keys doesn't work
-- inside transactions, so we handle FK tables explicitly instead.

-- Step 1: Save referencing table data as temp tables
CREATE TABLE IF NOT EXISTS _tmp_provider_model_info AS SELECT * FROM provider_model_info;
CREATE TABLE IF NOT EXISTS _tmp_provider_transform_rules AS SELECT * FROM provider_transform_rules;

-- Step 2: Drop referencing tables
DROP TABLE IF EXISTS provider_model_info;
DROP TABLE IF EXISTS provider_transform_rules;

-- Step 3: Recreate providers with expanded CHECK
CREATE TABLE providers_new (
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

INSERT INTO providers_new SELECT * FROM providers;
DROP TABLE providers;
ALTER TABLE providers_new RENAME TO providers;

-- Step 4: Recreate referencing tables with their original schemas
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

-- Step 5: Restore data
INSERT INTO provider_model_info SELECT * FROM _tmp_provider_model_info;
INSERT OR IGNORE INTO provider_transform_rules SELECT * FROM _tmp_provider_transform_rules;

-- Step 6: Cleanup
DROP TABLE _tmp_provider_model_info;
DROP TABLE _tmp_provider_transform_rules;
