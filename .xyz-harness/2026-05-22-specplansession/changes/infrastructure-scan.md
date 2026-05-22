# Infrastructure Scan — Retry Rule Upgrade

## Project Structure

| Area | Path(s) |
|------|---------|
| Monorepo root | `router/` (backend), `frontend/` (Vue 3), `tests/` (Vitest) |
| Core proxy | `router/src/proxy/orchestration/` |
| DB layer | `router/src/db/` |
| Admin API | `router/src/admin/` |
| DB migrations | `router/src/db/migrations/` |

## Existing APIs (Retry Rules Domain)

| File | Exports | Purpose |
|------|---------|---------|
| `router/src/db/retry-rules.ts` | `getActiveRetryRules`, `getAllRetryRules`, `createRetryRule`, `updateRetryRule`, `deleteRetryRule`, `getRetryRuleById`, `RetryRule` interface | CRUD for retry rules. Already supports `provider_id` and `body_matchers` columns. |
| `router/src/db/upstream-error-logs.ts` | `logUpstreamError`, `extractErrorInfo`, `cleanUpstreamErrorLogs` | Stores final failed request error summaries. Already exists (74 lines). |
| `router/src/proxy/orchestration/retry-rules.ts` | `RetryRuleMatcher` class (load, match, test) | Provider-isolated matching: `(providerId | '__global__'):statusCode` key, JSON body_matchers + regex fallback |
| `router/src/proxy/orchestration/body-matcher.ts` | `BodyMatcher` interface, `matchBodyMatchers`, `resolvePath` | Pure functions for structured JSON body matching. Supports equals/contains/exists operators. |
| `router/src/proxy/orchestration/resilience.ts` | `ResilienceLayer.decide()`, `ResilienceConfig`, `ResilienceResult` | Decision engine. Accepts `providerId` for rule matching. Handles retry/failover/abort. |
| `router/src/proxy/handler/failover-loop.ts` | `executeFailoverLoop()` | Orchestrates failover loop. Already imports `logUpstreamError`. |
| `router/src/admin/retry-rules.ts` | CRUD endpoints + AI generation | Already supports `provider_id` and `body_matchers` in Create/Update schemas. |

## Key Type Definitions

| Type | File | Fields |
|------|------|--------|
| `RetryRule` | `router/src/db/retry-rules.ts` | id, name, status_code, body_pattern, body_matchers (string \| null), is_active, created_at, retry_strategy, retry_delay_ms, max_retries, max_delay_ms, provider_id (string \| null) |
| `BodyMatcher` | `router/src/proxy/orchestration/body-matcher.ts` | path (string), operator ("equals"\|"contains"\|"exists"), value (string \| undefined) |
| `ResilienceConfig` | `router/src/proxy/orchestration/resilience.ts` | baseDelayMs, failoverThreshold, ruleMatcher?, isFailover, iterationCap?, providerId? |
| `ResilienceAttempt` | `router/src/core/types.ts` | TransportResult fields + error_code, headers_sent |
| `ResilienceDecision` | `router/src/proxy/orchestration/resilience.ts` | action: "done"\|"retry"\|"failover"\|"abort" + reason/delayMs/excludeTarget |

## Patterns in Use

| Pattern | Description |
|---------|-------------|
| ServiceContainer DI | Dependency injection via `SERVICE_KEYS` constants |
| Pipeline pattern | `ProxyPipeline` with hooks for route/transform/transport flow |
| Migration-based schema evolution | Sequential `.sql` files, latest is `049_add_provider_isolation_and_matchers.sql` |
| StateRegistry refresh | After CRUD writes, `stateRegistry.refreshRetryRules()` triggers `RetryRuleMatcher.load()` |
| Frontend: shadcn-vue components | `Badge`, `Select`, `Input`, `Dialog`, `Tabs`, `TooltipProvider` |

## Dependencies

| Library | Version | Use |
|---------|---------|-----|
| better-sqlite3 | N/A | Database |
| Fastify | N/A | HTTP server framework |
| Vue 3 | N/A | Frontend framework |
| shadcn-vue | 2.6 | UI components |
| Vitest | 3.1.2 | Testing |
| @sinclair/typebox | N/A | Schema validation (Admin API) |

## Recent Commits (on `fix-usage-limit-return`)

| Commit | Description |
|--------|-------------|
| `01bb760` | pr: rewrite overall retrospect with cross-phase references |
| `da7c369` | pr: add PR/CI evidence and overall retrospect |
| `0c3d999` | feat: retry rule upgrade - provider isolation, body matchers, error logging |
| `f05eb69` | test: add retrospect, update results with frontend tests |
| `0dabc72` | test: add frontend vitest + AC6/AC7 component test |
| `8bf95cf` | feat: retry rule provider isolation + JSON body matchers + upstream error logs |
| `abed852` | spec: retry rule provider isolation + JSON matching + error logging |

The branch contains the full implementation of the spec from spec → plan → dev → test → PR cycle.
