# Infrastructure Scan: 429 Usage-Limit Response Path

## 1. TransportResult Type

**File:** `router/src/core/types.ts` (lines 90-148)

5 kinds. Key variants for 429 path:

| Kind | Fields | Used when |
|------|--------|-----------|
| `"success"` | statusCode, body, headers, sentHeaders, sentBody | Non-stream 2xx |
| `"error"` | statusCode, body, headers, sentHeaders, sentBody | Non-stream non-2xx |
| `"stream_error"` | statusCode, body, headers, sentHeaders, headersSent? | Stream non-200 OR stream 200 with error body |
| `"stream_success"` | statusCode, metrics?, upstreamResponseHeaders?, sentHeaders | Stream completed normally |
| `"stream_abort"` | statusCode, abortReason?, timeoutContext?, sentHeaders | Stream aborted (timeout/disconnect/loop) |
| `"throw"` | error, headersSent? | Network-level exception (ETIMEDOUT etc.) |

**Key detail:** `headersSent` is optional and only set for `"stream_error"` and `"throw"`. Falsy/undefined means headers NOT yet sent to client.

---

## 2. Stream Transport — callStream()

**File:** `router/src/proxy/transport/stream.ts`

### Non-200 upstream response (early error, line ~223-236)

```typescript
if (statusCode !== UPSTREAM_SUCCESS) {  // UPSTREAM_SUCCESS = 200
  const chunks: Buffer[] = [];
  upstreamRes.on("data", (chunk) => chunks.push(chunk));
  upstreamRes.on("end", () => {
    effectiveResolve({
      kind: "stream_error",
      statusCode,              // actual upstream status (e.g. 429)
      body: Buffer.concat(chunks).toString("utf-8"),
      headers: filterHeaders(upstreamRes.headers),
      sentHeaders: upstreamHeaders,
      // headersSent is NOT set — defaults to undefined/falsy
    });
  });
  return;
}
```

**Design decisions:**
- `headersSent` is never explicitly set here → `undefined` → resilience/tracker treat as "not sent"
- This path does NOT run `checkEarlyError()` — the early error scanner only runs for 200 responses
- SSE stream connection is never started — the response is entirely buffered

### 200 response with error body (early error detection)

- Buffers up to 4KB, then runs `checkEarlyError(bufferedText)` 
- If `checkEarlyError()` returns true: transitions to `EARLY_ERROR` state, resolves `{ kind: "stream_error", body, headersSent: this.headersSent || undefined }`
- `checkEarlyError` in `transport-fn.ts` calls `p.matcher!.test(200, data)` — **tests against statusCode=200**
- So retry rules with `status_code = 429` will NOT match this early error check
- **Implication:** 429 responses in 200 body can only be caught by the resilience layer's `decide()`, not by the stream proxy's early abort

---

## 3. Transport Function Builder

**File:** `router/src/proxy/transport/transport-fn.ts`

### Stream path (lines 99-114)

```typescript
const checkEarlyError = p.matcher ? (data: string) => p.matcher!.test(UPSTREAM_SUCCESS, data) : undefined;
const streamResult = await callStream(/* ... */);
```

- `checkEarlyError` always tests against `statusCode = 200`, regardless of actual upstream status
- `responseTransform` parameter is **captured in the closure but never passed to `callStream`**
- `formatTransform` (Transform stream) is passed — handles format conversion for streaming

### Non-stream path (lines 116-126)

```typescript
let result = await callNonStream(/* ... */);
if (p.responseTransform && "body" in result && result.body) {
  result = { ...result, body: p.responseTransform(result.body) };
}
```

- `responseTransform` IS applied to non-stream results
- But for `"error"` kind results (non-2xx), `result.body` exists and `responseTransform` IS applied
- **For stream_error results (from callStream): responseTransform is NEVER applied**

### Key design decisions:
- `responseTransform` handles JSON body transformation (format conversion + plugin response hooks)
- Not applied to stream errors means error response bodies are NOT format-converted before returning to resilience layer
- But resilience layer only uses the body for regex matching against retry rules, so this is fine for decision-making
- If a stream error becomes the final response to the client, the body will be raw upstream format

---

## 4. Retry Rules Matcher

**File:** `router/src/proxy/orchestration/retry-rules.ts`

