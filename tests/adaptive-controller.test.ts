import { describe, it, expect, vi, beforeEach } from "vitest";
import { AdaptiveConcurrencyController } from "../src/proxy/adaptive-controller.js";

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

describe("AdaptiveConcurrencyController", () => {
  let ctrl: AdaptiveConcurrencyController;
  let sem: ReturnType<typeof createMockSemaphore>;

  beforeEach(() => {
    sem = createMockSemaphore();
    ctrl = new AdaptiveConcurrencyController(sem as any);
  });

  describe("init", () => {
    it("starts at max (optimistic start)", () => {
      ctrl.init("p1", { max: 20 }, { queueTimeoutMs: 5000, maxQueueSize: 10 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(20);
      expect(ctrl.getStatus("p1")!.probeActive).toBe(true);
      // probeActive: effectiveLimit = min(20 + 1, 20) = 20
      expect(sem.updateConfig).toHaveBeenCalledWith("p1", {
        maxConcurrency: 20, queueTimeoutMs: 5000, maxQueueSize: 10,
      });
    });
  });

  describe("success transitions", () => {
    beforeEach(() => {
      ctrl.init("p1", { max: 20 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
      // 模拟 adaptive 已经过 backoff 降到 currentLimit=3, probeActive=false
      ctrl["entries"].get("p1")!.state.currentLimit = 3;
      ctrl["entries"].get("p1")!.state.probeActive = false;
      sem.updateConfig.mockClear();
    });

    it("opens probe window after 3 consecutive successes", () => {
      for (let i = 0; i < 3; i++) ctrl.onRequestComplete("p1", { success: true });
      expect(ctrl.getStatus("p1")!.probeActive).toBe(true);
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(3);
      expect(sem.updateConfig).toHaveBeenLastCalledWith("p1", {
        maxConcurrency: 4, queueTimeoutMs: 0, maxQueueSize: 0,
      });
    });

    it("increases limit after 3 more successes with probe active", () => {
      for (let i = 0; i < 3; i++) ctrl.onRequestComplete("p1", { success: true }); // open probe
      sem.updateConfig.mockClear();
      for (let i = 0; i < 3; i++) ctrl.onRequestComplete("p1", { success: true }); // confirm
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(4);
      expect(ctrl.getStatus("p1")!.probeActive).toBe(true);
      expect(sem.updateConfig).toHaveBeenLastCalledWith("p1", {
        maxConcurrency: 5, queueTimeoutMs: 0, maxQueueSize: 0,
      });
    });

    it("does not exceed hard max", () => {
      ctrl.init("p1", { max: 4 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
      ctrl["entries"].get("p1")!.state.currentLimit = 3;
      for (let i = 0; i < 3; i++) ctrl.onRequestComplete("p1", { success: true }); // open probe
      for (let i = 0; i < 3; i++) ctrl.onRequestComplete("p1", { success: true }); // increase to 4
      sem.updateConfig.mockClear();
      for (let i = 0; i < 3; i++) ctrl.onRequestComplete("p1", { success: true }); // try but capped
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(4);
      expect(sem.updateConfig).toHaveBeenLastCalledWith("p1", {
        maxConcurrency: 4, queueTimeoutMs: 0, maxQueueSize: 0,
      });
    });

    it("resets failure counter on success", () => {
      ctrl.onRequestComplete("p1", { success: false, statusCode: 500 });
      ctrl.onRequestComplete("p1", { success: true });
      expect(ctrl.getStatus("p1")!.consecutiveFailures).toBe(0);
      expect(ctrl.getStatus("p1")!.consecutiveSuccesses).toBe(1);
    });
  });

  describe("429 handling", () => {
    beforeEach(() => {
      ctrl.init("p1", { max: 20 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
      ctrl["entries"].get("p1")!.state.currentLimit = 8;
      sem.updateConfig.mockClear();
    });

    it("halves limit on 429", () => {
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(4);
      expect(ctrl.getStatus("p1")!.probeActive).toBe(false);
    });

    it("enters cooldown after 429", () => {
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      expect(ctrl.getStatus("p1")!.cooldownUntil).toBeGreaterThan(Date.now());
    });

    it("does not adjust during cooldown", () => {
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      for (let i = 0; i < 3; i++) ctrl.onRequestComplete("p1", { success: true });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(4);
      expect(ctrl.getStatus("p1")!.consecutiveSuccesses).toBe(3);
    });

    it("respects hard min of 1", () => {
      ctrl["entries"].get("p1")!.state.currentLimit = 3;
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(1);
    });
  });

  describe("non-429 failures (5xx)", () => {
    beforeEach(() => {
      ctrl.init("p1", { max: 20 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
      ctrl["entries"].get("p1")!.state.currentLimit = 6;
      sem.updateConfig.mockClear();
    });

    it("decreases by 2 after 3 consecutive 5xx failures", () => {
      for (let i = 0; i < 3; i++) ctrl.onRequestComplete("p1", { success: false, statusCode: 500 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(4);
      expect(ctrl.getStatus("p1")!.probeActive).toBe(false);
    });

    it("does not decrease on non-consecutive failures", () => {
      ctrl.onRequestComplete("p1", { success: false, statusCode: 500 });
      ctrl.onRequestComplete("p1", { success: true });
      ctrl.onRequestComplete("p1", { success: false, statusCode: 500 });
      ctrl.onRequestComplete("p1", { success: false, statusCode: 500 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(6);
    });

    it("respects hard min of 1", () => {
      ctrl["entries"].get("p1")!.state.currentLimit = 2;
      for (let i = 0; i < 3; i++) ctrl.onRequestComplete("p1", { success: false, statusCode: 500 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(1);
    });

    it("decreases on 502, 503, 504", () => {
      ctrl.onRequestComplete("p1", { success: false, statusCode: 502 });
      ctrl.onRequestComplete("p1", { success: false, statusCode: 503 });
      ctrl.onRequestComplete("p1", { success: false, statusCode: 504 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(4);
    });

    it("decreases on network error (undefined statusCode)", () => {
      for (let i = 0; i < 3; i++) ctrl.onRequestComplete("p1", { success: false });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(4);
    });
  });

  describe("non-concurrency failures (2xx/4xx)", () => {
    beforeEach(() => {
      ctrl.init("p1", { max: 20 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
      ctrl["entries"].get("p1")!.state.currentLimit = 6;
      sem.updateConfig.mockClear();
    });

    it("ignores stream_error with upstream 200 (body error)", () => {
      for (let i = 0; i < 5; i++) ctrl.onRequestComplete("p1", { success: false, statusCode: 200 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(6);
      expect(ctrl.getStatus("p1")!.consecutiveFailures).toBe(0);
    });

    it("ignores 4xx client errors", () => {
      ctrl.onRequestComplete("p1", { success: false, statusCode: 400 });
      ctrl.onRequestComplete("p1", { success: false, statusCode: 401 });
      ctrl.onRequestComplete("p1", { success: false, statusCode: 403 });
      ctrl.onRequestComplete("p1", { success: false, statusCode: 404 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(6);
      expect(ctrl.getStatus("p1")!.consecutiveFailures).toBe(0);
    });

    it("does not reset success counter on 2xx/4xx failures", () => {
      ctrl.onRequestComplete("p1", { success: true });
      ctrl.onRequestComplete("p1", { success: true });
      ctrl.onRequestComplete("p1", { success: false, statusCode: 200 });
      expect(ctrl.getStatus("p1")!.consecutiveSuccesses).toBe(2); // not reset
      expect(ctrl.getStatus("p1")!.consecutiveFailures).toBe(0); // not incremented
    });
  });

  describe("cooldown expiry", () => {
    it("resumes after cooldown", () => {
      vi.useFakeTimers();
      ctrl.init("p1", { max: 20 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
      ctrl["entries"].get("p1")!.state.currentLimit = 4;
      ctrl.onRequestComplete("p1", { success: false, statusCode: 429 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(2);
      vi.advanceTimersByTime(31_000);
      for (let i = 0; i < 3; i++) ctrl.onRequestComplete("p1", { success: true });
      expect(ctrl.getStatus("p1")!.probeActive).toBe(true);
      vi.useRealTimers();
    });
  });

  describe("remove / re-init", () => {
    it("cleans up on remove", () => {
      ctrl.init("p1", { max: 20 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
      ctrl.remove("p1");
      expect(ctrl.getStatus("p1")).toBeUndefined();
    });

    it("re-inits from scratch at max", () => {
      ctrl.init("p1", { max: 20 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
      ctrl["entries"].get("p1")!.state.currentLimit = 6;
      ctrl.remove("p1");
      ctrl.init("p1", { max: 20 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(20);
      expect(ctrl.getStatus("p1")!.probeActive).toBe(true);
    });
  });

  describe("syncProvider", () => {
    it("initializes on enable at max", () => {
      ctrl.syncProvider("p1", {
        adaptive_enabled: 1, max_concurrency: 20,
        queue_timeout_ms: 5000, max_queue_size: 10,
      });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(20);
      expect(ctrl.getStatus("p1")!.probeActive).toBe(true);
    });

    it("removes on disable", () => {
      ctrl.init("p1", { max: 20 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
      ctrl.syncProvider("p1", {
        adaptive_enabled: 0, max_concurrency: 20,
        queue_timeout_ms: 0, max_queue_size: 0,
      });
      expect(ctrl.getStatus("p1")).toBeUndefined();
    });

    it("clamps current limit when max_concurrency decreases", () => {
      ctrl.init("p1", { max: 20 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
      ctrl["entries"].get("p1")!.state.currentLimit = 10;
      ctrl.syncProvider("p1", {
        adaptive_enabled: 1, max_concurrency: 5,
        queue_timeout_ms: 0, max_queue_size: 0,
      });
      expect(ctrl.getStatus("p1")!.currentLimit).toBe(5);
    });
  });
});
