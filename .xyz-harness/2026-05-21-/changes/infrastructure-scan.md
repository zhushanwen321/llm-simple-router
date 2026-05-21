# Pipeline Migration Infrastructure Scan

Date: 2026-05-22  
Scope: `router/src/proxy/`  

---

## 1. Project Structure

```
router/src/proxy/
├── (7 root files)                    # types.ts, proxy-core.ts, proxy-logging.ts, log-helpers.ts, log-detail-policy.ts, tool-error-logger.ts, pipeline-snapshot.ts
├── enhancement/       (1 file)       # index.ts
├── format/            (2 files)      # registry.ts, types.ts
│   ├── adapters/      (4 files)      # anthropic.ts, openai.ts, responses.ts, shared-error-meta.ts
│   └── converters/    (6 files)      # anthropic-openai.ts, anthropic-responses.ts, openai-anthropic.ts, openai-responses.ts, responses-anthropic.ts, responses-openai.ts
├── handler/           (3 files)      # create-proxy-handler.ts, failover-loop.ts, proxy-handler-utils.ts
├── hooks/             (2 files)      # plugin-bridge.ts, sse-event-transform.ts
│   └── builtin/       (9 files)      # allowed-models.ts, cache-estimation.ts, client-detection.ts, enhancement-preprocess.ts, error-logging.ts, overflow-redirect.ts, plugin-request.ts, provider-patches.ts, request-logging.ts
├── orchestration/     (4 files)      # orchestrator.ts, resilience.ts, retry-rules.ts, scope.ts
├── patch/             (3 files)      # index.ts, safe-sse-parser.ts, tool-round-limiter.ts
│   └── deepseek/      (4 files)      # index.ts, patch-orphan-tool-results.ts, patch-thinking.ts, utils.ts
├── pipeline/          (5 files)      # context.ts, hook-registry.ts, pipeline.ts, register-hooks.ts, types.ts
├── routing/           (5 files)      # enhancement-config.ts, mapping-resolver.ts, modality-redirect.ts, overflow.ts, usage-window-tracker.ts
├── transform/         (26 files)     # id-utils.ts, message-mapper.ts, plugin-registry.ts, plugin-types.ts, provider-meta.ts, request-bridge-responses.ts, request-transform-responses.ts, request-transform.ts, response-bridge-responses.ts, response-transform-responses.ts, response-transform.ts, sanitize.ts, shared-normalize.ts, stream-ant2oa.ts, stream-ant2resp.ts, stream-bridge-chat2resp.ts, stream-bridge-resp2chat.ts, stream-oa2ant.ts, stream-resp2ant.ts, stream-transform-base.ts, thinking-mapper.ts, thinking-resolver.ts, tool-mapper.ts, types-responses.ts, types.ts, usage-mapper.ts
└── transport/         (4 files)      # http.ts, proxy-agent.ts, stream.ts, transport-fn.ts
```

Total: **89 `.ts` files** across 13 directories.

---

## 2. Pipeline Infrastructure

### 2.1 `pipeline/types.ts` — Core Types

**`HookPhase`** (union type, 6 values):

| Phase | Purpose |
|-------|---------|
| `pre_route` | Before route resolution (client detection, preprocessing) |
| `post_route` | After route resolution (allowed models, overflow redirect) |
| `pre_transport` | Before sending to upstream (plugin transforms, provider patches) |
| `post_response` | After upstream response (logging, metrics, cache estimation) |
| `on_error` | On error (error logging) |
| `on_stream_event` | During SSE streaming (event transformation) |

**`PipelineHook`** interface:
```typescript
interface PipelineHook {
  name: string;           // Global unique name
  phase: HookPhase;       // Mount phase
  priority: number;       // 0-99 infra, 100-199 built-in, 200-299 plugins, 900-999 observers
  execute(ctx: PipelineContext): void | Promise<void>;
}
```

**`PipelineAbort`** class:
```typescript
class PipelineAbort extends Error {
  constructor(public readonly statusCode: number, public readonly body: unknown);
}
```
Used by hooks to short-circuit the pipeline with a specific HTTP response.

**`PipelineContext`** interface (the shared mutable state bag):

