export const STRATEGY_NAMES = {
  SCHEDULED: "scheduled",
} as const;

export interface Target {
  backend_model: string;
  provider_id: string;
}

export interface ResolveContext {
  now: Date;
}

export interface MappingStrategy {
  select(rule: unknown, context: ResolveContext): Target | undefined;
}
