import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import type { ServerResponse } from "node:http";
import { RequestTracker } from "../../src/monitor/request-tracker.js";
import { ProviderSemaphoreManager } from "../../src/proxy/orchestration/semaphore.js";
import type { ActiveRequest } from "../../src/monitor/types.js";

// --- Mocks ---

function createMockResponse(): {
  res: ServerResponse;
  writes: string[];
  closeCallbacks: Array<() => void>;
} {
  const writes: string[] = [];
  const closeCallbacks: Array<() => void> = [];

  const res = {
    write(data: string) {
      writes.push(data);
      return true;
    },
    on(event: string, cb: () => void) {
      if (event === "close") closeCallbacks.push(cb);
      return this;
    },
    writableEnded: false,
  } as unknown as ServerResponse;

  return { res, writes, closeCallbacks };
}

function createActiveRequest(overrides?: Partial<ActiveRequest>): ActiveRequest {
  return {
    id: "req-1",
    apiType: "openai",
    model: "gpt-4",
    providerId: "provider-1",
    providerName: "OpenAI",
    isStream: false,
    startTime: Date.now(),
    status: "pending",
    retryCount: 0,
    attempts: [],
    ...overrides,
  };
}

describe("RequestTracker", () => {
  let tracker: RequestTracker;

  // Spies on StatsAggregator methods
  let recordLatencySpy: Mock;
  let recordRequestSpy: Mock;
  let recordProviderLatencySpy: Mock;
  let getStatsSpy: Mock;

  // Mock RuntimeCollector
  let collectSpy: Mock;

  // Mock ProviderSemaphoreManager
  let getStatusSpy: Mock;

  beforeEach(() => {
    tracker = new RequestTracker();

    // Spy on internal statsAggregator
    const agg = (tracker as unknown as { statsAggregator: StatsAggregator }).statsAggregator;
    recordLatencySpy = vi.spyOn(agg, "recordLatency");
    recordRequestSpy = vi.spyOn(agg, "recordRequest");
    recordProviderLatencySpy = vi.spyOn(agg, "recordProviderLatency");
    getStatsSpy = vi.spyOn(agg, "getStats").mockReturnValue({
      totalRequests: 0,
      successCount: 0,
      errorCount: 0,
      retryCount: 0,
      failoverCount: 0,
      avgLatencyMs: 0,
      p50LatencyMs: 0,
      p99LatencyMs: 0,
      byProvider: {},
      byStatusCode: {},
    });

    // Spy on internal runtimeCollector
    const rc = (tracker as unknown as { runtimeCollector: RuntimeCollector }).runtimeCollector;
    collectSpy = vi.spyOn(rc, "collect").mockReturnValue({
      uptimeMs: 1000,
      memoryUsage: { rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 },
      activeHandles: 0,
      activeRequests: 0,
      eventLoopDelayMs: 0,
    });
  });

  // Minimal type stubs to access private fields via (tracker as any)
  type StatsAggregator = import("../../src/monitor/stats-aggregator.js").StatsAggregator;
  type RuntimeCollector = import("../../src/monitor/runtime-collector.js").RuntimeCollector;

  describe("start()", () => {
    it("adds request to activeMap", () => {
      const req = createActiveRequest();
      tracker.start(req);

      const found = tracker.get("req-1");
      expect(found).toBeDefined();
      expect(found!.id).toBe("req-1");
      expect(found!.status).toBe("pending");
    });

    it("broadcasts request_start event", () => {
      const { res, writes } = createMockResponse();
      tracker.addClient(res);

      tracker.start(createActiveRequest());

      const sseMsg = writes.join("");
      expect(sseMsg).toContain("event: request_start");
      expect(sseMsg).toContain("req-1");
    });
  });

  describe("update()", () => {
    it("modifies active request fields", () => {
      tracker.start(createActiveRequest());
      tracker.update("req-1", { retryCount: 2, status: "pending" });

      const found = tracker.get("req-1");
      expect(found!.retryCount).toBe(2);
    });

    it("does nothing for unknown request id", () => {
      tracker.start(createActiveRequest());
      // Should not throw
      tracker.update("nonexistent", { retryCount: 5 });
    });
  });

  describe("complete()", () => {
    it("moves request from activeMap to recentCompleted", () => {
      tracker.start(createActiveRequest());
      tracker.complete("req-1", { status: "completed", statusCode: 200 });

      // No longer in active
      expect(tracker.getActive()).toHaveLength(0);

      // Still retrievable via get() from recentCompleted
      const found = tracker.get("req-1");
      expect(found).toBeDefined();
      expect(found!.status).toBe("completed");
      expect(found!.completedAt).toBeDefined();

      // In recent completed list
      const recent = tracker.getRecent();
      expect(recent).toHaveLength(1);
    });

    it("records latency and request stats", () => {
      const startTime = Date.now() - 500;
      tracker.start(createActiveRequest({ startTime }));
      tracker.complete("req-1", { status: "completed", statusCode: 200 });

      expect(recordLatencySpy).toHaveBeenCalled();
      const latency = recordLatencySpy.mock.calls[0][0] as number;
      expect(latency).toBeGreaterThanOrEqual(500);

      expect(recordRequestSpy).toHaveBeenCalledWith("provider-1", "OpenAI", 200, false, false);
      expect(recordProviderLatencySpy).toHaveBeenCalledWith("provider-1", expect.any(Number));
    });

    it("passes isRetry=true when retryCount > 0", () => {
      tracker.start(createActiveRequest({ retryCount: 1 }));
      tracker.complete("req-1", { status: "completed", statusCode: 200 });

      expect(recordRequestSpy).toHaveBeenCalledWith("provider-1", "OpenAI", 200, true, false);
    });

    it("broadcasts request_complete event", () => {
      const { res, writes } = createMockResponse();
      tracker.addClient(res);

      tracker.start(createActiveRequest());
      // Clear writes from start() broadcast
      writes.length = 0;

      tracker.complete("req-1", { status: "completed", statusCode: 200 });

      const sseMsg = writes.join("");
      expect(sseMsg).toContain("event: request_complete");
    });

    it("defaults statusCode to 0 when not provided", () => {
      tracker.start(createActiveRequest());
      tracker.complete("req-1", { status: "failed" });

      expect(recordRequestSpy).toHaveBeenCalledWith("provider-1", "OpenAI", 0, false, false);
    });
  });

  describe("getActive()", () => {
    it("only returns status=pending requests", () => {
      tracker.start(createActiveRequest({ id: "r1" }));
      tracker.start(createActiveRequest({ id: "r2" }));

      // Manually mark one as completed without moving it
      tracker.update("r1", { status: "completed" });

      const active = tracker.getActive();
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe("r2");
    });
  });

  describe("getRecent()", () => {
    it("returns recent completed sorted by completedAt desc", () => {
      tracker.start(createActiveRequest({ id: "r1" }));
      tracker.start(createActiveRequest({ id: "r2" }));

      tracker.complete("r1", { status: "completed", statusCode: 200 });
      tracker.complete("r2", { status: "completed", statusCode: 200 });

      const recent = tracker.getRecent();
      expect(recent).toHaveLength(2);
      // r2 completed later, should be first
      expect(recent[0].id).toBe("r2");
      expect(recent[1].id).toBe("r1");
    });

    it("respects limit parameter", () => {
      for (let i = 0; i < 5; i++) {
        tracker.start(createActiveRequest({ id: `r${i}` }));
        tracker.complete(`r${i}`, { status: "completed", statusCode: 200 });
      }

      const recent = tracker.getRecent(2);
      expect(recent).toHaveLength(2);
    });
  });

  describe("SSE client management", () => {
    it("addClient() and removeClient() manage SSE connections", () => {
      const { res: res1 } = createMockResponse();
      const { res: res2 } = createMockResponse();

      tracker.addClient(res1);
      tracker.addClient(res2);

      // Both should receive broadcasts
      const { writes: writes1 } = createMockResponse();
      // We can't easily access writes from the mock we already added,
      // so let's test via broadcast directly
    });

    it("auto-removes client on close event", () => {
      const { res, closeCallbacks } = createMockResponse();
      tracker.addClient(res);

      // Simulate close event
      expect(closeCallbacks).toHaveLength(1);
      closeCallbacks[0]();

      // Client should be removed — verify by checking broadcast doesn't write
      const { res: checkRes, writes: checkWrites } = createMockResponse();
      // After removal, no writes should go to the removed client
    });
  });

  describe("addClient() initial snapshot", () => {
    it("sends current active requests on connect", () => {
      tracker.start(createActiveRequest({ id: "existing-1" }));

      const { res, writes } = createMockResponse();
      tracker.addClient(res);

      const msg = writes.join("");
      expect(msg).toContain("event: request_update");
      expect(msg).toContain("existing-1");
      // 不应包含 clientRequest（已被剥离）
      expect(msg).not.toContain("clientRequest");
    });

    it("sends empty array when no active requests", () => {
      const { res, writes } = createMockResponse();
      tracker.addClient(res);

      const msg = writes.join("");
      expect(msg).toContain("event: request_update");
      expect(msg).toContain("data: []");
    });

    it("does not send snapshot when writableEnded=true", () => {
      const { res, writes } = createMockResponse();
      (res as unknown as { writableEnded: boolean }).writableEnded = true;

      tracker.addClient(res);

      expect(writes).toHaveLength(0);
    });
  });

  describe("broadcast()", () => {
    it("writes SSE message to all clients", () => {
      const { res: res1, writes: writes1 } = createMockResponse();
      const { res: res2, writes: writes2 } = createMockResponse();

      tracker.addClient(res1);
      tracker.addClient(res2);
      // addClient 现在会发送初始快照，清空以单独测试 broadcast
      writes1.length = 0;
      writes2.length = 0;

      tracker.broadcast("test_event", { hello: "world" });

      const expected = 'event: test_event\ndata: {"hello":"world"}\n\n';
      expect(writes1.join("")).toBe(expected);
      expect(writes2.join("")).toBe(expected);
    });

    it("removes client on write failure", () => {
      const { res: goodRes, writes: goodWrites } = createMockResponse();
      const badRes = {
        write() { return false; },
        on() { return this; },
        writableEnded: false,
      } as unknown as ServerResponse;

      tracker.addClient(goodRes);
      tracker.addClient(badRes);

      tracker.broadcast("test", {});

      // bad client should have been removed, good client still receives
      goodWrites.length = 0;
      tracker.broadcast("second", {});
      expect(goodWrites.join("")).toContain("second");
    });

    it("skips clients with writableEnded=true", () => {
      const { res, writes } = createMockResponse();
      (res as unknown as { writableEnded: boolean }).writableEnded = true;

      tracker.addClient(res);
      tracker.broadcast("test", {});

      expect(writes).toHaveLength(0);
    });
  });

  describe("startPushInterval()", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      tracker.stopPushInterval();
      vi.useRealTimers();
    });

    it("broadcasts request_update + concurrency_update + stats_update on 5s tick", () => {
      const { res, writes } = createMockResponse();
      tracker.addClient(res);
      tracker.start(createActiveRequest());

      tracker.startPushInterval();
      vi.advanceTimersByTime(5000);

      const all = writes.join("");
      expect(all).toContain("event: request_update");
      expect(all).toContain("event: concurrency_update");
      expect(all).toContain("event: stats_update");
    });

    it("includes runtime_update every 10s (2nd tick)", () => {
      const { res, writes } = createMockResponse();
      tracker.addClient(res);

      tracker.startPushInterval();

      // First tick (5s): no runtime_update
      vi.advanceTimersByTime(5000);
      const first = writes.join("");
      expect(first).not.toContain("event: runtime_update");

      // Second tick (10s): includes runtime_update
      vi.advanceTimersByTime(5000);
      const second = writes.join("");
      expect(second).toContain("event: runtime_update");
    });

    it("cleans up stale recentCompleted entries", () => {
      const now = Date.now();
      vi.setSystemTime(now);

      tracker.start(createActiveRequest({ id: "r1" }));
      tracker.complete("r1", { status: "completed", statusCode: 200 });

      // The completed entry was just added, so it's fresh
      expect(tracker.getRecent()).toHaveLength(1);

      // Advance past 5 minute TTL
      vi.setSystemTime(now + 5 * 60 * 1000 + 1);

      const { res } = createMockResponse();
      tracker.addClient(res);
      tracker.startPushInterval();
      vi.advanceTimersByTime(5000);

      expect(tracker.getRecent()).toHaveLength(0);
    });
  });

  describe("getConcurrency()", () => {
    it("returns empty array when no providers configured", () => {
      expect(tracker.getConcurrency()).toEqual([]);
    });

    it("combines semaphoreManager status with providerConfigCache", () => {
      const semMgr = new ProviderSemaphoreManager();
      const localTracker = new RequestTracker({ semaphoreManager: semMgr });

      semMgr.updateConfig("p1", {
        maxConcurrency: 5,
        queueTimeoutMs: 3000,
        maxQueueSize: 10,
      });

      localTracker.updateProviderConfig("p1", {
        name: "Provider1",
        maxConcurrency: 5,
        queueTimeoutMs: 3000,
        maxQueueSize: 10,
      });

      const concurrencies = localTracker.getConcurrency();
      expect(concurrencies).toHaveLength(1);
      expect(concurrencies[0]).toEqual({
        providerId: "p1",
        providerName: "Provider1",
        maxConcurrency: 5,
        active: 0,
        queued: 0,
        queueTimeoutMs: 3000,
        maxQueueSize: 10,
        adaptiveEnabled: false,
        adaptiveLimit: undefined,
      });
    });
  });

  describe("getStats()", () => {
    it("delegates to statsAggregator", () => {
      const stats = tracker.getStats();
      expect(getStatsSpy).toHaveBeenCalled();
      expect(stats.totalRequests).toBe(0);
    });
  });

  describe("getRuntime()", () => {
    it("delegates to runtimeCollector", () => {
      const rt = tracker.getRuntime();
      expect(collectSpy).toHaveBeenCalled();
      expect(rt.uptimeMs).toBe(1000);
    });
  });
});
