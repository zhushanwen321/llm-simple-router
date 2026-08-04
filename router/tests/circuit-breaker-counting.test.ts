/**
 * Circuit breaker 计数 + 绑定写入单元测试（design §4.5 计数点表 + §3 绑定写入规则）。
 *
 * 覆盖集成测试难以触发的路径（客户端断连需 TCP 中途断开，app.inject 无法模拟）：
 * - client_aborted 短路：不计任何熔断事件（design §4.5）
 * - 白名单外失败不计（不稀释失败率分母）
 * - isOpenAndCooling 纯谓词（无副作用，design §3 条件③c）
 */
import { describe, it, expect, vi } from "vitest";
import { applyCircuitBreakerAndBinding } from "../src/proxy/handler/resilience-processor.js";
import { CircuitBreaker } from "../src/proxy/routing/circuit-breaker.js";
import type { CircuitBreakerConfig, Target, ResolveResult } from "../src/core/types.js";

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
