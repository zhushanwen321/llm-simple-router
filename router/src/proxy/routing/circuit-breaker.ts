import type { CircuitBreakerConfig } from "../../core/types.js";

/** 秒 → 毫秒换算因子（提取为命名常量避免 no-magic-numbers 警告） */
const MS_PER_SECOND = 1000;

/**
 * 熔断状态（内存单例，per target key）。设计文档 §4.2。
 *
 * 两态状态机（设计文档 §4.1，明确不要 half-open——新 session 请求本身即天然试探）：
 *   CLOSED ──失败率≥阈值且样本≥min_samples──▶ OPEN
 *     ▲                                        │
 *     └────冷却期结束（cooldown_sec）───────────┘
 */
export interface CircuitState {
  /** 滑动窗口内事件（时间戳 + 成败） */
  events: Array<{ t: number; ok: boolean }>;
  state: "closed" | "open";
  /** 置 OPEN 的时刻；CLOSED 时为 null。固定冷却语义：OPEN 期间绝不刷新 */
  openedAt: number | null;
}

/**
 * 全局熔断状态机。
 *
 * per-target key 隔离（group + schedule + provider + model，见 buildCircuitKey），
 * key 为 null 时零开销跳过（无配置路径，向后兼容历史 group）。
 *
 * 固定冷却语义（设计文档 §4.3）：OPEN 期间照常记录事件（窗口继续滑动，
 * 冷却结束恢复后有新鲜样本），但绝不评估 OPEN 转移、绝不刷新 openedAt——
 * 否则全链 OPEN 时每次回退请求的失败都会刷新 openedAt，冷却期被无限顺延、永不结束。
 */
export class CircuitBreaker {
  private readonly states = new Map<string, CircuitState>();

  /**
   * 构造熔断状态 key（设计文档 §4.2）。
   *
   * key 必须含 group + schedule 维度：熔断参数是 target 级按 group 配置的，
   * 若 key 只含 provider+model，同一 (provider, model) 被不同 group 使用时，
   * 同一 events 数组会被不同窗口/阈值评估，行为非确定。
   *
   * @returns `${groupId}:${scheduleId ?? 'base'}:${providerId}:${backendModel}`；
   *          groupId 为 null（direct/fallback 路径）时返回 null（不参与熔断计数）
   */
  buildCircuitKey(
    groupId: string | null,
    scheduleId: string | undefined,
    providerId: string,
    backendModel: string,
  ): string | null {
    if (groupId === null) return null;
    return `${groupId}:${scheduleId ?? "base"}:${providerId}:${backendModel}`;
  }

  /**
   * 记录一次 target 尝试结果（设计文档 §4.3）。
   *
   * 精确语义：
   * 1. key 为 null → 直接返回（零开销门控）
   * 2. 惰性获取/创建 CircuitState
   * 3. push {t, ok} 到 events
   * 4. 惰性清理窗口外事件（滑动窗口）
   * 5. 仅 state==='closed' 时评估 OPEN 转移；'open' 时照常记录但绝不刷新 openedAt
   *
   * @param now 注入时间戳，便于单元测试控制时间（默认 Date.now()）
   */
  recordResult(
    key: string | null,
    ok: boolean,
    config: CircuitBreakerConfig,
    now: number = Date.now(),
  ): void {
    // 零开销门控：无配置路径不构造 key，直接返回
    if (key === null) return;

    const state = this.getOrCreateState(key);
    state.events.push({ t: now, ok });

    // 惰性清理窗口外事件（滑动窗口）
    const windowMs = config.window_sec * MS_PER_SECOND;
    state.events = state.events.filter((e) => e.t >= now - windowMs);

    // 仅 CLOSED 时评估 OPEN 转移（OPEN 期间绝不刷新 openedAt，固定冷却语义）
    if (state.state !== "closed") return;

    const total = state.events.length;
    const failed = state.events.filter((e) => !e.ok).length;
    if (total >= config.min_samples && failed / total >= config.failure_rate) {
      state.state = "open";
      state.openedAt = now;
    }
  }

  /**
   * 判定 target 是否应被跳过（设计文档 §4.4）。
   *
   * @returns true=OPEN 且冷却未过需跳过；
   *          false=可尝试（key 为 null / 无状态=CLOSED 语义 / 已 CLOSED / 冷却结束自动恢复）
   *
   * @param now 注入时间戳，便于单元测试控制时间（默认 Date.now()）
   */
  shouldSkip(
    key: string | null,
    config: CircuitBreakerConfig,
    now: number = Date.now(),
  ): boolean {
    // 零开销门控：无配置路径不跳过
    if (key === null) return false;

    const state = this.states.get(key);
    // 无状态记录 = CLOSED 语义（从未记录过事件）
    if (state === undefined) return false;
    if (state.state === "closed") return false;

    // OPEN：冷却未过 → 跳过
    const cooldownMs = config.cooldown_sec * MS_PER_SECOND;
    if (state.openedAt !== null && now - state.openedAt < cooldownMs) {
      return true;
    }

    // 冷却结束 → 转 CLOSED（清空 events，恢复后从新鲜样本重新累计），不跳过
    state.state = "closed";
    state.events = [];
    state.openedAt = null;
    return false;
  }

  /**
   * 只读判定某 key 是否处于熔断中（OPEN 且冷却未过）。**无副作用**——不转换状态、不清空 events。
   *
   * 用于绑定失效判定（§3 条件③c）等「谓词必须纯」的场景；
   * 路由侧选路应继续用 shouldSkip（冷却结束时转 CLOSED 恢复可尝试）。
   *
   * @returns true=OPEN 且冷却未过；false=key 为 null / 无状态 / CLOSED / 冷却结束（不转换）
   */
  isOpenAndCooling(
    key: string | null,
    config: CircuitBreakerConfig,
    now: number = Date.now(),
  ): boolean {
    if (key === null) return false;
    const state = this.states.get(key);
    if (state === undefined || state.state === "closed") return false;
    if (state.openedAt === null) return false;
    const cooldownMs = config.cooldown_sec * MS_PER_SECOND;
    return now - state.openedAt < cooldownMs;
  }

  /** 惰性获取或创建某 key 的熔断状态 */
  private getOrCreateState(key: string): CircuitState {
    let state = this.states.get(key);
    if (state === undefined) {
      state = { events: [], state: "closed", openedAt: null };
      this.states.set(key, state);
    }
    return state;
  }
}
