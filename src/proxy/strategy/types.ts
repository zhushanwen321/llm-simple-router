export const STRATEGY_NAMES = {
  SCHEDULED: "scheduled",
  ROUND_ROBIN: "round-robin",
  RANDOM: "random",
  FAILOVER: "failover",
} as const;

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

export interface MappingStrategy {
  select(rule: unknown, context: ResolveContext, clientModel?: string): Target | undefined;
}
