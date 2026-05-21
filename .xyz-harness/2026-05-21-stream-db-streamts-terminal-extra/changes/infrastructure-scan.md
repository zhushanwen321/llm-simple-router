# Infrastructure Scan: stream-db / stream timestamps / terminal & extra data

## 1. Project Structure (SSE streaming, metrics, DB, logging)

```
router/src/
├── metrics/
│   ├── sse-parser.ts              # SSE line buffer parser (raw protocol)
│   ├── metrics-extractor.ts       # MetricsExtractor: streaming metrics extraction
│   └── sse-metrics-transform.ts   # Transform stream: SSEParser + MetricsExtractor
├── proxy/
│   ├── transport/
│   │   ├── stream.ts              # StreamProxy: state machine for streaming transport
│   │   ├── transport-fn.ts        # Factory: creates transport fn, wires SSEMetricsTransform
│   │   └── http.ts                # callNonStream / callStream (upstream HTTP calls)
│   ├── handler/
│   │   ├── create-proxy-handler.ts # Factory: registers POST routes, sets up orchestration
│   │   ├── failover-loop.ts       # Main execution loop: resolve→transform→transport→log
│   │   └── proxy-handler-utils.ts # serializeBlocksForStorage, detectClient, etc.
│   ├── proxy-logging.ts           # logResilienceResult, collectTransportMetrics
│   ├── log-helpers.ts             # insertSuccessLog, insertRejectedLog
│   └── proxy-core.ts              # buildUpstreamUrl, buildUpstreamHeaders, createErrorFormatter
├── db/
│   ├── logs.ts                    # request_logs INSERT/UPDATE/SELECT
│   ├── metrics.ts                 # request_metrics INSERT/SELECT (summary, timeseries)
│   ├── index.ts                   # re-exports, initDatabase, migrations
│   └── migrations/                # 47 SQL migration files
└── core/
    ├── monitor/
    │   ├── request-tracker.ts     # SSE real-time monitoring broadcasting
    │   ├── types.ts               # ActiveRequest, StreamMetricsSnapshot, ContentBlock types
    │   ├── stream-content-accumulator.ts  # accumulates SSE raw+text content per request
    │   └── stream-extractor.ts    # extractStreamText: parse SSE line → ContentBlock
    └── types.ts                   # MetricsResult, TransportResult, ResilienceAttempt, StreamState
```

## 2. Existing APIs (exported functions)

### SSE Parsing & Metrics
| File | Export | Role |
|------|--------|------|
| `sse-parser.ts` | `SSEParser` class | Parses TCP stream chunks → `SSEEvent[]`. Handles `\r\n` normalization, `[DONE]` detection (sets `isDone=true`), `\n\n` event boundaries |
| `metrics-extractor.ts` | `MetricsExtractor` class | Internal state machine: processes SSE events → `MetricsResult`. Tracks per-phase timing (thinking/text/tool_use), stop_reason, tokens. `getMetrics()` returns final snapshot |
| `sse-metrics-transform.ts` | `SSEMetricsTransform` class | `Transform` stream: feeds chunks → SSEParser → extractor. `onMetrics` callback (throttled 5000ms), `onChunk` callback, `onContentDelta` callback, `flushParser()` method |

### DB Log Insertion
| File | Export | Role |
|------|--------|------|
| `logs.ts` | `insertRequestLog()` | Core INSERT into `request_logs` table. Handles file-writer context, detail preservation |
| `logs.ts` | `updateLogStreamContent()` | UPDATE `stream_text_content` for completed stream requests |
| `logs.ts` | `updateLogClientStatus()` | UPDATE `client_status_code` |
| `logs.ts` | `updateLogPipelineSnapshot()` | UPDATE `pipeline_snapshot` |
| `logs.ts` | `getRequestLogById()` | SELECT with LEFT JOIN request_metrics |
| `logs.ts` | `getRequestLogs()` | Paginated list with metrics JOIN |
| `metrics.ts` | `insertMetrics()` | Core INSERT into `request_metrics` table |
| `metrics.ts` | `getMetricsSummary()` | Aggregated summary (avg TTFT/TPS, cache rate) |
| `metrics.ts` | `getMetricsTimeseries()` | Time-bucketed metric trends |
| `metrics.ts` | `getClientTypeBreakdown()` | Count by client_type |