```typescript
export class RetryRuleMatcher {
  private cache = new Map<number, { rule: RetryRule; pattern: RegExp }[]>();

  load(db): void {
    // Reads is_active = 1 rules, groups by status_code
  }

  match(statusCode: number, body: string): RetryRule | null {
    const entries = this.cache.get(statusCode);
    // Returns first rule matching status_code AND body_pattern
  }

  test(statusCode: number, body: string): boolean {
    return this.match(statusCode, body) !== null;
  }
}
```

### RetryRule schema (from `router/src/db/retry-rules.ts`)

```typescript
export interface RetryRule {
  id: string; name: string;
  status_code: number;
  body_pattern: string;           // regex pattern against response body
  is_active: number;              // 0/1
  retry_strategy: "fixed" | "exponential";
  retry_delay_ms: number;         // default 5000
  max_retries: number;            // default 10
  max_delay_ms: number;           // default 60000
}
```

### Default rules

Seed data created by `seedDefaultRules()` — implementation not found in current codebase (may be removed). No hardcoded 429 rules in migration files. Status:

| status_code | body_pattern | Source |
|-------------|-------------|--------|
| (unknown) | (unknown) | `seedDefaultRules()` — NOT found in current code |

**Impact:** Retry rules for 429 must be explicitly created via Admin API. Without them, the resilience layer will not retry 429 responses (falls through to failover/abort).

---

## 5. Resilience Layer — decide()

**File:** `router/src/proxy/orchestration/resilience.ts`

### Decision flow for stream_error

```
stream_error kind
│
├── headersSent === true → ABORT ("stream_error_headers_sent")
│
├── statusCode < failoverThreshold (default 400)
│   ├── match retry rule + attemptCount < max_retries → RETRY
│   ├── isFailover → FAILOVER
│   └── else → ABORT ("stream_error")
│
├── statusCode >= failoverThreshold (400) ← 429 ENTERS HERE
│   ├── match retry rule + attemptCount < max_retries → RETRY
│   ├── isFailover → FAILOVER
│   └── else → DONE
│
└── (other status with body) — match retry rule → RETRY / else DONE
```

### Retry delay calculation

```
├── matchedRule found → createStrategy(matchedRule)
│   ├── "fixed" → FixedIntervalStrategy(matchedRule.retry_delay_ms)
│   └── "exponential" → ExponentialBackoffStrategy(matchedRule.retry_delay_ms, matchedRule.max_delay_ms)
│
├── statusCode === 429 → also checks Retry-After header
│   delay = Math.max(strategy.getDelay(attemptCount), retryAfterMs ?? 0)
│
└── statusCode >= failoverThreshold (throw excluded) → uses matchedRule's strategy
```

### Iteration termination

- `iterationCap` defaults to 50 (constant `DEFAULT_ITERATION_CAP`)
- Per-target attempt tracked via `perTargetCounts` Map
- `state.attemptCount` = `getTargetCount(currentTarget) - 1` (per-target, not global)
- Global `globalAttemptIndex` increments on retry/failover
- On `iterationCap` exceeded: returns `{ kind: "error", statusCode: 502 }` + `finalDecision: "iteration_cap_exceeded"`

### ProviderSwitchNeeded for cross-provider failover

When resilience switches from provider A to B, it throws `ProviderSwitchNeeded` — caught by failover-loop outer loop.

---

## 6. Orchestrator

**File:** `router/src/proxy/orchestration/orchestrator.ts`

### `handle()` flow

```
handle(request, reply, apiType, config, ctx)
  ├── buildActiveRequest → tracker
  ├── trackerScope.track
  │   └── semaphoreScope.withSlot
  │       └── executeResilience(config, ctx)
  │           └── deps.resilience.execute(targets[], transportFn, config)
  │
  ├── extractTrackStatus(result) → { status: "completed"|"failed", statusCode? }
  ├── adaptiveController.onRequestComplete()
  ├── sendResponse(reply, result.result, ctx)
  └── return result
```

### `sendResponse()` for each result kind

| kind | Action |
|------|--------|
| `stream_success` | return (nothing; StreamProxy handles reply) |
| `stream_abort` | return (nothing; StreamProxy already ended/destroyed) |
| `throw` | return (nothing; failover-loop handles error response) |
| `stream_error` + `headersSent` | return (StreamProxy already served partial response) |
| `failover` + statusCode >= failoverThreshold | return (outer loop handles failover) |
| `error` / `stream_error` without headersSent | Write headers + reply.code() + reply.send(body) |
| `success` | Write headers + reply.code() + reply.send(body) |

