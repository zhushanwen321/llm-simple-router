import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  SemaphoreManager,
  SemaphoreQueueFullError,
  SemaphoreTimeoutError,
} from "../../src/concurrency/semaphore.js";

describe("SemaphoreManager", () => {
  let mgr: SemaphoreManager;

  beforeEach(() => {
    mgr = new SemaphoreManager();
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

  // --- 并发控制切换场景测试 ---

  describe("concurrency mode switch scenarios", () => {
    it("手动(N)→手动(M) 缩小：旧请求 release 正常递减 current，信号量不卡死", async () => {
      // 初始 maxConcurrency=5，5 个请求在执行
      mgr.updateConfig("p1", { maxConcurrency: 5, queueTimeoutMs: 0, maxQueueSize: 10 });
      const tokens = await Promise.all([
        mgr.acquire("p1"), mgr.acquire("p1"), mgr.acquire("p1"),
        mgr.acquire("p1"), mgr.acquire("p1"),
      ]);
      expect(mgr.getStatus("p1")).toEqual({ active: 5, queued: 0 });

      // 缩小到 maxConcurrency=3（不截断 current，不递增 generation）
      mgr.updateConfig("p1", { maxConcurrency: 3, queueTimeoutMs: 0, maxQueueSize: 10 });

      // current 仍为 5（不截断），新请求会排队
      expect(mgr.getStatus("p1")).toEqual({ active: 5, queued: 0 });

      // 新请求应该排队（current=5 >= maxConcurrency=3）
      const queued = mgr.acquire("p1");
      expect(mgr.getStatus("p1")).toEqual({ active: 5, queued: 1 });

      // 旧请求逐一 release，排队者被唤醒
      mgr.release("p1", tokens[0]); // current 不变(5)，唤醒排队者
      await queued; // 排队者获取到
      expect(mgr.getStatus("p1")).toEqual({ active: 5, queued: 0 });

      mgr.release("p1", tokens[1]); // current(4)
      expect(mgr.getStatus("p1")).toEqual({ active: 4, queued: 0 });

      mgr.release("p1", tokens[2]); // current(3)
      expect(mgr.getStatus("p1")).toEqual({ active: 3, queued: 0 });

      mgr.release("p1", tokens[3]); // current(2)
      expect(mgr.getStatus("p1")).toEqual({ active: 2, queued: 0 });

      mgr.release("p1", tokens[4]); // current(1)
      expect(mgr.getStatus("p1")).toEqual({ active: 1, queued: 0 });

      // 新请求可以直接获取（current < maxConcurrency）
      const newToken = await mgr.acquire("p1");
      expect(mgr.getStatus("p1")).toEqual({ active: 2, queued: 0 });
      mgr.release("p1", newToken);
    });

    it("手动(N)→手动(M) 缩小：所有旧请求 release 后 current 归零，新请求正常", async () => {
      mgr.updateConfig("p1", { maxConcurrency: 5, queueTimeoutMs: 0, maxQueueSize: 10 });
      const tokens = await Promise.all([
        mgr.acquire("p1"), mgr.acquire("p1"), mgr.acquire("p1"),
      ]);

      // 缩小到 1
      mgr.updateConfig("p1", { maxConcurrency: 1, queueTimeoutMs: 0, maxQueueSize: 10 });

      // 所有旧请求 release
      mgr.release("p1", tokens[0]);
      mgr.release("p1", tokens[1]);
      mgr.release("p1", tokens[2]);

      // current 应归零
      expect(mgr.getStatus("p1")).toEqual({ active: 0, queued: 0 });

      // 新请求正常获取
      const newToken = await mgr.acquire("p1");
      expect(mgr.getStatus("p1")).toEqual({ active: 1, queued: 0 });
      mgr.release("p1", newToken);
      expect(mgr.getStatus("p1")).toEqual({ active: 0, queued: 0 });
    });

    it("手动(N)→手动(0)：旧 token release 被跳过，bypass 模式生效", async () => {
      mgr.updateConfig("p1", { maxConcurrency: 3, queueTimeoutMs: 0, maxQueueSize: 10 });
      const tokens = await Promise.all([
        mgr.acquire("p1"), mgr.acquire("p1"),
      ]);

      // 关闭并发控制
      mgr.updateConfig("p1", { maxConcurrency: 0, queueTimeoutMs: 0, maxQueueSize: 0 });
      expect(mgr.getStatus("p1")).toEqual({ active: 0, queued: 0 });

      // 旧 token release → generation 不匹配，跳过
      mgr.release("p1", tokens[0]);
      mgr.release("p1", tokens[1]);
      expect(mgr.getStatus("p1")).toEqual({ active: 0, queued: 0 });

      // bypass 模式
      const bypassToken = await mgr.acquire("p1");
      expect(bypassToken.bypassed).toBe(true);
    });

    it("手动(0)→手动(N)：从 bypass 切到限流", async () => {
      mgr.updateConfig("p1", { maxConcurrency: 0, queueTimeoutMs: 0, maxQueueSize: 0 });
      const bypassToken = await mgr.acquire("p1");
      expect(bypassToken.bypassed).toBe(true);

      // 开启限流
      mgr.updateConfig("p1", { maxConcurrency: 2, queueTimeoutMs: 0, maxQueueSize: 10 });

      // bypass token release → 跳过（不计数）
      mgr.release("p1", bypassToken);
      expect(mgr.getStatus("p1")).toEqual({ active: 0, queued: 0 });

      // 新请求正常获取
      const t1 = await mgr.acquire("p1");
      expect(t1.bypassed).toBe(false);
      expect(mgr.getStatus("p1")).toEqual({ active: 1, queued: 0 });
      mgr.release("p1", t1);
    });

    it("remove 后 release：entry 不存在，no-op", async () => {
      mgr.updateConfig("p1", { maxConcurrency: 3, queueTimeoutMs: 0, maxQueueSize: 10 });
      const tokens = await Promise.all([
        mgr.acquire("p1"), mgr.acquire("p1"),
      ]);

      // remove（模拟禁用 provider）
      mgr.remove("p1");
      expect(mgr.getStatus("p1")).toEqual({ active: 0, queued: 0 });

      // 旧 token release → entry 不存在，no-op
      mgr.release("p1", tokens[0]);
      mgr.release("p1", tokens[1]);
      expect(mgr.getStatus("p1")).toEqual({ active: 0, queued: 0 });

      // 重新 init
      mgr.updateConfig("p1", { maxConcurrency: 2, queueTimeoutMs: 0, maxQueueSize: 10 });
      const newToken = await mgr.acquire("p1");
      expect(mgr.getStatus("p1")).toEqual({ active: 1, queued: 0 });
      mgr.release("p1", newToken);
    });

    it("removeAll 后 release：所有 entry 清空，no-op", async () => {
      mgr.updateConfig("p1", { maxConcurrency: 3, queueTimeoutMs: 0, maxQueueSize: 10 });
      mgr.updateConfig("p2", { maxConcurrency: 2, queueTimeoutMs: 0, maxQueueSize: 10 });
      const [t1, t2] = await Promise.all([
        mgr.acquire("p1"), mgr.acquire("p2"),
      ]);

      mgr.removeAll();

      // 旧 token release → no-op
      mgr.release("p1", t1);
      mgr.release("p2", t2);
      expect(mgr.getStatus("p1")).toEqual({ active: 0, queued: 0 });
      expect(mgr.getStatus("p2")).toEqual({ active: 0, queued: 0 });
    });

    it("手动(N)→手动(M) 增大：排队者被释放", async () => {
      mgr.updateConfig("p1", { maxConcurrency: 2, queueTimeoutMs: 0, maxQueueSize: 10 });
      const [t1, t2] = await Promise.all([
        mgr.acquire("p1"), mgr.acquire("p1"),
      ]);
      expect(mgr.getStatus("p1")).toEqual({ active: 2, queued: 0 });

      // 第3个请求排队
      const p3 = mgr.acquire("p1");
      expect(mgr.getStatus("p1")).toEqual({ active: 2, queued: 1 });

      // 增大到 4
      mgr.updateConfig("p1", { maxConcurrency: 4, queueTimeoutMs: 0, maxQueueSize: 10 });
      const t3 = await p3;
      expect(mgr.getStatus("p1")).toEqual({ active: 3, queued: 0 });

      // 清理
      mgr.release("p1", t1);
      mgr.release("p1", t2);
      mgr.release("p1", t3);
      expect(mgr.getStatus("p1")).toEqual({ active: 0, queued: 0 });
    });

    it("快速连续切换：手动(5)→手动(0)→手动(3)，旧 token 两次失效", async () => {
      mgr.updateConfig("p1", { maxConcurrency: 5, queueTimeoutMs: 0, maxQueueSize: 10 });
      const oldTokens = await Promise.all([
        mgr.acquire("p1"), mgr.acquire("p1"), mgr.acquire("p1"),
      ]);

      // 快速切换：5 → 0（generation++）→ 3
      mgr.updateConfig("p1", { maxConcurrency: 0, queueTimeoutMs: 0, maxQueueSize: 0 });
      mgr.updateConfig("p1", { maxConcurrency: 3, queueTimeoutMs: 0, maxQueueSize: 10 });

      // 旧 token release → generation 不匹配
      oldTokens.forEach(t => mgr.release("p1", t));
      expect(mgr.getStatus("p1")).toEqual({ active: 0, queued: 0 });

      // 新请求正常
      const newToken = await mgr.acquire("p1");
      expect(mgr.getStatus("p1")).toEqual({ active: 1, queued: 0 });
      mgr.release("p1", newToken);
      expect(mgr.getStatus("p1")).toEqual({ active: 0, queued: 0 });
    });
  });
});
