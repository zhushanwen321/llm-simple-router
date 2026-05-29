-- 051: Add endpoints column to providers, migrate existing data to endpoints JSON
ALTER TABLE providers ADD COLUMN endpoints TEXT DEFAULT NULL;

UPDATE providers
SET endpoints = json_array(
    json_object(
      'api_type', api_type,
      'base_url', base_url,
      'upstream_path', CASE WHEN upstream_path IS NULL THEN json('null') ELSE json(upstream_path) END,
      'api_key', CASE WHEN api_key IS NULL THEN json('null') ELSE api_key END
    )
  )
WHERE endpoints IS NULL
  AND api_type IS NOT NULL
  AND base_url IS NOT NULL;
