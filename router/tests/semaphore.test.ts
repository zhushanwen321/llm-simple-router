import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ProviderSemaphoreManager,
  SemaphoreQueueFullError,
  SemaphoreTimeoutError,
} from "../src/proxy/orchestration/semaphore.js";

describe("ProviderSemaphoreManager", () => {
  let mgr: ProviderSemaphoreManager;

  beforeEach(() => {
    mgr = new ProviderSemaphoreManager();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("maxConcurrency=0: acquire returns immediately, status shows (0,0)", async () => {
    mgr.updateConfig("p1", { maxConcurrency: 0, queueTimeoutMs: 0, maxQueueSize: 0 });
    await mgr.acquire("p1");
    await mgr.acquire("p1");
    expect(mgr.getStatus("p1")).toEqual({ active: 0, queued: 0 });
  });

  it("unconfigured provider: acquire returns immediately", async () => {
    await mgr.acquire("unknown");
    expect(mgr.getStatus("unknown")).toEqual({ active: 0, queued: 0 });
  });

  it("within limit: acquire/release tracks current correctly", async () => {
    mgr.updateConfig("p1", { maxConcurrency: 2, queueTimeoutMs: 0, maxQueueSize: 10 });
    const t1 = await mgr.acquire("p1");
    const t2 = await mgr.acquire("p1");
    expect(mgr.getStatus("p1")).toEqual({ active: 2, queued: 0 });

    mgr.release("p1", t1);
    expect(mgr.getStatus("p1")).toEqual({ active: 1, queued: 0 });

    mgr.release("p1", t2);
    expect(mgr.getStatus("p1")).toEqual({ active: 0, queued: 0 });
  });

  it("at capacity: queues then wakes on release", async () => {
    mgr.updateConfig("p1", { maxConcurrency: 1, queueTimeoutMs: 0, maxQueueSize: 10 });
    const t1 = await mgr.acquire("p1");
    expect(mgr.getStatus("p1")).toEqual({ active: 1, queued: 0 });

    const p2 = mgr.acquire("p1");
    expect(mgr.getStatus("p1")).toEqual({ active: 1, queued: 1 });

    mgr.release("p1", t1);
    const t2 = await p2;
    expect(mgr.getStatus("p1")).toEqual({ active: 1, queued: 0 });

    mgr.release("p1", t2);
    expect(mgr.getStatus("p1")).toEqual({ active: 0, queued: 0 });
  });

  it("queue full: throws SemaphoreQueueFullError", async () => {
    mgr.updateConfig("p1", { maxConcurrency: 1, queueTimeoutMs: 0, maxQueueSize: 1 });
    await mgr.acquire("p1");

    const p2 = mgr.acquire("p1");
    p2.catch(() => {});

    await expect(mgr.acquire("p1")).rejects.toThrow(SemaphoreQueueFullError);
  });

  it("queue timeout: throws SemaphoreTimeoutError", async () => {
    vi.useFakeTimers();
    mgr.updateConfig("p1", { maxConcurrency: 1, queueTimeoutMs: 5000, maxQueueSize: 10 });
    await mgr.acquire("p1");

    const p2 = mgr.acquire("p1");
    vi.advanceTimersByTime(5000);

    await expect(p2).rejects.toThrow(SemaphoreTimeoutError);
  });

  it("AbortSignal: removes from queue and rejects", async () => {
    mgr.updateConfig("p1", { maxConcurrency: 1, queueTimeoutMs: 0, maxQueueSize: 10 });
    await mgr.acquire("p1");

    const ac = new AbortController();
    const p2 = mgr.acquire("p1", ac.signal);
    expect(mgr.getStatus("p1")).toEqual({ active: 1, queued: 1 });

    ac.abort();
    try {
      await p2;
      expect.unreachable("should have rejected");
    } catch (err) {
      expect((err as DOMException).name).toBe("AbortError");
    }
    expect(mgr.getStatus("p1")).toEqual({ active: 1, queued: 0 });
  });

  it("release unknown provider: no-op", () => {
    expect(() => mgr.release("nonexistent", { generation: 0 })).not.toThrow();
  });

  it("updateConfig increase maxConcurrency: wakes queued entries", async () => {
    mgr.updateConfig("p1", { maxConcurrency: 1, queueTimeoutMs: 0, maxQueueSize: 10 });
    await mgr.acquire("p1");

    const p2 = mgr.acquire("p1");
    expect(mgr.getStatus("p1")).toEqual({ active: 1, queued: 1 });

    mgr.updateConfig("p1", { maxConcurrency: 3, queueTimeoutMs: 0, maxQueueSize: 10 });
    await p2;
    expect(mgr.getStatus("p1")).toEqual({ active: 2, queued: 0 });
  });

  it("remove: rejects all queued entries", async () => {
    mgr.updateConfig("p1", { maxConcurrency: 1, queueTimeoutMs: 0, maxQueueSize: 10 });
    await mgr.acquire("p1");

    const p2 = mgr.acquire("p1");
    const p3 = mgr.acquire("p1");

    mgr.remove("p1");
    await expect(p2).rejects.toThrow("Provider removed");
    await expect(p3).rejects.toThrow("Provider removed");
    expect(mgr.getStatus("p1")).toEqual({ active: 0, queued: 0 });
  });

  it("updateConfig to maxConcurrency=0: drains entire queue", async () => {
    mgr.updateConfig("p1", { maxConcurrency: 1, queueTimeoutMs: 0, maxQueueSize: 10 });
    const t1 = await mgr.acquire("p1");

    const p2 = mgr.acquire("p1");
    const p3 = mgr.acquire("p1");
    expect(mgr.getStatus("p1")).toEqual({ active: 1, queued: 2 });

    mgr.updateConfig("p1", { maxConcurrency: 0, queueTimeoutMs: 0, maxQueueSize: 0 });
    await p2;
    await p3;
    expect(mgr.getStatus("p1")).toEqual({ active: 0, queued: 0 });

    // 旧 token 的 release 应被跳过（generation 已变更）
    mgr.release("p1", t1);
    expect(mgr.getStatus("p1")).toEqual({ active: 0, queued: 0 });
  });

  it("generation: old token release skipped after maxConcurrency 0→positive round-trip", async () => {
    // 设置 maxConcurrency=1，获取 token
    mgr.updateConfig("p1", { maxConcurrency: 1, queueTimeoutMs: 0, maxQueueSize: 10 });
    const oldToken = await mgr.acquire("p1");

    // 禁用限流 → generation 递增
    mgr.updateConfig("p1", { maxConcurrency: 0, queueTimeoutMs: 0, maxQueueSize: 0 });
    expect(mgr.getStatus("p1")).toEqual({ active: 0, queued: 0 });

    // 恢复限流
    mgr.updateConfig("p1", { maxConcurrency: 1, queueTimeoutMs: 0, maxQueueSize: 10 });
    const newToken = await mgr.acquire("p1");
    expect(mgr.getStatus("p1")).toEqual({ active: 1, queued: 0 });

    // 旧 token release → 被跳过，不偷走新请求的槽位
    mgr.release("p1", oldToken);
    expect(mgr.getStatus("p1")).toEqual({ active: 1, queued: 0 });

    // 新 token release → 正常释放
    mgr.release("p1", newToken);
    expect(mgr.getStatus("p1")).toEqual({ active: 0, queued: 0 });
  });
});
