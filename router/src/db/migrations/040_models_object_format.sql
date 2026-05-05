-- 040_models_object_format.sql
-- Convert providers.models from string array to object array
-- ["glm-5.1"] → [{"id": "glm-5.1"}]

UPDATE providers
SET models = (
  SELECT json_group_array(json('{"id": ' || json_quote(value) || '}'))
  FROM json_each(models)
)
WHERE json_type(models) = 'array'
  AND json_array_length(models) > 0
  AND json_type(json_extract(models, '$[0]')) = 'string';
