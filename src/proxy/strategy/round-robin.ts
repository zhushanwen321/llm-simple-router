import type { MappingStrategy, ResolveContext, Target } from "./types.js";

export class RoundRobinStrategy implements MappingStrategy {
  select(_rule: unknown, _context: ResolveContext): Target | undefined {
    throw new Error("Not implemented");
  }
}