| Property | Mutability | Type | Description |
|----------|-----------|------|-------------|
| `request` | readonly | `FastifyRequest` | Original Fastify request |
| `reply` | readonly | `FastifyReply` | Original Fastify reply |
| `rawBody` | readonly | `Record<string, unknown>` | Deep clone of original request body |
| `clientModel` | readonly | `string` | `body.model` from original request |
| `apiType` | readonly | `string` | `"openai" \| "openai-responses" \| "anthropic"` |
| `body` | mutable | `Record<string, unknown>` | Current (possibly transformed) request body |
| `isStream` | mutable | `boolean` | `body.stream === true` |
| `resolved` | mutable | `Target \| null` | Resolved mapping target |
| `provider` | mutable | `ProviderInfo \| null` | Active provider row |
| `effectiveUpstreamPath` | mutable | `string` | Final upstream URL path |
| `effectiveApiType` | mutable | `string` | May differ from `apiType` after format transform |
| `injectedHeaders` | mutable | `Record<string, string>` | Extra headers to send upstream |
| `metadata` | mutable | `Map<string, unknown>` | Hook communication channel |
| `logId` | mutable | `string` | Current iteration's log UUID |
| `rootLogId` | mutable | `string \| null` | First iteration's log UUID (failover tracking) |
| `transportResult` | mutable | `TransportResult \| null` | Result from transport layer |
| `resilienceResult` | mutable | `ResilienceResult \| null` | Result from resilience layer |
| `clientRequest` | mutable | `string` | JSON string of client request (for logging) |
| `upstreamRequest` | mutable | `string` | JSON string of upstream request (for logging) |
| `snapshot` | mutable | `PipelineSnapshot` | Accumulated pipeline stage records |

### 2.2 `pipeline/pipeline.ts` — ProxyPipeline Class

```typescript
class ProxyPipeline {
  private hooksByPhase: Map<HookPhase, PipelineHook[]>;

  register(hook: PipelineHook): void;          // Idempotent: same-name hook skips
  getHookChain(phase: HookPhase): ReadonlyArray<{ name: string; priority: number }>;
  async emit(phase: HookPhase, ctx: PipelineContext): Promise<void>;
}

export const proxyPipeline: ProxyPipeline;  // Global singleton
```

Key behaviors:
- `register()` is idempotent — duplicate name silently skipped
- Hooks within a phase are sorted by ascending priority
- `emit()` executes hooks sequentially (no parallelism)

### 2.3 `pipeline/context.ts` — createPipelineContext

```typescript
function createPipelineContext(
  request: FastifyRequest,
  reply: FastifyReply,
  apiType: string,
): PipelineContext;
```

Initializes all mutable fields to defaults:
- `body` = `request.body` (reference, not clone)
- `rawBody` = `structuredClone(body)` (deep clone for logging)
- `resolved` = `null`, `provider` = `null`
- `metadata` = empty `Map`
- `logId` = `""`, `rootLogId` = `null`
- `snapshot` = new `PipelineSnapshot()`

### 2.4 `pipeline/register-hooks.ts` — All Registered Hooks

9 built-in hooks registered at startup, each registered to both `hookRegistry` (Admin API query) and `proxyPipeline` (actual execution):

| # | Hook | Variable Name |
|---|------|--------------|
| 1 | `enhancement-preprocess` | `enhancementPreprocessHook` |
| 2 | `allowed-models` | `allowedModelsHook` |
| 3 | `overflow-redirect` | `overflowRedirectHook` |
| 4 | `plugin-request` | `pluginRequestHook` |
| 5 | `provider-patches` | `providerPatchesHook` |
| 6 | `request-logging` | `requestLoggingHook` |
| 7 | `error-logging` | `errorLoggingHook` |
| 8 | `client-detection` | `clientDetectionHook` |
| 9 | `cache-estimation` | `cacheEstimationHook` |

### 2.5 `pipeline/hook-registry.ts` — Admin API Registry

Separate from `ProxyPipeline`. Only used by Admin API to list configured hooks. Does NOT execute hooks.

```typescript
class HookRegistry {
  register(hook: PipelineHook): void;
  getByPhase(phase: HookPhase): HookSummary[];
  getAll(): Record<string, HookSummary[]>;
}
export const hookRegistry: HookRegistry;  // Global singleton
```

### 2.6 `pipeline-snapshot.ts` — PipelineSnapshot

Records pipeline stages as structured data for diagnostics:

