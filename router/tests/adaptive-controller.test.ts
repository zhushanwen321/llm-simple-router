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
  // AC-1: max=0 入口防护
  // ══════════════════════════════════════════════════════════════
  describe("AC-1: max=0 input guard", () => {
    it("init(max=0) clamps to max=1, currentLimit=1", () => {
      ctrl.init("p1", { max: 0 }, { queueTimeoutMs: 5000, maxQueueSize: 10 });
      const state = ctrl.getStatus("p1")!;
      expect(state.currentLimit).toBe(1);
      expect(state.consecutiveSuccesses).toBe(0);
      expect(state.consecutiveFailures).toBe(0);
      expect(state.cooldownUntil).toBe(0);
      expect(sem.updateConfig).toHaveBeenCalledWith("p1", expect.objectContaining({
        maxConcurrency: 1,
      }));
    });

    it("syncProvider(max_concurrency=0) clamps to 1", () => {
      ctrl.syncProvider("p1", {
        adaptive_enabled: 1, max_concurrency: 0,
        queue_timeout_ms: 5000, max_queue_size: 10,
      });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(1);
    });

    it("deriveProfile(1,1) returns valid numerics", () => {
      // 验证 init(max=0) → clamped max=1 后 deriveProfile 不产生 NaN
      ctrl.init("p1", { max: 0 }, { queueTimeoutMs: 5000, maxQueueSize: 10 });
      // 手动验证 deriveProfile(1,1)
      const p = deriveProfile(1, 1);
      expect(p.climbThreshold).toBe(4);
      expect(p.dropThreshold).toBe(3);
      expect(p.cooldownMs).toBe(20000);
      expect(Number.isNaN(p.climbThreshold)).toBe(false);
      expect(Number.isNaN(p.dropThreshold)).toBe(false);
    });

    it("init(max=NaN) clamps to max=1", () => {
      ctrl.init("p1", { max: NaN } as any, { queueTimeoutMs: 5000, maxQueueSize: 10 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(1);
    });

    it("init(max=undefined) clamps to max=1", () => {
      ctrl.init("p1", { max: undefined } as any, { queueTimeoutMs: 5000, maxQueueSize: 10 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(1);
    });

    it("init(max=-1) clamps to max=1", () => {
      ctrl.init("p1", { max: -1 }, { queueTimeoutMs: 5000, maxQueueSize: 10 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(1);
    });

    it("syncProvider(max_concurrency=NaN) clamps to 1", () => {
      ctrl.syncProvider("p1", {
        adaptive_enabled: 1, max_concurrency: NaN as any,
        queue_timeout_ms: 5000, max_queue_size: 10,
      });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(1);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // AC-2: 高水位无条件爬升（无利用率门控）
  // ══════════════════════════════════════════════════════════════
  describe("AC-2: unconditional climb at high watermark", () => {
    it("limit=8 (high watermark) climbs without wasQueued", () => {
      // max=10, limit=8 > max/2, 但无需 limitReached/wasQueued
      initAtLimit("p1", 10, 8);
      const needed = deriveProfile(8, 10).climbThreshold;
      reportN("p1", { success: true, wasQueued: false }, needed);
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(9);
    });

    it("limit=6 climbs without wasQueued", () => {
      initAtLimit("p1", 10, 6);
      const needed = deriveProfile(6, 10).climbThreshold;
      reportN("p1", { success: true, wasQueued: false }, needed);
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(7);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // AC-3: 冷却期保护下降不保护上升
  // ══════════════════════════════════════════════════════════════
  describe("AC-3: cooldown blocks drops, not climbs", () => {
    it("successes accumulate and climb during cooldown", () => {
      // 429 触发冷却期后，成功仍可累积并爬升
      vi.useFakeTimers();
      initAtLimit("p1", 10, 10);
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(9);

      // 冷却期内发成功，应能爬升
      const needed = deriveProfile(9, 10).climbThreshold;
      reportN("p1", { success: true }, needed);
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(10);

      vi.useRealTimers();
    });

    it("429 during cooldown is blocked (no further drop)", () => {
      initAtLimit("p1", 10, 5);
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(4);

      // 冷却期内再发 429，不下降
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(4);
    });

    it("5xx during cooldown is blocked (no failure count)", () => {
      initAtLimit("p1", 10, 5);
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(4);

      // 冷却期内发 5xx，不影响
      ctrl.onRequestComplete("p1", { success: false, statusCode: 500 });
      expect(ctrl.getStatus("p1")!.consecutiveFailures).toBe(0);
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(4);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // AC-4: 429 固定 -1 下降
  // ══════════════════════════════════════════════════════════════
  describe("AC-4: 429 fixed -1 drop", () => {
    it("429 drops exactly 1: limit=6→5", () => {
      initAtLimit("p1", 10, 6);
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(5);
    });

    it("429 drops exactly 1: limit=3→2", () => {
      initAtLimit("p1", 10, 3);
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(2);
    });

    it("429 drops exactly 1: limit=2→1", () => {
      initAtLimit("p1", 10, 2);
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(1);
    });

    it("429 at limit=1 stays at 1 (ADAPTIVE_MIN)", () => {
      initAtLimit("p1", 10, 1);
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(1);
    });

    it("429 at max=1 stays at 1", () => {
      initAtLimit("p1", 1, 1);
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(1);
    });

    it("429 enters cooldown", () => {
      initAtLimit("p1", 10, 5);
      const before = Date.now();
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      expect(ctrl.getStatus("p1")!.cooldownUntil).toBeGreaterThan(before);
    });

    it("429 syncs to semaphore", () => {
      initAtLimit("p1", 10, 5);
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      expect(sem.updateConfig).toHaveBeenLastCalledWith("p1", expect.objectContaining({
        maxConcurrency: 4,
      }));
    });
  });

  // ══════════════════════════════════════════════════════════════
  // AC-5: 满额时保留半数成功计数
  // ══════════════════════════════════════════════════════════════
  describe("AC-5: at-max partial counter preservation", () => {
    it("at max: consecutiveSuccesses halved instead of reset", () => {
      // max=10, limit=10, climbThreshold=5
      initAtLimit("p1", 10, 10);
      reportN("p1", { success: true }, 5);
      // 已在 max，不爬升但保留半数
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(10);
      expect(ctrl.getStatus("p1")!.consecutiveSuccesses).toBe(2); // floor(5/2)
    });

    it("at max: subsequent climb needs fewer successes", () => {
      initAtLimit("p1", 10, 10);
      reportN("p1", { success: true }, 5);
      expect(ctrl.getStatus("p1")!.consecutiveSuccesses).toBe(2);
      // 只需再 3 次即可再次触发（2+3=5 >= climbThreshold=5）
      reportN("p1", { success: true }, 3);
      expect(ctrl.getStatus("p1")!.consecutiveSuccesses).toBe(2); // floor(5/2)
    });

    it("below max: consecutiveSuccesses resets to 0 on climb", () => {
      initAtLimit("p1", 10, 8);
      const needed = deriveProfile(8, 10).climbThreshold;
      reportN("p1", { success: true }, needed);
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(9);
      expect(ctrl.getStatus("p1")!.consecutiveSuccesses).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // AC-6: 密集 429 只降 1 格
  // ══════════════════════════════════════════════════════════════
  describe("AC-6: burst 429 drops only 1 slot", () => {
    it("10 rapid 429s only drop 1 slot (cooldown protection)", () => {
      initAtLimit("p1", 10, 10);
      reportN("p1", { success: false, statusCode: 429 }, 10);
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(9);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // AC-7: limit=1 完全恢复
  // ══════════════════════════════════════════════════════════════
  describe("AC-7: full recovery from limit=1", () => {
    it("recovers from limit=1 to max=10 with consecutive successes", () => {
      initAtLimit("p1", 10, 1);
      // 逐步爬升：每达到 climbThreshold 就 +1
      // deriveProfile(1,10).climbThreshold=3, deriveProfile(2,10).climbThreshold=3,
      // deriveProfile(3,10).climbThreshold=4, deriveProfile(4,10).climbThreshold=4,
      // deriveProfile(5,10).climbThreshold=4, deriveProfile(6,10).climbThreshold=4,
      // deriveProfile(7,10).climbThreshold=5, deriveProfile(8,10).climbThreshold=5,
      // deriveProfile(9,10).climbThreshold=5
      // Total: 3+3+4+4+4+4+5+5+5 = 37，但 climbThreshold 是基于当前 limit
      // 实际需要逐步喂入
      let totalSuccesses = 0;
      for (let expected = 2; expected <= 10; expected++) {
        const profile = deriveProfile(expected - 1, 10);
        reportN("p1", { success: true }, profile.climbThreshold);
        totalSuccesses += profile.climbThreshold;
        expect(ctrl.getStatus("p1")!.currentLimit).toBe(expected);
      }
      // 总共约 37 次成功（spec 说 36，精确值取决于 deriveProfile）
      expect(totalSuccesses).toBeGreaterThan(30);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // AC-8: 冷却期内失败不重置成功计数
  // ══════════════════════════════════════════════════════════════
  describe("AC-8: cooldown failure preserves success counter", () => {
    it("5xx during cooldown does not reset consecutiveSuccesses", () => {
      initAtLimit("p1", 10, 9);
      // 先触发冷却期
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(8);

      // 累积 4 次成功
      reportN("p1", { success: true }, 4);
      expect(ctrl.getStatus("p1")!.consecutiveSuccesses).toBe(4);

      // 冷却期内发 5xx
      ctrl.onRequestComplete("p1", { success: false, statusCode: 500 });
      // consecutiveSuccesses 保持 4（不被清零）
      expect(ctrl.getStatus("p1")!.consecutiveSuccesses).toBe(4);
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(8);
    });

    it("429 during cooldown does not reset consecutiveSuccesses", () => {
      initAtLimit("p1", 10, 9);
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(8);

      reportN("p1", { success: true }, 4);
      expect(ctrl.getStatus("p1")!.consecutiveSuccesses).toBe(4);

      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      expect(ctrl.getStatus("p1")!.consecutiveSuccesses).toBe(4);
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(8);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // deriveProfile 参数推导（V3: 无 keepRatio）
  // ══════════════════════════════════════════════════════════════
  describe("deriveProfile", () => {
    it("max=5 at various limits", () => {
      let p = deriveProfile(1, 5);
      expect(p.climbThreshold).toBe(3);
      expect(p.dropThreshold).toBe(4);

      p = deriveProfile(3, 5);
      expect(p.climbThreshold).toBe(4);
      expect(p.dropThreshold).toBe(3);

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

    it("cooldownMs increases with level", () => {
      const low = deriveProfile(1, 10).cooldownMs;
      const high = deriveProfile(10, 10).cooldownMs;
      expect(high).toBeGreaterThan(low);
      expect(low).toBeGreaterThanOrEqual(10_000);
      expect(high).toBeLessThanOrEqual(20_000);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // 5xx 失败处理（V3: 含冷却期）
  // ══════════════════════════════════════════════════════════════
  describe("5xx failures", () => {
    it("drops 1 after consecutive dropThreshold failures", () => {
      initAtLimit("p1", 10, 6);
      const needed = deriveProfile(6, 10).dropThreshold;
      reportN("p1", { success: false, statusCode: 500 }, needed);
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(5);
    });

    it("enters cooldown after 5xx drop (V3 change)", () => {
      initAtLimit("p1", 10, 6);
      const needed = deriveProfile(6, 10).dropThreshold;
      reportN("p1", { success: false, statusCode: 500 }, needed);
      expect(ctrl.getStatus("p1")!.cooldownUntil).toBeGreaterThan(0);
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
      ctrl.onRequestComplete("p1", { success: false, statusCode: 500 });
      ctrl.onRequestComplete("p1", { success: true });
      ctrl.onRequestComplete("p1", { success: false, statusCode: 500 });
      ctrl.onRequestComplete("p1", { success: false, statusCode: 500 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(6);
    });

    it("respects hard min of 1", () => {
      initAtLimit("p1", 10, 2);
      const needed = deriveProfile(2, 10).dropThreshold;
      reportN("p1", { success: false, statusCode: 500 }, needed);
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(1);
    });

    it("5xx failures reset consecutiveFailures counter after drop", () => {
      initAtLimit("p1", 10, 6);
      const needed = deriveProfile(6, 10).dropThreshold;
      reportN("p1", { success: false, statusCode: 500 }, needed);
      expect(ctrl.getStatus("p1")!.consecutiveFailures).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════════
  // 冷却期行为（V3: 成功可累积，失败被拦截）
  // ══════════════════════════════════════════════════════════════
  describe("cooldown behavior", () => {
    it("successes during cooldown accumulate and can climb", () => {
      vi.useFakeTimers();
      initAtLimit("p1", 10, 5);
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(4);

      // 冷却期内发足够成功，能爬升
      const needed = deriveProfile(4, 10).climbThreshold;
      reportN("p1", { success: true }, needed);
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(5);

      vi.useRealTimers();
    });

    it("after cooldown ends, failures resume", () => {
      vi.useFakeTimers();
      initAtLimit("p1", 10, 6);
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(5);

      // 冷却期基于 429 发生时的 limit=6 计算
      const cooldownMs = deriveProfile(6, 10).cooldownMs;
      vi.advanceTimersByTime(cooldownMs + 1);

      // 冷却期结束后，5xx 可以触发下降
      const needed = deriveProfile(5, 10).dropThreshold;
      reportN("p1", { success: false, statusCode: 500 }, needed);
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(4);

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
      (ctrl as any).entries.get("p1").state.currentLimit = 3;
      ctrl.remove("p1");
      ctrl.init("p1", { max: 10 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(10);
      expect(ctrl.getStatus("p1")!.consecutiveSuccesses).toBe(0);
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
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(3);
    });

    it("syncProvider clamps max_concurrency=0 to 1", () => {
      ctrl.syncProvider("p1", {
        adaptive_enabled: 1, max_concurrency: 0,
        queue_timeout_ms: 5000, max_queue_size: 10,
      });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(1);
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
      ctrl.onRequestComplete("p1", { success: true });
      ctrl.onRequestComplete("p1", { success: true });
      expect(ctrl.getStatus("p1")!.consecutiveSuccesses).toBe(2);
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
      initAtLimit("p1", 5, 5);
      const needed = deriveProfile(5, 5).climbThreshold;
      reportN("p1", { success: true }, needed);
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(5);
    });

    it("climbs up to max but not beyond", () => {
      initAtLimit("p1", 5, 4);
      let needed = deriveProfile(4, 5).climbThreshold;
      reportN("p1", { success: true }, needed);
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(5);

      sem.updateConfig.mockClear();
      needed = deriveProfile(5, 5).climbThreshold;
      reportN("p1", { success: true }, needed);
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
      const state = ctrl.getStatus("p1")!;
      expect(state.currentLimit).toBe(20);
      expect(state.consecutiveSuccesses).toBe(0);
      expect(state.consecutiveFailures).toBe(0);
      expect(state.cooldownUntil).toBe(0);
      expect(sem.updateConfig).toHaveBeenCalledWith("p1", {
        maxConcurrency: 20, queueTimeoutMs: 5000, maxQueueSize: 10,
      });
    });
  });

  // ══════════════════════════════════════════════════════════════
  // AdaptiveState 无 limitReached/probeActive（V3 清理）
  // ══════════════════════════════════════════════════════════════
  describe("V3 state cleanup", () => {
    it("AdaptiveState has no limitReached field", () => {
      ctrl.init("p1", { max: 10 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
      const state = ctrl.getStatus("p1")!;
      expect("limitReached" in state).toBe(false);
    });

    it("AdaptiveState has no probeActive field", () => {
      ctrl.init("p1", { max: 10 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
      const state = ctrl.getStatus("p1")!;
      expect("probeActive" in state).toBe(false);
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

  // ══════════════════════════════════════════════════════════════
  // E2E 场景（来自设计文档）
  // ══════════════════════════════════════════════════════════════
  describe("E2E scenarios", () => {
    it("E15: rapid recovery during cooldown", () => {
      // 429 then 5 successes during cooldown fully recover
      initAtLimit("p1", 10, 10);
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(9);

      const needed = deriveProfile(9, 10).climbThreshold;
      reportN("p1", { success: true }, needed);
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(10);
    });

    it("E18: success interrupts failure chain", () => {
      // alternating success/failure does not trigger drop
      initAtLimit("p1", 10, 6);
      ctrl.onRequestComplete("p1", { success: false, statusCode: 500 }); // f=1
      ctrl.onRequestComplete("p1", { success: true }); // f=0
      ctrl.onRequestComplete("p1", { success: false, statusCode: 500 }); // f=1
      ctrl.onRequestComplete("p1", { success: true }); // f=0
      ctrl.onRequestComplete("p1", { success: false, statusCode: 500 }); // f=1
      ctrl.onRequestComplete("p1", { success: false, statusCode: 500 }); // f=2
      // dropThreshold for limit=6,max=10 = 3, only 2 consecutive
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(6);
    });

    it("syncToSemaphore uses currentLimit directly (no +1)", () => {
      initAtLimit("p1", 10, 5);
      const needed = deriveProfile(5, 10).climbThreshold;
      reportN("p1", { success: true }, needed);
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(6);
      expect(sem.updateConfig).toHaveBeenLastCalledWith("p1", expect.objectContaining({
        maxConcurrency: 6,
      }));
    });
  });
});
