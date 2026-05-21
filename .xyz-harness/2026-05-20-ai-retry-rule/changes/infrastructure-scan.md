# Infrastructure Scan: AI-Powered Retry Rule Generation

Date: 2026-05-20
Branch: feat-add-ai-retry-rule

---

## 1. Request Detail / Logs System

### DB Schema (`router/src/db/logs.ts`)

**`request_logs` table** — key columns for AI rule generation:

| Column | Type | Relevance to AI Rule |
|--------|------|---------------------|
| `id` | TEXT PK | Request identifier |
| `api_type` | TEXT | "openai" / "anthropic" / "openai-responses" |
| `model` | TEXT nullable | Client-requested model |
| `provider_id` | TEXT nullable | Backend provider |
| `status_code` | INT nullable | Upstream HTTP status (key input for retry rule) |
| `client_status_code` | INT nullable | Status sent to client |
| `error_message` | TEXT nullable | Error text (key input for body_pattern) |
| `upstream_response` | TEXT nullable | Full upstream response body (key input for body_pattern) |
| `is_retry` / `is_failover` | INT | Whether this was a retry/failover attempt |
| `original_request_id` | TEXT nullable | Links retry children to parent |
| `latency_ms` | INT nullable | Request latency |
| `is_stream` | INT | Stream vs non-stream |
| `session_id` | TEXT nullable | Session tracking |
| `pipeline_snapshot` | TEXT nullable | Pipeline state at request time |

**Detail preservation**: `shouldPreserveDetail()` gates whether `client_request`, `upstream_request`, `upstream_response` are stored (controlled by `log-detail-policy.ts` + `LogFileWriter`).

### DB Queries

| Function | Purpose |
|----------|---------|
| `getRequestLogById()` | Single log with metrics JOIN — **primary API for detail view** |
| `getRequestLogs()` / `getRequestLogsGrouped()` | Paginated list with filters |
| `getRequestLogChildren()` | Retry/failover child requests (limit 100) |
| `insertRequestLog()` | DB insert with detail-preservation gating + file writer |
| `updateLogStreamContent()` | Post-stream text content backfill |
| `updateLogPipelineSnapshot()` | Pipeline snapshot backfill |

### Admin API (`router/src/admin/logs.ts`)

| Endpoint | Method | Notes |
|----------|--------|-------|
| `/admin/api/logs` | GET | Paginated list, filters: api_type, model, provider_id, start/end_time, status_code, view=grouped |
| `/admin/api/logs/:id` | GET | Single log detail, auto-backfills from JSONL files |
| `/admin/api/logs/:id/children` | GET | Retry children |
| `/admin/api/logs/before` | DELETE | Bulk cleanup |

### Frontend (`frontend/src/views/Logs.vue` — 414 lines)

- Uses `UnifiedRequestDialog` for log detail view (separate component at `components/request-detail/UnifiedRequestDialog.vue` — 198 lines)
- `LogTableRow` component renders each row with expand/collapse for children
- Filters: period, date range, provider, model, key, status
- Composables: `useLogFilters`, `useLogs`, `useLogRetention`, `useClipboard`
- Log detail dialog opens via `openLogDetail()` → sets `selectedLogEntry` + `logDetailOpen`

**`UnifiedRequestDialog`** exposes:
- Left panel: `RequestOverviewPanel` (metadata, status, latency, tokens)
- Right panel: Tabs (Response / Request) with `ResponseViewer` and `RequestDiffViewer`
- Full upstream response body available via `logDetailData.responseBody` / `overview.upstreamResponse`

---

## 2. Retry Rules System

### DB Schema (`router/src/db/retry-rules.ts`)

**`retry_rules` table** (created in migration 011, strategy fields added in 013):

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | TEXT PK | randomUUID | |
| `name` | TEXT | — | Human-readable name |
| `status_code` | INTEGER | — | HTTP status to match (100-599) |
| `body_pattern` | TEXT | — | Regex pattern against response body |
| `is_active` | INTEGER | 1 | Enable/disable |
| `retry_strategy` | TEXT | "exponential" | "fixed" or "exponential" |
| `retry_delay_ms` | INTEGER | 5000 | Initial/fixed delay |
| `max_retries` | INTEGER | 10 | Max retry count (0-100) |
| `max_delay_ms` | INTEGER | 60000 | Exponential backoff cap |
| `created_at` | TEXT | ISO string | |

### RetryRuleMatcher (`router/src/proxy/orchestration/retry-rules.ts`)

- In-memory cache: `Map<statusCode, {rule, pattern: RegExp}[]>`
- `load(db)` — reads active rules from DB, groups by status_code, compiles regex
- `match(statusCode, body)` — returns first matching rule (status_code → regex test)
- Reloaded via `stateRegistry.refreshRetryRules()` after any CRUD operation

