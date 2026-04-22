# Retry Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为每条 retry rule 添加独立可配的重试策略（固定间隔 / 指数退避），使用策略模式实现。

**Architecture:** DB 新增 4 列存储策略参数 → RetryRuleMatcher 返回完整规则 → retryableCall 根据规则构建策略对象计算延迟。全局配置作为无匹配规则时的回退。

**Tech Stack:** TypeScript, better-sqlite3, Fastify, Vue 3 + shadcn-vue

**Spec:** `.superpowers/specs/2026-04-17-retry-strategy-design.md`

---

### Task 1: DB Migration + 类型扩展 + DB 函数改造

**Files:**
- Create: `src/db/migrations/013_add_retry_strategy.sql`
- Modify: `src/db/retry-rules.ts`

- [ ] **Step 1: 创建 migration 文件**

```sql
-- src/db/migrations/013_add_retry_strategy.sql
ALTER TABLE retry_rules ADD COLUMN retry_strategy TEXT NOT NULL DEFAULT 'exponential';
ALTER TABLE retry_rules ADD COLUMN retry_delay_ms INTEGER NOT NULL DEFAULT 5000;
ALTER TABLE retry_rules ADD COLUMN max_retries INTEGER NOT NULL DEFAULT 10;
ALTER TABLE retry_rules ADD COLUMN max_delay_ms INTEGER NOT NULL DEFAULT 60000;
```

- [ ] **Step 2: 扩展 RetryRule 类型 + 改造 DB 函数**

在 `src/db/retry-rules.ts` 中：

**RetryRule 接口**新增 4 个字段：
```typescript
retry_strategy: "fixed" | "exponential";
retry_delay_ms: number;
max_retries: number;
max_delay_ms: number;
```

**RETRY_FIELDS** Set 新增这 4 个字段名。

**createRetryRule** — 参数类型和 INSERT 语句都要改：
```typescript
export function createRetryRule(
  db: Database.Database,
  rule: {
    name: string; status_code: number; body_pattern: string; is_active?: number;
    retry_strategy?: string; retry_delay_ms?: number; max_retries?: number; max_delay_ms?: number;
  },
): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO retry_rules (id, name, status_code, body_pattern, is_active, created_at, retry_strategy, retry_delay_ms, max_retries, max_delay_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, rule.name, rule.status_code, rule.body_pattern, rule.is_active ?? 1, now,
    rule.retry_strategy ?? "exponential", rule.retry_delay_ms ?? 5000, rule.max_retries ?? 10, rule.max_delay_ms ?? 60000);
  return id;
}
```

**updateRetryRule** — Pick 类型要扩展以包含新字段：
```typescript
fields: Partial<Pick<RetryRule, "name" | "status_code" | "body_pattern" | "is_active" | "retry_strategy" | "retry_delay_ms" | "max_retries" | "max_delay_ms">>,
```

**DEFAULT_RULES** 类型新增 4 个字段，但 `seedDefaultRules` 的 INSERT 不需要改（DB DEFAULT 值与显式值相同，让 DB 默认值生效即可）。保持 `DEFAULT_RULES` 数据结构与 INSERT 一致：要么 `DEFAULT_RULES` 只保留原有字段让 DB DEFAULT 生效，要么两者都改。推荐前者——不改 `DEFAULT_RULES`。

- [ ] **Step 3: 运行现有测试确认 migration 生效**

Run: `npx vitest run tests/admin-retry-rules.test.ts -v`
Expected: PASS

- [ ] **Step 4: Commit**

```
feat(db): add retry_strategy columns to retry_rules table
```

---

### Task 2: 策略模式 + RetryRuleMatcher.match()

**Files:**
- Modify: `src/proxy/retry.ts`
- Modify: `src/proxy/retry-rules.ts`

- [ ] **Step 1: 在 retry.ts 中添加策略接口和实现**

在 `retry.ts` 的 Constants 区域之前添加：

