# Retry Rule Upgrade: Backend Design

> **For agentic workers:** This document describes the backend design for the Retry Rule Provider Isolation, JSON Field Matching, and Upstream Error Logging features. It supplements the main `plan.md` with detailed implementation guidance.

## 1. DB Schema Change (Migration 049)

**File:** `router/src/db/migrations/049_add_provider_isolation_and_matchers.sql`
**Status:** ✅ Already created

### DDL

```sql
-- Provider isolation: provider_id = NULL means global rule
ALTER TABLE retry_rules ADD COLUMN provider_id TEXT NULL DEFAULT NULL;
ALTER TABLE retry_rules ADD COLUMN body_matchers TEXT NULL DEFAULT NULL;

-- New upstream error logs table
CREATE TABLE upstream_error_logs (
  id TEXT PRIMARY KEY,
  request_log_id TEXT REFERENCES request_logs(id) ON DELETE SET NULL,
  provider_id TEXT NOT NULL,
  backend_model TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  error_type TEXT,
  error_message TEXT,
  client_agent_type TEXT NOT NULL DEFAULT 'unknown',
  router_key_id TEXT,
  session_id TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for time-based and provider/status queries
CREATE INDEX idx_upstream_error_logs_time ON upstream_error_logs(created_at);
CREATE INDEX idx_upstream_error_logs_provider ON upstream_error_logs(provider_id, created_at);
CREATE INDEX idx_upstream_error_logs_status ON upstream_error_logs(status_code, created_at);
```

### Design Rationale

- **provider_id = NULL as global**: Simple, backwards-compatible. Existing rules automatically become global rules.
- **provider_id = UUID**: 1:N relationship (one provider can have multiple rules). No FK constraint needed — rules reference provider IDs that may exist or be deleted (soft reference).
- **body_matchers as JSON TEXT**: Flexible schema-less JSON storage. The JSON array format (`[{path, operator, value}]`) allows future extension (e.g., new operators) without DDL changes.
- **ON DELETE SET NULL on request_log_id**: When request logs are cleaned up, upstream error logs keep their structural data but lose the FK link.

### Backward Compatibility

- Existing rules: `provider_id = NULL`, `body_matchers = NULL`
- `match()` method checks `if (entry.matchers !== null)` before using structured matchers
- `match()` method falls back to body_pattern regex when matchers are null
- Existing `SELECT *` queries automatically return the new columns (NULL for old rows)
- CRUD functions use existing patterns (`buildUpdateQuery` with RETRY_FIELDS whitelist)

## 2. BodyMatcher Interface and Matching Engine

**File:** `router/src/proxy/orchestration/body-matcher.ts`
**Status:** ✅ Already created

### Interface

```typescript
export interface BodyMatcher {
  /** JSON 路径，如 "error.type"、"error.message"，按 '.' 分割逐层访问 */
  path: string;
  /** 比较操作符 */
  operator: "equals" | "contains" | "exists";
  /** equals/contains 的期望值。exists 时忽略 */
  value?: string;
}
```

### Functions

#### `resolvePath(obj: unknown, path: string): unknown`

Traverses a nested object using dot-separated path segments. Returns the value at the path, or `undefined` if any intermediate segment doesn't exist or isn't an object.

**Why dot-separated instead of JSONPath subset:** Dot notation covers >99% of real cases and is simpler to implement and reason about. Array indexing (`error.details[0].code`) is not supported — if needed in the future, it can be added by extending `resolvePath().`

#### `matchBodyMatchers(body: string, matchers: BodyMatcher[]): boolean`

Main entry point. Parses `body` as JSON, then checks ALL matchers in AND logic:

| Operator | Logic | Value ignored? |
|----------|-------|---------------|
| `exists` | Path must exist (value !== undefined) | ✅ Yes |
| `equals` | Path value must strictly equal expected value (string/number/boolean toString comparison) | ❌ No |
| `contains` | Path value must include expected substring | ❌ No |

**Why AND:** OR logic between matchers would create ambiguity — you could have a rule that matches "rate_limit_error" OR "server_error" but since the rule has a single action (retry count, delay, etc.), there's no meaningful distinction. If OR logic is needed, create multiple rules.

### Integration with RetryRuleMatcher

