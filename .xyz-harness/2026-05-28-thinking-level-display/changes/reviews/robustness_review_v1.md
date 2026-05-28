---
verdict: "fail"
must_fix: 3
---

# Robustness Review v1

**Review date:** 2026-05-28
**Reviewer:** AI Agent
**Scope:** thinking level 展示、模型过滤修复、耗时列
**Files reviewed:** 9 files across backend (router/) and frontend (frontend/)

---

## Summary

3 MUST FIX items identified, 5 SHOULD FIX recommendations. The code is generally well-structured with proper error containment, but has two concrete runtime bugs (NaN/Infinity in `formatLatency`) and a systemic lack of logging on parse failures that would hinder debugging. SQL injection is not a concern — all queries are parameterized.

---

## 1. Error Handling

### 1.1 `extractThinkingLevelFromRequest` (router/src/proxy/orchestration/orchestrator.ts)

| Check | Status | Note |
|-------|--------|------|
| JSON.parse try-catch | ✅ | Whole extraction wrapped in try-catch |
| null/undefined input | ✅ | `!clientRequest` guard at top |
| Optional chaining | ✅ | `parsed?.body`, `body.thinking?.type` |
| typeof guard | ✅ | `typeof body !== "object"` catches both null and primitives |

**Finding:** ❌ **MUST FIX #1** — The catch block silently returns `"off"` with no logging at all. If `clientRequest` is persistently malformed (corrupted JSON, wrong structure), there is zero trace to investigate. Add a `logger.debug` or `logger.warn` in the catch block.

### 1.2 `extractThinkingLevel` (frontend/src/utils/thinking-level.ts)

| Check | Status | Note |
|-------|--------|------|
| JSON.parse try-catch | ✅ | Whole function wrapped |
| null/undefined/empty string | ✅ | `!clientRequestJson` guard |
| Optional chaining | ✅ | `parsed?.body`, `body.reasoning?.effort` |

**Finding:** ❗ Same pattern as backend — silent catch. While the frontend doesn't have a structured logger, adding `console.warn('extractThinkingLevel: failed to parse clientRequest', clientRequestJson)` would significantly improve debuggability. Classified as **SHOULD FIX** because the impact is lower (frontend parses on render only, not on critical path).

### 1.3 `formatLatency` (frontend/src/utils/format.ts)

| Check | Status | Note |
|-------|--------|------|
| null/undefined | ✅ | Returns `"-"` |
| Negative numbers | ❗ | Displays e.g. `"-45ms"` — should never happen but silently looks wrong |

**Finding:** ❌ **MUST FIX #2** — `NaN` and `Infinity` values produce bad output:
- `NaN < 1000` → `false`, falls to `(NaN / 1000).toFixed(1)` → `"NaN"` 
- `Infinity < 1000` → `false`, falls to `(Infinity / 1000).toFixed(1)` → `"Infinity"`
- `-Infinity < 1000` → `true`, `Math.round(-Infinity)` → `"-Infinityms"`

**Fix:** Add `if (!Number.isFinite(ms)) return "-"` check at the top after the null/undefined check.

### 1.4 `enhancementLabel` (LogTableRow.vue)

| Check | Status | Note |
|-------|--------|------|
| JSON.parse try-catch | ✅ | Returns `t('logs.row.unknown')` on failure |
| null input | ✅ | `if (!raw)` guard |

✅ No issues found.

### 1.5 `mergeUpstreamData` / `extractResponseMetadata` (upstream-merge.ts)

| Check | Status | Note |
|-------|--------|------|
| JSON.parse try-catch | ✅ | All parse points wrapped |
| null/undefined checks | ✅ | Consistent guard clauses |
| type guards | ✅ | `typeof parsed.statusCode === 'number'`, `parsed.body !== undefined` |

✅ No issues found. The multiple JSON.parse calls are each properly guarded.

---

## 2. Exception Propagation

| Function | Catch behavior | Propagation |
|----------|---------------|-------------|
| `extractThinkingLevelFromRequest` | Returns `"off"` | ✅ Contained |
| `extractThinkingLevel` | Returns `"off"` | ✅ Contained |
| `mergeUpstreamData` | Returns `upstreamResponse` raw | ✅ Contained |
| `extractResponseMetadata` | Returns `''` | ✅ Contained |
| `parseWrapper` | Returns `null` | ✅ Contained |
| `parseAndStripContent` | Returns `bodyStr` raw | ✅ Contained |
| Orchestrator `handle()` `catch` | Re-throws after adaptive controller notification | ✅ Correct propagation |
| Orchestrator `sendResponse` | `try {} catch {}` for `reply.raw.destroy()` | ✅ Explicitly annotated as intentional |

