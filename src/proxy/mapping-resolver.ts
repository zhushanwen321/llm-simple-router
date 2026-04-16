import Database from "better-sqlite3";
import type { Target, ResolveContext } from "./strategy/types.js";
import { ScheduledStrategy } from "./strategy/scheduled.js";
import { getMappingGroup } from "../db/index.js";

const STRATEGIES: Record<string, import("./strategy/types.js").MappingStrategy> = {
  scheduled: new ScheduledStrategy(),
};

export function resolveMapping(
  db: Database.Database,
  clientModel: string,
  context: ResolveContext,
): Target | null {
  const group = getMappingGroup(db, clientModel);
  if (!group) return null;

  let rule: unknown;
  try { rule = JSON.parse(group.rule); } catch { return null; }

  const strategy = STRATEGIES[group.strategy];
  if (!strategy) return null;

  return strategy.select(rule, context) ?? null;
}