### Logging Pipeline
| File | Export | Role |
|------|--------|------|
| `log-helpers.ts` | `insertSuccessLog()` | Builds `RequestLogInsert` for success case, calls `insertRequestLog` |
| `log-helpers.ts` | `insertRejectedLog()` | Builds `RequestLogInsert` for rejected/error case |
| `proxy-logging.ts` | `logResilienceResult()` | Logs all resilience attempts (retries+failovers) to `request_logs` |
| `proxy-logging.ts` | `collectTransportMetrics()` | Reads metrics from `TransportResult.metrics` (stream) or `fromNonStreamResponse`, falls back, calls `insertMetrics` |

### Monitoring
| File | Export | Role |
|------|--------|------|
| `request-tracker.ts` | `RequestTracker` class | SSE broadcasting (6 event types): `request_start`, `request_update`, `request_complete`, `concurrency_update`, `stats_update`, `runtime_update`. `appendStreamChunk()` for live content, `update()` for streamMetrics snapshots, `updateCompletedMetrics()` for post-hoc cache read token updates |

### Transport
| File | Export | Role |
|------|--------|------|
| `transport-fn.ts` | `buildTransportFn()` | Factory: creates closure that wires SSEMetricsTransform → StreamProxy + tracker callbacks |
| `stream.ts` | `callStream()` | Creates upstream HTTP request, initializes `StreamProxy` state machine, returns `Promise<TransportResult>` |
| `stream.ts` | `StreamProxy` class (private) | BUFFERING→STREAMING→COMPLETED/ABORTED state machine. `onData()`, `onEnd()`, `onUpstreamError()`, `terminal()`, `collectMetrics()` |

## 3. Type Definitions

### `MetricsResult` (`core/types.ts`)

```typescript
interface MetricsResult {
  input_tokens: number | null;         // from message_start or final chunk usage
  output_tokens: number | null;        // from message_delta or final chunk usage
  cache_creation_tokens: number | null;
  cache_read_tokens: number | null;
  cache_read_tokens_estimated?: number;
  ttft_ms: number | null;             // time to first content token
  total_duration_ms: number | null;   // T6 - T0 (proxy end-to-end)
  tokens_per_second: number | null;   // @deprecated: use total_tps
  stop_reason: string | null;         // extracted from finish_reason / delta.stop_reason / status
  is_complete: number;                // 0 or 1
  // Two-phase TPS:
  thinking_tokens: number | null;
  thinking_duration_ms: number | null;
  thinking_tps: number | null;
  non_thinking_duration_ms: number | null;
  non_thinking_tps: number | null;
  total_tps: number | null;
  // Content counts (for analysis only):
  text_tokens: number | null;
  tool_use_tokens: number | null;
}
```

### `StreamMetricsSnapshot` (`core/monitor/types.ts`)

```typescript
interface StreamMetricsSnapshot {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheReadTokensEstimated?: number;
  ttftMs: number | null;
  tokensPerSecond: number | null;
  stopReason: string | null;
  isComplete: boolean;
  // Two-phase TPS breakdown:
  thinkingTokens: number | null;
  thinkingDurationMs: number | null;
  thinkingTps: number | null;
  nonThinkingDurationMs: number | null;
  nonThinkingTps: number | null;
  totalTps: number | null;
  // Content counts:
  textTokens: number | null;
  toolUseTokens: number | null;
}
```

### `request_logs` table (from migration chain + `logs.ts`)

| Column | Type | Source |
|--------|------|--------|
| id | TEXT PK | `randomUUID()` |
| api_type | TEXT | "openai" / "openai-responses" / "anthropic" |
| model | TEXT | client_model |
| provider_id | TEXT | provider.id |
| status_code | INTEGER | HTTP status |
| client_status_code | INTEGER | actual status sent to client (migration 025) |
| latency_ms | INTEGER | Date.now() - startTime |
| is_stream | INTEGER | 0/1 |
| error_message | TEXT | extracted from upstream error |
| created_at | TEXT | ISO 8601 |
| client_request | TEXT | JSON (sanitized headers + body) |
| upstream_request | TEXT | JSON (url + sanitized headers + body) |
| upstream_response | TEXT | JSON (statusCode + headers + body) |
| is_retry | INTEGER | 0/1 |
| is_failover | INTEGER | 0/1 |
| original_request_id | TEXT | root log ID for retry/failover chains |
| router_key_id | TEXT | FK to router_keys |
| original_model | TEXT | original client model |
| session_id | TEXT | from client detection hook |
| pipeline_snapshot | TEXT | JSON stages |
| input_tokens | INTEGER | denormalized from request_metrics (migration 021) |
| output_tokens | INTEGER | denormalized |
| cache_read_tokens | INTEGER | denormalized |
| ttft_ms | INTEGER | denormalized |
| tokens_per_second | REAL | denormalized |
| stop_reason | TEXT | denormalized |
| backend_model | TEXT | denormalized |
| metrics_complete | INTEGER | denormalized is_complete |
| stream_text_content | TEXT | accumulated stream text (migration 021) |

