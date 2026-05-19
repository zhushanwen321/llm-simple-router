export interface RetryRule {
  id: string;
  name: string;
  status_code: number;
  body_pattern: string;
  is_active: number;
  created_at: string;
  retry_strategy: "fixed" | "exponential";
  retry_delay_ms: number;
  max_retries: number;
  max_delay_ms: number;
}

export interface RouterKey {
  id: string;
  name: string;
  key: string | null;
  key_prefix: string;
  allowed_models: string[] | null;
  is_active: number;
  created_at: string;
}
