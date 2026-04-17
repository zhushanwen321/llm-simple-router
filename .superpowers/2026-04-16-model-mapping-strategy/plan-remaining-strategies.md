# 剩余负载策略 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为模型映射分组实现轮询 (round-robin)、随机 (random)、故障转移 (failover) 三种负载策略。

**Architecture:** 在现有 `MappingStrategy` 接口基础上新增三个策略实现类，通过 `STRATEGIES` 注册表注册。故障转移通过扩展 `ResolveContext` 的 `excludeTargets` 字段，在 `proxy-core` 层面实现跨 target 重试循环。

**Tech Stack:** TypeScript, Vitest, Fastify, Vue 3, shadcn-vue

**Spec:** `.superpowers/2026-04-16-model-mapping-strategy/spec-remaining-strategies.md`

---

## File Structure

| 操作 | 文件 | 职责 |
|------|------|------|
| Modify | `src/proxy/strategy/types.ts` | 扩展 ResolveContext、STRATEGY_NAMES |
| Create | `src/proxy/strategy/round-robin.ts` | 轮询策略实现 |
| Create | `src/proxy/strategy/random.ts` | 随机策略实现 |
| Create | `src/proxy/strategy/failover.ts` | 故障转移策略实现 |
| Modify | `src/proxy/mapping-resolver.ts` | 注册新策略 |
| Modify | `src/proxy/proxy-core.ts` | failover 跨 target 重试循环 |
| Modify | `src/admin/groups.ts` | validateRule 扩展新策略 |
| Modify | `frontend/src/views/ModelMappings.vue` | 展示新策略的 targets |
| Modify | `frontend/src/components/mappings/MappingGroupFormDialog.vue` | 策略选择 + targets 表单 |
| Create | `tests/round-robin-strategy.test.ts` | 轮询策略单元测试 |
| Create | `tests/random-strategy.test.ts` | 随机策略单元测试 |
| Create | `tests/failover-strategy.test.ts` | 故障转移策略单元测试 |
| Modify | `tests/mapping-resolver.test.ts` | 新策略的 resolveMapping 集成测试 |
| Modify | `tests/admin-groups.test.ts` | Admin API 新策略验证测试 |

---

### Task 1: 扩展策略类型定义

**Files:**
- Modify: `src/proxy/strategy/types.ts`

- [ ] **Step 1: 更新 types.ts**

在现有文件中扩展 `ResolveContext` 和 `STRATEGY_NAMES`：

```typescript
export const STRATEGY_NAMES = {
  SCHEDULED: "scheduled",
  ROUND_ROBIN: "round-robin",
  RANDOM: "random",
  FAILOVER: "failover",
} as const;

export interface Target {
  backend_model: string;
  provider_id: string;
}

export interface ResolveContext {
  now: Date;
  excludeTargets?: Target[];
}

export interface MappingStrategy {
  select(rule: unknown, context: ResolveContext, clientModel?: string): Target | undefined;
}
```

- [ ] **Step 2: 运行现有测试确认无回归**

Run: `npx vitest run tests/scheduled-strategy.test.ts tests/mapping-resolver.test.ts`
Expected: 全部 PASS

- [ ] **Step 3: Commit**

```bash
git add src/proxy/strategy/types.ts
git commit -m "feat(strategy): extend ResolveContext with excludeTargets and add strategy names"
```

---

### Task 2: 实现 RoundRobinStrategy

**Files:**
- Create: `src/proxy/strategy/round-robin.ts`
- Create: `tests/round-robin-strategy.test.ts`

- [ ] **Step 1: 编写 failing test**

创建 `tests/round-robin-strategy.test.ts`：

```typescript
import { describe, it, expect } from "vitest";
import { RoundRobinStrategy } from "../src/proxy/strategy/round-robin.js";
import type { Target } from "../src/proxy/strategy/types.js";

const t1: Target = { backend_model: "gpt-4", provider_id: "p1" };
const t2: Target = { backend_model: "claude-3", provider_id: "p2" };
const t3: Target = { backend_model: "gemini", provider_id: "p3" };

function makeContext() {
  return { now: new Date() };
}

describe("RoundRobinStrategy", () => {
  it("cycles through targets in order", () => {
    const strategy = new RoundRobinStrategy();
    const rule = { targets: [t1, t2, t3] };
    expect(strategy.select(rule, makeContext())).toEqual(t1);
    expect(strategy.select(rule, makeContext())).toEqual(t2);
    expect(strategy.select(rule, makeContext())).toEqual(t3);
    expect(strategy.select(rule, makeContext())).toEqual(t1);
  });

  it("returns undefined for empty targets", () => {
    const strategy = new RoundRobinStrategy();
    expect(strategy.select({ targets: [] }, makeContext())).toBeUndefined();
  });

  it("skips excluded targets", () => {
    const strategy = new RoundRobinStrategy();
    const rule = { targets: [t1, t2, t3] };
    strategy.select(rule, makeContext()); // t1
    strategy.select(rule, makeContext()); // t2
    // exclude t3, should cycle back to t1
    const result = strategy.select(rule, { ...makeContext(), excludeTargets: [t3] });
    expect(result).toEqual(t1);
  });

  it("returns undefined when all targets excluded", () => {
    const strategy = new RoundRobinStrategy();
    const rule = { targets: [t1, t2] };
    const result = strategy.select(rule, { ...makeContext(), excludeTargets: [t1, t2] });
    expect(result).toBeUndefined();
  });

  it("returns undefined for invalid rule", () => {
    const strategy = new RoundRobinStrategy();
    expect(strategy.select(null, makeContext())).toBeUndefined();
    expect(strategy.select({ targets: "not-array" }, makeContext())).toBeUndefined();
    expect(strategy.select({ targets: [null] }, makeContext())).toBeUndefined();
  });

  it("maintains independent state per client model", () => {
    const strategy = new RoundRobinStrategy();
    const ruleA = { targets: [t1, t2] };
    const ruleB = { targets: [t3, t1] };
    expect(strategy.select(ruleA, makeContext(), "model-a")).toEqual(t1);
    expect(strategy.select(ruleB, makeContext(), "model-b")).toEqual(t3);
    expect(strategy.select(ruleA, makeContext(), "model-a")).toEqual(t2);
    expect(strategy.select(ruleB, makeContext(), "model-b")).toEqual(t1);
  });
});
```