### `request_metrics` table (migration 006 + 021 + 031 + 032 + 043)

| Column | Type | Source |
|--------|------|--------|
| id | TEXT PK | `randomUUID()` |
| request_log_id | TEXT UNIQUE FK | FK → request_logs.id ON DELETE CASCADE |
| provider_id | TEXT | |
| backend_model | TEXT | |
| api_type | TEXT | |
| router_key_id | TEXT | migration 043 |
| status_code | INTEGER | migration 021 |
| input_tokens | INTEGER | |
| output_tokens | INTEGER | |
| cache_creation_tokens | INTEGER | |
| cache_read_tokens | INTEGER | |
| ttft_ms | INTEGER | |
| total_duration_ms | INTEGER | |
| tokens_per_second | REAL | @deprecated: use total_tps |
| stop_reason | TEXT | |
| is_complete | INTEGER | default 1 |
| input_tokens_estimated | INTEGER | migration 030 |
| client_type | TEXT | migration 043, default 'unknown' |
| cache_read_tokens_estimated | INTEGER | migration 043, default 0 |
| thinking_tokens | INTEGER | migration 031 |
| text_tokens | INTEGER | migration 031 |
| tool_use_tokens | INTEGER | migration 031 |
| thinking_duration_ms | INTEGER | migration 031 |
| text_duration_ms | INTEGER | migration 031 (column exists, not populated) |
| tool_use_duration_ms | INTEGER | migration 031 (column exists, not populated) |
| thinking_tps | REAL | migration 031 |
| text_tps | REAL | migration 031 (column exists, not populated) |
| tool_use_tps | REAL | migration 031 (column exists, not populated) |
| total_tps | REAL | migration 031 |
| non_thinking_duration_ms | INTEGER | migration 032 |
| non_thinking_tps | REAL | migration 032 |
| created_at | TEXT | `datetime('now')` |

## 4. Data Flow Patterns

### SSE → Metrics → DB → Monitor (complete pipeline)

```
upstream HTTP response
     │
     ▼
callStream() → StreamProxy.onData(chunk)
     │
     ├──► SSEMetricsTransform._transform(chunk)
     │        │
     │        ├──► SSEParser.feed(chunk) → SSEEvent[]
     │        │         │
     │        │         ▼
     │        │    MetricsExtractor.processEvent(event)
     │        │         │
     │        │         ├── processOpenAIEvent: finish_reason → stopReason, streamEndTime
     │        │         ├── processAnthropicEvent: message_delta.delta.stop_reason → stopReason
     │        │         ├── processResponsesEvent: response.completed → stopReason
     │        │         └── all: track firstContent → ttftMs, usage tokens
     │        │
     │        └── throttled onMetrics callback →
     │               tracker.update(logId, { streamMetrics: toStreamMetrics(m) })
     │
     ├──► onChunk callback → tracker.appendStreamChunk(rawLine)
     │        │
     │        └──► StreamContentAccumulator.append(rawLine)
     │               → extractStreamText(rawLine) → ContentBlock[]
     │               → rawChunks / textContent / totalChars / blocks
     │
     └──► pipeEntry.write(chunk) → reply.raw.write(chunk)
```

### `StreamProxy.onEnd()` flow (terminal event):

```
onEnd()
  │
  ├──► metricsTransform.flushParser()  ← KEY: ensures [DONE]/message_stop processed
  ├──► extractor.getMetrics() ← final MetricsResult
  ├──► terminal("stream_success", { metrics }, deferred=true)
  │       │
  │       └──► resolve(TransportResult)  ──→ microtask: logResilienceResult()
  │                                              collectTransportMetrics()
  │                                                    │
  │                                                    ├──► insertMetrics(db, {
  │                                                    │        ...result.metrics,
  │                                                    │        stop_reason, is_complete, tokens, ...
  │                                                    │     })
  │                                                    │
  │                                                    └──► tracker.update(logId, { streamMetrics })
  │
  └──→ setImmediate() → pipeEntry.end()
                          → endReply()
```