```typescript
// In retry-rules.ts load():
let matchers: BodyMatcher[] | null = null;
if (rule.body_matchers) {
  try {
    matchers = JSON.parse(rule.body_matchers) as BodyMatcher[];
  } catch {
    matchers = null; // Invalid JSON → fallback to regex
  }
}

// In retry-rules.ts findMatch():
if (entry.matchers !== null) {
  if (matchBodyMatchers(body, entry.matchers)) return entry.rule;
} else if (entry.pattern) {
  if (entry.pattern.test(body)) return entry.rule;
}
```

## 3. RetryRuleMatcher Cache Structure Upgrade

**File:** `router/src/proxy/orchestration/retry-rules.ts`
**Status:** ✅ Already updated

### Cache Structure

**Before (flat by status_code):**
```
Map<statusCode: number, CachedRule[]>
```

**After (two-level by provider_id + status_code):**
```
Map<"${providerId ?? '__global__'}:${statusCode}", CachedRule[]>
```

### Match Logic (Priority Order)

```
match(statusCode, body, providerId?):
  1. If providerId is provided:
     look up "providerId:statusCode" in cache
     if found → findMatch() over entries (body_matchers first, regex fallback)
     if matched → return rule
  2. Fallback to "__global__:statusCode"
     look up -- global group
     if found → findMatch() over entries
     if matched → return rule
  3. Return null (no match)
```

### Key Design Decision

**Binding rules are NOT included in the global group.** This means a binding rule never accidentally matches a different provider's request. Only rules with `provider_id = NULL` are in the global group.

### Rule Ordering

Within a cache key group, rules are ordered by `created_at DESC` (from `getActiveRetryRules()`). The `findMatch()` method iterates in order and returns the first match. This means:
- For provider bound rules: most recently created rule wins
- For global rules: most recently created rule wins

This is consistent with the existing behavior (before the change, all rules were ordered by `created_at DESC`).

### Test Coverage

| Scenario | Expected |
|----------|----------|
| Provider A bound rule + Provider B request (same status code) | Only global rules matched |
| Provider bound rule matches → return rule | Rule returned |
| Provider bound rule doesn't match → fallback to global | Global rule returned (or null) |
| No provider bound rules → fallback to global | Global rule returned (or null) |
| No providerId → only global rules checked | Global rule returned (or null) |

## 4. upstream_error_logs Table and Insert Functions

**File:** `router/src/db/upstream-error-logs.ts`
**Status:** ✅ Already created

### Interface

```typescript
export interface UpstreamErrorLog {
  id: string;
  request_log_id: string | null;
  provider_id: string;
  backend_model: string;
  status_code: number;
  error_type: string | null;
  error_message: string | null;
  client_agent_type: string;
  router_key_id: string | null;
  session_id: string | null;
  retry_count: number;
  created_at: string;
}
```

### Functions

#### `logUpstreamError(db, entry)`

Inserts one row. Generates UUID and timestamp internally. All fields required except nullable ones.

#### `extractErrorInfo(body: string): { errorType, errorMessage }`

Extracts error type and message from upstream response body. Priority:
1. `error.type` → errorType
2. `error.code` → errorType (fallback if no type)
3. `error.message` → errorMessage
4. If JSON parse fails → `{ null, null }`

#### `cleanUpstreamErrorLogs(db, beforeDate): number`

Deletes records older than the given date. Returns count of deleted rows. Designed to be called by the existing log cleanup mechanism.

### Why Not Write in ResilienceLayer?

The ResilienceLayer operates on individual transport attempts and doesn't have access to:
- `request_log_id` (generated at the failover-loop level)
- Final decision context (whether this is the last attempt)

Writing in the failover-loop after `logResilienceResult` ensures we have all context and only write for the final failure.

## 5. ResilienceLayer.decide() ProviderId Parameter Passing

**File:** `router/src/proxy/orchestration/resilience.ts`
**Status:** ✅ Already updated

### Changes

#### `ResilienceConfig`
```typescript
export interface ResilienceConfig {
  // ...existing fields...
  /** 当前 provider ID，用于 RetryRuleMatcher 按 provider 过滤规则 */
  providerId?: string;  // NEW
}
```