**No exception leaks found.** All errors are properly contained or re-thrown.

---

## 3. Logging

| Code location | Has logging? | Quality |
|---------------|-------------|---------|
| `extractThinkingLevelFromRequest` catch | ❌ None | MUST FIX #1 |
| `extractThinkingLevel` catch | ❌ None | SHOULD FIX |
| `useLogFilters.loadProviders()` catch | ✅ `console.error` + `toast.error` | ✅ |
| `useLogFilters.loadRouterKeys()` catch | ✅ `console.error` + `toast.error` | ✅ |
| `useLogFilters.loadModelOptions()` catch | ❌ Silent (`catch {}`) | Minor — outer catch is effectively dead code since `Promise.allSettled` never rejects |
| `useLogs.loadLogs()` catch | ✅ `console.error` + `toast.error` | ✅ |
| `useLogs.handleCleanup()` catch | ✅ `console.error` + `toast.error` | ✅ |
| `useLogs.toggleExpand()` catch | ✅ `console.error` + `toast.error` | ✅ |
| `useLogs.openLogDetail()` catch | ✅ `console.error` + `toast.error` | ✅ |

**Finding:** The backend's `extractThinkingLevelFromRequest` lacks any logging on parse failure. This is the most impactful logging gap because it runs on the request-serving code path — malformed `client_request` data would be invisible in logs.

---

## 4. Fail-fast Validation

### 4.1 Admin API — `page` and `limit` parameters

**Finding:** ❌ **MUST FIX #3** — `admin/logs.ts` has no validation on `page`/`limit` being positive integers or within bounds:

```typescript
const page = parseInt(query.page || "1", 10);
const limit = parseInt(query.limit || "20", 10);
```

- `parseInt("abc")` → `NaN` → passes `NaN` to SQLite as `OFFSET` and `LIMIT`
- No maximum limit cap — client could request `limit=100000`, triggering a large memory allocation

**Fix:** Add validation:
```typescript
const page = Math.max(1, parseInt(query.page || "1", 10) || 1);
const limit = Math.min(100, Math.max(1, parseInt(query.limit || "20", 10) || 20));
```

### 4.2 Status code filter type mismatch

**Finding:** ❗ `getRequestLogs` and `getRequestLogsGrouped` don't declare `status_code` in their options type, but `buildLogWhereClause` accepts and processes it. The `admin/logs.ts` route handler passes `status_code` through `listOptions`. TypeScript doesn't flag this due to excess property checking rules (not a fresh object literal in call position).

**Recommendation:** Add `status_code?: string` to both `getRequestLogs` and `getRequestLogsGrouped` options types for accuracy. (SHOULD FIX)

### 4.3 Unknown status_code value

**Finding:** If a client passes `status_code=unknown_value`, `buildLogWhereClause` silently ignores it (no WHERE clause added). The user sees no filter applied but UI doesn't indicate the value was invalid. Not a robustness bug per se, but could confuse users. (INFO)

---

## 5. Test Friendliness

| Component | Pure function? | Global state? | Notes |
|-----------|---------------|---------------|-------|
| `extractThinkingLevelFromRequest` | ✅ Yes | None | Easy to unit test |
| `extractThinkingLevel` | ✅ Yes | None | Easy to unit test |
| `formatLatency` | ✅ Yes | None | Easy to unit test |
| `buildLogWhereClause` | ✅ Yes | None | Easy to unit test |
| `mergeUpstreamData` | ✅ Yes | None | Easy to unit test |
| `extractResponseMetadata` | ✅ Yes | None | Easy to unit test |
| `parseAndStripContent` | ✅ Yes | None | Easy to unit test |
| `enhancementLabel` | ✅ Yes | None | Easy to unit test |
| `ProxyOrchestrator.handle()` | ❌ No | Depends on DI'd services | Integration-test-friendly via injected deps |
| `createOrchestrator` | ❌ No | Requires SemaphoreManager/Tracker | Returns `undefined` if deps missing — explicit! |

✅ All pure extraction/formatting functions are trivially testable. The orchestrator uses DI, making it testable with mocks.

---

## 6. Debug Friendliness

