import type {
  ISemaphoreControl,
  AdaptiveState,
  AdaptiveResult,
  ProviderConcurrencyParams,
} from "./types.js";
import type { Logger } from "../types.js";

const SUCCESS_THRESHOLD = 3;
const FAILURE_THRESHOLD = 3;
const DECREASE_STEP = 2;
const COOLDOWN_MS = 30_000;
const RATE_LIMIT_STATUS = 429;
const HALF_DIVISOR = 2;
const HTTP_SERVER_ERROR_MIN = 500;

const ADAPTIVE_MIN = 1;

interface AdaptiveEntry {
  state: AdaptiveState;
  max: number;
  queueTimeoutMs: number;
  maxQueueSize: number;
}

export class AdaptiveController {
  private readonly entries = new Map<string, AdaptiveEntry>();

  constructor(
    private semaphoreControl: ISemaphoreControl,
    private logger?: Logger,
  ) {}

  init(providerId: string, config: { max: number }, semParams: { queueTimeoutMs: number; maxQueueSize: number }): void {
    const initialLimit = config.max;
    this.entries.set(providerId, {
      state: {
        currentLimit: initialLimit,
        probeActive: true,
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

  /** 移除 provider 的自适应并发状态。调用方还需调用 semaphoreManager.remove() 或 updateConfig() 清理信号量配置。 */
  remove(providerId: string): void {
    this.entries.delete(providerId);
  }

  /** 清除所有 provider 的自适应并发状态（导入配置后重建前调用） */
  removeAll(): void {
    this.entries.clear();
  }

  onRequestComplete(providerId: string, result: AdaptiveResult): void {
    const entry = this.entries.get(providerId);
    if (!entry) return;
    if (result.success) {
      this.transitionSuccess(providerId, entry, result);
    } else {
      this.transitionFailure(providerId, entry, result);
    }
  }

  getStatus(providerId: string): AdaptiveState | undefined {
    return this.entries.get(providerId)?.state;
  }

  syncProvider(providerId: string, p: ProviderConcurrencyParams): void {
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
      this.semaphoreControl.updateConfig(providerId, {
        maxConcurrency: p.max_concurrency,
        queueTimeoutMs: p.queue_timeout_ms,
        maxQueueSize: p.max_queue_size,
      });
    }
  }

  private transitionSuccess(providerId: string, entry: AdaptiveEntry, result: AdaptiveResult): void {
    const s = entry.state;
    s.consecutiveSuccesses++;
    s.consecutiveFailures = 0;
    if (Date.now() < s.cooldownUntil) return;

    if (s.consecutiveSuccesses >= SUCCESS_THRESHOLD) {
      if (!s.probeActive) {
        s.probeActive = true;
        s.consecutiveSuccesses = 0;
        const effective = Math.min(Math.max(s.currentLimit + 1, ADAPTIVE_MIN), entry.max);
        this.logger?.info?.({ providerId, requestId: result.requestId, prevLimit: s.currentLimit, newLimit: s.currentLimit, effectiveLimit: effective, action: "probe_open" }, "Adaptive: probe window opened");
      } else {
        const prevLimit = s.currentLimit;
        s.currentLimit = Math.min(s.currentLimit + 1, entry.max);
        s.consecutiveSuccesses = 0;
        const effective = Math.min(Math.max(s.currentLimit + 1, ADAPTIVE_MIN), entry.max);
        this.logger?.info?.({ providerId, requestId: result.requestId, prevLimit, newLimit: s.currentLimit, effectiveLimit: effective, max: entry.max, action: "limit_increased" }, "Adaptive: limit increased by 1");
      }
      this.syncToSemaphore(providerId);
    }
  }

  private transitionFailure(providerId: string, entry: AdaptiveEntry, result: AdaptiveResult): void {
    const statusCode = result.statusCode;
    // 过滤非并发相关的错误：
    // - retryRuleMatched=true → resilience 层根据重试规则判断为可重试的失败，计入退避
    // - 429: 限流，计入退避
    // - 5xx: 服务端错误（可能过载），计入退避
    // - undefined: 网络异常，计入退避
    // - 2xx/4xx 且 retryRuleMatched!=true: 非并发问题（如 upstream 200 body error 但未命中重试规则），不触发退避
    if (!result.retryRuleMatched && statusCode !== undefined && statusCode !== RATE_LIMIT_STATUS && statusCode < HTTP_SERVER_ERROR_MIN) {
      this.logger?.debug?.({ providerId, statusCode, action: "failure_ignored" }, "Adaptive: non-concurrency failure ignored");
      return;
    }

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
      this.logger?.warn?.({ providerId, requestId: result.requestId, prevLimit, newLimit: s.currentLimit, cooldownMs: COOLDOWN_MS, statusCode, action: "rate_limit_backoff" }, "Adaptive: 429 rate limit, halved concurrency and entered cooldown");
    } else if (s.consecutiveFailures >= FAILURE_THRESHOLD) {
      const prevLimit = s.currentLimit;
      s.currentLimit = Math.max(s.currentLimit - DECREASE_STEP, ADAPTIVE_MIN);
      s.probeActive = false;
      s.consecutiveFailures = 0;
      this.syncToSemaphore(providerId);
      this.logger?.warn?.({ providerId, requestId: result.requestId, prevLimit, newLimit: s.currentLimit, statusCode, retryRuleMatched: result.retryRuleMatched ?? false, action: "failure_backoff" }, "Adaptive: sustained failures, decreased concurrency");
    }
  }

  private syncToSemaphore(providerId: string): void {
    const entry = this.entries.get(providerId);
    if (!entry) return;
    // probeActive 时额外加 1 个探针槽位，但不超过 max
    const effectiveLimit = entry.state.probeActive
      ? Math.min(Math.max(entry.state.currentLimit + 1, ADAPTIVE_MIN), entry.max)
      : Math.max(entry.state.currentLimit, ADAPTIVE_MIN);
    this.semaphoreControl.updateConfig(providerId, {
      maxConcurrency: effectiveLimit,
      queueTimeoutMs: entry.queueTimeoutMs,
      maxQueueSize: entry.maxQueueSize,
    });
  }
}