```typescript
// ---------- Strategy Pattern ----------

export interface RetryStrategy {
  getDelay(attempt: number): number;
}

export class FixedIntervalStrategy implements RetryStrategy {
  constructor(private delayMs: number) {}
  getDelay(): number { return this.delayMs; }
}

export class ExponentialBackoffStrategy implements RetryStrategy {
  constructor(private baseMs: number, private capMs: number) {}
  getDelay(attempt: number): number {
    return Math.min(this.baseMs * 2 ** attempt, this.capMs);
  }
}

export function createStrategy(rule: { retry_strategy: string; retry_delay_ms: number; max_delay_ms: number }): RetryStrategy {
  if (rule.retry_strategy === "fixed") return new FixedIntervalStrategy(rule.retry_delay_ms);
  return new ExponentialBackoffStrategy(rule.retry_delay_ms, rule.max_delay_ms);
}
```

- [ ] **Step 2: 改造 RetryRuleMatcher**

在 `src/proxy/retry-rules.ts` 中：

缓存类型从 `Map<number, RegExp[]>` 改为 `Map<number, { rule: RetryRule; pattern: RegExp }[]>`。

`load()` 方法：
```typescript
load(db: Database.Database): void {
  this.raw = getActiveRetryRules(db);
  this.cache.clear();
  for (const rule of this.raw) {
    const entries = this.cache.get(rule.status_code) ?? [];
    entries.push({ rule, pattern: new RegExp(rule.body_pattern) });
    this.cache.set(rule.status_code, entries);
  }
}
```

新增 `match()`：
```typescript
match(statusCode: number, body: string): RetryRule | null {
  const entries = this.cache.get(statusCode);
  if (!entries) return null;
  for (const { rule, pattern } of entries) {
    if (pattern.test(body)) return rule;
  }
  return null;
}
```

`test()` 委托给 `match()`：
```typescript
test(statusCode: number, body: string): boolean {
  return this.match(statusCode, body) !== null;
}
```

- [ ] **Step 3: 写策略单元测试**

在 `tests/retry.test.ts` 中的 import 行添加新导出，末尾添加：

```typescript
import { FixedIntervalStrategy, ExponentialBackoffStrategy, createStrategy } from "../src/proxy/retry.js";

describe("RetryStrategy", () => {
  it("FixedIntervalStrategy returns constant delay", () => {
    const s = new FixedIntervalStrategy(5000);
    expect(s.getDelay(0)).toBe(5000);
    expect(s.getDelay(1)).toBe(5000);
    expect(s.getDelay(5)).toBe(5000);
  });

  it("ExponentialBackoffStrategy doubles and caps", () => {
    const s = new ExponentialBackoffStrategy(5000, 60000);
    expect(s.getDelay(0)).toBe(5000);
    expect(s.getDelay(1)).toBe(10000);
    expect(s.getDelay(2)).toBe(20000);
    expect(s.getDelay(3)).toBe(40000);
    expect(s.getDelay(4)).toBe(60000); // capped
  });

  it("createStrategy returns correct type", () => {
    expect(createStrategy({ retry_strategy: "fixed", retry_delay_ms: 3000, max_delay_ms: 60000 })).toBeInstanceOf(FixedIntervalStrategy);
    expect(createStrategy({ retry_strategy: "exponential", retry_delay_ms: 3000, max_delay_ms: 60000 })).toBeInstanceOf(ExponentialBackoffStrategy);
    expect(createStrategy({ retry_strategy: "linear", retry_delay_ms: 3000, max_delay_ms: 60000 })).toBeInstanceOf(ExponentialBackoffStrategy);
  });
});
```

- [ ] **Step 4: 写 RetryRuleMatcher.match() 测试**

在 `tests/retry.test.ts` 末尾添加：