### Strengths
- All pure extraction/format functions can be isolated and tested in unit tests
- Orchesrator catch blocks on semaphore/resilience errors properly report to adaptive controller before re-throwing, preserving stack trace
- Frontend API calls follow the established pattern of `console.error` + `toast.error`

### Gaps
- `extractThinkingLevelFromRequest`: silent fallback to "off" on parse failure — no way to know if data was malformed
- `extractThinkingLevel`: same issue on frontend
- Backend orchestration error handlers log to adaptive controller but don't write to request_logs or app logs

---

## Special Focus Items

### A) `extractThinkingLevelFromRequest` / `extractThinkingLevel` try-catch completeness

✅ **Both functions have correct try-catch wrapping** covering the entire extraction logic. All failure paths return `"off"`. The functions are identical in logic (as expected — they serve the same purpose on different sides).

❌ **Gap:** No logging on failure. In production, if hundreds of requests have malformed `client_request`, every one silently falls back to `"off"` with zero visibility.

**Recommendation:** Add `console.warn` on frontend, `request.log.warn` or `logger.debug` on backend.

### B) `buildLogWhereClause` — SQL injection risk

✅ **No injection vector found.** All user-supplied values use SQL parameterized queries (`?` placeholders via better-sqlite3). The `LIKE` patterns (`%${val}%`) are safe because the `%` characters are embedded in the parameter value, not in SQL text. The `status_code` branch uses hardcoded string comparisons (`= 200`, `IS NULL`).

### C) `formatLatency` — NaN/Infinity/negative handling

❌ **MUST FIX #2** — See section 1.3 above. NaN and Infinity produce invalid display strings.

### D) SSE `thinkingLevel` missing — frontend fallback

✅ **Fallback chain is complete:**

| Data path | Fallback | Code |
|-----------|----------|------|
| Realtime (ActiveRequest) | `req.thinkingLevel ?? "off"` in `fromActiveRequest()` | `types.ts` line 103 |
| History (LogEntry) | `extractThinkingLevel(entry.client_request, entry.api_type)` in `fromLogEntry()` | `types.ts` line 249 |
| LogTableRow | `extractThinkingLevel(props.log.client_request, props.log.api_type)` as computed | `LogTableRow.vue` line 42 |
| Monitor badges | `v-if="req.thinkingLevel && req.thinkingLevel !== 'off'"` | `Monitor.vue` lines 58, 234 |

If backend never sends `thinkingLevel`, all paths fall back to client-side extraction from `client_request` JSON, which defaults to `"off"` on any failure.

---

## Raw Issue List

| # | Severity | File | Line | Description |
|---|----------|------|------|-------------|
| 1 | MUST FIX | `orchestrator.ts` | 27-30 | `extractThinkingLevelFromRequest` catch block silently returns `"off"` - no logging when JSON parse fails |
| 2 | MUST FIX | `format.ts` | 101-106 | `formatLatency` doesn't guard against `NaN`/`Infinity` — displays "NaNs" or "Infinityms" |
| 3 | MUST FIX | `admin/logs.ts` | 53-54 | No validation on `page`/`limit`; `parseInt("abc")` → `NaN` → passed to SQL as OFFSET/LIMIT, no max limit cap |
| 4 | SHOULD FIX | `thinking-level.ts` | 18 | Frontend `extractThinkingLevel` catch — no `console.warn` for debug visibility |
| 5 | SHOULD FIX | `format.ts` | 101-106 | Negative `ms` values display as negative (e.g. "-45ms"); should clamp to `0` or return `"-"` |
| 6 | SHOULD FIX | `admin/logs.ts` / `db/logs.ts` | both | `status_code` filter passed to `getRequestLogs`/`getRequestLogsGrouped` but not declared in their options type |
| 7 | INFO | `format.ts` | 101-106 | Edge case: `-0` rounds to `-0` and displays as `"0ms"` — cosmetic, not functional |

---

## Verdict

**MUST FIX count: 3** → Verdict: **fail**

All three MUST FIX issues are concrete runtime defects:
1. Missing logging on parse failure in `extractThinkingLevelFromRequest` — loss of debuggability on critical path
2. `formatLatency` produces invalid display for NaN/Infinity — user-facing data corruption
3. Missing input validation on `page`/`limit` in admin API — potential for silent misbehavior

The code is architecturally sound (all queries parameterized, all JSON.parse calls guarded, all errors contained), but these three issues need resolution before gate pass.
