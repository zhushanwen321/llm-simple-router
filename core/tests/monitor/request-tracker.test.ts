import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { RequestTracker } from "../../src/monitor/request-tracker.js";
import { StatsAggregator } from "../../src/monitor/stats-aggregator.js";
import { RuntimeCollector } from "../../src/monitor/runtime-collector.js";
import { SemaphoreManager } from "../../src/concurrency/semaphore.js";
import type { ActiveRequest, SSEClient } from "../../src/monitor/types.js";

// --- Mocks ---

function createMockClient(): {
  client: SSEClient;
  writes: string[];
  closeCallbacks: Array<() => void>;
} {
  const writes: string[] = [];
  const closeCallbacks: Array<() => void> = [];

  const client = {
    write(data: string) {
      writes.push(data);
    },
    on(event: string, cb: () => void) {
      if (event === "close") closeCallbacks.push(cb);
    },
    writableEnded: false,
    end() {},
  } as unknown as SSEClient;

  return { client, writes, closeCallbacks };
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

  beforeEach(() => {
    tracker = new RequestTracker();

    // Spy on internal statsAggregator (public readonly field)
    recordLatencySpy = vi.spyOn(tracker.statsAggregator, "recordLatency");
    recordRequestSpy = vi.spyOn(tracker.statsAggregator, "recordRequest");
    recordProviderLatencySpy = vi.spyOn(tracker.statsAggregator, "recordProviderLatency");
    getStatsSpy = vi.spyOn(tracker.statsAggregator, "getStats").mockReturnValue({
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

    // Spy on internal runtimeCollector (public readonly field)
    collectSpy = vi.spyOn(tracker.runtimeCollector, "collect").mockReturnValue({
      uptimeMs: 1000,
      memoryUsage: { rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 },
      activeHandles: 0,
      activeRequests: 0,
      eventLoopDelayMs: 0,
    });
  });

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
      const { client, writes } = createMockClient();
      tracker.addClient(client);

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
      const { client, writes } = createMockClient();
      tracker.addClient(client);

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
      const { client: client1 } = createMockClient();
      const { client: client2 } = createMockClient();

      tracker.addClient(client1);
      tracker.addClient(client2);

      // Both should receive broadcasts — verified by broadcast() tests
    });

    it("auto-removes client on close event", () => {
      const { client, closeCallbacks } = createMockClient();
      tracker.addClient(client);

      // Simulate close event
      expect(closeCallbacks).toHaveLength(1);
      closeCallbacks[0]();

      // Client should be removed — verify by checking broadcast doesn't write
      const { client: checkClient, writes: checkWrites } = createMockClient();
      tracker.addClient(checkClient);
      checkWrites.length = 0;
      tracker.broadcast("test", {});
      // Only checkClient should receive — not the removed one
      expect(checkWrites).toHaveLength(1);
    });
  });

  describe("addClient() initial snapshot", () => {
    it("sends current active requests on connect", () => {
      tracker.start(createActiveRequest({ id: "existing-1" }));

      const { client, writes } = createMockClient();
      tracker.addClient(client);

      const msg = writes.join("");
      expect(msg).toContain("event: request_update");
      expect(msg).toContain("existing-1");
      // clientRequest should be stripped in request_update broadcast
      expect(msg).not.toContain("clientRequest");
    });

    it("sends empty array when no active requests", () => {
      const { client, writes } = createMockClient();
      tracker.addClient(client);

      const msg = writes.join("");
      expect(msg).toContain("event: request_update");
      expect(msg).toContain("data: []");
    });

    it("does not send snapshot when writableEnded=true", () => {
      const { client, writes } = createMockClient();
      (client as unknown as { writableEnded: boolean }).writableEnded = true;

      tracker.addClient(client);

      expect(writes).toHaveLength(0);
    });
  });

  describe("broadcast()", () => {
    it("writes SSE message to all clients", () => {
      const { client: client1, writes: writes1 } = createMockClient();
      const { client: client2, writes: writes2 } = createMockClient();

      tracker.addClient(client1);
      tracker.addClient(client2);
      // addClient sends initial snapshot, clear to isolate broadcast test
      writes1.length = 0;
      writes2.length = 0;

      tracker.broadcast("test_event", { hello: "world" });

      const expected = 'event: test_event\ndata: {"hello":"world"}\n\n';
      expect(writes1.join("")).toBe(expected);
      expect(writes2.join("")).toBe(expected);
    });

    it("removes client on write failure", () => {
      const { client: goodClient, writes: goodWrites } = createMockClient();
      const badClient = {
        write() { throw new Error("write failed"); },
        on() {},
        writableEnded: false,
        end() {},
      } as unknown as SSEClient;

      tracker.addClient(goodClient);
      tracker.addClient(badClient);

      tracker.broadcast("test", {});

      // bad client should have been removed, good client still receives
      goodWrites.length = 0;
      tracker.broadcast("second", {});
      expect(goodWrites.join("")).toContain("second");
    });

    it("skips clients with writableEnded=true", () => {
      const { client, writes } = createMockClient();
      (client as unknown as { writableEnded: boolean }).writableEnded = true;

      tracker.addClient(client);
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
      const { client, writes } = createMockClient();
      tracker.addClient(client);
      tracker.start(createActiveRequest());

      tracker.startPushInterval();
      vi.advanceTimersByTime(5000);

      const all = writes.join("");
      expect(all).toContain("event: request_update");
      expect(all).toContain("event: concurrency_update");
      expect(all).toContain("event: stats_update");
    });

    it("includes runtime_update every 10s (2nd tick)", () => {
      const { client, writes } = createMockClient();
      tracker.addClient(client);

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

      const { client } = createMockClient();
      tracker.addClient(client);
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
      const semMgr = new SemaphoreManager();
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

  describe("killRequest()", () => {
    it("returns true and invokes registered kill callback", () => {
      const killCb = vi.fn();
      tracker.start(createActiveRequest({ id: "kill-1" }));
      tracker.registerKillCallback("kill-1", killCb);

      const result = tracker.killRequest("kill-1");

      expect(result).toBe(true);
      expect(killCb).toHaveBeenCalledTimes(1);
    });

    it("returns false for non-existent request", () => {
      const result = tracker.killRequest("nonexistent");
      expect(result).toBe(false);
    });

    it("returns false for request without registered callback", () => {
      tracker.start(createActiveRequest({ id: "no-cb" }));

      const result = tracker.killRequest("no-cb");
      expect(result).toBe(false);
    });

    it("logs info on successful kill", () => {
      const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
      const localTracker = new RequestTracker({ logger });
      const killCb = vi.fn();

      localTracker.start(createActiveRequest({ id: "log-1" }));
      localTracker.registerKillCallback("log-1", killCb);
      localTracker.killRequest("log-1");

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ reqId: "log-1" }),
        "Tracker: killRequest",
      );
    });

    it("logs debug when kill target not found", () => {
      const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
      const localTracker = new RequestTracker({ logger });

      localTracker.killRequest("ghost");

      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({ reqId: "ghost" }),
        "Tracker: killRequest not found (already completed or unknown)",
      );
    });
  });

  describe("kill + complete interaction", () => {
    it("complete after kill forces status to failed", () => {
      const killCb = vi.fn();
      tracker.start(createActiveRequest({ id: "killed-1" }));
      tracker.registerKillCallback("killed-1", killCb);

      tracker.killRequest("killed-1");

      // Simulate the abort completing the request
      tracker.complete("killed-1", { status: "completed", statusCode: 200 });

      const found = tracker.get("killed-1");
      expect(found).toBeDefined();
      expect(found!.status).toBe("failed");
    });

    it("normal complete clears kill callback so subsequent killRequest returns false", () => {
      const killCb = vi.fn();
      tracker.start(createActiveRequest({ id: "normal-1" }));
      tracker.registerKillCallback("normal-1", killCb);

      // Complete without killing
      tracker.complete("normal-1", { status: "completed", statusCode: 200 });

      // killCallback should have been cleaned up in complete()
      const result = tracker.killRequest("normal-1");
      expect(result).toBe(false);
    });

    it("kill then complete still moves to recentCompleted", () => {
      const killCb = vi.fn();
      tracker.start(createActiveRequest({ id: "kcr-1" }));
      tracker.registerKillCallback("kcr-1", killCb);
      tracker.killRequest("kcr-1");
      tracker.complete("kcr-1", { status: "completed", statusCode: 200 });

      const recent = tracker.getRecent();
      expect(recent).toHaveLength(1);
      expect(recent[0].status).toBe("failed");
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