注意：test 中 `select` 需要第三个参数 `clientModel`，在步骤 2 实现时添加。

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/round-robin-strategy.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 RoundRobinStrategy**

创建 `src/proxy/strategy/round-robin.ts`：

```typescript
import type { MappingStrategy, ResolveContext, Target } from "./types.js";

interface TargetsRule {
  targets: Target[];
}

function isTarget(value: unknown): value is Target {
  return (
    typeof value === "object" &&
    value !== null &&
    "backend_model" in value &&
    typeof (value as Target).backend_model === "string" &&
    "provider_id" in value &&
    typeof (value as Target).provider_id === "string"
  );
}

function isTargetsRule(value: unknown): value is TargetsRule {
  if (typeof value !== "object" || value === null) return false;
  const r = value as TargetsRule;
  return Array.isArray(r.targets) && r.targets.every(isTarget);
}

export class RoundRobinStrategy implements MappingStrategy {
  private indexMap = new Map<string, number>();

  select(rule: unknown, context: ResolveContext, clientModel?: string): Target | undefined {
    if (!isTargetsRule(rule)) return undefined;

    const key = clientModel ?? JSON.stringify(rule);
    const filtered = rule.targets.filter(
      (t) => !context.excludeTargets?.some(
        (e) => e.backend_model === t.backend_model && e.provider_id === t.provider_id
      )
    );
    if (filtered.length === 0) return undefined;

    const lastIndex = this.indexMap.get(key) ?? -1;
    const nextIndex = (lastIndex + 1) % filtered.length;
    this.indexMap.set(key, nextIndex);
    return filtered[nextIndex];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/round-robin-strategy.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/proxy/strategy/round-robin.ts tests/round-robin-strategy.test.ts
git commit -m "feat(strategy): implement round-robin strategy with memory-based index"
```

---

### Task 3: 实现 RandomStrategy

**Files:**
- Create: `src/proxy/strategy/random.ts`
- Create: `tests/random-strategy.test.ts`

- [ ] **Step 1: 编写 failing test**

创建 `tests/random-strategy.test.ts`：

```typescript
import { describe, it, expect, vi } from "vitest";
import { RandomStrategy } from "../src/proxy/strategy/random.js";
import type { Target } from "../src/proxy/strategy/types.js";

const t1: Target = { backend_model: "gpt-4", provider_id: "p1" };
const t2: Target = { backend_model: "claude-3", provider_id: "p2" };
const t3: Target = { backend_model: "gemini", provider_id: "p3" };

function makeContext() {
  return { now: new Date() };
}

describe("RandomStrategy", () => {
  it("returns a target from the list", () => {
    const strategy = new RandomStrategy();
    const rule = { targets: [t1, t2, t3] };
    const result = strategy.select(rule, makeContext());
    expect([t1, t2, t3]).toContainEqual(result);
  });

  it("returns undefined for empty targets", () => {
    const strategy = new RandomStrategy();
    expect(strategy.select({ targets: [] }, makeContext())).toBeUndefined();
  });

  it("skips excluded targets", () => {
    const strategy = new RandomStrategy();
    const rule = { targets: [t1, t2] };
    const result = strategy.select(rule, { ...makeContext(), excludeTargets: [t1] });
    expect(result).toEqual(t2);
  });

  it("returns undefined when all excluded", () => {
    const strategy = new RandomStrategy();
    const rule = { targets: [t1, t2] };
    const result = strategy.select(rule, { ...makeContext(), excludeTargets: [t1, t2] });
    expect(result).toBeUndefined();
  });

  it("returns single target when only one remains after exclude", () => {
    const strategy = new RandomStrategy();
    const rule = { targets: [t1, t2, t3] };
    const result = strategy.select(rule, { ...makeContext(), excludeTargets: [t1, t3] });
    expect(result).toEqual(t2);
  });

  it("returns undefined for invalid rule", () => {
    const strategy = new RandomStrategy();
    expect(strategy.select(null, makeContext())).toBeUndefined();
    expect(strategy.select({ targets: "not-array" }, makeContext())).toBeUndefined();
    expect(strategy.select({ targets: [123] }, makeContext())).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/random-strategy.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 RandomStrategy**

创建 `src/proxy/strategy/random.ts`：

```typescript
import type { MappingStrategy, ResolveContext, Target } from "./types.js";

