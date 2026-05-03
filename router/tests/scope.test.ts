import { describe, it, expect, vi } from "vitest";
import { SemaphoreScope, TrackerScope } from "../src/proxy/orchestration/scope.js";
import { SemaphoreManager as ProviderSemaphoreManager } from "@llm-router/core/concurrency";
import { RequestTracker } from "@llm-router/core/monitor";
import type { ActiveRequest } from "@llm-router/core/monitor";

describe("SemaphoreScope", () => {
  function setup(maxConcurrency: number) {
    const manager = new ProviderSemaphoreManager();
    manager.updateConfig("p1", { maxConcurrency, queueTimeoutMs: 5000, maxQueueSize: 10 });
    const scope = new SemaphoreScope(manager);
    return { manager, scope };
  }

  it("should execute fn and release slot", async () => {
    const { scope, manager } = setup(1);
    const result = await scope.withSlot("p1", new AbortController().signal, vi.fn(), async () => 42);
    expect(result).toBe(42);
    expect(manager.getStatus("p1")).toEqual({ active: 0, queued: 0 });
  });

  it("should release slot when fn throws", async () => {
    const { scope, manager } = setup(1);
    await expect(scope.withSlot("p1", new AbortController().signal, vi.fn(), async () => {
      throw new Error("boom");
    })).rejects.toThrow("boom");
    expect(manager.getStatus("p1")).toEqual({ active: 0, queued: 0 });
  });

  it("should call onQueued when entering wait queue", async () => {
    const { scope, manager } = setup(1);
    const onQueued = vi.fn();
    const block = scope.withSlot("p1", new AbortController().signal, vi.fn(), () => new Promise(() => {}));
    const queued = scope.withSlot("p1", new AbortController().signal, onQueued, async () => "done");
    expect(onQueued).toHaveBeenCalled();
  });
});

describe("TrackerScope", () => {
  it("should call start and complete on success", async () => {
    const tracker = new RequestTracker();
    const scope = new TrackerScope(tracker);
    const req: ActiveRequest = {
      id: "test-1", apiType: "openai", model: "gpt-4",
      providerId: "p1", providerName: "test", isStream: false,
      startTime: Date.now(), status: "pending", retryCount: 0,
      attempts: [], clientIp: "127.0.0.1", queued: false,
    };
    const result = await scope.track(req, async () => "ok", () => ({ status: "completed" as const, statusCode: 200 }));
    expect(result).toBe("ok");
    expect(tracker.getActive()).toHaveLength(0);
    expect(tracker.getRecent(1)).toHaveLength(1);
    expect(tracker.getRecent(1)[0].status).toBe("completed");
  });

  it("should complete as failed when fn throws", async () => {
    const tracker = new RequestTracker();
    const scope = new TrackerScope(tracker);
    const req: ActiveRequest = {
      id: "test-2", apiType: "openai", model: "gpt-4",
      providerId: "p1", providerName: "test", isStream: false,
      startTime: Date.now(), status: "pending", retryCount: 0,
      attempts: [], clientIp: "127.0.0.1", queued: false,
    };
    await expect(scope.track(req, async () => { throw new Error("fail"); }, () => ({ status: "completed" as const })))
      .rejects.toThrow("fail");
    expect(tracker.getRecent(1)[0].status).toBe("failed");
  });
});