```typescript
type StageRecord =
  | { stage: "tool_round_limit"; action: string; rounds: number }
  | { stage: "tool_guard"; action: string; tool: string }
  | { stage: "routing"; client_model: string; backend_model: string; provider_id: string; strategy: string; mapping_reason?: MappingReason }
  | { stage: "overflow"; triggered: boolean; redirect_to?: string; redirect_provider?: string }
  | { stage: "provider_patch"; types: string[] }
  | { stage: "modality-redirect"; triggered: boolean; original_model: string; redirect_to: string; redirect_provider: string; reason: string; detected_modalities?: string[] };
```

---

## 3. Current Hooks — Detail

### 3.1 `pre_route` Hooks

| Hook | Priority | What It Does | Reads from `ctx.metadata` |
|------|----------|-------------|---------------------------|
| `builtin:enhancement-preprocess` | 110 | Tool round limit injection + tool loop detection (3-tier: inject warning → abort 422 → hard disconnect) | `"db"`, `"container"`, `"session_id"` (set by client-detection) |
| `builtin:client-detection` | 200 | Detect client type (claude-code, pi, etc.) from request headers/body, extract `session_id` | `"db"` (optional, falls back to defaults) |

### 3.2 `post_route` Hooks

| Hook | Priority | What It Does | Reads from `ctx.metadata` |
|------|----------|-------------|---------------------------|
| `builtin:allowed-models` | 50 | Check `routerKey.allowed_models` whitelist, abort 403 if model not allowed | `"errors"` (ProxyErrorFormatter) |
| `builtin:overflow-redirect` | 100 | Check if request tokens exceed context window, redirect to overflow model | `"db"` |

### 3.3 `pre_transport` Hooks

| Hook | Priority | What It Does | Reads from `ctx.metadata` |
|------|----------|-------------|---------------------------|
| `builtin:provider-patches` | 100 | Apply provider-specific body patches (developer_role conversion, DeepSeek patches) | `ctx.provider`, `ctx.resolved` (context fields) |
| `builtin:plugin-request` | 250 | Apply PluginRegistry `beforeRequest`/`afterRequest` transforms on body and headers | `"container"` |

### 3.4 `post_response` Hooks

| Hook | Priority | What It Does | Reads from `ctx.metadata` |
|------|----------|-------------|---------------------------|
| `builtin:cache-estimation` | 200 | Estimate cache hit tokens via prefix matching (or pass through API-reported values) | `"db"`, `"session_id"`, `"client_type"` |
| `builtin:request-logging` | 900 | Log resilience result + collect transport metrics + write stream content + flush tool errors | `"db"`, `"container"`, `"startTime"`, `"resilienceResult"`, `"matcher"`, `"logFileWriter"`, `"pendingToolErrors"` |

### 3.5 `on_error` Hooks

| Hook | Priority | What It Does | Reads from `ctx.metadata` |
|------|----------|-------------|---------------------------|
| `builtin:error-logging` | 900 | Insert rejected/error log to DB + flush pending tool errors | `"db"`, `"startTime"`, `"matcher"`, `"logFileWriter"`, `"errorInfo"`, `"pendingToolErrors"` |

### 3.6 `on_stream_event` Hooks

No built-in hooks registered for this phase. Infrastructure exists (`SSEEventTransform` in `hooks/sse-event-transform.ts`) but does not call `proxyPipeline.emit("on_stream_event", ...)` — it only stores the parsed event in `ctx.metadata.set("currentSSEEvent", ...)`.

### 3.7 Plugin Bridge Hooks (Dynamic)

`hooks/plugin-bridge.ts` bridges `TransformPlugin` instances into pipeline hooks at runtime:

| Generated Hook Name | Phase | Priority | Condition |
|---------------------|-------|----------|-----------|
| `plugin:{name}:beforeRequest` | `pre_transport` | 250 | Plugin has `beforeRequest` or `beforeRequestTransform` |
| `plugin:{name}:afterRequest` | `pre_transport` | 260 | Plugin has `afterRequest` or `afterRequestTransform` |
| `plugin:{name}:beforeResponse` | `post_response` | 250 | Plugin has `beforeResponse` or `beforeResponseTransform` |
| `plugin:{name}:afterResponse` | `post_response` | 260 | Plugin has `afterResponse` or `afterResponseTransform` |
| `plugin:{name}:onError` | `on_error` | 250 | Plugin has `onError` |

---

## 4. `failover-loop.ts` — Duplicated Logic vs Hooks

### 4.1 Responsibilities Currently in failover-loop.ts

The failover loop (`executeFailoverLoop()`, ~340 lines) contains **significant inline logic** that duplicates or overlaps with existing hooks:

