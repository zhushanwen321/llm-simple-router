-- 为每个 provider 的每个 model 单独存储 context_window
CREATE TABLE IF NOT EXISTS provider_model_info (
  provider_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  context_window INTEGER NOT NULL,
  PRIMARY KEY (provider_id, model_name),
  FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE
);
