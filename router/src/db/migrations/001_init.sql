CREATE TABLE IF NOT EXISTS migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backend_services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_type TEXT NOT NULL CHECK(api_type IN ('openai', 'anthropic')),
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_mappings (
  id TEXT PRIMARY KEY,
  client_model TEXT NOT NULL UNIQUE,
  backend_model TEXT NOT NULL,
  backend_service_id TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  FOREIGN KEY (backend_service_id) REFERENCES backend_services(id)
);

CREATE TABLE IF NOT EXISTS request_logs (
  id TEXT PRIMARY KEY,
  api_type TEXT NOT NULL,
  model TEXT,
  backend_service_id TEXT,
  status_code INTEGER,
  latency_ms INTEGER,
  is_stream INTEGER,
  error_message TEXT,
  created_at TEXT NOT NULL
);
