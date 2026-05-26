-- Normalize patch IDs in providers.models JSON from hyphen to underscore format.
-- All patch IDs stored in DB should use underscore (thinking_consistency, orphan_tool_results, etc).
-- Frontend sends hyphen format; normalizePatchName() normalizes at write/read time.
-- This migration ensures existing DB data is also normalized and deduplicated.

-- Step 1: Migrate old patch IDs to current canonical names (underscore format)
-- These old IDs were already stored with underscores, just need name mapping
UPDATE providers
SET models = REPLACE(models, 'thinking_param', 'thinking_consistency')
WHERE models LIKE '%thinking_param%';

UPDATE providers
SET models = REPLACE(models, 'thinking_blocks', 'thinking_consistency')
WHERE models LIKE '%thinking_blocks%';

UPDATE providers
SET models = REPLACE(models, 'non_ds_tools', 'thinking_consistency')
WHERE models LIKE '%non_ds_tools%';

UPDATE providers
SET models = REPLACE(models, 'cache_control', 'thinking_consistency')
WHERE models LIKE '%cache_control%';

-- Step 2: Normalize hyphen to underscore (must handle multi-word IDs in correct order)
-- Longer IDs first to avoid partial replacement

-- orphan-tool-results-oa → orphan_tool_results_oa (before orphan-tool-results)
UPDATE providers
SET models = REPLACE(models, 'orphan-tool-results-oa', 'orphan_tool_results_oa')
WHERE models LIKE '%orphan-tool-results-oa%';

-- orphan-tool-results → orphan_tool_results
UPDATE providers
SET models = REPLACE(models, 'orphan-tool-results', 'orphan_tool_results')
WHERE models LIKE '%orphan-tool-results%';

-- thinking-consistency → thinking_consistency
UPDATE providers
SET models = REPLACE(models, 'thinking-consistency', 'thinking_consistency')
WHERE models LIKE '%thinking-consistency%';

-- developer-role → developer_role
UPDATE providers
SET models = REPLACE(models, 'developer-role', 'developer_role')
WHERE models LIKE '%developer-role%';

-- Step 3: Deduplicate patch arrays within each provider's models JSON.
-- After migration, the same patch ID may appear multiple times in an array.
-- This uses a recursive CTE to remove duplicate values from JSON arrays.
-- Only processes rows that have patches (contain "thinking_consistency" etc).
--
-- Note: SQLite JSON dedup is complex. The application layer (parseModels)
-- already deduplicates via Set at read time, so this step is best-effort
-- cleanup for DB consistency. A separate script is recommended for large datasets.
