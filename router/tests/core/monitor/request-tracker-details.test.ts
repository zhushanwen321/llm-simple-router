import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { RequestTracker } from "../../../src/core/monitor/request-tracker.js";
import type { ActiveRequest, SSEClient } from "../../../src/core/monitor/types.js";

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
    clientRequest: '{"model":"gpt-4","messages":[...]}',
    upstreamRequest: '{"model":"gpt-4","messages":[...],"stream":true}',
    ...overrides,
  };
}

/**
 * 从 SSE write 记录中提取指定事件的 JSON payload
 */
function extractSSEPayload(writes: string[], event: string): unknown {
  const full = writes.join("");
  const regex = new RegExp(`event: ${event}\\ndata: (.+)\\n\\n`, "s");
  const match = full.match(regex);
  if (!match) return undefined;
  return JSON.parse(match[1]);
}

describe("RequestTracker — completedDetails 分离", () => {
  let tracker: RequestTracker;

  beforeEach(() => {
    tracker = new RequestTracker();
    // 抑制 statsAggregator 调用
    vi.spyOn(tracker.statsAggregator, "recordLatency").mockReturnValue(undefined);
    vi.spyOn(tracker.statsAggregator, "recordRequest").mockReturnValue(undefined);
    vi.spyOn(tracker.statsAggregator, "recordProviderLatency").mockReturnValue(undefined);
    vi.spyOn(tracker.statsAggregator, "getStats").mockReturnValue({
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
    vi.spyOn(tracker.runtimeCollector, "collect").mockReturnValue({
      uptimeMs: 1000,
      memoryUsage: { rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 },
      activeHandles: 0,
      activeRequests: 0,
      eventLoopDelayMs: 0,
    });
  });

  // --- Task 1: complete() 分离 clientRequest/upstreamRequest ---

  describe("complete() 分离详情到 completedDetails", () => {
    it("test_complete_recentCompleted_noClientRequest_字段被剥离", () => {
      tracker.start(createActiveRequest({
        id: "req-sep-1",
        clientRequest: "original-client-body",
        upstreamRequest: "original-upstream-body",
      }));
      tracker.complete("req-sep-1", { status: "completed", statusCode: 200 });

      const recent = tracker.getRecent();
      expect(recent).toHaveLength(1);

      // recentCompleted 中不应包含 clientRequest 和 upstreamRequest
      expect(recent[0].clientRequest).toBeUndefined();
      expect(recent[0].upstreamRequest).toBeUndefined();
    });

    it("test_complete_recentCompleted_保留其他摘要字段", () => {
      tracker.start(createActiveRequest({
        id: "req-sep-2",
        model: "claude-3",
        providerId: "anthropic",
        providerName: "Anthropic",
        clientRequest: "body",
        upstreamRequest: "upstream",
      }));
      tracker.complete("req-sep-2", { status: "completed", statusCode: 200 });

      const recent = tracker.getRecent();
      expect(recent).toHaveLength(1);

      // 摘要字段保留
      expect(recent[0].id).toBe("req-sep-2");
      expect(recent[0].model).toBe("claude-3");
      expect(recent[0].providerId).toBe("anthropic");
      expect(recent[0].providerName).toBe("Anthropic");
      expect(recent[0].status).toBe("completed");
      expect(recent[0].completedAt).toBeDefined();
    });

    it("test_complete_completedDetails存储原始详情", () => {
      tracker.start(createActiveRequest({
        id: "req-details-1",
        clientRequest: "client-req-body-detail",
        upstreamRequest: "upstream-req-body-detail",
      }));
      tracker.complete("req-details-1", { status: "completed", statusCode: 200 });

      // completedDetails Map 应存在并存储原始 clientRequest/upstreamRequest
      const completedDetails = (tracker as any).completedDetails as
        Map<string, { clientRequest?: string; upstreamRequest?: string }> | undefined;

      expect(completedDetails).toBeDefined();
      expect(completedDetails!.has("req-details-1")).toBe(true);

      const details = completedDetails!.get("req-details-1")!;
      expect(details.clientRequest).toBe("client-req-body-detail");
      expect(details.upstreamRequest).toBe("upstream-req-body-detail");
    });
  });

  // --- Task 2: getRequestById() 从 completedDetails 合并 ---

  describe("getRequestById() 合并 completedDetails", () => {
    it("test_getRequestById_completed_合并clientRequest和upstreamRequest", () => {
      tracker.start(createActiveRequest({
        id: "req-merge-1",
        clientRequest: "merged-client-body",
        upstreamRequest: "merged-upstream-body",
      }));
      tracker.complete("req-merge-1", { status: "completed", statusCode: 200 });

      const result = tracker.getRequestById("req-merge-1");

      expect(result).toBeDefined();
      expect(result!.clientRequest).toBe("merged-client-body");
      expect(result!.upstreamRequest).toBe("merged-upstream-body");
    });

    it("test_getRequestById_completed_返回完整摘要加详情", () => {
      const startTime = Date.now() - 300;
      tracker.start(createActiveRequest({
        id: "req-full-1",
        model: "gpt-4o",
        providerId: "openai",
        startTime,
        clientRequest: "full-client",
        upstreamRequest: "full-upstream",
      }));
      tracker.complete("req-full-1", { status: "completed", statusCode: 200 });

      const result = tracker.getRequestById("req-full-1");

      expect(result).toBeDefined();
      // 摘要字段
      expect(result!.id).toBe("req-full-1");
      expect(result!.model).toBe("gpt-4o");
      expect(result!.providerId).toBe("openai");
      expect(result!.status).toBe("completed");
      expect(result!.completedAt).toBeGreaterThan(startTime);
      // 合并的详情
      expect(result!.clientRequest).toBe("full-client");
      expect(result!.upstreamRequest).toBe("full-upstream");
    });

    it("test_getRequestById_completed_无clientRequest时返回undefined字段", () => {
      tracker.start(createActiveRequest({
        id: "req-no-detail-1",
        // 不带 clientRequest/upstreamRequest
      }));
      delete (tracker.get("req-no-detail-1") as any).clientRequest;
      delete (tracker.get("req-no-detail-1") as any).upstreamRequest;

      tracker.complete("req-no-detail-1", { status: "completed", statusCode: 200 });

      const result = tracker.getRequestById("req-no-detail-1");
      expect(result).toBeDefined();
      // 没有原始数据时字段应为 undefined
      expect(result!.clientRequest).toBeUndefined();
      expect(result!.upstreamRequest).toBeUndefined();
    });
  });

  // --- Task 3: cleanupRecent() 同步清理 completedDetails ---

  describe("cleanupRecent() 同步清理 completedDetails", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      tracker.stopPushInterval();
      vi.useRealTimers();
    });

    it("test_cleanupRecent_清理过期的completedDetails条目", () => {
      const now = Date.now();
      vi.setSystemTime(now);

      tracker.start(createActiveRequest({ id: "r-expired", clientRequest: "old", upstreamRequest: "old-up" }));
      tracker.complete("r-expired", { status: "completed", statusCode: 200 });

      // 验证 completedDetails 中有数据
      const completedDetails = (tracker as any).completedDetails as Map<string, unknown>;
      expect(completedDetails.has("r-expired")).toBe(true);

      // 推进时间超过 5 分钟 TTL
      vi.setSystemTime(now + 5 * 60 * 1000 + 1);

      // 手动触发清理（通过 push interval tick）
      const { client } = createMockClient();
      tracker.addClient(client);
      tracker.startPushInterval();
      vi.advanceTimersByTime(5000);

      // completedDetails 中的过期条目应被清理
      expect(completedDetails.has("r-expired")).toBe(false);
      // recentCompleted 也应被清理
      expect(tracker.getRecent()).toHaveLength(0);
    });

    it("test_cleanupRecent_未过期条目保留在completedDetails中", () => {
      const now = Date.now();
      vi.setSystemTime(now);

      tracker.start(createActiveRequest({ id: "r-fresh", clientRequest: "fresh", upstreamRequest: "fresh-up" }));
      tracker.complete("r-fresh", { status: "completed", statusCode: 200 });

      // 推进 3 分钟（未超过 5 分钟 TTL）
      vi.setSystemTime(now + 3 * 60 * 1000);

      const { client } = createMockClient();
      tracker.addClient(client);
      tracker.startPushInterval();
      vi.advanceTimersByTime(5000);

      const completedDetails = (tracker as any).completedDetails as Map<string, unknown>;
      expect(completedDetails.has("r-fresh")).toBe(true);
      expect(tracker.getRecent()).toHaveLength(1);
    });
  });

  // --- Task 4: broadcast() strip upstreamRequest ---

  describe("broadcast() 脱敏 upstreamRequest", () => {
    it("test_broadcast_request_complete_无clientRequest和upstreamRequest", () => {
      const { client, writes } = createMockClient();
      tracker.addClient(client);

      tracker.start(createActiveRequest({
        id: "req-bc-1",
        clientRequest: "bc-client",
        upstreamRequest: "bc-upstream",
      }));
      writes.length = 0;

      tracker.complete("req-bc-1", { status: "completed", statusCode: 200 });

      const payload = extractSSEPayload(writes, "request_complete") as any;
      expect(payload).toBeDefined();
      expect(payload.clientRequest).toBeUndefined();
      expect(payload.upstreamRequest).toBeUndefined();
    });

    it("test_broadcast_request_start_无clientRequest和upstreamRequest", () => {
      const { client, writes } = createMockClient();
      tracker.addClient(client);

      tracker.start(createActiveRequest({
        id: "req-bc-2",
        clientRequest: "start-client",
        upstreamRequest: "start-upstream",
      }));

      const payload = extractSSEPayload(writes, "request_start") as any;
      expect(payload).toBeDefined();
      expect(payload.clientRequest).toBeUndefined();
      expect(payload.upstreamRequest).toBeUndefined();
    });

    it("test_broadcast_request_update_无clientRequest和upstreamRequest", () => {
      const { client, writes } = createMockClient();
      tracker.addClient(client);

      tracker.start(createActiveRequest({
        id: "req-bc-3",
        clientRequest: "update-client",
        upstreamRequest: "update-upstream",
      }));

      // addClient 会发送 initial snapshot，清空以隔离后续广播
      writes.length = 0;

      // queued 状态变化触发 request_update
      tracker.update("req-bc-3", { queued: true });

      const payload = extractSSEPayload(writes, "request_update") as any;
      expect(payload).toBeDefined();
      // request_update 是数组
      expect(Array.isArray(payload)).toBe(true);
      const req = payload.find((r: any) => r.id === "req-bc-3");
      expect(req).toBeDefined();
      expect(req.clientRequest).toBeUndefined();
      expect(req.upstreamRequest).toBeUndefined();
    });
  });

  // --- Regression: pending 请求行为不变 ---

  describe("pending 请求 getRequestById() 行为不变", () => {
    it("test_getRequestById_pending_返回完整数据", () => {
      tracker.start(createActiveRequest({
        id: "req-pending-1",
        clientRequest: "pending-client-body",
        upstreamRequest: "pending-upstream-body",
      }));

      const result = tracker.getRequestById("req-pending-1");

      expect(result).toBeDefined();
      expect(result!.status).toBe("pending");
      expect(result!.clientRequest).toBe("pending-client-body");
      expect(result!.upstreamRequest).toBe("pending-upstream-body");
    });
  });

  // --- completedDetails 容量限制 ---

  describe("completedDetails 容量限制", () => {
    it("test_completedDetails_容量不超过200", () => {
      const RECENT_COMPLETED_MAX = 200;

      // 创建 205 个请求并完成
      for (let i = 0; i < 205; i++) {
        tracker.start(createActiveRequest({
          id: `req-cap-${i}`,
          clientRequest: `client-${i}`,
          upstreamRequest: `upstream-${i}`,
        }));
        tracker.complete(`req-cap-${i}`, { status: "completed", statusCode: 200 });
      }

      const completedDetails = (tracker as any).completedDetails as Map<string, unknown>;
      expect(completedDetails.size).toBeLessThanOrEqual(RECENT_COMPLETED_MAX);
    });

    it("test_completedDetails_淘汰最旧条目后getRequestById仍能返回较新的", () => {
      const RECENT_COMPLETED_MAX = 200;

      // 创建 205 个请求并完成
      for (let i = 0; i < 205; i++) {
        tracker.start(createActiveRequest({
          id: `req-evict-${i}`,
          clientRequest: `client-evict-${i}`,
          upstreamRequest: `upstream-evict-${i}`,
        }));
        tracker.complete(`req-evict-${i}`, { status: "completed", statusCode: 200 });
      }

      // 最新的请求应可查到完整数据
      const latest = tracker.getRequestById("req-evict-204");
      expect(latest).toBeDefined();
      expect(latest!.clientRequest).toBe("client-evict-204");
      expect(latest!.upstreamRequest).toBe("upstream-evict-204");

      // 最旧的请求可能已被淘汰（completedDetails 容量限制）
      const oldest = tracker.getRequestById("req-evict-0");
      // 由于容量限制，最旧的可能只有摘要没有详情
      if (oldest) {
        // 如果还能查到摘要（从 recentCompleted），详情可能为 undefined
        expect(oldest.clientRequest).toBeUndefined();
      }
    });
  });
});
