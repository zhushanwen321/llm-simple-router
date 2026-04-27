export interface Target {
  backend_model: string;
  provider_id: string;
  overflow_provider_id?: string;
  overflow_model?: string;
}

export interface ResolveContext {
  now: Date;
  excludeTargets?: Target[];
}

export interface ConcurrencyOverride {
  max_concurrency?: number;
  queue_timeout_ms?: number;
  max_queue_size?: number;
}

export interface ResolveResult {
  target: Target;
  concurrency_override?: ConcurrencyOverride;
  /** 活跃规则（schedule 或 base）中的 target 总数，用于 failover 判断 */
  targetCount: number;
}