```typescript
describe("RetryRuleMatcher.match()", () => {
  it("returns matched rule with strategy fields", () => {
    const matcher = new RetryRuleMatcher();
    const rule = {
      id: "1", name: "test", status_code: 429, body_pattern: ".*", is_active: 1, created_at: "",
      retry_strategy: "fixed" as const, retry_delay_ms: 3000, max_retries: 5, max_delay_ms: 30000,
    };
    matcher["cache"] = new Map([[429, [{ rule, pattern: /^.*$/ }]]]);
    expect(matcher.match(429, "rate limited")).toEqual(rule);
  });

  it("returns null when no match", () => {
    const matcher = new RetryRuleMatcher();
    expect(matcher.match(200, "ok")).toBeNull();
  });

  it("test() delegates to match()", () => {
    const matcher = new RetryRuleMatcher();
    const rule = {
      id: "1", name: "test", status_code: 429, body_pattern: ".*", is_active: 1, created_at: "",
      retry_strategy: "exponential" as const, retry_delay_ms: 5000, max_retries: 10, max_delay_ms: 60000,
    };
    matcher["cache"] = new Map([[429, [{ rule, pattern: /^.*$/ }]]]);
    expect(matcher.test(429, "any")).toBe(true);
    expect(matcher.test(200, "ok")).toBe(false);
  });
});
```

- [ ] **Step 5: 运行测试**

Run: `npx vitest run tests/retry.test.ts -v`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```
feat(proxy): add RetryStrategy pattern and RetryRuleMatcher.match()
```

---

### Task 3: retryableCall 集成 per-rule 策略

**Files:**
- Modify: `src/proxy/retry.ts`

核心改造。`retryableCall` 在每次收到非成功响应时：
1. `matcher.match(statusCode, body)` 获取匹配规则
2. 用规则的 `max_retries` 和 `createStrategy(rule)` 计算延迟
3. 429 时与 Retry-After 取 max
4. 无匹配规则 → 直接返回（不重试）
5. 网络异常（throw）→ 仍用全局 `config.maxRetries` + `config.baseDelayMs`

- [ ] **Step 1: 改造 retryableCall**

替换 `retry.ts` 中的 `retryableCall` 函数体：

```typescript
export async function retryableCall<T extends ProxyResult | StreamProxyResult>(
  fn: ProxyFn<T>,
  config: RetryConfig,
  reply?: FastifyReply,
): Promise<RetryResult<T>> {
  const attempts: Attempt[] = [];

  for (let attempt = 0; ; attempt++) {
    const start = Date.now();

    try {
      const result = await fn();
      const elapsed = Date.now() - start;
      const body = extractBody(result);

      attempts.push({
        attemptIndex: attempt,
        statusCode: result.statusCode,
        error: null,
        latencyMs: elapsed,
        responseBody: body,
      });

      if (result.statusCode < HTTP_BAD_REQUEST) return { result, attempts };

      // 通过 matcher 获取匹配规则（含策略参数）
      const matchedRule = body ? config.ruleMatcher?.match(result.statusCode, body) ?? null : null;
      if (!matchedRule) return { result, attempts };

      const maxAttempts = matchedRule.max_retries;
      if (attempt >= maxAttempts) return { result, attempts };
      if (reply && (reply.raw.writableFinished || reply.raw.headersSent)) return { result, attempts };

      const strategy = createStrategy(matchedRule);
      const headers = extractHeaders(result);
      const retryAfterMs = result.statusCode === HTTP_TOO_MANY_REQUESTS ? parseRetryAfter(headers) : null;
      const delay = Math.max(strategy.getDelay(attempt), retryAfterMs ?? 0);
      await sleep(delay);
    } catch (err: unknown) {
      const elapsed = Date.now() - start;
      const errMsg = err instanceof Error ? err.message : String(err);

      attempts.push({
        attemptIndex: attempt,
        statusCode: null,
        error: errMsg,
        latencyMs: elapsed,
        responseBody: null,
      });

      if (!isRetryableThrow(err)) throw err;
      if (attempt >= config.maxRetries) throw err;
      if (reply && (reply.raw.writableFinished || reply.raw.headersSent)) throw err;

      await sleep(config.baseDelayMs);
    }
  }
}
```

