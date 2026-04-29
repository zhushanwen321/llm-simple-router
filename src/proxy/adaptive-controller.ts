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

interface AdaptiveEntry {
  state: AdaptiveState;
  min: number;
  max: number;
  queueTimeoutMs: number;
  maxQueueSize: number;
}

export interface ProviderAdaptiveConfig {
  adaptive_enabled: number;
  adaptive_min: number;
  max_concurrency: number;
  queue_timeout_ms: number;
  max_queue_size: number;
}

export class AdaptiveConcurrencyController {
  private readonly entries = new Map<string, AdaptiveEntry>();

  constructor(private semaphoreManager: ProviderSemaphoreManager) {}

  init(providerId: string, config: { min: number; max: number }, semParams: { queueTimeoutMs: number; maxQueueSize: number }): void {
    this.entries.set(providerId, {
      state: {
        currentLimit: config.min,
        probeActive: false,
        consecutiveSuccesses: 0,
        consecutiveFailures: 0,
        cooldownUntil: 0,
      },
      min: config.min,
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
        existing.min = p.adaptive_min;
        existing.max = p.max_concurrency;
        existing.queueTimeoutMs = p.queue_timeout_ms;
        existing.maxQueueSize = p.max_queue_size;
        existing.state.currentLimit = Math.min(
          Math.max(existing.state.currentLimit, existing.min), existing.max,
        );
        this.syncToSemaphore(providerId);
      } else {
        this.init(providerId, { min: p.adaptive_min, max: p.max_concurrency }, {
          queueTimeoutMs: p.queue_timeout_ms, maxQueueSize: p.max_queue_size,
        });
      }
    } else {
      this.remove(providerId);
    }
  }

  private transitionSuccess(providerId: string, entry: AdaptiveEntry): void {
    const s = entry.state;
    s.consecutiveSuccesses++;
    s.consecutiveFailures = 0;
    // 冷却期内只累加计数，不触发调整；过期后累积的成功计数可能立即触发 probe
    if (Date.now() < s.cooldownUntil) return;

    if (s.consecutiveSuccesses >= SUCCESS_THRESHOLD) {
      if (!s.probeActive) {
        s.probeActive = true;
        s.consecutiveSuccesses = 0;
      } else {
        s.currentLimit = Math.min(s.currentLimit + 1, entry.max);
        s.consecutiveSuccesses = 0;
      }
      this.syncToSemaphore(providerId);
    }
  }

  private transitionFailure(providerId: string, entry: AdaptiveEntry, statusCode?: number): void {
    const s = entry.state;
    s.consecutiveFailures++;
    s.consecutiveSuccesses = 0;

    if (statusCode === 429) {
      s.currentLimit = Math.max(Math.floor(s.currentLimit / 2), entry.min);
      s.probeActive = false;
      s.cooldownUntil = Date.now() + COOLDOWN_MS;
      s.consecutiveFailures = 0;
      this.syncToSemaphore(providerId);
    } else if (s.consecutiveFailures >= FAILURE_THRESHOLD) {
      s.currentLimit = Math.max(s.currentLimit - DECREASE_STEP, entry.min);
      s.probeActive = false;
      s.consecutiveFailures = 0;
      this.syncToSemaphore(providerId);
    }
  }

  private syncToSemaphore(providerId: string): void {
    const entry = this.entries.get(providerId);
    if (!entry) return;
    // probeActive 时额外加 1 个探针槽位，但不超过 max
    const effectiveLimit = entry.state.probeActive
      ? Math.min(entry.state.currentLimit + 1, entry.max)
      : entry.state.currentLimit;
    this.semaphoreManager.updateConfig(providerId, {
      maxConcurrency: effectiveLimit,
      queueTimeoutMs: entry.queueTimeoutMs,
      maxQueueSize: entry.maxQueueSize,
    });
  }
}
