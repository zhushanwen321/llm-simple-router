import type { MappingStrategy, ResolveContext, Target } from "./types.js";
import { isTargetsRule } from "./targets-rule.js";

export class RandomStrategy implements MappingStrategy {
  select(rule: unknown, context: ResolveContext): Target | undefined {
    if (!isTargetsRule(rule)) return undefined;

    const filtered = rule.targets.filter(
      (t) => !context.excludeTargets?.some(
        (e) => e.backend_model === t.backend_model && e.provider_id === t.provider_id
      )
    );
    if (filtered.length === 0) return undefined;

    return filtered[Math.floor(Math.random() * filtered.length)];
  }
}
