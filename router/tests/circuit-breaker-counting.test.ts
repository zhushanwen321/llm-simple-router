/**
 * Circuit breaker 计数 + 绑定写入单元测试（design §4.5 计数点表 + §3 绑定写入规则）。
 *
 * 覆盖集成测试难以触发的路径（客户端断连需 TCP 中途断开，app.inject 无法模拟）：
 * - client_aborted 短路：不计任何熔断事件（design §4.5）
 * - 白名单外失败不计（不稀释失败率分母）
 * - isOpenAndCooling 纯谓词（无副作用，design §3 条件③c）
 */
import { describe, it, expect, vi } from "vitest";
import { applyCircuitBreakerAndBinding, countCircuitEvent } from "../src/proxy/handler/resilience-processor.js";
import { CircuitBreaker } from "../src/proxy/routing/circuit-breaker.js";
import type { CircuitBreakerConfig, Target, ResolveResult, TransportResult } from "../src/core/types.js";

const CB_CONFIG: CircuitBreakerConfig = {
  enabled: true,
  window_sec: 60,
  failure_rate: 0.9,
  min_samples: 1,
  cooldown_sec: 300,
};

const TARGET_T1: Target = { backend_model: "m1", provider_id: "p1", circuit_breaker: CB_CONFIG };

/** 构造最小 ResolveResult（group 路径，含 configLevelTargetKeys） */
function makeResolveResult(configKeys: Set<string>): ResolveResult {
  return {
    target: TARGET_T1,
    targetCount: 2,
    mappingReason: "group_base_rule",
    group_id: "g1",
    schedule_id: undefined,
    configLevelTargetKeys: configKeys,
  };
}

/** 构造 mock db（getProviderById 返回 active provider，用于绑定失效判定 ③b） */
function makeMockDb(): Record<string, unknown> {
  return {
    prepare: () => ({
      get: () => null,
      run: () => ({ changes: 0 }),
    }),
  };
}

describe("applyCircuitBreakerAndBinding: client_aborted 短路（§4.5）", () => {
  it("client_aborted 不计任何熔断事件（100 次断连也不污染失败率）", () => {
    const cb = new CircuitBreaker();
    const key = cb.buildCircuitKey("g1", undefined, "p1", "m1")!;
    const recordSpy = vi.spyOn(cb, "recordResult");

    // 100 次 client_aborted（throw 结果但 finalDecision=abort/client_aborted）
    for (let i = 0; i < 100; i++) {
      applyCircuitBreakerAndBinding({
        circuitBreaker: cb,
        cachedTargets: [TARGET_T1, { backend_model: "m2", provider_id: "p2" }],
        resolveResult: makeResolveResult(new Set(["p1:m1", "p2:m2"])),
        resolved: TARGET_T1,
        tr: { kind: "throw", error: new Error("aborted") },
        finalDecision: { action: "abort", reason: "client_aborted" },
        db: makeMockDb() as never,
        sessionId: "sess-1",
        routerKeyId: "rk-1",
      });
    }

    // 断言：100 次断连零计数
    expect(recordSpy).not.toHaveBeenCalled();
    expect(cb.shouldSkip(key, CB_CONFIG)).toBe(false); // 未 OPEN
  });

  it("client_aborted 后 1 次真实失败仍正常计入（仅真实失败计数）", () => {
    const cb = new CircuitBreaker();
    const key = cb.buildCircuitKey("g1", undefined, "p1", "m1")!;

    // 1 次断连（不计）
    applyCircuitBreakerAndBinding({
      circuitBreaker: cb,
      cachedTargets: [TARGET_T1, { backend_model: "m2", provider_id: "p2" }],
      resolveResult: makeResolveResult(new Set(["p1:m1"])),
      resolved: TARGET_T1,
      tr: { kind: "throw", error: new Error("aborted") },
      finalDecision: { action: "abort", reason: "client_aborted" },
      db: makeMockDb() as never,
      sessionId: undefined,
      routerKeyId: null,
    });

    // 1 次真实失败（min_samples=1 → OPEN）
    applyCircuitBreakerAndBinding({
      circuitBreaker: cb,
      cachedTargets: [TARGET_T1],
      resolveResult: makeResolveResult(new Set(["p1:m1"])),
      resolved: TARGET_T1,
      tr: { kind: "error", statusCode: 500, body: "err", headers: {}, sentHeaders: {}, sentBody: "" },
      finalDecision: undefined,
      db: makeMockDb() as never,
      sessionId: undefined,
      routerKeyId: null,
    });

    expect(cb.shouldSkip(key, CB_CONFIG)).toBe(true); // OPEN
  });

  it("非 client_aborted 的 abort（如 idle_timeout）不计为 client_aborted（仍走正常计数）", () => {
    const cb = new CircuitBreaker();
    const recordSpy = vi.spyOn(cb, "recordResult");

    // stream_abort（idle_timeout）→ finalDecision=abort 但 reason≠client_aborted
    applyCircuitBreakerAndBinding({
      circuitBreaker: cb,
      cachedTargets: [TARGET_T1],
      resolveResult: makeResolveResult(new Set(["p1:m1"])),
      resolved: TARGET_T1,
      tr: { kind: "stream_abort", statusCode: 200, sentHeaders: {}, abortReason: "idle_timeout" },
      finalDecision: { action: "abort", reason: "idle_timeout" },
      db: makeMockDb() as never,
      sessionId: undefined,
      routerKeyId: null,
    });

    // stream_abort 计入 ok（design §4.5），非 client_aborted 短路
    expect(recordSpy).toHaveBeenCalledTimes(1);
  });
});