interface TargetsRule {
  targets: Target[];
}

function isTarget(value: unknown): value is Target {
  return (
    typeof value === "object" &&
    value !== null &&
    "backend_model" in value &&
    typeof (value as Target).backend_model === "string" &&
    "provider_id" in value &&
    typeof (value as Target).provider_id === "string"
  );
}

function isTargetsRule(value: unknown): value is TargetsRule {
  if (typeof value !== "object" || value === null) return false;
  const r = value as TargetsRule;
  return Array.isArray(r.targets) && r.targets.every(isTarget);
}

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/random-strategy.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/proxy/strategy/random.ts tests/random-strategy.test.ts
git commit -m "feat(strategy): implement random strategy with exclude support"
```

---

### Task 4: 实现 FailoverStrategy

**Files:**
- Create: `src/proxy/strategy/failover.ts`
- Create: `tests/failover-strategy.test.ts`

- [ ] **Step 1: 编写 failing test**

创建 `tests/failover-strategy.test.ts`：

```typescript
import { describe, it, expect } from "vitest";
import { FailoverStrategy } from "../src/proxy/strategy/failover.js";
import type { Target } from "../src/proxy/strategy/types.js";

const t1: Target = { backend_model: "gpt-4", provider_id: "p1" };
const t2: Target = { backend_model: "claude-3", provider_id: "p2" };
const t3: Target = { backend_model: "gemini", provider_id: "p3" };

function makeContext() {
  return { now: new Date() };
}