### Admin API (`router/src/admin/retry-rules.ts`)

| Endpoint | Method | Validation |
|----------|--------|------------|
| `/admin/api/retry-rules` | GET | — |
| `/admin/api/retry-rules` | POST | TypeBox schema + `new RegExp(body_pattern)` test |
| `/admin/api/retry-rules/:id` | PUT | Partial update, same regex validation |
| `/admin/api/retry-rules/:id` | DELETE | Checks existence first |

All write operations call `stateRegistry?.refreshRetryRules()` to sync memory cache.

### Recommended Rules System

- Static JSON config: `router/config/recommended-retry-rules.json` — 12 predefined rules
- Loaded via `router/src/config/recommended.ts` → `getRecommendedRetryRules()`
- API: `GET /admin/api/recommended/retry-rules` — marks existing rules with `exists` flag
- Frontend: `RetryRules.vue` bottom collapsible card with checkbox multi-select + bulk add

### Frontend (`frontend/src/views/RetryRules.vue` — 638 lines)

- **Create/Edit Dialog**: `Dialog` component with form fields (name, status_code, body_pattern, retry_strategy, retry_delay_ms, max_retries, max_delay_ms, is_active)
- **Delete Confirmation**: `AlertDialog`
- **Recommended Rules**: Collapsible `Card` at bottom, checkbox selection, bulk add via sequential `api.createRetryRule()` calls
- Client-side validation: regex validity, status code range, delay minimums
- Form state: `ref<{ ...DEFAULT_FORM }>` pattern with `errors` ref

### API Client (`frontend/src/api/client.ts`)

```typescript
getRetryRules: () => request<RetryRule[]>("get", "/retry-rules")
createRetryRule: (data) => request<{ id: string }>("post", "/retry-rules", data)
updateRetryRule: (id, data) => request<{ success: boolean }>("put", `/retry-rules/${id}`, data)
deleteRetryRule: (id) => request<{ success: boolean }>("delete", `/retry-rules/${id}`)
recommended.getRetryRules: () => request<RecommendedRetryRule[]>("get", "/recommended/retry-rules")
```

---

## 3. Proxy Enhancement System (Configuration Pattern)

### Settings Storage (`router/src/db/settings.ts`)

- Key-value store in `settings` table (`key` TEXT, `value` TEXT)
- 30-second TTL cache per `Database` instance (WeakMap)
- `getSetting(db, key)` / `setSetting(db, key, value)`
- Enhancement config stored as JSON string under key `"proxy_enhancement"`
- No AI model config exists yet — this is where `ai_retry_model` / `ai_retry_api_key` would go

### Admin API (`router/src/admin/proxy-enhancement.ts`)

- `GET /admin/api/proxy-enhancement` — reads JSON from settings, merges with defaults
- `PUT /admin/api/proxy-enhancement` — validates with TypeBox schema, writes JSON to settings
- Calls `clearEnhancementConfigCache()` on update

### Frontend (`frontend/src/views/ProxyEnhancement.vue` — 277 lines)

- **Edit-then-save pattern**: all toggles are local refs, single "Save" button at bottom
- Cards for each feature: loop detection, tool round limit, tool error logging
- Separate API calls for token estimation and client session headers
- Uses `Promise.all` for parallel saves (not `allSettled` — flagged by lint)

---

## 4. AI/LLM Call Infrastructure

### No existing LLM call utility

The backend has **no** generic "call an LLM" function. All HTTP calls are either:
- **Proxy transport**: `callNonStream()` / `callStream()` in `router/src/proxy/transport/` — designed for upstream proxying, not for making independent LLM API calls
- **`callGet()`**: Used for fetching provider model lists (`/admin/api/providers/fetch-models`)
- **`fetchJson()`** in `router/src/upgrade/checker.ts`: Simple HTTP GET for JSON (npm registry + GitHub config)

### What exists for reuse

| Component | Reusability | Notes |
|-----------|-------------|-------|
| `callNonStream()` | High | Could call any OpenAI-compatible chat completions endpoint. Takes `{ base_url }`, `apiKey`, `body`, headers, path |
| `callGet()` | Medium | GET only, used for model list fetching |
| `fetchJson()` | Low | Too simple, no POST support |
| `buildUpstreamHeaders()` | Medium | Builds auth headers from raw headers + API key |

**To call an LLM for rule generation**, the simplest path is:
1. Reuse the router's own proxy endpoint (`localhost:PORT/v1/chat/completions`) via `callNonStream()` with a configured router key
2. Or build a new lightweight utility using native `http`/`https` (same pattern as `fetchJson` but with POST)

### Provider data available for AI config

