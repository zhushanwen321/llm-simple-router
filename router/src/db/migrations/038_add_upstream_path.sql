-- Add upstream_path column to providers table.
-- When NULL, the router uses the default path based on api_type:
--   openai / openai-responses → /v1/chat/completions or /v1/responses
--   anthropic → /v1/messages
-- When set, this value overrides the default upstream path.

ALTER TABLE providers ADD COLUMN upstream_path TEXT DEFAULT NULL;