**Design decision:** Orchestrator sends the final response for non-stream errors. For stream errors without headers sent, orchestrator writes the error body to the reply. But for failover iterations, `sendResponse` skips sending — the outer failover loop decides.

---

## 7. Failover Loop

**File:** `router/src/proxy/handler/failover-loop.ts`

### Entry point and invocation

`createProxyHandler` → `handleRequest` → `proxyPipeline.emit("pre_route", ctx)` → `executeFailoverLoop(ctx, errors, deps, upstreamPath, adapter)`

### Loop structure

```
while(true)
  ├── reply.raw.destroyed check → return reply
  ├── failoverIteration > MAX_FAILOVER_ITERATIONS (10) → 503
  ├── filterExcluded(cachedTargets, excludeTargets)
  │   └── empty → rejectAndReply("All failover targets exhausted")
  │
  ├── Resolve target, provider, patches, API key, transforms
  ├── buildTransportFn(...) → transportFn closure
  │
  ├── orchestrator.handle(request, reply, ..., { transportFn, ... })
  │
  ├── logResilienceResult(...)           ← writes per-attempt logs + diagnostics
  ├── collectTransportMetrics(...)       ← writes metrics on success
  │
  ├── succeeded (stream_success/stream_abort) → usageWindowTracker.recordRequest
  │
  ├── isFailover && !reply.raw.headersSent && failed
  │   └── failed = tr.kind === "throw" || ("statusCode" in tr && tr.statusCode >= 400)
  │   └── excludeTargets.push(resolved); continue
  │
  ├── !reply.raw.headersSent
  │   ├── success → reply.code().send()
  │   ├── throw/error → updateLogClientStatus + reply.code(err).send(err)
  │   └── unknown kind → reply.code(502).send(formatError)
  │
  └── catch
      ├── PipelineAbort → reply.code(e.statusCode).send(e.body)
      ├── ProviderSwitchNeeded → log + excludeTargets.push + continue
      ├── SemaphoreQueueFullError → rejectAndReply
      ├── SemaphoreTimeoutError → rejectAndReply
      ├── AbortError → return reply
      └── unknown → console.debug + insertRequestLog + reply.code(502)
```

### client_status_code setting

Only set in one place (line 502):
```typescript
if (tr.kind === "throw" || (tr.kind === "error" && tr.statusCode >= HTTP_ERROR_THRESHOLD)) {
  const err = errors.upstreamConnectionFailed();
  updateLogClientStatus(db, lastLogId, err.statusCode);  // 502
  return reply.code(err.statusCode).send(err.body);
}
```