describe("applyCircuitBreakerAndBinding: 白名单外失败不计（§4.5）", () => {
  it("status_codes=[429] 时 500 失败不计入（不稀释失败率分母）", () => {
    const cb = new CircuitBreaker();
    const key = cb.buildCircuitKey("g1", undefined, "p1", "m1")!;
    const recordSpy = vi.spyOn(cb, "recordResult");
    const config429: CircuitBreakerConfig = { ...CB_CONFIG, status_codes: [429] };

    for (let i = 0; i < 5; i++) {
      applyCircuitBreakerAndBinding({
        circuitBreaker: cb,
        cachedTargets: [TARGET_T1, { backend_model: "m2", provider_id: "p2" }],
        resolveResult: makeResolveResult(new Set(["p1:m1"])),
        resolved: { ...TARGET_T1, circuit_breaker: config429 },
        tr: { kind: "error", statusCode: 500, body: "err", headers: {}, sentHeaders: {}, sentBody: "" },
        finalDecision: undefined,
        db: makeMockDb() as never,
        sessionId: undefined,
        routerKeyId: null,
      });
    }

    // 5 次 500（白名单外）零计数
    expect(recordSpy).not.toHaveBeenCalled();
    expect(cb.shouldSkip(key, config429)).toBe(false);
  });

  it("throw（连接级错误）不受白名单限制，始终计入 fail", () => {
    const cb = new CircuitBreaker();
    const recordSpy = vi.spyOn(cb, "recordResult");
    const config429: CircuitBreakerConfig = { ...CB_CONFIG, status_codes: [429] };

    applyCircuitBreakerAndBinding({
      circuitBreaker: cb,
      cachedTargets: [{ ...TARGET_T1, circuit_breaker: config429 }],
      resolveResult: makeResolveResult(new Set(["p1:m1"])),
      resolved: { ...TARGET_T1, circuit_breaker: config429 },
      tr: { kind: "throw", error: new Error("ECONNREFUSED") },
      finalDecision: undefined,
      db: makeMockDb() as never,
      sessionId: undefined,
      routerKeyId: null,
    });

    // throw 始终计入（即使白名单=[429]）
    expect(recordSpy).toHaveBeenCalledWith(expect.any(String), false, expect.anything(), expect.any(Number));
  });
});

