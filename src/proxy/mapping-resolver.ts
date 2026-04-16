import Database from "better-sqlite3";
import type { Target, ResolveContext } from "./strategy/types.js";
import { STRATEGY_NAMES } from "./strategy/types.js";
import { ScheduledStrategy } from "./strategy/scheduled.js";
import { getMappingGroup } from "../db/index.js";

// 策略注册表：key 为数据库中 mapping_groups.strategy 字段的值。
// 新增策略时：
// 1. 在 src/proxy/strategy/ 下创建实现文件
// 2. 在此注册表中添加映射
const STRATEGIES: Record<string, import("./strategy/types.js").MappingStrategy> = {
  [STRATEGY_NAMES.SCHEDULED]: new ScheduledStrategy(),
};

export function resolveMapping(
  db: Database.Database,
  clientModel: string,
  context: ResolveContext,
): Target | null {
  const group = getMappingGroup(db, clientModel);
  if (!group) return null;

  let rule: unknown;
  try { rule = JSON.parse(group.rule); } catch { console.warn(`[mapping-resolver] Failed to parse rule for client_model '${group.client_model}'`); return null; }

  const strategy = STRATEGIES[group.strategy];
  if (!strategy) return null;

  return strategy.select(rule, context) ?? null;
}