describe("FailoverStrategy", () => {
  it("returns first target by default", () => {
    const strategy = new FailoverStrategy();
    const rule = { targets: [t1, t2, t3] };
    expect(strategy.select(rule, makeContext())).toEqual(t1);
  });

  it("returns second target when first is excluded", () => {
    const strategy = new FailoverStrategy();
    const rule = { targets: [t1, t2, t3] };
    const result = strategy.select(rule, { ...makeContext(), excludeTargets: [t1] });
    expect(result).toEqual(t2);
  });

  it("returns third target when first two are excluded", () => {
    const strategy = new FailoverStrategy();
    const rule = { targets: [t1, t2, t3] };
    const result = strategy.select(rule, { ...makeContext(), excludeTargets: [t1, t2] });
    expect(result).toEqual(t3);
  });

  it("returns undefined when all targets excluded", () => {
    const strategy = new FailoverStrategy();
    const rule = { targets: [t1, t2] };
    const result = strategy.select(rule, { ...makeContext(), excludeTargets: [t1, t2] });
    expect(result).toBeUndefined();
  });

  it("returns undefined for invalid rule", () => {
    const strategy = new FailoverStrategy();
    expect(strategy.select(null, makeContext())).toBeUndefined();
    expect(strategy.select({ targets: "not-array" }, makeContext())).toBeUndefined();
    expect(strategy.select({ targets: [null] }, makeContext())).toBeUndefined();
  });

  it("returns undefined for empty targets", () => {
    const strategy = new FailoverStrategy();
    expect(strategy.select({ targets: [] }, makeContext())).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/failover-strategy.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 FailoverStrategy**

创建 `src/proxy/strategy/failover.ts`：

```typescript
import type { MappingStrategy, ResolveContext, Target } from "./types.js";

interface TargetsRule {
  targets: Target[];
}

function isTarget(value: unknown): value is Target {
  return (
    typeof value === "object" &&
    value !== null &&
    "backend_model" in value &&
    typeof (value as Target).backend_model === "string" &&
    "provider_id" in value &&
    typeof (value as Target).provider_id === "string"
  );
}

function isTargetsRule(value: unknown): value is TargetsRule {
  if (typeof value !== "object" || value === null) return false;
  const r = value as TargetsRule;
  return Array.isArray(r.targets) && r.targets.every(isTarget);
}

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/failover-strategy.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/proxy/strategy/failover.ts tests/failover-strategy.test.ts
git commit -m "feat(strategy): implement failover strategy with exclude-based selection"
```

---

### Task 5: 注册新策略到 mapping-resolver

**Files:**
- Modify: `src/proxy/mapping-resolver.ts`
- Modify: `tests/mapping-resolver.test.ts`

- [ ] **Step 1: 添加 failing test**

在 `tests/mapping-resolver.test.ts` 末尾（`describe` 块内）追加：

```typescript
it("resolves round-robin strategy", () => {
  const rule = JSON.stringify({
    targets: [
      { backend_model: "gpt-4", provider_id: "p1" },
      { backend_model: "claude-3", provider_id: "p2" },
    ],
  });
  // 先插入 provider（resolveMapping 不校验 provider，但以防未来变更）
  db.prepare("INSERT INTO mapping_groups (id, client_model, strategy, rule, created_at) VALUES (?, ?, ?, ?, ?)")
    .run("g1", "my-model", "round-robin", rule, new Date().toISOString());

  const result = resolveMapping(db, "my-model", { now: new Date() });
  // 第一次应该返回 targets[0]
  expect(result).toEqual({ backend_model: "gpt-4", provider_id: "p1" });
});

it("resolves random strategy", () => {
  const rule = JSON.stringify({
    targets: [
      { backend_model: "gpt-4", provider_id: "p1" },
      { backend_model: "claude-3", provider_id: "p2" },
    ],
  });
  db.prepare("INSERT INTO mapping_groups (id, client_model, strategy, rule, created_at) VALUES (?, ?, ?, ?, ?)")
    .run("g1", "my-model", "random", rule, new Date().toISOString());

  const result = resolveMapping(db, "my-model", { now: new Date() });
  expect(result?.backend_model).toBeDefined();
  expect(result?.provider_id).toBeDefined();
});

it("resolves failover strategy", () => {
  const rule = JSON.stringify({
    targets: [
      { backend_model: "gpt-4", provider_id: "p1" },
      { backend_model: "claude-3", provider_id: "p2" },
    ],
  });
  db.prepare("INSERT INTO mapping_groups (id, client_model, strategy, rule, created_at) VALUES (?, ?, ?, ?, ?)")
    .run("g1", "my-model", "failover", rule, new Date().toISOString());

  const result = resolveMapping(db, "my-model", { now: new Date() });
  expect(result).toEqual({ backend_model: "gpt-4", provider_id: "p1" });
});

it("resolves failover with excludeTargets", () => {
  const rule = JSON.stringify({
    targets: [
      { backend_model: "gpt-4", provider_id: "p1" },
      { backend_model: "claude-3", provider_id: "p2" },
    ],
  });
  db.prepare("INSERT INTO mapping_groups (id, client_model, strategy, rule, created_at) VALUES (?, ?, ?, ?, ?)")
    .run("g1", "my-model", "failover", rule, new Date().toISOString());

  const result = resolveMapping(db, "my-model", {
    now: new Date(),
    excludeTargets: [{ backend_model: "gpt-4", provider_id: "p1" }],
  });
  expect(result).toEqual({ backend_model: "claude-3", provider_id: "p2" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mapping-resolver.test.ts`
Expected: 新测试 FAIL（策略未注册）

- [ ] **Step 3: 注册策略**

修改 `src/proxy/mapping-resolver.ts`：

```typescript
import Database from "better-sqlite3";
import type { Target, ResolveContext } from "./strategy/types.js";
import { STRATEGY_NAMES } from "./strategy/types.js";
import { ScheduledStrategy } from "./strategy/scheduled.js";
import { RoundRobinStrategy } from "./strategy/round-robin.js";
import { RandomStrategy } from "./strategy/random.js";
import { FailoverStrategy } from "./strategy/failover.js";
import { getMappingGroup } from "../db/index.js";

const STRATEGIES: Record<string, import("./strategy/types.js").MappingStrategy> = {
  [STRATEGY_NAMES.SCHEDULED]: new ScheduledStrategy(),
  [STRATEGY_NAMES.ROUND_ROBIN]: new RoundRobinStrategy(),
  [STRATEGY_NAMES.RANDOM]: new RandomStrategy(),
  [STRATEGY_NAMES.FAILOVER]: new FailoverStrategy(),
};

// resolveMapping 函数保持不变
```

同时修改 `resolveMapping` 传递 `clientModel` 给 `strategy.select()`（Task 1 已扩展 MappingStrategy 接口添加可选 `clientModel` 参数）：

```typescript
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

  return strategy.select(rule, context, clientModel) ?? null;
}
```

> 注意：`clientModel` 参数在 Task 1 中已加入 `MappingStrategy` 接口，所有策略的 `select` 方法都接受可选的第三参数。`ScheduledStrategy`、`RandomStrategy`、`FailoverStrategy` 忽略该参数，只有 `RoundRobinStrategy` 使用它来维护独立的轮询 index。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mapping-resolver.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/proxy/mapping-resolver.ts tests/mapping-resolver.test.ts
git commit -m "feat(resolver): register round-robin, random, failover strategies"
```

---

### Task 6: Admin API validateRule 扩展

**Files:**
- Modify: `src/admin/groups.ts`
- Modify: `tests/admin-groups.test.ts`

- [ ] **Step 1: 添加 failing test**

在 `tests/admin-groups.test.ts` 的 `describe("Mapping Group CRUD")` 块内追加：

```typescript
it("POST creates round-robin group", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/admin/api/mapping-groups",
    headers: { cookie, "content-type": "application/json" },
    payload: {
      client_model: "gpt-4",
      strategy: "round-robin",
      rule: JSON.stringify({
        targets: [
          { backend_model: "gpt-4-turbo", provider_id: providerId },
          { backend_model: "gpt-4o", provider_id: providerId },
        ],
      }),
    },
  });
  expect(res.statusCode).toBe(201);
});

it("POST creates random group", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/admin/api/mapping-groups",
    headers: { cookie, "content-type": "application/json" },
    payload: {
      client_model: "gpt-4",
      strategy: "random",
      rule: JSON.stringify({
        targets: [
          { backend_model: "gpt-4-turbo", provider_id: providerId },
        ],
      }),
    },
  });
  expect(res.statusCode).toBe(201);
});

it("POST creates failover group", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/admin/api/mapping-groups",
    headers: { cookie, "content-type": "application/json" },
    payload: {
      client_model: "gpt-4",
      strategy: "failover",
      rule: JSON.stringify({
        targets: [
          { backend_model: "gpt-4-turbo", provider_id: providerId },
          { backend_model: "gpt-4o", provider_id: providerId },
        ],
      }),
    },
  });
  expect(res.statusCode).toBe(201);
});