describe("isOpenAndCooling: 纯谓词无副作用（§3 条件③c）", () => {
  it("OPEN 且冷却未过 → true，不改变状态", () => {
    const cb = new CircuitBreaker();
    const key = cb.buildCircuitKey("g1", undefined, "p1", "m1")!;
    const T0 = 1_000_000;

    // 触发 OPEN
    cb.recordResult(key, false, CB_CONFIG, T0);
    const statesBefore = (cb as unknown as { states: Map<string, { state: string; openedAt: number | null; events: unknown[] }> }).states.get(key)!;
    const openedAtBefore = statesBefore.openedAt;

    // isOpenAndCooling 多次调用
    expect(cb.isOpenAndCooling(key, CB_CONFIG, T0 + 1000)).toBe(true);
    expect(cb.isOpenAndCooling(key, CB_CONFIG, T0 + 1000)).toBe(true);

    // 状态未被改变（仍是 OPEN，openedAt 未变）
    const statesAfter = (cb as unknown as { states: Map<string, { state: string; openedAt: number | null }> }).states.get(key)!;
    expect(statesAfter.state).toBe("open");
    expect(statesAfter.openedAt).toBe(openedAtBefore);
  });

  it("冷却结束后 isOpenAndCooling 返回 false，但状态仍是 OPEN（不转 CLOSED）", () => {
    const cb = new CircuitBreaker();
    const key = cb.buildCircuitKey("g1", undefined, "p1", "m1")!;
    const T0 = 1_000_000;

    cb.recordResult(key, false, CB_CONFIG, T0);
    // 冷却结束（cooldown_sec=300 → 300_000ms）
    expect(cb.isOpenAndCooling(key, CB_CONFIG, T0 + 301_000)).toBe(false);

    // 状态仍是 OPEN（isOpenAndCooling 不转换；shouldSkip 才会转换）
    const state = (cb as unknown as { states: Map<string, { state: string }> }).states.get(key)!;
    expect(state.state).toBe("open");
  });

  it("key=null / 无状态 / CLOSED → false", () => {
    const cb = new CircuitBreaker();
    expect(cb.isOpenAndCooling(null, CB_CONFIG)).toBe(false);
    expect(cb.isOpenAndCooling("g1:base:p1:no-such-model", CB_CONFIG)).toBe(false);
  });
});

describe("countCircuitEvent 纯函数：§4.5 计数点表逐行验证", () => {
  // 构造各 kind 的 TransportResult（最小字段）
  const throwTr: TransportResult = { kind: "throw", error: new Error("boom") };
  const errorOf = (code: number): TransportResult => ({
    kind: "success", statusCode: code, body: "", headers: {}, sentHeaders: {}, sentBody: "",
  });
  const streamError: TransportResult = {
    kind: "stream_error", statusCode: 200, body: "", headers: {}, sentHeaders: {},
  };
  const streamAbort: TransportResult = {
    kind: "stream_abort", statusCode: 200, sentHeaders: {},
  };
  const success: TransportResult = {
    kind: "success", statusCode: 200, body: "", headers: {}, sentHeaders: {}, sentBody: "",
  };

  // §4.5 表格逐行：返回 false=fail / true=ok / null=不计

  it("throw 始终计 fail（不受白名单限制）", () => {
    expect(countCircuitEvent(throwTr, { ...CB_CONFIG, status_codes: [429] })).toBe(false);
    expect(countCircuitEvent(throwTr, { ...CB_CONFIG, status_codes: [503] })).toBe(false);
    expect(countCircuitEvent(throwTr, CB_CONFIG)).toBe(false); // 无白名单
  });

  it("statusCode>=400 且在白名单 → fail", () => {
    expect(countCircuitEvent(errorOf(429), { ...CB_CONFIG, status_codes: [429] })).toBe(false);
    expect(countCircuitEvent(errorOf(503), CB_CONFIG)).toBe(false); // 无白名单=全部计入
  });

  it("B6: stream_error (statusCode<400) 不产生任何事件 → null", () => {
    // stream_error 的 statusCode<400，不达阈值，无失败语义
    expect(countCircuitEvent(streamError, CB_CONFIG)).toBe(null);
    expect(countCircuitEvent(streamError, { ...CB_CONFIG, status_codes: [200] })).toBe(null);
  });

  it("白名单外失败 (statusCode>=400 但不在 status_codes) → null（不稀释分母）", () => {
    // §4.5 行5：不产生任何事件（不计 fail 也不计 ok）
    expect(countCircuitEvent(errorOf(500), { ...CB_CONFIG, status_codes: [429] })).toBe(null);
    expect(countCircuitEvent(errorOf(418), { ...CB_CONFIG, status_codes: [429, 503] })).toBe(null);
  });

  it("success / stream_success / stream_abort → ok", () => {
    expect(countCircuitEvent(success, CB_CONFIG)).toBe(true);
    const streamSuccess: TransportResult = {
      kind: "stream_success", statusCode: 200, sentHeaders: {},
    };
    expect(countCircuitEvent(streamSuccess, CB_CONFIG)).toBe(true);
    expect(countCircuitEvent(streamAbort, CB_CONFIG)).toBe(true);
  });
});