### `collectTransportMetrics()` flow:

```
collectTransportMetrics()
  │
  ├── isStream && (stream_success || stream_abort)  ← path A
  │     └── extractFn(result.metrics)  →  insertMetrics(db, { ...metrics, stop_reason, is_complete, ... })
  │
  ├── nonStream && kind === "success"  ← path B
  │     └── MetricsExtractor.fromNonStreamResponse() → insertMetrics(...)
  │
  └── fallback (no metrics) → insertMetrics(db, { is_complete: 0 })
```

### Stream proxy `onEnd()` deferred resolve chain:

```
StreamProxy.onEnd()
  │
  ├── flushParser()             ⑴ ← SSE buffer flushed → [DONE] / message_stop processed
  ├── collectMetrics(true)      ⑵ ← final metrics with is_complete=1
  ├── terminal("stream_success") ⑶ ← deferred=true
  │     └── resolve(result)      ⑷ ← microtask: logging writes
  └── setImmediate(endReply)     ⑸ ← macrotask: reply.raw.end()
```

## 5. Key Dependencies (Import Graph)

```
transport-fn.ts
  ├── SSEMetricsTransform (metrics/sse-metrics-transform.ts)
  │     ├── SSEParser (metrics/sse-parser.ts)
  │     └── MetricsExtractor (metrics/metrics-extractor.ts)
  └── StreamProxy (proxy/transport/stream.ts)

failover-loop.ts
  ├── transport-fn.ts
  ├── logResilienceResult (proxy/proxy-logging.ts)
  ├── collectTransportMetrics (proxy/proxy-logging.ts)
  ├── updateLogStreamContent (db/logs.ts)
  └── RequestTracker (core/monitor/request-tracker.ts)
       └── StreamContentAccumulator (core/monitor/stream-content-accumulator.ts)
            └── extractStreamText (core/monitor/stream-extractor.ts)

proxy-logging.ts
  ├── logResilienceResult → insertRequestLog (db/logs.ts)
  └── collectTransportMetrics → insertMetrics (db/metrics.ts)
       └── MetricsExtractor.fromNonStreamResponse
```

## 6. Known Issues & Observations

### stop_reason extraction
- **OpenAI**: extracted from `choices[0].finish_reason` in the final delta chunk. If upstream sends `finish_reason: null` in an intermediate chunk before the real finish_reason, the last non-null value wins (since `processOpenAIEvent` overwrites `this.stopReason` each time `choice.finish_reason` is truthy). This is correct.
- **Anthropic**: extracted from `message_delta.delta.stop_reason`. Two events end the stream: `message_delta` (has stop_reason + output_tokens) then `message_stop` (only signals complete). `streamEndTime` is set in `message_delta`, `complete=true` in `message_stop`.
- **OpenAI Responses**: extracted from `response.completed` (status=completed→"end_turn") or `response.incomplete` (status=incomplete→"max_tokens"). The `response.completed` event has `this.complete = true` set.

### is_complete issues (migration 046)
- **Historical bug**: `StreamProxy.onEnd()` called `getMetrics()` before `flushParser()`, so `metrics-extractor.ts`'s `complete` flag was always `false` for OpenAI SSE ([DONE] never processed). Fix applied to historical data (migration 046) and code path (`collectMetrics()` calls `flushParser()` first).
- However, the `flushParser()` → `getMetrics()` ordering dependency should be explicitly enforced. If `flushParser()` or `getMetrics()` order changes, `is_complete` will silently regress.

### stream timestamps (stream_ts)
- **No explicit stream timestamps are stored in DB**. The `MetricsResult` stores `total_duration_ms` (T6 - T0), `ttft_ms`, `thinking_duration_ms`, `non_thinking_duration_ms`, but there is **no persisted `stream_start_ts` or `stream_end_ts` column** in either `request_metrics` or `request_logs`.
- `streamEndTime` and `streamStartTime` are tracked as private fields in `MetricsExtractor` and used for `total_duration_ms` calculation, but their raw timestamps are never persisted.
- `startTime` (request start) is passed through the chain as `number` (Date.now()) but only `latency_ms` (difference) is stored.