it("POST failover with single target returns 400", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/admin/api/mapping-groups",
    headers: { cookie, "content-type": "application/json" },
    payload: {
      client_model: "gpt-4",
      strategy: "failover",
      rule: JSON.stringify({
        targets: [
          { backend_model: "gpt-4-turbo", provider_id: providerId },
        ],
      }),
    },
  });
  expect(res.statusCode).toBe(400);
});

it("POST round-robin with empty targets returns 400", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/admin/api/mapping-groups",
    headers: { cookie, "content-type": "application/json" },
    payload: {
      client_model: "gpt-4",
      strategy: "round-robin",
      rule: JSON.stringify({ targets: [] }),
    },
  });
  expect(res.statusCode).toBe(400);
});

it("POST with unknown strategy returns 400", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/admin/api/mapping-groups",
    headers: { cookie, "content-type": "application/json" },
    payload: {
      client_model: "gpt-4",
      strategy: "unknown-strategy",
      rule: JSON.stringify({ targets: [] }),
    },
  });
  expect(res.statusCode).toBe(400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/admin-groups.test.ts`
Expected: 新测试 FAIL

- [ ] **Step 3: 扩展 validateRule**

修改 `src/admin/groups.ts` 的 `validateRule` 函数：

1. 添加策略名白名单校验（在函数最前面）

```typescript
const VALID_STRATEGIES = new Set(Object.values(STRATEGY_NAMES));
if (!VALID_STRATEGIES.has(strategy)) {
  return `Unknown strategy '${strategy}'. Valid: ${[...VALID_STRATEGIES].join(", ")}`;
}
```

2. 添加 targets 类策略的验证（在 scheduled 验证之后）

```typescript
if (strategy === STRATEGY_NAMES.ROUND_ROBIN || strategy === STRATEGY_NAMES.RANDOM || strategy === STRATEGY_NAMES.FAILOVER) {
  const r = rule as { targets?: unknown[] };
  if (!Array.isArray(r.targets) || r.targets.length === 0) {
    return "rule.targets must be a non-empty array";
  }
  const minTargets = strategy === STRATEGY_NAMES.FAILOVER ? 2 : 1;
  if (r.targets.length < minTargets) {
    return `strategy '${strategy}' requires at least ${minTargets} target(s)`;
  }
  for (let i = 0; i < r.targets.length; i++) {
    const t = r.targets[i] as any;
    if (!t.backend_model || !t.provider_id) {
      return `targets[${i}] missing backend_model or provider_id`;
    }
    const p = getProviderById(db, t.provider_id);
    if (!p) {
      return `targets[${i}] provider_id '${t.provider_id}' not found`;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/admin-groups.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add src/admin/groups.ts tests/admin-groups.test.ts
git commit -m "feat(admin): validate round-robin, random, failover rules with strategy whitelist"
```

---

### Task 7: proxy-core failover 跨 target 重试

**Files:**
- Modify: `src/proxy/proxy-core.ts`

这是最复杂的改动。需要在 `handleProxyPost` 中增加 failover 循环。

- [ ] **Step 1: 新增 import**

在 `src/proxy/proxy-core.ts` 顶部添加：

```typescript
import { getMappingGroup } from "../db/index.js";
import type { Target } from "./strategy/types.js";
```

- [ ] **Step 2: 重构 handleProxyPost**

将现有的 `handleProxyPost` 函数（约 400-560 行）重构为带 failover 循环的版本。

核心思路：将 resolveMapping → provider 获取 → proxy 请求 → 日志记录包裹在一个 `while(true)` 循环中。成功时 return，失败时检查是否需要 failover。

具体实现：

```typescript
export async function handleProxyPost(
  request: FastifyRequest,
  reply: FastifyReply,
  apiType: "openai" | "anthropic",
  upstreamPath: string,
  errors: ProxyErrorFormatter,
  deps: ProxyHandlerDeps,
  options?: { beforeSendProxy?: (body: Record<string, unknown>, isStream: boolean) => void; },
): Promise<FastifyReply> {
  const { db, streamTimeoutMs, retryMaxAttempts, retryBaseDelayMs, matcher } = deps;

  request.raw.socket.on("error", (err) => request.log.debug({ err }, "client socket error"));
  const clientModel = ((request.body as Record<string, unknown>).model as string) || "unknown";

  // 查询分组策略（只查一次）
  const group = getMappingGroup(db, clientModel);
  const isFailover = group?.strategy === "failover";
  const excludeTargets: Target[] = [];

  while (true) {
    const startTime = Date.now();
    const logId = randomUUID();
    const routerKeyId = request.routerKey?.id ?? null;
    const body = request.body as Record<string, unknown>;
    const originalBody = JSON.parse(JSON.stringify(body));

    const resolved = resolveMapping(db, clientModel, { now: new Date(), excludeTargets });
    if (!resolved) {
      if (isFailover && excludeTargets.length > 0) {
        // 所有 failover target 都已尝试，reply 已在上一轮发送
        return reply;
      }
      const e = errors.modelNotFound(clientModel);
      return reply.status(e.statusCode).send(e.body);
    }

    const provider = getProviderById(db, resolved.provider_id);
    if (!provider || !provider.is_active) {
      const e = errors.providerUnavailable();
      return reply.status(e.statusCode).send(e.body);
    }
    if (provider.api_type !== apiType) {
      const e = errors.providerTypeMismatch();
      return reply.status(e.statusCode).send(e.body);
    }

    body.model = resolved.backend_model;
    const apiKey = decrypt(provider.api_key, getSetting(db, "encryption_key")!);
    const isStream = body.stream === true;
    options?.beforeSendProxy?.(body, isStream);

    const reqBodyStr = JSON.stringify(body);
    const cliHdrs: RawHeaders = request.headers as RawHeaders;
    const clientReq = JSON.stringify({ headers: cliHdrs, body: originalBody });
    const retryConfig = buildRetryConfig(retryMaxAttempts, retryBaseDelayMs, matcher);
    const upstreamReqBase = JSON.stringify({ url: `${provider.base_url}${upstreamPath}`, headers: buildUpstreamHeaders(cliHdrs, apiKey, Buffer.byteLength(reqBodyStr)), body: reqBodyStr });

    try {
      const { result: r, attempts } = isStream
        ? await retryableCall(() => { const mt = new SSEMetricsTransform(apiType, startTime); return proxyStream(provider, apiKey, body, cliHdrs, reply, streamTimeoutMs, upstreamPath, mt); }, retryConfig, reply)
        : await retryableCall(() => proxyNonStream(provider, apiKey, body, cliHdrs, upstreamPath), retryConfig, reply);

      // 记录所有尝试的日志（同现有逻辑）
      let lastSuccessLogId = logId;
      for (const attempt of attempts) {
        const isOriginal = attempt.attemptIndex === 0;
        const attemptLogId = isOriginal ? logId : randomUUID();
        if (attempt.error) {
          insertRequestLog(db, { id: attemptLogId, api_type: apiType, model: clientModel, provider_id: provider.id, status_code: HTTP_BAD_GATEWAY, latency_ms: attempt.latencyMs, is_stream: isStream ? 1 : 0, error_message: attempt.error, created_at: new Date().toISOString(), request_body: reqBodyStr, client_request: clientReq, upstream_request: upstreamReqBase, is_retry: isOriginal ? 0 : 1, original_request_id: isOriginal ? null : logId, router_key_id: routerKeyId });
        } else if (attempt.statusCode !== UPSTREAM_SUCCESS) {
          insertRequestLog(db, { id: attemptLogId, api_type: apiType, model: clientModel, provider_id: provider.id, status_code: attempt.statusCode, latency_ms: attempt.latencyMs, is_stream: isStream ? 1 : 0, error_message: null, created_at: new Date().toISOString(), request_body: reqBodyStr, response_body: attempt.responseBody, client_request: clientReq, upstream_request: upstreamReqBase, upstream_response: JSON.stringify({ statusCode: attempt.statusCode, body: attempt.responseBody }), client_response: JSON.stringify({ statusCode: attempt.statusCode, body: attempt.responseBody }), is_retry: isOriginal ? 0 : 1, original_request_id: isOriginal ? null : logId, router_key_id: routerKeyId });
        } else {
          const h = isStream ? ((r as StreamProxyResult).upstreamResponseHeaders ?? {}) : ((r as ProxyResult).headers);
          insertSuccessLog(db, apiType, attemptLogId, clientModel, provider, isStream, startTime, reqBodyStr, clientReq, upstreamReqBase, r.statusCode, attempt.responseBody, h, h, !isOriginal, isOriginal ? null : logId, routerKeyId);
          lastSuccessLogId = attemptLogId;
        }
      }

      // --- Failover 检查 ---
      // 如果最终状态码不是 2xx，且是 failover 策略，且 headers 未发送
      const finalStatus = r.statusCode;
      if (isFailover && finalStatus >= 400 && !reply.raw.headersSent) {
        excludeTargets.push(resolved);
        continue; // 尝试下一个 target
      }

      // 非 failover 或成功：发送响应
      if (isStream) {
        if (r.statusCode !== UPSTREAM_SUCCESS) {
          for (const [k, v] of Object.entries((r as StreamProxyResult).upstreamResponseHeaders ?? {})) reply.header(k, v);
          reply.status(r.statusCode).send((r as StreamProxyResult).responseBody);
        }
      } else {
        const pr = r as ProxyResult;
        for (const [k, v] of Object.entries(pr.headers)) reply.header(k, v);
        return reply.status(pr.statusCode).send(pr.body);
      }

      if (r.statusCode === UPSTREAM_SUCCESS) {
        if (isStream) {
          const sr = r as StreamProxyResult;
          if (sr.metricsResult) { try { insertMetrics(db, { ...sr.metricsResult, request_log_id: lastSuccessLogId, provider_id: provider.id, backend_model: resolved.backend_model, api_type: apiType }); } catch (err) { request.log.error({ err }, "Failed to insert metrics"); } }
        } else {
          try { const mr = MetricsExtractor.fromNonStreamResponse(apiType, (r as ProxyResult).body); if (mr) insertMetrics(db, { ...mr, request_log_id: lastSuccessLogId, provider_id: provider.id, backend_model: resolved.backend_model, api_type: apiType }); } catch (err) { request.log.error({ err }, "Failed to insert metrics"); }
        }
      }
      return reply;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const sentH = buildUpstreamHeaders(cliHdrs, apiKey, Buffer.byteLength(reqBodyStr));
      const upstreamReq = JSON.stringify({ url: `${provider.base_url}${upstreamPath}`, headers: sentH, body: reqBodyStr });
      insertRequestLog(db, { id: logId, api_type: apiType, model: clientModel, provider_id: provider.id, status_code: HTTP_BAD_GATEWAY, latency_ms: Date.now() - startTime, is_stream: isStream ? 1 : 0, error_message: errMsg || "Upstream connection failed", created_at: new Date().toISOString(), request_body: reqBodyStr, client_request: clientReq, upstream_request: upstreamReq, router_key_id: routerKeyId });

      // --- Failover 检查（异常路径）---
      if (isFailover && !reply.raw.headersSent) {
        excludeTargets.push(resolved);
        continue; // 尝试下一个 target
      }

      const e = errors.upstreamConnectionFailed();
      return reply.status(e.statusCode).send(e.body);
    }
  }
}
```

> **关键设计决策：**
> - `group` 只在循环外查一次（不变）
> - `startTime`、`logId`、`body` 在每次循环内重新初始化（每次 target 尝试独立）
> - 白名单校验移到 `resolveMapping` 之前（首次循环外已处理，但后续 target 也需要检查——不过因为白名单校验的是 clientModel 而非 backend_model，所以只需校验一次）
> - failover 检查条件：`isFailover && (statusCode >= 400 || exception) && !reply.raw.headersSent`

- [ ] **Step 4: Run 全部 proxy 测试**

Run: `npx vitest run tests/openai-proxy.test.ts tests/anthropic-proxy.test.ts tests/integration.test.ts`
Expected: 全部 PASS（确保无回归）

- [ ] **Step 5: Commit**

```bash
git add src/proxy/proxy-core.ts
git commit -m "feat(proxy): add failover loop across targets in handleProxyPost"
```

---

### Task 8: 前端 — 策略下拉和 targets 表单

**Files:**
- Modify: `frontend/src/components/mappings/MappingGroupFormDialog.vue`
- Modify: `frontend/src/views/ModelMappings.vue`

- [ ] **Step 1: 在 MappingGroupFormDialog.vue 中扩展策略下拉**

将策略 SelectContent 从只有 `scheduled` 扩展为四个选项：

```html
<SelectContent>
  <SelectItem value="scheduled">定时切换 (scheduled)</SelectItem>
  <SelectItem value="round-robin">轮询 (round-robin)</SelectItem>
  <SelectItem value="random">随机 (random)</SelectItem>
  <SelectItem value="failover">故障转移 (failover)</SelectItem>
</SelectContent>
```

- [ ] **Step 2: 根据策略切换表单区域**

在表单中增加条件渲染：
- `v-if="form.strategy === 'scheduled'"` → 保持现有的 default + windows 表单
- `v-else` → targets 列表表单

targets 列表表单结构：

```html
<div v-else class="border rounded-lg p-3 space-y-3">
  <div class="flex items-center justify-between">
    <div class="text-sm font-medium text-foreground">目标列表</div>
    <Button type="button" variant="outline" size="sm" @click="emit('addTarget')">添加目标</Button>
  </div>
  <div v-for="(t, idx) in form.targets" :key="idx" class="border rounded-md p-2 space-y-2">
    <div class="flex items-center gap-2">
      <div class="flex-1">
        <Label class="block text-xs text-muted-foreground mb-1">供应商</Label>
        <Select :model-value="t.provider_id" @update:model-value="onTargetProviderChange(idx, $event)">
          <!-- 同现有的 provider select -->
        </Select>
      </div>
      <div class="flex-1">
        <Label class="block text-xs text-muted-foreground mb-1">后端模型</Label>
        <Select v-model="t.backend_model">
          <!-- 同现有的 model select -->
        </Select>
      </div>
      <div v-if="form.strategy === 'failover'" class="flex flex-col gap-1">
        <Button type="button" variant="ghost" size="sm" :disabled="idx === 0" @click="emit('moveTargetUp', idx)">↑</Button>
        <Button type="button" variant="ghost" size="sm" :disabled="idx === form.targets.length - 1" @click="emit('moveTargetDown', idx)">↓</Button>
      </div>
      <Button type="button" variant="ghost" size="sm" class="text-destructive shrink-0" @click="emit('removeTarget', idx)">删除</Button>
    </div>
  </div>
  <div v-if="form.targets.length === 0" class="text-sm text-muted-foreground">暂无目标</div>
</div>
```

- [ ] **Step 3: 更新 FormData 和 emits**

扩展 `FormData` interface：

```typescript
interface FormData {
  client_model: string;
  strategy: string;
  // scheduled
  default: { backend_model: string; provider_id: string };
  windows: RuleWindow[];
  // round-robin / random / failover
  targets: { backend_model: string; provider_id: string }[];
}
```

更新 `DEFAULT_FORM` 增加 `targets` 字段：

```typescript
const DEFAULT_FORM = {
  client_model: '',
  strategy: 'scheduled',
  default: { backend_model: '', provider_id: '' },
  windows: [] as RuleWindow[],
  targets: [] as { backend_model: string; provider_id: string }[],
}
```

更新 emits（增加 `addTarget`, `removeTarget`, `moveTargetUp`, `moveTargetDown`）。

同时更新 `MappingGroupFormDialog.vue` 的 `props.form` 类型（加 `targets` 字段）。

- [ ] **Step 4: 更新 ModelMappings.vue 中的展示逻辑**

在分组列表中，根据策略类型显示不同内容：

- scheduled：现有逻辑（default + windows）
- round-robin / random / failover：遍历 targets 显示

```html
<div v-if="g.strategy === 'scheduled'" class="space-y-3">
  <!-- 现有的 scheduled 展示 -->
</div>
<div v-else class="space-y-2">
  <div v-for="(t, idx) in g.parsedRule.targets" :key="idx" class="flex items-center gap-2 text-sm">
    <span v-if="g.strategy === 'failover'" class="text-muted-foreground text-xs">{{ idx + 1 }}.</span>
    <span class="font-mono">{{ t.backend_model }}</span>
    <span class="text-muted-foreground">/</span>
    <span>{{ providerNameMap.get(t.provider_id) || t.provider_id }}</span>
  </div>
</div>
```

- [ ] **Step 4b: 更新 ModelMappings.vue 中的事件监听和 handler**

在 `<MappingGroupFormDialog>` 标签上添加新的事件监听：

```html
<MappingGroupFormDialog
  v-model:open="dialogOpen"
  :editing-id="editingId"
  :form="form"
  :providers="providersList"
  :provider-models="providerModelsMap"
  @save="handleSave"
  @add-window="addWindow"
  @remove-window="removeWindow"
  @add-target="addTarget"
  @remove-target="removeTarget"
  @move-target-up="moveTargetUp"
  @move-target-down="moveTargetDown"
/>
```

添加对应的 handler 函数：

```typescript
function addTarget() {
  const firstProviderId = providersList.value[0]?.id || ''
  const firstModels = providerModelsMap.value.get(firstProviderId) || []
  form.value.targets.push({ backend_model: firstModels[0] || '', provider_id: firstProviderId })
}

function removeTarget(idx: number) {
  form.value.targets.splice(idx, 1)
}

function moveTargetUp(idx: number) {
  if (idx <= 0) return
  const targets = form.value.targets
  ;[targets[idx - 1], targets[idx]] = [targets[idx], targets[idx - 1]]
}

function moveTargetDown(idx: number) {
  const targets = form.value.targets
  if (idx >= targets.length - 1) return
  ;[targets[idx], targets[idx + 1]] = [targets[idx + 1], targets[idx]]
}
```

- [ ] **Step 4c: 更新 openEdit 解析 targets 格式的 rule**

修改 `ModelMappings.vue` 中的 `openEdit` 函数，支持解析 targets 格式的 rule：

```typescript
function openEdit(g: MappingGroup & { parsedRule?: Rule & { targets?: { backend_model: string; provider_id: string }[] } }) {
  editingId.value = g.id
  let rule: any = {}
  try { rule = JSON.parse(g.rule) } catch { /* format error */ }

  if (g.strategy === 'scheduled') {
    form.value = {
      ...DEFAULT_FORM,
      client_model: g.client_model,
      strategy: g.strategy,
      default: {
        backend_model: rule.default?.backend_model || '',
        provider_id: rule.default?.provider_id || providersList.value[0]?.id || '',
      },
      windows: rule.windows ? JSON.parse(JSON.stringify(rule.windows)) : [],
    }
  } else {
    // round-robin / random / failover
    const firstProviderId = providersList.value[0]?.id || ''
    const firstModels = providerModelsMap.value.get(firstProviderId) || []
    form.value = {
      ...DEFAULT_FORM,
      client_model: g.client_model,
      strategy: g.strategy,
      targets: Array.isArray(rule.targets)
        ? rule.targets.map((t: any) => ({
            backend_model: t.backend_model || '',
            provider_id: t.provider_id || firstProviderId,
          }))
        : [{ backend_model: firstModels[0] || '', provider_id: firstProviderId }],
    }
  }
  dialogOpen.value = true
}
```

- [ ] **Step 5: 更新 handleSave 中的 rule 构造**

```typescript
async function handleSave() {
  try {
    let ruleJson: string;
    if (form.value.strategy === 'scheduled') {
      ruleJson = JSON.stringify({
        default: form.value.default,
        windows: form.value.windows,
      });
    } else {
      ruleJson = JSON.stringify({
        targets: form.value.targets,
      });
    }
    const payload = {
      client_model: form.value.client_model,
      strategy: form.value.strategy,
      rule: ruleJson,
    };
    // ... rest same
  }
}
```

- [ ] **Step 6: 启动前端验证**

Run: `cd frontend && npm run dev`

手动验证：
1. 创建 round-robin 分组，添加多个 target
2. 创建 random 分组
3. 创建 failover 分组，拖拽排序 target
4. 确认 scheduled 策略仍正常工作

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/mappings/MappingGroupFormDialog.vue frontend/src/views/ModelMappings.vue
git commit -m "feat(frontend): add round-robin, random, failover strategy UI"
```

---

### Task 9: 全量测试 + 最终验证

- [ ] **Step 1: Run 全部后端测试**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 2: Run 前端构建**

Run: `cd frontend && npm run build`
Expected: 构建成功，无 TS 错误

- [ ] **Step 3: 端到端手动验证**

1. `npm run dev` 启动后端
2. `cd frontend && npm run dev` 启动前端
3. 在管理后台创建各策略分组，通过 curl 发送代理请求验证行为

- [ ] **Step 4: 最终 Commit**

```bash
git add -A
git commit -m "chore: final verification for remaining load strategies"
```
