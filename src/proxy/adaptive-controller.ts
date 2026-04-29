import type { ProviderSemaphoreManager } from "./semaphore.js";

export interface AdaptiveState {
  currentLimit: number;
  probeActive: boolean;
  consecutiveSuccesses: number;
  consecutiveFailures: number;
  cooldownUntil: number;
}

interface AdaptiveResult {
  success: boolean;
  statusCode?: number;
}

const SUCCESS_THRESHOLD = 3;
const FAILURE_THRESHOLD = 3;
const DECREASE_STEP = 2;
const COOLDOWN_MS = 30_000;
const RATE_LIMIT_STATUS = 429;
const HALF_DIVISOR = 2;

const ADAPTIVE_MIN = 1;

interface AdaptiveEntry {
  state: AdaptiveState;
  max: number;
  queueTimeoutMs: number;
  maxQueueSize: number;
}

export interface ProviderAdaptiveConfig {
  adaptive_enabled: number;
  max_concurrency: number;
  queue_timeout_ms: number;
  max_queue_size: number;
}

export interface ControllerLogger {
  debug(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

export class AdaptiveConcurrencyController {
  private readonly entries = new Map<string, AdaptiveEntry>();

  constructor(
    private semaphoreManager: ProviderSemaphoreManager,
    private logger?: ControllerLogger,
  ) {}

  init(providerId: string, config: { max: number }, semParams: { queueTimeoutMs: number; maxQueueSize: number }): void {
    this.entries.set(providerId, {
      state: {
        currentLimit: ADAPTIVE_MIN,
        probeActive: false,
        consecutiveSuccesses: 0,
        consecutiveFailures: 0,
        cooldownUntil: 0,
      },
      max: config.max,
      queueTimeoutMs: semParams.queueTimeoutMs,
      maxQueueSize: semParams.maxQueueSize,
    });
    this.syncToSemaphore(providerId);
  }

  remove(providerId: string): void {
    this.entries.delete(providerId);
  }

  onRequestComplete(providerId: string, result: AdaptiveResult): void {
    const entry = this.entries.get(providerId);
    if (!entry) return;
    if (result.success) {
      this.transitionSuccess(providerId, entry);
    } else {
      this.transitionFailure(providerId, entry, result.statusCode);
    }
  }

  getStatus(providerId: string): AdaptiveState | undefined {
    return this.entries.get(providerId)?.state;
  }

  syncProvider(providerId: string, p: ProviderAdaptiveConfig): void {
    if (p.adaptive_enabled) {
      const existing = this.entries.get(providerId);
      if (existing) {
        existing.max = p.max_concurrency;
        existing.queueTimeoutMs = p.queue_timeout_ms;
        existing.maxQueueSize = p.max_queue_size;
        existing.state.currentLimit = Math.min(
          Math.max(existing.state.currentLimit, ADAPTIVE_MIN), existing.max,
        );
        this.syncToSemaphore(providerId);
      } else {
        this.init(providerId, { max: p.max_concurrency }, {
          queueTimeoutMs: p.queue_timeout_ms, maxQueueSize: p.max_queue_size,
        });
      }
    } else {
      this.remove(providerId);
      // 禁用自适应后恢复信号量到原始 max_concurrency
      this.semaphoreManager.updateConfig(providerId, {
        maxConcurrency: p.max_concurrency,
        queueTimeoutMs: p.queue_timeout_ms,
        maxQueueSize: p.max_queue_size,
      });
    }
  }

  private transitionSuccess(providerId: string, entry: AdaptiveEntry): void {
    const s = entry.state;
    s.consecutiveSuccesses++;
    s.consecutiveFailures = 0;
    if (Date.now() < s.cooldownUntil) return;

    if (s.consecutiveSuccesses >= SUCCESS_THRESHOLD) {
      if (!s.probeActive) {
        s.probeActive = true;
        s.consecutiveSuccesses = 0;
        this.logger?.debug({ providerId, currentLimit: s.currentLimit, action: "probe_open" }, "Adaptive: probe window opened");
      } else {
        s.currentLimit = Math.min(s.currentLimit + 1, entry.max);
        s.consecutiveSuccesses = 0;
        this.logger?.debug({ providerId, currentLimit: s.currentLimit, max: entry.max, action: "limit_increased" }, "Adaptive: limit increased by 1");
      }
      this.syncToSemaphore(providerId);
    }
  }

  private transitionFailure(providerId: string, entry: AdaptiveEntry, statusCode?: number): void {
    const s = entry.state;
    s.consecutiveFailures++;
    s.consecutiveSuccesses = 0;

    if (statusCode === RATE_LIMIT_STATUS) {
      const prevLimit = s.currentLimit;
      s.currentLimit = Math.max(Math.floor(s.currentLimit / HALF_DIVISOR), ADAPTIVE_MIN);
      s.probeActive = false;
      s.cooldownUntil = Date.now() + COOLDOWN_MS;
      s.consecutiveFailures = 0;
      this.syncToSemaphore(providerId);
      this.logger?.warn({ providerId, prevLimit, newLimit: s.currentLimit, cooldownMs: COOLDOWN_MS, action: "rate_limit_backoff" }, "Adaptive: 429 rate limit, halved concurrency and entered cooldown");
    } else if (s.consecutiveFailures >= FAILURE_THRESHOLD) {
      const prevLimit = s.currentLimit;
      s.currentLimit = Math.max(s.currentLimit - DECREASE_STEP, ADAPTIVE_MIN);
      s.probeActive = false;
      s.consecutiveFailures = 0;
      this.syncToSemaphore(providerId);
      this.logger?.warn({ providerId, prevLimit, newLimit: s.currentLimit, action: "failure_backoff" }, "Adaptive: sustained failures, decreased concurrency");
    }
  }

  private syncToSemaphore(providerId: string): void {
    const entry = this.entries.get(providerId);
    if (!entry) return;
    // probeActive 时额外加 1 个探针槽位，但不超过 max
    const effectiveLimit = entry.state.probeActive
      ? Math.min(Math.max(entry.state.currentLimit + 1, ADAPTIVE_MIN), entry.max)
      : Math.max(entry.state.currentLimit, ADAPTIVE_MIN);
    this.semaphoreManager.updateConfig(providerId, {
      maxConcurrency: effectiveLimit,
      queueTimeoutMs: entry.queueTimeoutMs,
      maxQueueSize: entry.maxQueueSize,
    });
  }
}