同时**删除**不再使用的 `getBackoffMs` 函数和 `BACKOFF_BASE` 常量（延迟计算已由策略对象接管）。

保留 `isRetryableResult` 函数（仍有外部使用），但其内部逻辑已不被 `retryableCall` 调用（match 取代了它的角色）。保持原样导出即可。

- [ ] **Step 2: 更新现有测试的 matcher 缓存结构**

`tests/retry.test.ts` 中 `createMatcherWithDefaults()` 适配新缓存结构：

```typescript
function createMatcherWithDefaults(): RetryRuleMatcher {
  const matcher = new RetryRuleMatcher();
  const defaultRule = {
    id: "test", name: "default", status_code: 429, body_pattern: ".*", is_active: 1, created_at: "",
    retry_strategy: "exponential" as const, retry_delay_ms: 5000, max_retries: 2, max_delay_ms: 60000,
  };
  matcher["cache"] = new Map([
    [429, [{ rule: defaultRule, pattern: /^.*$/ }]],
    [503, [{ rule: { ...defaultRule, status_code: 503 }, pattern: /^.*$/ }]],
  ]);
  return matcher;
}
```

`max_retries: 2` 与原 `DEFAULT_CONFIG.maxRetries = 2` 一致，保持测试行为不变。

- [ ] **Step 3: 添加边界条件测试**

在 `tests/retry.test.ts` 的 `retryableCall` describe 中添加：

```typescript
it("uses per-rule max_retries from matched rule", async () => {
  const matcher = new RetryRuleMatcher();
  const rule = {
    id: "test", name: "limited", status_code: 429, body_pattern: ".*", is_active: 1, created_at: "",
    retry_strategy: "fixed" as const, retry_delay_ms: 1, max_retries: 2, max_delay_ms: 60000,
  };
  matcher["cache"] = new Map([[429, [{ rule, pattern: /^.*$/ }]]]);
  const config: RetryConfig = { maxRetries: 99, baseDelayMs: 1, ruleMatcher: matcher };

  const { attempts } = await retryableCall(() => Promise.resolve(mockResult(429, "rate limited")), config);
  expect(attempts).toHaveLength(3); // 1 initial + 2 retries (rule.max_retries)
});

it("does not retry when no rule matches", async () => {
  const matcher = new RetryRuleMatcher();
  // no rules loaded
  const config: RetryConfig = { maxRetries: 99, baseDelayMs: 1, ruleMatcher: matcher };

  const { result, attempts } = await retryableCall(() => Promise.resolve(mockResult(429, "rate limited")), config);
  expect(result.statusCode).toBe(429);
  expect(attempts).toHaveLength(1); // no matching rule, immediate return
});

it("respects max_retries=0 from rule", async () => {
  const matcher = new RetryRuleMatcher();
  const rule = {
    id: "test", name: "no-retry", status_code: 429, body_pattern: ".*", is_active: 1, created_at: "",
    retry_strategy: "fixed" as const, retry_delay_ms: 1, max_retries: 0, max_delay_ms: 60000,
  };
  matcher["cache"] = new Map([[429, [{ rule, pattern: /^.*$/ }]]]);
  const config: RetryConfig = { maxRetries: 99, baseDelayMs: 1, ruleMatcher: matcher };

  const { result, attempts } = await retryableCall(() => Promise.resolve(mockResult(429, "rate limited")), config);
  expect(result.statusCode).toBe(429);
  expect(attempts).toHaveLength(1); // matched but max_retries=0
});
```

- [ ] **Step 4: 运行所有重试相关测试**