| Responsibility | Lines | Already in a Hook? | Hook Name |
|---------------|-------|-------------------|-----------|
| Enhancement config loading + tool error extraction | ~L135-145 | Partially | `enhancement-preprocess` (tool round limit only) |
| `resolveMapping()` (route resolution) | ~L121 | No | — |
| `computeModalityRedirectTargets()` (modality redirect) | ~L130 | No | — |
| `expandOverflowTargets()` (overflow redirect) | ~L133-137 | **Duplicated** | `overflow-redirect` hook |
| `allowed_models` filtering | ~L139-160 | **Duplicated** | `allowed-models` hook |
| `filterExcluded()` target selection | ~L185 | No | — |
| Provider lookup (`getProviderById`) | ~L195 | No | — |
| Format transform (`resolveUpstreamPath`) | ~L206-210, L290-320 | No | — |
| Plugin adjustments (`applyPluginAdjustments`) | ~L215-218 | **Duplicated** | `plugin-request` hook |
| Provider patches (`applyProviderPatches`) | ~L221-226 | **Duplicated** | `provider-patches` hook |
| API key decryption | ~L228-234 | No | — |
| `adapter.beforeSendProxy()` | ~L236 | No | — |
| Stream transform creation (`formatRegistry.createStreamTransform`) | ~L241-243 | No | — |
| Response transform (non-stream format conversion) | ~L246-268 | No | — |
| Transport function build (`buildTransportFn`) | ~L271-280 | No | — |
| Orchestrator execution | ~L283 | No | — |
| Resilience result logging | ~L288-303 | **Duplicated** | `request-logging` hook |
| Transport metrics collection | ~L304 | **Duplicated** | `request-logging` hook |
| Stream content logging | ~L318-327 | **Duplicated** | `request-logging` hook |
| Tool error flushing | ~L307 | **Duplicated** | `request-logging` hook |
| Failover control (exclude targets, continue loop) | ~L330-340 | No | — |
| Error handling (ProviderSwitchNeeded, Semaphore errors, AbortError) | ~L341-400 | No | — |

### 4.2 Responsibilities NOT Covered by Any Existing Hook

These are the "pure failover-loop" responsibilities that have no hook equivalent:

1. **Route resolution** — `resolveMapping()` + `computeModalityRedirectTargets()` + `expandOverflowTargets()` precompute
2. **Target selection** — `filterExcluded()` picking first non-excluded target
3. **Provider lookup** — `getProviderById()` + active check
4. **Format transform** — `resolveUpstreamPath()` deciding effective API type and upstream path
5. **API key decryption** — caching decrypted keys per provider per request
6. **`beforeSendProxy()`** — adapter pre-send callback
7. **Stream transform pipeline** — creating format transforms + response transforms for non-stream
8. **Transport function build** — `buildTransportFn()` closure
9. **Orchestrator delegation** — calling `orchestrator.handle()`
10. **Failover control flow** — `while(true)` loop, `excludeTargets` accumulation, `MAX_FAILOVER_ITERATIONS` guard
11. **Error classification** — `ProviderSwitchNeeded` → continue, `SemaphoreQueueFullError` → reject, `AbortError` → silent exit
12. **Log ID management** — `rootLogId` tracking, per-iteration `logId` generation
13. **Mapping reason tracking** — `effectiveMappingReason` and `overflowIndices` bookkeeping
14. **Pipeline snapshot construction** — per-iteration snapshot with precomputed stages
15. **Stream timeout handling** — writing SSE error event on stream_abort
16. **Usage window recording** — `usageWindowTracker.recordRequest()` on success
17. **Socket destruction guard** — checking `reply.raw.destroyed` at loop start

---

## 5. `create-proxy-handler.ts` — Pipeline emit() Calls

### 5.1 Current `proxyPipeline.emit()` Calls

| Phase | Location | Line Context |
|-------|----------|-------------|
| `pre_route` | `create-proxy-handler.ts` L134 | `await proxyPipeline.emit("pre_route", ctx)` — after creating context, before failover loop |

### 5.2 Missing `proxyPipeline.emit()` Calls

