import type {
  ISemaphoreControl,
  AdaptiveState,
  AdaptiveResult,
  ProviderConcurrencyParams,
} from "./types.js";
import type { Logger } from "../types.js";

const RATE_LIMIT_STATUS = 429;
const HTTP_SERVER_ERROR_MIN = 500;
const ADAPTIVE_MIN = 1;

// deriveProfile 参数常量
const CAPACITY_LOG_BASE = 7;
const CLIMB_BASE = 2;
const CLIMB_CAPACITY_WEIGHT = 2;
const CLIMB_LEVEL_WEIGHT = 2;
const DROP_BASE = 5;
const DROP_CAPACITY_WEIGHT = 2;
const DROP_LEVEL_WEIGHT = 2;
const COOLDOWN_BASE_MS = 10_000;
const COOLDOWN_LEVEL_MS = 10_000;
/** 满额时保留半数成功计数器的除数 */
const AT_MAX_COUNTER_HALVE_DIVISOR = 2;

interface AdaptiveEntry {
  state: AdaptiveState;
  max: number;
  queueTimeoutMs: number;
  maxQueueSize: number;
}

interface AdaptiveProfile {
  climbThreshold: number;
  dropThreshold: number;
  cooldownMs: number;
}

export class AdaptiveController {
  private readonly entries = new Map<string, AdaptiveEntry>();

  constructor(
    private semaphoreControl: ISemaphoreControl,
    private logger?: Logger,
  ) {}

