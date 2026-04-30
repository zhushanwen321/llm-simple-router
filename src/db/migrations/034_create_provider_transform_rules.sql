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
