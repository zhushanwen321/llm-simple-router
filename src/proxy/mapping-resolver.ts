import Database from "better-sqlite3";
import type { Target, ResolveContext } from "./strategy/types.js";
import { STRATEGY_NAMES } from "./strategy/types.js";
import { ScheduledStrategy } from "./strategy/scheduled.js";
import { RoundRobinStrategy } from "./strategy/round-robin.js";
import { RandomStrategy } from "./strategy/random.js";
import { FailoverStrategy } from "./strategy/failover.js";
import { getMappingGroup } from "../db/index.js";

// 策略注册表：key 为数据库中 mapping_groups.strategy 字段的值。
// 新增策略时：
// 1. 在 src/proxy/strategy/ 下创建实现文件
// 2. 在此注册表中添加映射
const STRATEGIES: Record<string, import("./strategy/types.js").MappingStrategy> = {
  [STRATEGY_NAMES.SCHEDULED]: new ScheduledStrategy(),
  [STRATEGY_NAMES.ROUND_ROBIN]: new RoundRobinStrategy(),
  [STRATEGY_NAMES.RANDOM]: new RandomStrategy(),
  [STRATEGY_NAMES.FAILOVER]: new FailoverStrategy(),
};

export function resolveMapping(
  db: Database.Database,
  clientModel: string,
  context: ResolveContext,
): Target | null {
  // 优先处理 provider_name/backend_model 格式（如 kimi-coding-plan/kimi-for-coding）
  // 这种格式直接路由到指定 provider，不需要 mapping group
  const slashMatch = /^([a-zA-Z0-9_-]+)\/(.+)$/.exec(clientModel);
  if (slashMatch) {
    const providerName = slashMatch[1];
    const backendModel = slashMatch[2];
    const provider = db.prepare("SELECT id, models FROM providers WHERE name = ? AND is_active = 1").get(providerName) as { id: string; models: string } | undefined;
    if (provider) {
      try {
        const models: string[] = JSON.parse(provider.models);
        if (models.includes(backendModel)) {
          return { backend_model: backendModel, provider_id: provider.id };
        }
      } catch { /* 忽略解析失败 */ }
    }
    // 明确的 provider/model 格式解析失败，不再 fallback 到 mapping group
    return null;
  }

  const group = getMappingGroup(db, clientModel);
  if (!group) {
    // Fallback: 没有 mapping group 时，直接查 provider 的 models 字段
    const providers = db.prepare("SELECT id, models FROM providers WHERE is_active = 1").all() as { id: string; models: string }[];
    for (const p of providers) {
      try {
        const models: string[] = JSON.parse(p.models);
        if (models.includes(clientModel)) {
          return { backend_model: clientModel, provider_id: p.id };
        }
      } catch { /* 忽略解析失败 */ }
    }
    return null;
  }

  let rule: unknown;
  try { rule = JSON.parse(group.rule); } catch { console.warn(`[mapping-resolver] Failed to parse rule for client_model '${group.client_model}'`); return null; }

  const strategy = STRATEGIES[group.strategy];
  if (!strategy) return null;

  return strategy.select(rule, context, clientModel) ?? null;
}
