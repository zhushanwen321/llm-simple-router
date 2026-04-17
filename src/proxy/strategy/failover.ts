import type { MappingStrategy, ResolveContext, Target } from "./types.js";
import { isTargetsRule } from "./targets-rule.js";

export class FailoverStrategy implements MappingStrategy {
  select(rule: unknown, context: ResolveContext): Target | undefined {
    if (!isTargetsRule(rule)) return undefined;

    for (const t of rule.targets) {
      const excluded = context.excludeTargets?.some(
        (e) => e.backend_model === t.backend_model && e.provider_id === t.provider_id
      );
      if (!excluded) return t;
    }
    return undefined;
  }
}
