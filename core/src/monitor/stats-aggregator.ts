import type { StatsSnapshot, ProviderStats } from "./types.js";

/**
 * Fixed-size circular buffer for latency samples.
 * Overwrites oldest entries when full — O(1) append.
 */
class RingBuffer {
  private buf: number[];
  private head = 0; // next write position
  private len = 0;

  constructor(private capacity: number) {
    this.buf = new Array(capacity);
  }

  push(value: number): void {
    this.buf[this.head] = value;
    this.head = (this.head + 1) % this.capacity;
    if (this.len < this.capacity) this.len++;
  }

  /** Returns a sorted copy of current values. */
  sorted(): number[] {
    const slice = this.buf.slice(0, this.len);
    slice.sort((a, b) => a - b);
    return slice;
  }

  clear(): void {
    this.head = 0;
    this.len = 0;
  }
}

interface ProviderAccumulator {
  totalRequests: number;
  successCount: number;
  errorCount: number;
  retryCount: number;
  latencyBuffer: RingBuffer;
  errorsByCode: Map<number, number>;
}

function emptyAccumulator(): ProviderAccumulator {
  return {
    totalRequests: 0,
    successCount: 0,
    errorCount: 0,
    retryCount: 0,
    latencyBuffer: new RingBuffer(PROVIDER_LATENCY_CAPACITY),
    errorsByCode: new Map(),
  };
}

const TOP_ERRORS_LIMIT = 5;

const DEFAULT_CAPACITY = 1000;
const PROVIDER_LATENCY_CAPACITY = 200;
const HTTP_SUCCESS_RANGE_MIN = 200;
const HTTP_SUCCESS_RANGE_MAX = 400;
const PERCENTILE_P50 = 0.5;
const PERCENTILE_P99 = 0.99;

export class StatsAggregator {
  private latencyBuffer: RingBuffer;
  private totalRequests = 0;
  private successCount = 0;
  private errorCount = 0;
  private retryCount = 0;
  private failoverCount = 0;
  private byStatusCode: Map<number, number> = new Map();
  private providers: Map<string, ProviderAccumulator> = new Map();
  private providerNames: Map<string, string> = new Map();

  constructor(capacity = DEFAULT_CAPACITY) {
    this.latencyBuffer = new RingBuffer(Math.max(1, capacity));
  }

  recordLatency(ms: number): void {
    this.latencyBuffer.push(ms);
  }

  recordRequest(
    providerId: string,
    providerName: string,
    statusCode: number,
    isRetry: boolean,
    isFailover: boolean,
  ): void {
    this.totalRequests++;
    this.providerNames.set(providerId, providerName);

    // Global status code counters
    this.byStatusCode.set(
      statusCode,
      (this.byStatusCode.get(statusCode) ?? 0) + 1,
    );

    if (statusCode >= HTTP_SUCCESS_RANGE_MIN && statusCode < HTTP_SUCCESS_RANGE_MAX) {
      this.successCount++;
    } else {
      this.errorCount++;
    }

    if (isRetry) this.retryCount++;
    if (isFailover) this.failoverCount++;

    // Per-provider accumulator
    let acc = this.providers.get(providerId);
    if (!acc) {
      acc = emptyAccumulator();
      this.providers.set(providerId, acc);
    }
    acc.totalRequests++;
    if (statusCode >= HTTP_SUCCESS_RANGE_MIN && statusCode < HTTP_SUCCESS_RANGE_MAX) {
      acc.successCount++;
    } else {
      acc.errorCount++;
      acc.errorsByCode.set(
        statusCode,
        (acc.errorsByCode.get(statusCode) ?? 0) + 1,
      );
    }
    if (isRetry) acc.retryCount++;
  }

  /**
   * Associate a latency sample with a provider for per-provider avgLatencyMs.
   * Must be called alongside recordRequest for accurate per-provider latency.
   */
  recordProviderLatency(providerId: string, ms: number): void {
    let acc = this.providers.get(providerId);
    if (!acc) {
      acc = emptyAccumulator();
      this.providers.set(providerId, acc);
    }
    acc.latencyBuffer.push(ms);
  }

  getStats(): StatsSnapshot {
    const sorted = this.latencyBuffer.sorted();
    const count = sorted.length;

    const avgLatencyMs =
      count > 0 ? sorted.reduce((s, v) => s + v, 0) / count : 0;
    const p50LatencyMs = count > 0 ? percentile(sorted, PERCENTILE_P50) : 0;
    const p99LatencyMs = count > 0 ? percentile(sorted, PERCENTILE_P99) : 0;

    const byProvider: Record<string, ProviderStats> = {};
    for (const [id, acc] of this.providers) {
      const topErrors = [...acc.errorsByCode.entries()]
        .map(([code, count]) => ({ code, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, TOP_ERRORS_LIMIT);

      byProvider[id] = {
        providerName: this.providerNames.get(id) ?? id,
        totalRequests: acc.totalRequests,
        successCount: acc.successCount,
        errorCount: acc.errorCount,
        avgLatencyMs: avgFromBuffer(acc.latencyBuffer),
        retryCount: acc.retryCount,
        topErrors,
      };
    }

    const byStatusCode: Record<number, number> = {};
    for (const [code, cnt] of this.byStatusCode) {
      byStatusCode[code] = cnt;
    }

    return {
      totalRequests: this.totalRequests,
      successCount: this.successCount,
      errorCount: this.errorCount,
      retryCount: this.retryCount,
      failoverCount: this.failoverCount,
      avgLatencyMs,
      p50LatencyMs,
      p99LatencyMs,
      byProvider,
      byStatusCode,
    };
  }

  reset(): void {
    this.latencyBuffer.clear();
    this.totalRequests = 0;
    this.successCount = 0;
    this.errorCount = 0;
    this.retryCount = 0;
    this.failoverCount = 0;
    this.byStatusCode.clear();
    this.providers.clear();
    this.providerNames.clear();
  }
}

/** Nearest-rank percentile on a pre-sorted ascending array. */
function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

function avgFromBuffer(buf: RingBuffer): number {
  const sorted = buf.sorted();
  return sorted.length > 0 ? sorted.reduce((s, v) => s + v, 0) / sorted.length : 0;
}