### terminal/extra event fields
- **`text_duration_ms`, `tool_use_duration_ms`, `text_tps`, `tool_use_tps`**: Columns exist in `request_metrics` (migration 031) but are **never populated**. The code in `metrics-extractor.ts` computes `textTokens` and `toolUseTokens` but does NOT store `text_duration_ms` or `tool_use_duration_ms`. The TPS model simplified to thinking/non-thinking (migration 032) abandoned these individual durations.
- **`stream_text_content`**: Written post-hoc in `failover-loop.ts` via `updateLogStreamContent()`. This is a **second pass** — the function reads `tracker.get(logId)?.streamContent` and serializes blocks. This is redundant with the content already tracked in `StreamContentAccumulator`.

### SSE flush safety
- **Timing dependency in `onEnd()`**: `StreamProxy.onEnd()` defers `reply.raw.end()` to `setImmediate` (macrotask) while `terminal()` resolves the promise (microtask). This is correct for ensuring `logResilienceResult` runs before reply closes. However:
  - `onEnd()` calls `collectMetrics(true)` before `terminal("stream_success", { metrics }, true)`.
  - `collectMetrics(true)` internally calls `flushParser()` then `getMetrics()` — the `isComplete` flag is determined by whether `[DONE]` (OpenAI) or `message_stop` (Anthropic) has been processed.
  - If `flushParser()` doesn't find trailing data (e.g., upstream sends final chunk without proper `\n\n`), the `isDone` flag may never be set, leading to `is_complete=0` in DB.
- **`flushParser()` for Anthropic** handles `message_stop` which sets `this.complete = true` in extractor. For OpenAI, `[DONE]` is detected in `SSEParser.parseBlock()` which sets `isDone=true`, and then in `processOpenAIEvent()` which sets `this.complete = true`.

### StreamMetricsSnapshot → update path
- `transport-fn.ts` uses `onMetrics` callback (from `SSEMetricsTransform`) to update `tracker.update(logId, { streamMetrics: ... })` — this pushes intermediate metrics (throttled 5000ms).
- After stream completes, `transport-fn.ts` checks `streamResult.metrics` and calls `tracker.update()` again with final metrics.
- **Race**: `onMetrics` callback fires inside `_transform` while `collectTransportMetrics` runs later. The final `streamResult.metrics` from `collectMetrics(true)` is the authoritative source for DB persistence, while `onMetrics` updates are for live monitoring only.
- **`toStreamMetrics()`** in `transport-fn.ts` converts `MetricsResult` (snake_case) → `StreamMetricsSnapshot` (camelCase). `is_complete` → `isComplete: m.is_complete === 1`.

### Migration 046 data fix
- SQL patch retroactively sets `is_complete=1` for records where `is_complete=0` but `status_code=200 AND output_tokens>0 AND total_duration_ms>0`. This covers the historical bug where `flushParser()` was called after `getMetrics()`.

### column gap: `text_duration_ms`, `tool_use_duration_ms`, `text_tps`, `tool_use_tps`
- These columns exist in `request_metrics` (migration 031) but are **never written**. The TPS breakdown switched to thinking/non-thinking model in migration 032. These 4 columns are dead schema.

### `stop_reason` not propagated through format transforms
- When transforms (e.g., OpenAI→Anthropic format) are active, the `stop_reason` from the upstream provider's metrics extraction is used directly. The transform layer does NOT remap stop_reason values.

### `is_complete` vs `complete` naming inconsistency
- `MetricsResult.is_complete` is `number` (0|1). `StreamMetricsSnapshot.isComplete` is `boolean`. The conversion `m.is_complete === 1` in `toStreamMetrics()` handles this correctly.

### `cache_read_tokens_estimated` flow
- In `collectTransportMetrics`, if upstream does not return cache tokens AND `getTokenEstimationEnabled(db)` is true, it first checks pipeline metadata `_cachedCacheTokens` (from cache-estimation hook), then falls back to `cacheEstimator.estimateHit()`. Result written to `metrics.cache_read_tokens_estimated = 1`.

### `stream_text_content` written post-hoc in failover-loop
- The `updateLogStreamContent()` call in `failover-loop.ts` reads from `tracker.get(logId)?.streamContent` and serializes using `serializeBlocksForStorage()`. This is done **after** `logResilienceResult` and `collectTransportMetrics`, so it's an independent write operation via a separate SQL UPDATE.
