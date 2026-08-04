import { describe, it, expect } from "vitest";
import type { CircuitBreakerConfig } from "../src/core/types";
import { CircuitBreaker } from "../src/proxy/routing/circuit-breaker";

/**
 * W2 cb-state-machine：全局熔断状态机单元测试。
 * 验证 CircuitBreaker 的 CLOSED⇄OPEN 两态转移、固定冷却语义、滑动窗口、key 隔离。
 * 通过注入 now 参数精确控制时间，不依赖真实时钟。
 */

/** 测试用配置：60s 窗口 / 90% 失败率 / 10 样本下限 / 300s 冷却 */
const CONFIG: CircuitBreakerConfig = {
  enabled: true,
  window_sec: 60,
  failure_rate: 0.9,
  min_samples: 10,
  cooldown_sec: 300,
};

/** 固定时间基准，避免 0 带来的边界混淆 */
const T0 = 1_000_000_000_000;

/** 测试辅助：读取某 key 的内部 events（验证状态机内部转移，单元测试惯例） */
function getEvents(
  cb: CircuitBreaker,
  key: string,
): Array<{ t: number; ok: boolean }> {
  const states = (
    cb as unknown as {
      states: Map<string, { events: Array<{ t: number; ok: boolean }> }>;
    }
  ).states;
  return states.get(key)?.events ?? [];
}

/** 测试辅助：读取内部 states 的条目数（验证 key=null 零开销门控无副作用） */
function getStatesSize(cb: CircuitBreaker): number {
  const states = (cb as unknown as { states: Map<string, unknown> }).states;
  return states.size;
}

describe("W2 CircuitBreaker 状态机", () => {
  it("TC1 失败率达标 + 样本足 → OPEN（shouldSkip 返回 true）", () => {
    const cb = new CircuitBreaker();
    const key = cb.buildCircuitKey("g1", undefined, "p1", "m1");
    expect(key).toBe("g1:base:p1:m1");

    // 10 次失败：total=10>=10, failed/total=1.0>=0.9 → CLOSED 转 OPEN
    for (let i = 0; i < 10; i++) {
      cb.recordResult(key, false, CONFIG, T0);
    }
    expect(cb.shouldSkip(key, CONFIG, T0)).toBe(true);
  });

  it("TC2 样本不足 → 不熔断（shouldSkip 返回 false）", () => {
    const cb = new CircuitBreaker();
    const key = cb.buildCircuitKey("g1", undefined, "p1", "m1")!;

    // 仅 5 次失败：total=5 < min_samples=10，不满足转移条件
    for (let i = 0; i < 5; i++) {
      cb.recordResult(key, false, CONFIG, T0);
    }
    expect(cb.shouldSkip(key, CONFIG, T0)).toBe(false);
  });

  it("TC3 OPEN 冷却期内持续跳过（未到 cooldown_sec）", () => {
    const cb = new CircuitBreaker();
    const key = cb.buildCircuitKey("g1", undefined, "p1", "m1")!;

    for (let i = 0; i < 10; i++) {
      cb.recordResult(key, false, CONFIG, T0);
    }
    // cooldown=300_000ms，前进 100_000ms 仍在冷却期内
    expect(cb.shouldSkip(key, CONFIG, T0 + 100_000)).toBe(true);
  });

  it("TC4 冷却期结束自动恢复 + events 清空", () => {
    const cb = new CircuitBreaker();
    const key = cb.buildCircuitKey("g1", undefined, "p1", "m1")!;

    for (let i = 0; i < 10; i++) {
      cb.recordResult(key, false, CONFIG, T0);
    }
    expect(cb.shouldSkip(key, CONFIG, T0)).toBe(true);

    // 前进 301_000ms > cooldown 300_000ms → 冷却结束转 CLOSED，events 清空
    expect(cb.shouldSkip(key, CONFIG, T0 + 301_000)).toBe(false);

    // 恢复后 recordResult，events 应从空开始（仅 1 条新事件）
    cb.recordResult(key, false, CONFIG, T0 + 301_000);
    expect(getEvents(cb, key).length).toBe(1);
  });

  it("TC5 OPEN 期间 recordResult 不刷新 openedAt（固定冷却语义）", () => {
    const cb = new CircuitBreaker();
    const key = cb.buildCircuitKey("g1", undefined, "p1", "m1")!;

    // 触发 OPEN，openedAt = T0
    for (let i = 0; i < 10; i++) {
      cb.recordResult(key, false, CONFIG, T0);
    }
    expect(cb.shouldSkip(key, CONFIG, T0)).toBe(true);

    // OPEN 期间继续记录失败（now=T0+50_000，仍在窗口内）
    // 正确实现：照常记录事件但不刷新 openedAt（保持 T0）
    for (let i = 0; i < 5; i++) {
      cb.recordResult(key, false, CONFIG, T0 + 50_000);
    }

    // 冷却按首次 openedAt=T0 计算：T0+301_000 已过 300_000 → 恢复
    // 若错误地刷新了 openedAt（=T0+50_000），则 T0+301_000 - (T0+50_000)=251_000 < 300_000 仍跳过
    expect(cb.shouldSkip(key, CONFIG, T0 + 301_000)).toBe(false);
  });

  it("TC6 窗口滑动：旧事件出窗后不计入失败率（9 旧 + 1 新不触发 OPEN）", () => {
    const cb = new CircuitBreaker();
    const key = cb.buildCircuitKey("g1", undefined, "p1", "m1")!;

    // T0 记录 9 次失败：total=9 < min_samples=10，CLOSED 不转移
    // （这 9 个事件是「旧事件」，稍后会因窗口滑动被清理）
    for (let i = 0; i < 9; i++) {
      cb.recordResult(key, false, CONFIG, T0);
    }

    // T0+61_000 记录 1 次失败：清理窗口外事件
    //   清理阈值 = (T0+61_000) - 60_000 = T0+1_000
    //   T0 的 9 个事件 t=T0 < T0+1_000 → 全部出窗；仅剩 T0+61_000 的 1 个
    //   total=1 < 10，不触发 OPEN
    // 反证：若不清理（错误实现），total=10>=10 且 failed=10/10=1.0>=0.9 → 会触发 OPEN
    cb.recordResult(key, false, CONFIG, T0 + 61_000);
    expect(cb.shouldSkip(key, CONFIG, T0 + 61_000)).toBe(false);
    expect(getEvents(cb, key).length).toBe(1);
  });

  it("TC7 key=null 零开销门控：不抛异常、不跳过、内部无状态条目", () => {
    const cb = new CircuitBreaker();

    // key=null：recordResult / shouldSkip 均直接返回，不触碰 states
    expect(() => cb.recordResult(null, false, CONFIG, T0)).not.toThrow();
    expect(cb.shouldSkip(null, CONFIG, T0)).toBe(false);
    expect(getStatesSize(cb)).toBe(0);
  });

  it("TC8 多 key 隔离：keyA 的 OPEN 不影响 keyB", () => {
    const cb = new CircuitBreaker();
    const keyA = cb.buildCircuitKey("g1", undefined, "p1", "m1")!;
    const keyB = cb.buildCircuitKey("g1", undefined, "p1", "m2")!;

    // keyA 触发 OPEN
    for (let i = 0; i < 10; i++) {
      cb.recordResult(keyA, false, CONFIG, T0);
    }
    expect(cb.shouldSkip(keyA, CONFIG, T0)).toBe(true);

    // keyB 无任何记录，应保持 CLOSED 语义
    expect(cb.shouldSkip(keyB, CONFIG, T0)).toBe(false);
  });
});
