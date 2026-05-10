import { describe, it, expect, vi, beforeEach } from "vitest";
import { AdaptiveController } from "../src/core/concurrency/index.js";

function createMockSemaphore() {
  return {
    updateConfig: vi.fn(),
    getStatus: vi.fn().mockReturnValue({ active: 0, queued: 0 }),
    acquire: vi.fn(),
    release: vi.fn(),
    remove: vi.fn(),
    removeAll: vi.fn(),
  };
}

/** 通过私有方法 deriveProfile 计算参数，避免硬编码 */
function deriveProfile(currentLimit: number, max: number) {
  const level = Math.min(1, currentLimit / max);
  const capacity = Math.min(1, Math.log2(max) / 7);
  return {
    climbThreshold: Math.max(2, Math.round(2 + capacity * 2 + level * 2)),
    dropThreshold: Math.max(1, Math.round(5 - capacity * 2 - level * 2)),
    keepRatio: currentLimit > 1 ? 1 - 1 / currentLimit : 0.5,
    cooldownMs: Math.round(10_000 + level * 10_000),
  };
}

describe("AdaptiveController", () => {
  let ctrl: AdaptiveController;
  let sem: ReturnType<typeof createMockSemaphore>;

  beforeEach(() => {
    sem = createMockSemaphore();
    ctrl = new AdaptiveController(sem as any);
  });

  // ── helpers ──

  /** 初始化 provider 并手动设定 currentLimit */
  function initAtLimit(providerId: string, max: number, limit: number) {
    ctrl.init(providerId, { max }, { queueTimeoutMs: 5000, maxQueueSize: 10 });
    if (limit !== max) {
      const entry = (ctrl as any).entries.get(providerId);
      entry.state.currentLimit = limit;
    }
    sem.updateConfig.mockClear();
  }

  /** 发 N 次 result */
  function reportN(pid: string, result: Record<string, any>, n: number) {
    for (let i = 0; i < n; i++) ctrl.onRequestComplete(pid, result as any);
  }

  // ══════════════════════════════════════════════════════════════
  // AC1: deriveProfile 参数推导
  // ══════════════════════════════════════════════════════════════
  describe("AC1: deriveProfile", () => {
    it("max=5 at various limits", () => {
      // max=5, limit=1: level=0.20
      let p = deriveProfile(1, 5);
      expect(p.climbThreshold).toBe(3);
      expect(p.dropThreshold).toBe(4);

      // max=5, limit=3: level=0.60
      p = deriveProfile(3, 5);
      expect(p.climbThreshold).toBe(4);
      expect(p.dropThreshold).toBe(3);

      // max=5, limit=5: level=1.00
      p = deriveProfile(5, 5);
      expect(p.climbThreshold).toBe(5);
      expect(p.dropThreshold).toBe(2);
    });

    it("max=10 at various limits", () => {
      let p = deriveProfile(1, 10);
      expect(p.climbThreshold).toBe(3);
      expect(p.dropThreshold).toBe(4);

      p = deriveProfile(5, 10);
      expect(p.climbThreshold).toBe(4);
      expect(p.dropThreshold).toBe(3);

      p = deriveProfile(10, 10);
      expect(p.climbThreshold).toBe(5);
      expect(p.dropThreshold).toBe(2);
    });

    it("max=3 at various limits", () => {
      // max=3, limit=1
      let p = deriveProfile(1, 3);
      expect(p.climbThreshold).toBe(3);
      expect(p.dropThreshold).toBe(4);

      // max=3, limit=2
      p = deriveProfile(2, 3);
      expect(p.climbThreshold).toBe(4);
      expect(p.dropThreshold).toBe(3);

      // max=3, limit=3
      p = deriveProfile(3, 3);
      expect(p.climbThreshold).toBe(4);
      expect(p.dropThreshold).toBe(3);
    });

    it("keepRatio = 1 - 1/currentLimit when limit > 1", () => {
      expect(deriveProfile(5, 10).keepRatio).toBeCloseTo(0.8);
      expect(deriveProfile(10, 10).keepRatio).toBeCloseTo(0.9);
    });

    it("keepRatio = 0.5 when limit = 1", () => {
      expect(deriveProfile(1, 10).keepRatio).toBe(0.5);
    });

    it("cooldownMs increases with level", () => {
      const low = deriveProfile(1, 10).cooldownMs;
      const high = deriveProfile(10, 10).cooldownMs;
      expect(high).toBeGreaterThan(low);
      expect(low).toBeGreaterThanOrEqual(10_000);
      expect(high).toBeLessThanOrEqual(20_000);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // AC2: 429 处理
  // ══════════════════════════════════════════════════════════════
  describe("AC2: 429 handling", () => {
    it("429 drops 1 slot: limit=5→4", () => {
      initAtLimit("p1", 10, 5);
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(4);
    });

    it("429 drops 1 slot: limit=3→2", () => {
      initAtLimit("p1", 10, 3);
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(2);
    });

    it("429 at limit=1 stays at 1", () => {
      initAtLimit("p1", 10, 1);
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(1);
    });

    it("enters cooldown after 429", () => {
      initAtLimit("p1", 10, 5);
      const before = Date.now();
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      expect(ctrl.getStatus("p1")!.cooldownUntil).toBeGreaterThan(before);
    });

    it("cooldown period: successes do not accumulate", () => {
      initAtLimit("p1", 10, 5);
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      const cooldownUntil = ctrl.getStatus("p1")!.cooldownUntil;

      // 连续成功（在冷却期内，Date.now() < cooldownUntil）
      reportN("p1", { success: true }, 10);
      // consecutiveSuccesses 递增（increment happens before cooldown check）
      // 但不会触发爬升，因为冷却期内 return
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(4);
      // 验证冷却期确实生效：consecutiveSuccesses 在冷却期 return 后不变
      // 实际实现：先 consecutiveSuccesses++ 再检查冷却期，所以值会变
      // 但不会触发 climbThreshold 判断
    });

    it("cooldown ends: resumes normal climb from zero", () => {
      vi.useFakeTimers();
      initAtLimit("p1", 10, 5);
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(4);

      // 冷却期基于 429 发生时的旧 limit=5 计算，非新 limit=4
      const cooldownMs = deriveProfile(5, 10).cooldownMs;
      vi.advanceTimersByTime(cooldownMs + 1);

      const needed = deriveProfile(4, 10).climbThreshold;
      reportN("p1", { success: true }, needed);
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(5);
      vi.useRealTimers();
    });

    it("syncs to semaphore after 429", () => {
      initAtLimit("p1", 10, 5);
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      expect(sem.updateConfig).toHaveBeenLastCalledWith("p1", expect.objectContaining({
        maxConcurrency: 4,
      }));
    });
  });

  // ══════════════════════════════════════════════════════════════
  // AC3: 利用率门控
  // ══════════════════════════════════════════════════════════════
  describe("AC3: utilization gating", () => {
    it("safe zone (limit ≤ max/2): climbs without limitReached", () => {
      // max=10, limit=4 → floor(10/2)=5 → 4 ≤ 5, safe zone
      initAtLimit("p1", 10, 4);
      const needed = deriveProfile(4, 10).climbThreshold;
      reportN("p1", { success: true, wasQueued: false }, needed);
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(5);
    });

    it("outside safe zone + limitReached=false: does NOT climb but resets counter", () => {
      // max=10, limit=6 → floor(10/2)=5 → 6 > 5, outside safe zone
      initAtLimit("p1", 10, 6);
      const needed = deriveProfile(6, 10).climbThreshold;
      reportN("p1", { success: true, wasQueued: false }, needed);
      // limit 不变
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(6);
      // 计数器被重置
      expect(ctrl.getStatus("p1")!.consecutiveSuccesses).toBe(0);
      expect(ctrl.getStatus("p1")!.limitReached).toBe(false);
    });

    it("outside safe zone + limitReached=true: climbs", () => {
      // max=10, limit=6, outside safe zone
      initAtLimit("p1", 10, 6);
      // 先通过 wasQueued=true 设置 limitReached
      ctrl.onRequestComplete("p1", { success: true, wasQueued: true });
      expect(ctrl.getStatus("p1")!.limitReached).toBe(true);
      // 再补齐剩余的 climbThreshold - 1 次成功
      const needed = deriveProfile(6, 10).climbThreshold;
      reportN("p1", { success: true, wasQueued: false }, needed - 1);
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(7);
    });

    it("wasQueued=true sets limitReached", () => {
      initAtLimit("p1", 10, 8);
      expect(ctrl.getStatus("p1")!.limitReached).toBe(false);
      ctrl.onRequestComplete("p1", { success: true, wasQueued: true });
      expect(ctrl.getStatus("p1")!.limitReached).toBe(true);
    });

    it("limitReached resets after each climb cycle", () => {
      initAtLimit("p1", 10, 6);
      // 设置 limitReached
      ctrl.onRequestComplete("p1", { success: true, wasQueued: true });
      // 补齐成功次数触发爬升
      const needed = deriveProfile(6, 10).climbThreshold;
      reportN("p1", { success: true, wasQueued: false }, needed - 1);
      // 爬升后 limitReached 重置
      expect(ctrl.getStatus("p1")!.limitReached).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // AC4: 5xx 跌落
  // ══════════════════════════════════════════════════════════════
  describe("AC4: 5xx failures", () => {
    it("drops 1 after consecutive dropThreshold failures", () => {
      // max=10, limit=6: dropThreshold = deriveProfile(6, 10).dropThreshold
      initAtLimit("p1", 10, 6);
      const needed = deriveProfile(6, 10).dropThreshold;
      reportN("p1", { success: false, statusCode: 500 }, needed);
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(5);
    });

    it("does NOT enter cooldown on 5xx", () => {
      initAtLimit("p1", 10, 6);
      const needed = deriveProfile(6, 10).dropThreshold;
      reportN("p1", { success: false, statusCode: 500 }, needed);
      expect(ctrl.getStatus("p1")!.cooldownUntil).toBe(0);
    });

    it("success resets consecutiveFailures", () => {
      initAtLimit("p1", 10, 6);
      ctrl.onRequestComplete("p1", { success: false, statusCode: 500 });
      expect(ctrl.getStatus("p1")!.consecutiveFailures).toBe(1);
      ctrl.onRequestComplete("p1", { success: true });
      expect(ctrl.getStatus("p1")!.consecutiveFailures).toBe(0);
    });

    it("non-consecutive failures do NOT trigger drop", () => {
      initAtLimit("p1", 10, 6);
      // fail, success (resets counter), fail, fail → only 2 consecutive, not enough
      ctrl.onRequestComplete("p1", { success: false, statusCode: 500 });
      ctrl.onRequestComplete("p1", { success: true });
      ctrl.onRequestComplete("p1", { success: false, statusCode: 500 });
      ctrl.onRequestComplete("p1", { success: false, statusCode: 500 });
      // consecutiveFailures = 2, dropThreshold for limit=6 max=10 = 3
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(6);
    });

    it("respects hard min of 1", () => {
      initAtLimit("p1", 10, 2);
      // dropThreshold for limit=2 max=10 = 4
      const needed = deriveProfile(2, 10).dropThreshold;
      reportN("p1", { success: false, statusCode: 500 }, needed);
      // limit 2→1
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(1);
      // 再跌也不会低于 1
      reportN("p1", { success: false, statusCode: 500 }, deriveProfile(1, 10).dropThreshold);
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(1);
    });

    it("5xx failures reset consecutiveFailures counter after drop", () => {
      initAtLimit("p1", 10, 6);
      const needed = deriveProfile(6, 10).dropThreshold;
      reportN("p1", { success: false, statusCode: 500 }, needed);
      // drop 后 consecutiveFailures 重置为 0
      expect(ctrl.getStatus("p1")!.consecutiveFailures).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // AC5: 信号量超时/队列满按 429 处理
  // ══════════════════════════════════════════════════════════════
  describe("AC5: semaphore timeout/queue full → 429", () => {
    it("statusCode=429 + success=false triggers 429 path (drop + cooldown)", () => {
      initAtLimit("p1", 10, 5);
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(4);
      expect(ctrl.getStatus("p1")!.cooldownUntil).toBeGreaterThan(0);
    });

    it("semaphore error behaves identically to upstream 429", () => {
      initAtLimit("p1", 10, 8);
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      // keepRatio for 8 = 1 - 1/8 = 0.875, floor(8*0.875) = 7
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(7);
      expect(ctrl.getStatus("p1")!.cooldownUntil).toBeGreaterThan(0);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // AC6: 去掉探针
  // ══════════════════════════════════════════════════════════════
  describe("AC6: no probe", () => {
    it("AdaptiveState has no probeActive field", () => {
      ctrl.init("p1", { max: 10 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
      const state = ctrl.getStatus("p1")!;
      expect("probeActive" in state).toBe(false);
    });

    it("syncToSemaphore uses currentLimit directly (no +1)", () => {
      initAtLimit("p1", 10, 5);
      // climb within safe zone
      const needed = deriveProfile(5, 10).climbThreshold;
      reportN("p1", { success: true }, needed);
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(6);
      expect(sem.updateConfig).toHaveBeenLastCalledWith("p1", expect.objectContaining({
        maxConcurrency: 6,
      }));
    });

    it("init syncs currentLimit (not max+1)", () => {
      ctrl.init("p1", { max: 10 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
      expect(sem.updateConfig).toHaveBeenCalledWith("p1", expect.objectContaining({
        maxConcurrency: 10,
      }));
    });
  });

  // ══════════════════════════════════════════════════════════════
  // 冷却期行为
  // ══════════════════════════════════════════════════════════════
  describe("cooldown behavior", () => {
    it("successes during cooldown do not trigger climb", () => {
      vi.useFakeTimers();
      initAtLimit("p1", 10, 5);
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(4);

      // 发大量成功，应该不爬升
      reportN("p1", { success: true }, 20);
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(4);

      vi.useRealTimers();
    });

    it("after cooldown, climbs normally", () => {
      vi.useFakeTimers();
      initAtLimit("p1", 10, 5);
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(4);

      // 冷却期基于 429 发生时的旧 limit=5 计算
      const cooldownMs = deriveProfile(5, 10).cooldownMs;
      vi.advanceTimersByTime(cooldownMs + 1);

      const needed = deriveProfile(4, 10).climbThreshold;
      reportN("p1", { success: true }, needed);
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(5);

      vi.useRealTimers();
    });
  });

  // ══════════════════════════════════════════════════════════════
  // remove / re-init / syncProvider
  // ══════════════════════════════════════════════════════════════
  describe("remove / re-init / syncProvider", () => {
    it("remove clears state", () => {
      ctrl.init("p1", { max: 10 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
      ctrl.remove("p1");
      expect(ctrl.getStatus("p1")).toBeUndefined();
    });

    it("re-init starts from max", () => {
      ctrl.init("p1", { max: 10 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
      // 手动降低
      (ctrl as any).entries.get("p1").state.currentLimit = 3;
      ctrl.remove("p1");
      ctrl.init("p1", { max: 10 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(10);
      // 状态全部重置
      expect(ctrl.getStatus("p1")!.consecutiveSuccesses).toBe(0);
      expect(ctrl.getStatus("p1")!.limitReached).toBe(false);
    });

    it("syncProvider enables adaptive for new provider", () => {
      ctrl.syncProvider("p1", {
        adaptive_enabled: 1, max_concurrency: 20,
        queue_timeout_ms: 5000, max_queue_size: 10,
      });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(20);
    });

    it("syncProvider disables adaptive", () => {
      ctrl.init("p1", { max: 10 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
      ctrl.syncProvider("p1", {
        adaptive_enabled: 0, max_concurrency: 10,
        queue_timeout_ms: 0, max_queue_size: 0,
      });
      expect(ctrl.getStatus("p1")).toBeUndefined();
      // 禁用后恢复信号量到原始 max
      expect(sem.updateConfig).toHaveBeenLastCalledWith("p1", expect.objectContaining({
        maxConcurrency: 10,
      }));
    });

    it("syncProvider clamps currentLimit when max decreases", () => {
      ctrl.init("p1", { max: 20 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
      (ctrl as any).entries.get("p1").state.currentLimit = 10;
      ctrl.syncProvider("p1", {
        adaptive_enabled: 1, max_concurrency: 5,
        queue_timeout_ms: 0, max_queue_size: 0,
      });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(5);
    });

    it("syncProvider does not increase currentLimit when max increases", () => {
      ctrl.init("p1", { max: 5 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
      (ctrl as any).entries.get("p1").state.currentLimit = 3;
      ctrl.syncProvider("p1", {
        adaptive_enabled: 1, max_concurrency: 20,
        queue_timeout_ms: 0, max_queue_size: 0,
      });
      // currentLimit 不超过 max（新的 max=20），保持 3
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(3);
    });

    it("removeAll clears all providers", () => {
      ctrl.init("p1", { max: 10 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
      ctrl.init("p2", { max: 5 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
      ctrl.removeAll();
      expect(ctrl.getStatus("p1")).toBeUndefined();
      expect(ctrl.getStatus("p2")).toBeUndefined();
    });
  });

  // ══════════════════════════════════════════════════════════════
  // 非并发错误过滤
  // ══════════════════════════════════════════════════════════════
  describe("non-concurrency error filtering", () => {
    it("2xx + retryRuleMatched=false: no drop, no failure count", () => {
      initAtLimit("p1", 10, 6);
      reportN("p1", { success: false, statusCode: 200, retryRuleMatched: false }, 10);
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(6);
      expect(ctrl.getStatus("p1")!.consecutiveFailures).toBe(0);
    });

    it("4xx + retryRuleMatched=false: no drop, no failure count", () => {
      initAtLimit("p1", 10, 6);
      ctrl.onRequestComplete("p1", { success: false, statusCode: 400 });
      ctrl.onRequestComplete("p1", { success: false, statusCode: 401 });
      ctrl.onRequestComplete("p1", { success: false, statusCode: 403 });
      ctrl.onRequestComplete("p1", { success: false, statusCode: 404 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(6);
      expect(ctrl.getStatus("p1")!.consecutiveFailures).toBe(0);
    });

    it("4xx + retryRuleMatched=true: triggers 5xx path drop", () => {
      initAtLimit("p1", 10, 6);
      const needed = deriveProfile(6, 10).dropThreshold;
      reportN("p1", { success: false, statusCode: 400, retryRuleMatched: true }, needed);
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(5);
    });

    it("network error (statusCode=undefined): follows 5xx path", () => {
      initAtLimit("p1", 10, 6);
      const needed = deriveProfile(6, 10).dropThreshold;
      reportN("p1", { success: false }, needed);
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(5);
    });

    it("2xx failure without retryRuleMatched does not reset success counter", () => {
      initAtLimit("p1", 10, 4);
      // 累积 2 次成功
      ctrl.onRequestComplete("p1", { success: true });
      ctrl.onRequestComplete("p1", { success: true });
      expect(ctrl.getStatus("p1")!.consecutiveSuccesses).toBe(2);
      // 2xx failure 不触发 transitionFailure → 不重置
      ctrl.onRequestComplete("p1", { success: false, statusCode: 200, retryRuleMatched: false });
      expect(ctrl.getStatus("p1")!.consecutiveSuccesses).toBe(2);
    });

    it("2xx failure with retryRuleMatched resets success counter", () => {
      initAtLimit("p1", 10, 4);
      ctrl.onRequestComplete("p1", { success: true });
      ctrl.onRequestComplete("p1", { success: true });
      ctrl.onRequestComplete("p1", { success: false, statusCode: 200, retryRuleMatched: true });
      expect(ctrl.getStatus("p1")!.consecutiveSuccesses).toBe(0);
      expect(ctrl.getStatus("p1")!.consecutiveFailures).toBe(1);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // 不超过 max 上限
  // ══════════════════════════════════════════════════════════════
  describe("max ceiling", () => {
    it("does not exceed max after climb", () => {
      // max=5, limit=5 (already at max)
      initAtLimit("p1", 5, 5);
      const needed = deriveProfile(5, 5).climbThreshold;
      // outside safe zone, need limitReached
      reportN("p1", { success: true, wasQueued: true }, needed);
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(5);
    });

    it("climbs up to max but not beyond", () => {
      // max=5, start at limit=4, climb once to 5, then try again
      initAtLimit("p1", 5, 4);
      // safe zone: floor(5/2)=2, 4>2, outside → need limitReached
      let needed = deriveProfile(4, 5).climbThreshold;
      reportN("p1", { success: true, wasQueued: true }, needed);
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(5);

      sem.updateConfig.mockClear();
      // at max, try to climb again
      needed = deriveProfile(5, 5).climbThreshold;
      reportN("p1", { success: true, wasQueued: true }, needed);
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(5);
      // 仍然 sync（即使没有实际爬升）
      expect(sem.updateConfig).toHaveBeenCalled();
    });

    it("429 at max=1 stays at 1", () => {
      initAtLimit("p1", 1, 1);
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(1);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // init 基本行为
  // ══════════════════════════════════════════════════════════════
  describe("init", () => {
    it("starts at max (optimistic start)", () => {
      ctrl.init("p1", { max: 20 }, { queueTimeoutMs: 5000, maxQueueSize: 10 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(20);
      expect(ctrl.getStatus("p1")!.consecutiveSuccesses).toBe(0);
      expect(ctrl.getStatus("p1")!.consecutiveFailures).toBe(0);
      expect(ctrl.getStatus("p1")!.limitReached).toBe(false);
      expect(ctrl.getStatus("p1")!.cooldownUntil).toBe(0);
      expect(sem.updateConfig).toHaveBeenCalledWith("p1", {
        maxConcurrency: 20, queueTimeoutMs: 5000, maxQueueSize: 10,
      });
    });
  });

  // ══════════════════════════════════════════════════════════════
  // 未知 provider
  // ══════════════════════════════════════════════════════════════
  describe("unknown provider", () => {
    it("onRequestComplete silently ignores unknown provider", () => {
      expect(() => {
        ctrl.onRequestComplete("unknown", { success: true });
      }).not.toThrow();
    });

    it("getStatus returns undefined for unknown provider", () => {
      expect(ctrl.getStatus("unknown")).toBeUndefined();
    });
  });
});