- `providers` table has `base_url`, `api_key` (encrypted), `api_type`, `upstream_path`
- Could let user pick a provider + model for AI calls, or use the router's own endpoint

---

## 5. Frontend Patterns

### Dialog/Form Patterns

| Pattern | Example | Files |
|---------|---------|-------|
| **Create/Edit Dialog** | `Dialog` + `DialogContent` with form, `v-model:open` | `RetryRules.vue` lines 110-258 |
| **Delete Confirmation** | `AlertDialog` + `AlertDialogContent` | `RetryRules.vue` lines 260-292 |
| **Log Detail Dialog** | `UnifiedRequestDialog` (custom component) | `Logs.vue`, `components/request-detail/` |
| **Collapsible Section** | `Collapsible` + `CollapsibleTrigger/Content` | `RetryRules.vue` recommended rules |
| **Edit-then-save** | Local refs + save button | `ProxyEnhancement.vue` |

### Form Submission Pattern (RetryRules.vue)

```
ref(DEFAULT_FORM) → validate() → api.createRetryRule/updateRetryRule → loadData() → toast
```

- `errors` ref: `Record<string, string>`, set per field in `validate()`
- Input clears error on `@input`: `@input="delete errors.name"`
- Save: try/catch with `console.error` + `toast.error(getApiMessage(e, ...))`

### UI Components Available (shadcn-vue)

| Component | Available |
|-----------|-----------|
| Dialog / DialogContent / DialogHeader / DialogFooter | Yes |
| AlertDialog + variants | Yes |
| Button / Input / Label / Textarea | Yes |
| Select + variants | Yes |
| Checkbox / Switch | Yes |
| Badge / Card + variants | Yes |
| Table + variants | Yes |
| Collapsible + variants | Yes |
| Tabs + variants | Yes |
| Tooltip / Popover | Yes |
| Progress | Yes |
| ScrollArea | Yes |
| Skeleton | Yes |

---

## 6. Recent Commits (last 10)

| Hash | Message | Relevance |
|------|---------|-----------|
| `4a51731` | Merge PR #147 — remove @llm-router/core from release | Cleanup |
| `61e1577` | merge: resolve conflict with origin/main | Integration |
| `e0c27de` | ci: skip CI for documentation-only changes | CI |
| `2d0100c` | chore: remove @llm-router/core from release pipeline | Packaging |
| `06929de` | chore: bump version to 0.11.2 | Release |
| `2414dc4` | Merge PR #146 — feat-add-codex | Feature |
| `c72729e` | feat: add DeepSeek 429 concurrency rate limit retry rule | **Retry rule addition pattern** — shows how new rules are added to recommended-retry-rules.json |
| `42f889e` | fix: address code review issues from PR #146 | Quality |
| `5b40f95` | fix: prevent QuickSetup mapping card collapse | UI fix |
| `559ede7` | refactor: optimize providers table layout | UI refactor |

**Key observation**: `c72729e` shows the current flow for adding retry rules — static JSON config + manual regex authoring. The AI rule generation feature would automate this by analyzing real error responses.

---

## Summary: Integration Points for AI Retry Rule Feature

### Data flow for rule generation

```
Request Log (upstream_response + status_code + error_message + provider_id)
  → AI Analysis (LLM call with error context)
  → Suggested RetryRule { name, status_code, body_pattern, strategy, ... }
  → User reviews in UI
  → POST /admin/api/retry-rules
  → RetryRuleMatcher.load() refreshes in-memory cache
```

### New components needed

| Component | Location | Purpose |
|-----------|----------|---------|
| AI retry rule API endpoint | `router/src/admin/retry-rules.ts` | `POST /admin/api/retry-rules/ai-generate` |
| LLM call utility | `router/src/utils/llm-client.ts` (new) | Call OpenAI-compatible API from backend |
| AI model config in settings | `router/src/db/settings.ts` | `ai_retry_provider_id`, `ai_retry_model` keys |
| AI config UI | `frontend/src/views/ProxyEnhancement.vue` or `RetryRules.vue` | Provider/model picker for AI calls |
| "Generate Rule" button | `frontend/src/views/Logs.vue` or `UnifiedRequestDialog.vue` | Trigger AI analysis from log detail |
| Rule preview dialog | `frontend/src/views/RetryRules.vue` | Show AI-suggested rule before saving |

### Reusable infrastructure

- **`callNonStream()`** in transport layer — can make HTTP POST to any endpoint
- **`getSetting()`/`setSetting()`** — config storage pattern
- **RetryRules.vue dialog + form** — copy for AI suggestion preview
- **`RetryRuleMatcher`** — already has reload mechanism via `stateRegistry.refreshRetryRules()`
- **`RecommendedRetryRule` type** — similar structure, could extend or reuse
