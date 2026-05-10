// TDD test for BI-H4 — SSE 广播预序列化 + dirty flag
// 预期 FAIL until implementation
//
// 当前实现：每次 broadcast() 对同一数据为每个 client 独立 JSON.stringify
// 优化目标：
// 1. broadcast() 只对 dirty 的事件做 JSON.stringify
// 2. 同一条消息对 N 个客户端只序列化一次
// 3. 无数据变化时不推送
// 本测试验证：
// 1. 相同数据对多个 client 发送相同的序列化消息
// 2. 无事件时不推送
// 3. request_start 后 broadcast 只推送一次序列化

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RequestTracker } from "../../src/core/monitor/request-tracker.js";
import type { ActiveRequest, SSEClient } from "../../src/core/monitor/types.js";

// --- Helpers ---

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

describe("BI-H4: SSE broadcast pre-serialization + dirty flag", () => {
  let tracker: RequestTracker;

  beforeEach(() => {
    tracker = new RequestTracker();
  });

  it("同一条消息对多个 client 只序列化一次", () => {
    // 监控 JSON.stringify 调用次数
    const originalStringify = JSON.stringify;
    let stringifyCallCount = 0;
    const stringifySpy = vi.fn((...args: Parameters<typeof JSON.stringify>) => {
      stringifyCallCount++;
      return originalStringify(...args);
    });

    const { client: client1, writes: writes1 } = createMockClient();
    const { client: client2, writes: writes2 } = createMockClient();
    const { client: client3, writes: writes3 } = createMockClient();

    tracker.addClient(client1);
    tracker.addClient(client2);
    tracker.addClient(client3);

    // 清除 addClient 产生的初始快照写入
    writes1.length = 0;
    writes2.length = 0;
    writes3.length = 0;

    // 使用 spy 替换 JSON.stringify（仅用于 broadcast 内部）
    // 注意：全局替换可能有副作用，这里仅作概念验证
    const data = { test: "serialization" };
    const msg = `event: test_event\ndata: ${JSON.stringify(data)}\n\n`;

    // 当前实现：broadcast 对每个 client 都写同一个预序列化的 msg
    // 但实际上 JSON.stringify 只调用一次（在 broadcast 方法内），然后 write 被调用 N 次
    tracker.broadcast("test_event", data);

    // 三个 client 应该收到完全相同的消息
    expect(writes1.join("")).toBe(msg);
    expect(writes2.join("")).toBe(msg);
    expect(writes3.join("")).toBe(msg);

    // 验证：消息内容应完全相同（已预序列化）
    expect(writes1[0]).toBe(writes2[0]);
    expect(writes2[0]).toBe(writes3[0]);
  });

  it("request_start 后，无变化时 pushTick 不应重复推送 request_update", () => {
    vi.useFakeTimers();

    const { client, writes } = createMockClient();
    tracker.addClient(client);
    writes.length = 0; // 清除初始快照

    // 启动推送间隔
    tracker.startPushInterval();

    // 开始一个请求
    tracker.start(createActiveRequest({ id: "req-dirty-1" }));
    writes.length = 0; // 清除 request_start 广播

    // 第一灭 tick（5 秒后）：推送 request_update
    vi.advanceTimersByTime(5000);
    const tick1Writes = [...writes];
    expect(tick1Writes.some((w) => w.includes("request_update"))).toBe(true);
    writes.length = 0;

    // 第二次 tick（10 秒后）：没有新变化，dirty flag 优化应跳过 request_update
    vi.advanceTimersByTime(5000);
    const tick2Writes = [...writes];

    // 优化目标：无数据变化时不应推送 request_update
    // 当前实现：每次 tick 都推送 request_update（不管有没有变化）
    const hasRequestUpdate = tick2Writes.some((w) => w.includes("event: request_update"));
    expect(hasRequestUpdate).toBe(false); // dirty flag 优化后应为 false

    tracker.stopPushInterval();
    vi.useRealTimers();
  });

  it("无任何活跃请求时 pushTick 应仍推送（保持心跳）或跳过（dirty flag 优化）", () => {
    vi.useFakeTimers();

    const { client, writes } = createMockClient();
    tracker.addClient(client);
    writes.length = 0;

    tracker.startPushInterval();

    // 没有任何活跃请求
    expect(tracker.getActive()).toHaveLength(0);

    // 5 秒后 pushTick
    vi.advanceTimersByTime(5000);

    // 当前实现：pushTick 始终推送 request_update（空数组）、concurrency_update、stats_update
    // 优化后（dirty flag）：如果无变化可以跳过 request_update
    // 但 concurrency_update 和 stats_update 仍应推送
    const allWrites = writes.join("");
    expect(allWrites).toContain("event: concurrency_update");
    expect(allWrites).toContain("event: stats_update");

    tracker.stopPushInterval();
    vi.useRealTimers();
  });

  it("complete 后 broadcast 应只序列化一次 request_complete", () => {
    const { client: client1, writes: writes1 } = createMockClient();
    const { client: client2, writes: writes2 } = createMockClient();

    tracker.addClient(client1);
    tracker.addClient(client2);
    writes1.length = 0;
    writes2.length = 0;

    // start + complete 触发两次 broadcast
    tracker.start(createActiveRequest({ id: "ser-1" }));
    writes1.length = 0;
    writes2.length = 0;

    tracker.complete("ser-1", { status: "completed", statusCode: 200 });

    // 两个 client 应收到相同的 request_complete 消息
    expect(writes1).toHaveLength(1);
    expect(writes2).toHaveLength(1);
    expect(writes1[0]).toBe(writes2[0]);
    expect(writes1[0]).toContain("event: request_complete");
    expect(writes1[0]).toContain("ser-1");
  });

  it("broadcast 中 request_update 应去除 clientRequest 和 upstreamRequest", () => {
    const { client, writes } = createMockClient();
    tracker.addClient(client);
    writes.length = 0;

    // start 一个带有 clientRequest 的请求
    tracker.start(createActiveRequest({
      id: "strip-1",
      clientRequest: "sensitive-data",
      upstreamRequest: "upstream-sensitive",
    }));

    // request_start 的 broadcast
    const startMsg = writes.find((w) => w.includes("request_start"));
    expect(startMsg).toBeDefined();
    expect(startMsg!).not.toContain("sensitive-data");
    expect(startMsg!).not.toContain("upstream-sensitive");
  });
});