#### `ResilienceLayer.decide()`
All calls to `config.ruleMatcher.match(statusCode, body)` now pass `config.providerId`:
```typescript
const matchedRule = config.ruleMatcher.match(result.statusCode, body, config.providerId);
```

#### Call Chain

```
ProxyOrchestrator.executeResilience()
  → constructs ResilienceConfig with providerId = config.provider.id
  → passes to ResilienceLayer.execute()
    → passes to ResilienceLayer.decide()
      → passes to RetryRuleMatcher.match(statusCode, body, providerId)
```

### All decide() call sites updated

1. `stream_error + statusCode < failoverThreshold` branch: ✅
2. `statusCode >= failoverThreshold` branch: ✅
3. `else` (other non-success responses) branch: ✅

### transport-fn.ts checkEarlyError

```typescript
const checkEarlyError = p.matcher ? (data: string) => p.matcher!.test(UPSTREAM_SUCCESS, data, p.provider.id) : undefined;
```
Also passes `p.provider.id` (already updated).

## 6. Failover-Loop Integration with upstream_error_logs

**File:** `router/src/proxy/handler/failover-loop.ts`
**Status:** ✅ Already updated

### Write Point

After `logResilienceResult()` and before `usageWindowTracker.recordRequest()`:

```typescript
// 失败时写入 upstream_error_logs
if (!succeeded) {
  const body = 'body' in tr ? tr.body : '';
  const { errorType, errorMessage } = extractErrorInfo(body);
  const trStatusCode = getTransportStatusCode(tr);
  if (trStatusCode !== null) {
    logUpstreamError(db, {
      request_log_id: lastLogId,
      provider_id: provider.id,
      backend_model: resolved.backend_model ?? clientModel,
      status_code: trStatusCode,
      error_type: errorType,
      error_message: errorMessage,
      client_agent_type: ctx.metadata.get("client_type") as string ?? "unknown",
      router_key_id: routerKeyId,
      session_id: ctx.metadata.get("session_id") as string | null ?? null,
      retry_count: resilienceResult.attempts.length - 1,
    });
  }
}
```

### Guard Condition

Only writes when `!succeeded` — i.e., the result kind is NOT `success`, `stream_success`, or `stream_abort`. This matches the exact failure scenarios:
- `kind === "stream_error"` (upstream returned error in SSE stream)
- `kind === "throw"` (network error)
- `kind === "error"` (upstream returned error status)

## 7. Stream Error Response Formatting Path

**File:** `router/src/proxy/handler/failover-loop.ts` (lines ~410-424)
**Status:** ✅ Already updated

### Logic

```typescript
if (tr.kind === "stream_error") {
  // stream_error + headersSent 已在 orchestrator.sendResponse 中处理
  // 此处为 !headersSent 分支：格式化错误体并发送
  const trStatus = getTransportStatusCode(tr);
  if (trStatus !== null) updateLogClientStatus(db, lastLogId, trStatus);
  const formattedBody = adapter.formatError(
    'body' in tr ? tr.body : "stream error",
  ) ?? { error: { message: "stream error", type: "server_error" } };
  reply.header("content-type", "application/json");
  return reply.code(tr.statusCode).send(formattedBody);
}
```

### Two-Phase Handling

**Phase 1 — In orchestrator.ts `sendResponse()`:**
- `stream_error + headersSent` → return (StreamProxy has already written to the socket)
- `stream_error + !headersSent + !isFailover` → falls through to failover-loop

**Phase 2 — In failover-loop `executeFailoverLoop()`:**
- `stream_error + !headersSent` → format via `adapter.formatError()`, set `content-type: application/json`, send with `tr.statusCode`
- Also records `client_status_code` in `request_logs` via `updateLogClientStatus()`

### Why FormatError Through Adapter?

The error format differs by API type:
- OpenAI: `{ error: { message: string, type: string, code: string } }`
- Anthropic: `{ type: "error", error: { type: string, message: string } }`
- OpenAI Responses: `{ error: { message: string, type: string, code: string } }`

Using `adapter.formatError()` ensures the correct format for each API type.

## 8. Admin API CRUD Adaptation

**File:** `router/src/admin/retry-rules.ts`
**Status:** ✅ Already updated