  init(providerId: string, config: { max: number }, semParams: { queueTimeoutMs: number; maxQueueSize: number }): void {
    const max = this.clampMax(config.max);
    this.entries.set(providerId, {
      state: {
        currentLimit: max,
        consecutiveSuccesses: 0,
        consecutiveFailures: 0,
        cooldownUntil: 0,
      },
      max,
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
        const max = this.clampMax(p.max_concurrency);
        existing.max = max;
        existing.queueTimeoutMs = p.queue_timeout_ms;
        existing.maxQueueSize = p.max_queue_size;
        existing.state.currentLimit = Math.min(
          Math.max(existing.state.currentLimit, ADAPTIVE_MIN), max,
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

  /** 将 max_concurrency 钳制到 >= ADAPTIVE_MIN，防止 NaN/undefined 泄漏到 deriveProfile */
  private clampMax(value: number): number {
    const n = Number(value);
    return Number.isFinite(n) && n >= ADAPTIVE_MIN ? n : ADAPTIVE_MIN;
  }

  /** 根据当前位置和容量推导行为参数，实现水位梯度控制 */
  private deriveProfile(currentLimit: number, max: number): AdaptiveProfile {
    const level = Math.min(1, currentLimit / max);
    const capacity = Math.min(1, Math.log2(max) / CAPACITY_LOG_BASE);

    return {
      climbThreshold: Math.max(CLIMB_BASE, Math.round(CLIMB_BASE + capacity * CLIMB_CAPACITY_WEIGHT + level * CLIMB_LEVEL_WEIGHT)),
      dropThreshold: Math.max(1, Math.round(DROP_BASE - capacity * DROP_CAPACITY_WEIGHT - level * DROP_LEVEL_WEIGHT)),
      cooldownMs: Math.round(COOLDOWN_BASE_MS + level * COOLDOWN_LEVEL_MS),
    };
  }

  private transitionSuccess(providerId: string, entry: AdaptiveEntry, result: AdaptiveResult): void {
    const s = entry.state;

    // V3: 冷却期不阻止成功累积（翻转语义：冷却期只阻止下降）
    s.consecutiveSuccesses++;
    s.consecutiveFailures = 0;

    const profile = this.deriveProfile(s.currentLimit, entry.max);

    if (s.consecutiveSuccesses >= profile.climbThreshold) {
      const prevLimit = s.currentLimit;
      s.currentLimit = Math.min(s.currentLimit + 1, entry.max);
      // 满额时保留半数计数器，避免反复从 0 开始爬升
      if (s.currentLimit === entry.max) {
        s.consecutiveSuccesses = Math.floor(s.consecutiveSuccesses / AT_MAX_COUNTER_HALVE_DIVISOR);
        this.logger?.debug?.({ providerId, prevLimit, newLimit: s.currentLimit, action: "at_max_counter_cycle" }, "Adaptive: at max, counters preserved");
      } else {
        s.consecutiveSuccesses = 0;
        this.logger?.info?.({ providerId, requestId: result.requestId, prevLimit, newLimit: s.currentLimit, action: "limit_increased" }, "Adaptive: limit increased by 1");
      }
      this.syncToSemaphore(providerId);
    }
  }

  private transitionFailure(providerId: string, entry: AdaptiveEntry, result: AdaptiveResult): void {
    const statusCode = result.statusCode;

    // 过滤非并发相关的错误：
    // - retryRuleMatched=true → resilience 层根据重试规则判断为可重试的失败，计入退避
    // - 429: 限流，计入退避（含信号量超时/队列满，orchestrator 统一传入 429）
    // - 5xx: 服务端错误（可能过载），计入退避
    // - undefined: 网络异常，计入退避
    // - 2xx/4xx 且 retryRuleMatched!=true: 非并发问题，不触发退避
    if (!result.retryRuleMatched && statusCode !== undefined && statusCode !== RATE_LIMIT_STATUS && statusCode < HTTP_SERVER_ERROR_MIN) {
      this.logger?.debug?.({ providerId, statusCode, action: "failure_ignored" }, "Adaptive: non-concurrency failure ignored");
      return;
    }

    const s = entry.state;

    // V3: 冷却期前置检查——阻止进一步下降，但不重置成功计数
    if (Date.now() < s.cooldownUntil) {
      this.logger?.debug?.({ providerId, statusCode, action: "failure_blocked_by_cooldown" }, "Adaptive: failure blocked by cooldown");
      return;
    }

    s.consecutiveFailures++;
    s.consecutiveSuccesses = 0;

    if (statusCode === RATE_LIMIT_STATUS) {
      // 429: 固定 -1 + 冷却期
      const profile = this.deriveProfile(s.currentLimit, entry.max);
      const prevLimit = s.currentLimit;
      s.currentLimit = Math.max(s.currentLimit - 1, ADAPTIVE_MIN);
      s.cooldownUntil = Date.now() + profile.cooldownMs;
      s.consecutiveFailures = 0;
      this.syncToSemaphore(providerId);
      this.logger?.warn?.({ providerId, requestId: result.requestId, prevLimit, newLimit: s.currentLimit, cooldownMs: profile.cooldownMs, statusCode, action: "rate_limit_backoff" }, "Adaptive: 429/semaphore, lost 1 slot and entered cooldown");
    } else {
      // 5xx / 网络错误（statusCode=undefined）：连续失败退避 + 冷却期
      const profile = this.deriveProfile(s.currentLimit, entry.max);
      if (s.consecutiveFailures >= profile.dropThreshold) {
        const prevLimit = s.currentLimit;
        s.currentLimit = Math.max(s.currentLimit - 1, ADAPTIVE_MIN);
        s.cooldownUntil = Date.now() + profile.cooldownMs;
        s.consecutiveFailures = 0;
        this.syncToSemaphore(providerId);
        this.logger?.warn?.({ providerId, requestId: result.requestId, prevLimit, newLimit: s.currentLimit, statusCode, retryRuleMatched: result.retryRuleMatched ?? false, action: "failure_backoff" }, "Adaptive: sustained failures, decreased concurrency");
      }
    }
  }

  private syncToSemaphore(providerId: string): void {
    const entry = this.entries.get(providerId);
    if (!entry) return;
    const effectiveLimit = Math.max(entry.state.currentLimit, ADAPTIVE_MIN);
    this.semaphoreControl.updateConfig(providerId, {
      maxConcurrency: effectiveLimit,
      queueTimeoutMs: entry.queueTimeoutMs,
      maxQueueSize: entry.maxQueueSize,
    });
  }
}