**Key finding:** `client_status_code` is NOT set for:
- `stream_error` results (where orchestrator's `sendResponse` writes the error body)
- Successful results (where orchestrator sends the body)
- `stream_abort` results

It's only set when the failover-loop catches a `throw`/`error` and maps it to `UPSTREAM_ERROR_STATUS (502)`.

---

## 8. Log Writing

### `logResilienceResult()` in `router/src/proxy/proxy-logging.ts`

Writes one row per attempt. Three code paths:

| Condition | status_code | error_message |
|-----------|-------------|---------------|
| `stream_error` + statusCode === 200 | `502` | `"stream_error: upstream returned 200 but body contains error"` |
| `attempt.error` exists | `502` | `attempt.error` (error message) |
| statusCode !== 200 (normal error) | `attempt.statusCode!` | `extractErrorMessageFromResponse(attempt.responseBody)` |
| else (success) | `attempt.statusCode!` | null |

**Diagnostic fields** (from `048_add_diagnostic_columns.sql`):

| Column | Source mapping |
|--------|---------------|
| `transport_kind` | `attempt.resultKind` |
| `headers_sent` | `attempt.headers_sent` (1/0/null) |
| `resilience_action` | Last attempt: `params.resilienceAction`; intermediate: `"retry"` |
| `resilience_reason` | Last attempt only (abort reason); intermediate: null |
| `mapping_reason` | `params.mappingReason` |
| `failover_trigger` | `params.failoverTrigger` (set on failover iteration) |
| `abort_reason` | Only when `result.kind === "stream_abort"` |
| `error_code` | `attempt.error_code` (ETIMEDOUT etc.) |

### `collectTransportMetrics()` in `router/src/proxy/proxy-logging.ts`

- For stream: only calls `insertMetrics` when `result.kind === "stream_success" || "stream_abort"` with metrics
- `stream_error` → falls through to fallback `insertMetrics` with `is_complete: 0`
- For non-stream: only when `result.kind === "success"`

**Design:** `stream_error` always gets an incomplete metrics row (is_complete=0), regardless of whether the body contained actual error info.

---

## 9. Entry Point — createProxyHandler

**File:** `router/src/proxy/handler/create-proxy-handler.ts`

```typescript
export function createProxyHandler(config: ProxyHandlerConfig) {
  // config = { apiType: "openai" | "openai-responses" | "anthropic", paths: string[] }
  return fp(handlerRaw, { name: `${apiType}-proxy` });
}
```

Registration order in `apps` Fastify plugin:
1. Creates `ProxyOrchestrator` (with SemaphoreManager, RequestTracker, AdaptiveController)
2. Gets `FormatAdapter` from `FormatRegistry`
3. Registers POST routes → each route creates PipelineContext → runs `proxyPipeline.emit("pre_route")` → `executeFailoverLoop()`

---

## Summary: 429 Usage-Limit Return Path (critical path)

```
Client → POST → createProxyHandler → executeFailoverLoop
  │
  ├── resolveMapping → target found
  ├── buildTransportFn → creates checkEarlyError (but tests against 200)
  │
  └── orchestrator.handle()
      └── semaphoreScope.withSlot()
          └── executeResilience()
              └── transportFn() → callStream()
                  │
                  ├── Upstream returns 429
                  │   └── callStream collects body, resolves { kind: "stream_error", statusCode: 429, body }
                  │
                  └── resilience.execute()
                      └── decide(result, state, config)
                          ├── kind === "stream_error", statusCode (429) >= 400
                          ├── match retry rule (429 + body pattern)
                          │   ├── matched + retries left → RETRY (calculate delay with Retry-After)
                          │   ├── matched + no retries + failover → FAILOVER (exclude target)
                          │   └── matched + no retries + single target → DONE
                          │
                          └── resilience result returned to orchestrator
                  │
      └── orchestrator.sendResponse()
          ├── failover mode + >= 400 → skip (outer loop)
          ├── single target + 429 + not headersSent → reply.code(429).send(body)
          └── result returned to failover-loop
  
  └── failover-loop post-handle
      ├── logResilienceResult() → writes one row per attempt
      │   · stream_error non-200 → status_code = attempt.statusCode (429)
      │   · headers_sent = null (not explicitly set by callStream)
      │   · resilience_action = "retry"/"failover"/"done"
      ├── collectTransportMetrics() → fallback (is_complete: 0)
      ├── client_status_code → NOT SET (only set for throw/error paths)
      │
      ├── isFailover + 429 → excludeTarget + continue loop
      └── single target + 429 → reply sent by orchestrator
```

### Notable design issues for spec writing

1. **No `client_status_code` for stream_error**: When orchestrator writes a 429 `stream_error` response, `client_status_code` remains NULL in request_logs. Only set for `throw`/`error` paths explicitly handled in failover-loop.

2. **`checkEarlyError` tests against 200**: The early error detector in `transport-fn.ts` passes `UPSTREAM_SUCCESS (200)` to `matcher.test()`. Retry rules with `status_code=429` will never match in the early error path — they only match in `resilience.ts` `decide()`.

3. **`headersSent` uncertainty**: `callStream` non-200 handler never sets `headersSent`. Resilience layer treats `undefined` as "not sent" (falsy check). On retry, the StreamProxy may have called `startStreaming` on a previous 200 attempt, setting `headersSent = true`. This state persists in `reply.raw.headersSent`.

4. **`responseTransform` not applied for stream errors**: Error body from stream is never run through format conversion. For non-stream errors, `responseTransform` IS applied.

5. **No default 429 retry rules**: The `seedDefaultRules()` function may be missing from current codebase. Without explicit 429 rules via Admin API, 429 responses only trigger failover (if multi-target) or pass-through to client.

6. **Resilience decision cascade**: 429 with retry rule = retry → failover (same target excluded) → next target → if all excluded: `"All failover targets exhausted"` → 502. The actual 429 is never returned to the client in multi-target failover mode.
