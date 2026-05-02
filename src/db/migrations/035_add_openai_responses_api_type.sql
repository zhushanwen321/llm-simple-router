-- Allow 'openai-responses' as a valid api_type for OpenAI Responses API support
-- The providers table was renamed from backend_services in migration 005

-- Remove the old CHECK constraint by recreating the table is not practical,
-- so we use a workaround: SQLite doesn't support ALTER TABLE ... DROP CONSTRAINT,
-- but we can recreate the table with the updated constraint.

-- However, since the table name might be 'providers' (renamed in 005),
-- we need to handle both cases. Let's use the simpler approach:

-- Step 1: Create a new table with the updated constraint
CREATE TABLE IF NOT EXISTS providers_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  api_type TEXT NOT NULL CHECK(api_type IN ('openai', 'openai-responses', 'anthropic')),
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  api_key_preview TEXT,
  models TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  max_concurrency INTEGER,
  queue_timeout_ms INTEGER,
  max_queue_size INTEGER,
  adaptive_enabled INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Step 2: Copy data from the old table
INSERT INTO providers_new SELECT * FROM providers;

-- Step 3: Drop the old table
DROP TABLE providers;

-- Step 4: Rename the new table
ALTER TABLE providers_new RENAME TO providers;
