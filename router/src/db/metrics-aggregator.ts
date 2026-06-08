import Database from "better-sqlite3";

// --- Constants ---

const MS_PER_SEC = 1000;
const BUCKET_SEC = 600; // 10 minutes
const TRIGGER_OFFSET_SEC = 300; // 5 minutes after bucket boundary
const TRIGGER_MINUTE_VALUES = "5,15,25,35,45,55";
const TRIGGER_MINUTES = TRIGGER_MINUTE_VALUES.split(",").map(Number);

function computeMsToNextTrigger(): number {
  const now = new Date();
  const min = now.getMinutes();
  const triggers = TRIGGER_MINUTES;
  let nextMin = triggers.find((t) => t > min);
  let addHours = 0;
  if (nextMin === undefined) {
    nextMin = triggers[0];
    addHours = 1;
  }
  const target = new Date(now);
  target.setMinutes(nextMin, 0, 0);
  target.setHours(target.getHours() + addHours);
  return target.getTime() - now.getTime();
}

export interface MetricsAggregatorHandle {
  stop: () => void;
}

/**
 * Aggregate request_metrics from the previous bucket into metrics_10min.
 *
 * Bucket boundaries are at :00, :10, :20, :30, :40, :50.
 * The aggregator runs at :05, :15, :25, :35, :45, :55 — 5 minutes after
 * the bucket boundary, ensuring all data for that bucket has landed.
 *
 * It computes the bucket that just closed: the one whose boundary
 * was 5 minutes ago (i.e., floor((now - 5min) / 600) * 600).
 */
function runAggregation(db: Database.Database, log: { warn: (msg: string) => void; info: (msg: string) => void }): void {
  const nowMs = Date.now();
  // The bucket that just ended: its start boundary is floor((now - 5min) / 600) * 600
  const bucketStartSec = Math.floor((nowMs / MS_PER_SEC - TRIGGER_OFFSET_SEC) / BUCKET_SEC) * BUCKET_SEC;
  const bucketEndSec = bucketStartSec + BUCKET_SEC;
  const bucketStart = new Date(bucketStartSec * MS_PER_SEC).toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
  const bucketEnd = new Date(bucketEndSec * MS_PER_SEC).toISOString().replace("T", " ").replace(/\.\d+Z$/, "");

  const result = db.prepare(`
    INSERT INTO metrics_10min (
      bucket_time, router_key_id, provider_id, backend_model, client_type, api_type,
      request_count, sum_input_tokens, sum_output_tokens, sum_cache_read_tokens,
      sum_cache_creation_tokens, sum_total_duration_ms, sum_ttft_ms,
      sum_thinking_tokens, sum_text_tokens, sum_tool_use_tokens,
      sum_thinking_duration_ms, sum_text_duration_ms, sum_tool_use_duration_ms
    )
    SELECT
      datetime(?),
      COALESCE(rm.router_key_id, ''),
      rm.provider_id,
      rm.backend_model,
      rm.client_type,
      rm.api_type,
      COUNT(*),
      COALESCE(SUM(rm.input_tokens), 0),
      COALESCE(SUM(rm.output_tokens), 0),
      COALESCE(SUM(rm.cache_read_tokens), 0),
      COALESCE(SUM(rm.cache_creation_tokens), 0),
      COALESCE(SUM(rm.total_duration_ms), 0),
      COALESCE(SUM(rm.ttft_ms), 0),
      COALESCE(SUM(rm.thinking_tokens), 0),
      COALESCE(SUM(rm.text_tokens), 0),
      COALESCE(SUM(rm.tool_use_tokens), 0),
      COALESCE(SUM(rm.thinking_duration_ms), 0),
      COALESCE(SUM(rm.text_duration_ms), 0),
      COALESCE(SUM(rm.tool_use_duration_ms), 0)
    FROM request_metrics rm
    WHERE rm.created_at >= ? AND rm.created_at < ?
    GROUP BY
      COALESCE(rm.router_key_id, ''),
      rm.provider_id,
      rm.backend_model,
      rm.client_type,
      rm.api_type
    ON CONFLICT (bucket_time, router_key_id, provider_id, backend_model, client_type, api_type)
    DO UPDATE SET
      request_count = request_count + excluded.request_count,
      sum_input_tokens = sum_input_tokens + excluded.sum_input_tokens,
      sum_output_tokens = sum_output_tokens + excluded.sum_output_tokens,
      sum_cache_read_tokens = sum_cache_read_tokens + excluded.sum_cache_read_tokens,
      sum_cache_creation_tokens = sum_cache_creation_tokens + excluded.sum_cache_creation_tokens,
      sum_total_duration_ms = sum_total_duration_ms + excluded.sum_total_duration_ms,
      sum_ttft_ms = sum_ttft_ms + excluded.sum_ttft_ms,
      sum_thinking_tokens = sum_thinking_tokens + excluded.sum_thinking_tokens,
      sum_text_tokens = sum_text_tokens + excluded.sum_text_tokens,
      sum_tool_use_tokens = sum_tool_use_tokens + excluded.sum_tool_use_tokens,
      sum_thinking_duration_ms = sum_thinking_duration_ms + excluded.sum_thinking_duration_ms,
      sum_text_duration_ms = sum_text_duration_ms + excluded.sum_text_duration_ms,
      sum_tool_use_duration_ms = sum_tool_use_duration_ms + excluded.sum_tool_use_duration_ms
  `).run(bucketStart, bucketStart, bucketEnd);

  if (result.changes > 0) {
    log.info(`Metrics aggregator: bucket ${bucketStart} → ${result.changes} rows`);
  }
}

export function scheduleMetricsAggregator(
  db: Database.Database,
  log: { warn: (msg: string) => void; info: (msg: string) => void },
): MetricsAggregatorHandle {
  let stopped = false;
  let currentTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleNext = () => {
    if (stopped) return;
    const delay = computeMsToNextTrigger();
    currentTimer = setTimeout(() => {
      if (stopped) return;
      try {
        runAggregation(db, log);
      } catch (e) {
        log.warn(`Metrics aggregator skipped: ${e instanceof Error ? e.message : JSON.stringify(e)}`);
      }
      // Schedule the next run after this one completes
      scheduleNext();
    }, delay);
  };

  scheduleNext();

  return {
    stop: () => {
      stopped = true;
      if (currentTimer) { clearTimeout(currentTimer); currentTimer = null; }
    },
  };
}