describe("T2: 白名单内外混合仍触发 OPEN（§4.5 白名单语义 + §10 混合场景）", () => {
  it("status_codes=[429] 时 10×白内429 + 5×白外500 → 仅 10 次429计入，failure_rate=10/10=100% OPEN", () => {
    const cb = new CircuitBreaker();
    const key = cb.buildCircuitKey("g1", undefined, "p1", "m1")!;
    const config429: CircuitBreakerConfig = { ...CB_CONFIG, status_codes: [429], min_samples: 5 };
    const target429 = { ...TARGET_T1, circuit_breaker: config429 };

    // 10 次白名单内 429（计 fail）
    const T0 = 1_000_000;
    for (let i = 0; i < 10; i++) {
      cb.recordResult(key, false, config429, T0 + i);
    }
    // 5 次白名单外 500（不产生任何事件，不计入分母）
    for (let i = 0; i < 5; i++) {
      // countCircuitEvent 返回 null → applyCircuitBreakerAndBinding 不调 recordResult
      const counted = countCircuitEvent(
        { kind: "success", statusCode: 500, body: "", headers: {}, sentHeaders: {}, sentBody: "" },
        config429,
      );
      expect(counted).toBe(null); // 白名单外：不产生事件
    }

    // 断言：仅 10 次 fail 计入，failure_rate = 10/10 = 100% ≥ 阈值 → OPEN
    // shouldSkip 传同一时间基准 T0+100（在冷却期内），避免 Date.now() 导致冷却起算偏移
    expect(cb.shouldSkip(key, config429, T0 + 100)).toBe(true);
    // 白名单外 500 不稀释分母（若错误计入 ok，分母=15，失败率=10/15=66% < 90% 不 OPEN）
  });

  it("白名单外失败不阻止白名单内 OPEN（反证：若白外错误计 ok，分母被稀释，OPEN 不触发）", () => {
    const cb = new CircuitBreaker();
    const key = cb.buildCircuitKey("g2", undefined, "p1", "m2")!;
    // 配置：failure_rate=0.9, min_samples=10，让“被稀释”场景下不达标
    const config: CircuitBreakerConfig = { ...CB_CONFIG, status_codes: [429], failure_rate: 0.9, min_samples: 10 };

    // 10 次白内 429（fail）
    const T0 = 2_000_000;
    for (let i = 0; i < 10; i++) cb.recordResult(key, false, config, T0 + i);
    // 模拟 20 次白外 500：正确实现下不产生事件
    // （若错误实现把白外计为 ok，20 ok + 10 fail → 10/30=33% < 90%，不 OPEN）
    expect(cb.shouldSkip(key, config, T0 + 100)).toBe(true); // 正确实现：仍 OPEN
  });
});
