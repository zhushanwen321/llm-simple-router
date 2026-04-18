CREATE TABLE IF NOT EXISTS session_model_states (
  id TEXT PRIMARY KEY,
  router_key_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  current_model TEXT NOT NULL,
  original_model TEXT,
  last_active_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(router_key_id, session_id),
  FOREIGN KEY (router_key_id) REFERENCES router_keys(id)
);
CREATE INDEX idx_sms_router_key ON session_model_states(router_key_id);

CREATE TABLE IF NOT EXISTS session_model_history (
  id TEXT PRIMARY KEY,
  router_key_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  old_model TEXT,
  new_model TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (router_key_id) REFERENCES router_keys(id)
);
CREATE INDEX idx_smh_session ON session_model_history(router_key_id, session_id);