| Phase | Where It Should Be | Currently Done By |
|-------|-------------------|------------------|
| `post_route` | After `resolveMapping()` in failover-loop | **Inline in failover-loop** — no emit |
| `pre_transport` | Before `buildTransportFn()` in failover-loop | **Inline in failover-loop** — `applyPluginAdjustments()` + `applyProviderPatches()` called directly |
| `post_response` | After `orchestrator.handle()` returns successfully | **Inline in failover-loop** — `logResilienceResult()` + `collectTransportMetrics()` called directly |
| `on_error` | In the catch blocks of failover-loop | **Inline in failover-loop** — `insertRequestLog()` + `insertRejectedLog()` called directly |
| `on_stream_event` | During SSE streaming in `StreamProxy` | `SSEEventTransform` stores event but **never calls `proxyPipeline.emit("on_stream_event", ctx)`** |

**Summary**: Only `pre_route` phase uses the pipeline. The other 5 phases have their logic hardcoded in `failover-loop.ts`.

### 5.3 Handler Flow

```
createProxyHandler()
  → handleRequest()
    → createPipelineContext()
    → ctx.metadata.set("db", ...)
    → ctx.metadata.set("container", ...)
    → proxyPipeline.emit("pre_route", ctx)     ← ONLY emit
    → executeFailoverLoop(ctx, ...)
      → [inline: post_route, pre_transport, orchestrator.handle(), post_response, on_error]
```

---

## 6. Orchestrator

### 6.1 `orchestrator.ts` — ProxyOrchestrator

**Factory function:**
```typescript
function createOrchestrator(
  semaphoreManager?: SemaphoreManager,
  tracker?: RequestTracker,
  adaptiveController?: AdaptiveController,
): ProxyOrchestrator | undefined;
```

**`handle()` method signature:**
```typescript
async handle(
  request: FastifyRequest,
  reply: FastifyReply,
  apiType: "openai" | "openai-responses" | "anthropic",
  config: OrchestratorConfig,
  ctx?: HandleContext,
): Promise<ResilienceResult>;
```

**`OrchestratorConfig`** (input):
```typescript
interface OrchestratorConfig {
  resolved: Target;
  provider: { id, name, is_active, api_type, base_url, api_key };
  clientModel: string;
  isStream: boolean;
  trackerId?: string;
  sessionId?: string;
  clientRequest?: string;
  upstreamRequest?: string;
  concurrencyOverride?: ConcurrencyOverride;
  mappingReason?: MappingReason;
}
```

**`HandleContext`** (execution config):
```typescript
interface HandleContext {
  streamTimeoutMs?: number;
  retryBaseDelayMs?: number;
  failoverThreshold?: number;
  isFailover?: boolean;
  ruleMatcher?: RetryRuleMatcher;
  transportFn: (target: Target) => Promise<TransportResult>;
}
```

### 6.2 What `handle()` Does

1. **Build `AbortController`** — wired to `request.raw.on("close")` for client disconnect
2. **Build `ActiveRequest`** — tracker metadata (model, provider, timestamps, etc.)
3. **Tracker scope** — `trackerScope.track()` wraps execution, registers kill callback
4. **Semaphore scope** — `semaphoreScope.withSlot()` acquires provider concurrency slot, with queue callback
5. **Resilience execution** — `resilience.execute()` runs the retry/failover loop with `transportFn`
6. **Adaptive controller** — reports success/failure + retry status
7. **Response sending** — `sendResponse()` writes HTTP response for non-stream/success cases
8. **Error propagation** — re-throws `ProviderSwitchNeeded`, `SemaphoreTimeoutError`, `SemaphoreQueueFullError`

The orchestrator is a thin coordination layer over semaphore + tracker + resilience. It does NOT know about pipeline hooks.

---

## 7. Dependencies — `failover-loop.ts` Imports

### Core Layer
```typescript
import { ProviderSwitchNeeded } from "../../core/errors.js";
import { SemaphoreQueueFullError, SemaphoreTimeoutError } from "../../core/errors.js";
import type { Target, MappingReason } from "../../core/types.js";
import type { ServiceContainer } from "../../core/container.js";
import { SERVICE_KEYS } from "../../core/container.js";
```

### DB Layer
```typescript
import { getProviderById, updateLogClientStatus, insertRequestLog, updateLogStreamContent } from "../../db/index.js";
import { getSetting } from "../../db/settings.js";
import { getModelStreamTimeout } from "../../db/providers.js";
```

### Config Layer
```typescript
import { getConfig } from "../../config/index.js";
import { parseModels } from "../../config/model-context.js";
```