### Schema Changes

#### `CreateRetryRuleSchema` (POST body)

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
  provider_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),      // NEW
  body_matchers: Type.Optional(Type.Union([Type.String(), Type.Null()])),    // NEW
});
```

#### `UpdateRetryRuleSchema` (PUT body)

```typescript
const UpdateRetryRuleSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1 })),
  status_code: Type.Optional(Type.Number({ minimum: 100, maximum: 599 })),
  body_pattern: Type.Optional(Type.String({ minLength: 1 })),
  is_active: Type.Optional(Type.Number()),
  retry_strategy: Type.Optional(Type.Union([Type.Literal("fixed"), Type.Literal("exponential")])),
  retry_delay_ms: Type.Optional(Type.Number({ minimum: 100 })),
  max_retries: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
  max_delay_ms: Type.Optional(Type.Number({ minimum: 100 })),
  provider_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),      // NEW
  body_matchers: Type.Optional(Type.Union([Type.String(), Type.Null()])),    // NEW
});
```

### Validation

#### `validateBodyMatchers(bodyMatchers: string | null | undefined): string | null`

- Returns null if input is null/undefined/empty
- Throws `Error` if JSON parse fails
- Throws `Error` if not an array
- Throws `Error` if any item lacks `path` (string) or has invalid `operator`
- Returns the original string on success

### CRUD Entry Points

#### `POST /admin/api/retry-rules`

```typescript
const bodyMatchers = validateBodyMatchers(body.body_matchers); // may throw
const id = createRetryRule(db, {
  // ...existing fields...
  provider_id: body.provider_id || null,
  body_matchers: bodyMatchers,
});
stateRegistry?.refreshRetryRules();
return reply.code(HTTP_CREATED).send({ id });
```

#### `PUT /admin/api/retry-rules/:id`

- `body.provider_id !== undefined` → `fields.provider_id = body.provider_id || null`
- `body.body_matchers !== undefined` → validate + set
- Fields filtered through `RETRY_FIELDS` whitelist (already includes `provider_id` and `body_matchers`)
- Calls `stateRegistry.refreshRetryRules()` to reload cache

#### `DELETE /admin/api/retry-rules/:id`

- No changes needed (deletes by ID, no field mapping)
- Still calls `stateRegistry.refreshRetryRules()`

### AI Generate Endpoint

**No changes to provider_id auto-fill.** The AI response parsing only extracts `name`, `status_code`, `body_pattern`, `retry_strategy`, `retry_delay_ms`, `max_retries`, `max_delay_ms`. The `provider_id` must be manually set by the user in the frontend after generation.

### StateRegistry Refresh

All CRUD operations call `stateRegistry.refreshRetryRules()` which triggers `RetryRuleMatcher.load()` to rebuild the two-level cache from the DB. This means:
- New rules are visible immediately after create/update/delete
- Cache is fully rebuilt (not patched) — acceptable for retry rules (small dataset, typically <100 rules)

## 9. DB Layer CRUD Updates

**File:** `router/src/db/retry-rules.ts`
**Status:** ✅ Already updated

### RetryRule Interface

```typescript
export interface RetryRule {
  id: string;
  name: string;
  status_code: number;
  body_pattern: string;
  is_active: number;
  created_at: string;
  retry_strategy: "fixed" | "exponential";
  retry_delay_ms: number;
  max_retries: number;
  max_delay_ms: number;
  provider_id: string | null;    // NEW
  body_matchers: string | null;  // NEW
}
```

### RETRY_FIELDS Whitelist

```typescript
const RETRY_FIELDS = new Set([
  "name", "status_code", "body_pattern", "is_active",
  "retry_strategy", "retry_delay_ms", "max_retries", "max_delay_ms",
  "provider_id", "body_matchers",  // ADDED
]);
```

### createRetryRule()

INSERT statement updated to include `provider_id` and `body_matchers` columns. Values default to `null` when not provided.

### updateRetryRule()

Uses `buildUpdateQuery()` with `RETRY_FIELDS` whitelist — automatically handles the new fields since the whitelist includes them.

### getActiveRetryRules() / getAllRetryRules() / getRetryRuleById()

`SELECT *` queries — automatically include the new columns. No changes needed.