Run: `npx vitest run tests/retry.test.ts tests/retry-integration.test.ts tests/admin-retry-rules.test.ts -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```
feat(proxy): integrate per-rule retry strategy into retryableCall
```

---

### Task 4: Admin API 更新

**Files:**
- Modify: `src/admin/retry-rules.ts`

- [ ] **Step 1: 更新 Create/Update Schema**

```typescript
const CreateRetryRuleSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  status_code: Type.Number({ minimum: 100, maximum: 599 }),
  body_pattern: Type.String({ minLength: 1 }),
  is_active: Type.Optional(Type.Number()),
  retry_strategy: Type.Optional(Type.Union([Type.Literal("fixed"), Type.Literal("exponential")])),
  retry_delay_ms: Type.Optional(Type.Number({ minimum: 100 })),
  max_retries: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
  max_delay_ms: Type.Optional(Type.Number({ minimum: 100 })),
});

const UpdateRetryRuleSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1 })),
  status_code: Type.Optional(Type.Number({ minimum: 100, maximum: 599 })),
  body_pattern: Type.Optional(Type.String({ minLength: 1 })),
  is_active: Type.Optional(Type.Number()),
  retry_strategy: Type.Optional(Type.Union([Type.Literal("fixed"), Type.Literal("exponential")])),
  retry_delay_ms: Type.Optional(Type.Number({ minimum: 100 })),
  max_retries: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
  max_delay_ms: Type.Optional(Type.Number({ minimum: 100 })),
});
```

- [ ] **Step 2: 更新 create handler**

POST handler 传新字段给 `createRetryRule`：
```typescript
const id = createRetryRule(db, {
  name: body.name,
  status_code: body.status_code,
  body_pattern: body.body_pattern,
  is_active: body.is_active ?? 1,
  retry_strategy: body.retry_strategy ?? "exponential",
  retry_delay_ms: body.retry_delay_ms ?? 5000,
  max_retries: body.max_retries ?? 10,
  max_delay_ms: body.max_delay_ms ?? 60000,
});
```

- [ ] **Step 3: 更新 update handler**

PUT handler 的 `fields` 构建增加新字段。同时 `fields` 的类型要匹配 `updateRetryRule` 的新 Pick 类型（已在 Task 1 扩展）：

```typescript
if (body.retry_strategy !== undefined) fields.retry_strategy = body.retry_strategy;
if (body.retry_delay_ms !== undefined) fields.retry_delay_ms = body.retry_delay_ms;
if (body.max_retries !== undefined) fields.max_retries = body.max_retries;
if (body.max_delay_ms !== undefined) fields.max_delay_ms = body.max_delay_ms;
```

- [ ] **Step 4: 运行 admin 测试**

Run: `npx vitest run tests/admin-retry-rules.test.ts -v`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat(admin): support retry strategy fields in CRUD API
```

---

### Task 5: 前端 RetryRules.vue 更新

**Files:**
- Modify: `frontend/src/views/RetryRules.vue`

- [ ] **Step 1: 编辑表单增加策略选择和参数输入**

在创建/编辑表单中新增：
- 策略类型选择：Select 组件，选项 `fixed`（固定间隔）/ `exponential`（指数退避）
- 初始延迟（ms）：Input (number) 组件，默认 5000
- 最大重试次数：Input (number) 组件，默认 10
- 延迟上限（ms）：Input (number) 组件，默认 60000，仅策略为 `exponential` 时显示

- [ ] **Step 2: 表格列增加策略信息列**

在规则列表表格中增加一列显示当前策略类型和关键参数。

- [ ] **Step 3: 手动验证**

启动前后端，在浏览器中：
1. 查看默认 seed 规则的策略列显示
2. 创建新规则，选择 fixed 策略，设置参数
3. 编辑已有规则切换策略类型
4. 确认表单校验（延迟 > 0，重试次数 >= 0 等）

- [ ] **Step 4: Commit**

```
feat(frontend): add retry strategy configuration to RetryRules page
```