### Routing Layer
```typescript
import { resolveMapping, filterExcluded } from "../routing/mapping-resolver.js";
import { expandOverflowTargets } from "../routing/overflow.js";
import { computeModalityRedirectTargets } from "../routing/modality-redirect.js";
import { loadEnhancementConfig } from "../routing/enhancement-config.js";
```

### Transport Layer
```typescript
import { buildTransportFn } from "../transport/transport-fn.js";
import type { ProxyAgentFactory } from "../transport/proxy-agent.js";
```

### Orchestration Layer
```typescript
import type { RetryRuleMatcher } from "../orchestration/retry-rules.js";
import type { ProxyOrchestrator } from "../orchestration/orchestrator.js";
```

### Pipeline Layer
```typescript
import type { PipelineContext } from "../pipeline/types.js";
import { PipelineAbort } from "../pipeline/types.js";
import { PipelineSnapshot } from "../pipeline-snapshot.js";
```

### Format Layer
```typescript
import type { FormatAdapter } from "../format/types.js";
import type { FormatRegistry } from "../format/registry.js";
```

### Patch Layer
```typescript
import { applyProviderPatches } from "../patch/index.js";
```

### Proxy Shared
```typescript
import type { ProxyErrorFormatter } from "../proxy-core.js";
import { buildUpstreamHeaders, buildUpstreamUrl } from "../proxy-core.js";
import { insertRejectedLog } from "../log-helpers.js";
import { logResilienceResult, collectTransportMetrics, sanitizeHeadersForLog } from "../proxy-logging.js";
import type { RawHeaders } from "../types.js";
```

### Handler Internal
```typescript
import { extractFailedToolResults, getTransportStatusCode, serializeBlocksForStorage } from "./proxy-handler-utils.js";
import type { FailedToolResult } from "./proxy-handler-utils.js";
```

### Transform Layer
```typescript
import type { PluginRegistry } from "../transform/plugin-registry.js";
import type { ResponseTransformContext } from "../transform/plugin-types.js";
import type { ApiType } from "../transform/types.js";
```

### Monitor Layer
```typescript
import type { RequestTracker } from "../../core/monitor/index.js";
```

### Utils
```typescript
import { decrypt } from "../../utils/crypto.js";
import { logToolErrors } from "../tool-error-logger.js";
```

### External
```typescript
import { randomUUID } from "crypto";
import type { FastifyReply } from "fastify";
import Database from "better-sqlite3";
```

### Import Count by Layer

| Layer | Import Count |
|-------|-------------|
| Core | 5 |
| DB | 3 |
| Config | 2 |
| Routing | 4 |
| Transport | 2 |
| Orchestration | 2 |
| Pipeline | 3 |
| Format | 2 |
| Patch | 1 |
| Proxy shared | 4 |
| Handler internal | 2 |
| Transform | 3 |
| Monitor | 1 |
| Utils | 2 |
| External | 3 |
| **Total** | **39 imports** |

---

## 8. Key Observations for Migration

1. **Pipeline is partially adopted**: Only `pre_route` phase uses `proxyPipeline.emit()`. The other 5 phases have their logic inlined in `failover-loop.ts`.

2. **4 hooks exist but are bypassed**: `overflow-redirect`, `allowed-models`, `provider-patches`, and `request-logging` hooks are registered and functional, but `failover-loop.ts` contains inline duplicates of their logic. The hooks are never called because `emit()` is never called for their phases.

3. **`on_stream_event` phase is inert**: `SSEEventTransform` stores parsed events in `ctx.metadata` but never calls `proxyPipeline.emit("on_stream_event", ctx)`.

4. **failover-loop.ts is a monolith**: 340+ lines with 39 imports spanning all layers. It combines routing, format transform, transport construction, orchestrator delegation, logging, error handling, and failover control.

5. **Orchestrator is pipeline-unaware**: `ProxyOrchestrator.handle()` is called from within `failover-loop.ts` as a black box. It manages semaphore/tracker/resilience but has no knowledge of pipeline hooks.

6. **`PipelineContext` is created in `create-proxy-handler.ts`** but most of its fields (`resolved`, `provider`, `transportResult`, etc.) are populated inside `failover-loop.ts` via local variables, not through the context object. The hooks expect these fields on the context but `failover-loop.ts` doesn't write to them — it uses local variables instead.

7. **Plugin bridge creates dynamic hooks** that would work if `emit()` were called for `pre_transport`, `post_response`, and `on_error` phases, but currently `applyPluginAdjustments()` in `failover-loop.ts` handles this inline.
