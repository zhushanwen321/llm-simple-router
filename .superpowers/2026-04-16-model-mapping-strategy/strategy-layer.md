# 策略层设计

## ResolveContext 扩展

```typescript
// src/proxy/strategy/types.ts
export interface ResolveContext {
  now: Date;
  excludeTargets?: Target[];  // 已失败的 targets，策略选择时跳过
}

export const STRATEGY_NAMES = {
  SCHEDULED: "scheduled",
  ROUND_ROBIN: "round-robin",
  RANDOM: "random",
  FAILOVER: "failover",
} as const;
```

## 共享类型

三种新策略共享 rule 结构：

```typescript
interface TargetsRule {
  targets: Target[];
}
```

## RoundRobinStrategy

- 内存状态：`Map<string, number>`（clientModel → lastIndex）
- `select(rule, context)`：
  1. 从 targets 中过滤掉 excludeTargets 得到 filteredTargets
  2. 如果 filteredTargets 为空，返回 undefined
  3. 取 (lastIndex + 1) % filteredTargets.length
  4. 更新内存 index 为新位置
  5. 返回 filteredTargets[index]
- **index 语义**：lastIndex 基于 filteredTargets 数组的位置，每次 select 成功（返回非 undefined）才推进
- 重启后 index 归零

## RandomStrategy

- `select(rule, context)`：
  1. 从 targets 中过滤掉 excludeTargets
  2. 如果为空，返回 undefined
  3. Math.random() 选一个

## FailoverStrategy

- `select(rule, context)`：
  1. 遍历 targets，返回第一个不在 excludeTargets 中的 target
  2. 无匹配时返回 undefined

## 注册

```typescript
// src/proxy/mapping-resolver.ts
const STRATEGIES = {
  [STRATEGY_NAMES.SCHEDULED]: new ScheduledStrategy(),
  [STRATEGY_NAMES.ROUND_ROBIN]: new RoundRobinStrategy(),
  [STRATEGY_NAMES.RANDOM]: new RandomStrategy(),
  [STRATEGY_NAMES.FAILOVER]: new FailoverStrategy(),
};
```
