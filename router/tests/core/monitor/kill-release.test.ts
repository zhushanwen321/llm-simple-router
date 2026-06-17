import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import type { FastifyReply, FastifyRequest } from "fastify";
import { SemaphoreManager } from "../../../src/core/concurrency/semaphore.js";
import { RequestTracker } from "../../../src/core/monitor/request-tracker.js";
import { AdaptiveController } from "../../../src/core/concurrency/adaptive-controller.js";
import { createOrchestrator } from "../../../src/proxy/orchestration/orchestrator.js";
import type { OrchestratorConfig } from "../../../src/proxy/orchestration/orchestrator.js";
import type { Target, TransportResult } from "../../../src/core/types.js";

class MockReplyRaw extends EventEmitter {
  writableEnded = false;
  headersSent = false;
  destroyed = false;
  writeHead() { return this; }
  write() { return this; }
  end() { this.writableEnded = true; return this; }
  destroy() { this.destroyed = true; this.emit("close"); return this; }
}

const makeReply = () => {
  const raw = new MockReplyRaw();
  const reply = { raw, code: vi.fn().mockReturnThis(), send: vi.fn().mockReturnThis(), header: vi.fn().mockReturnThis() };
  return { reply: reply as unknown as FastifyReply, raw };
};
const makeRequest = () => ({ ip: "127.0.0.1" }) as unknown as FastifyRequest;
const makeConfig = (trackerId: string): OrchestratorConfig => ({
  resolved: { provider_id: "p1", backend_model: "m1" },
  provider: { id: "p1", name: "P1", is_active: 1, api_type: "openai", base_url: "http://x", api_key: "k" },
  clientModel: "cm",
  isStream: true,
  trackerId,
});

const throwResult = (): TransportResult => ({ kind: "throw", error: new Error("client aborted") });
const tick = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** transportFn：模拟上游 hang，signal abort 时 resolve throw */
function hangUntilAbort(): (target: Target, signal?: AbortSignal) => Promise<TransportResult> {
  return (_target, signal) => new Promise<TransportResult>((resolve) => {
    if (signal?.aborted) { resolve(throwResult()); return; }
    signal?.addEventListener("abort", () => resolve(throwResult()), { once: true });
  });
}

describe("killRequest → semaphore release", () => {
  let semaphoreManager: SemaphoreManager;
  let tracker: RequestTracker;

  beforeEach(() => {
    semaphoreManager = new SemaphoreManager();
    semaphoreManager.updateConfig("p1", { maxConcurrency: 1, queueTimeoutMs: 0, maxQueueSize: 10 });
    tracker = new RequestTracker({ semaphoreManager });
    tracker.setReleaseSlotProvider((reqId) => semaphoreManager.releaseByReqId(reqId));
  });

  it("kill 已 acquire 请求 → semaphore.active 递减、槽位可复用", async () => {
    const orchestrator = createOrchestrator(semaphoreManager, tracker, new AdaptiveController(semaphoreManager))!;
    const { reply } = makeReply();
    const handlePromise = orchestrator.handle(makeRequest(), reply, "openai", makeConfig("req-kill"), { transportFn: hangUntilAbort() });

    await tick(20);
    expect(semaphoreManager.getStatus("p1").active).toBe(1);

    expect(tracker.killRequest("req-kill")).toBe(true);

    const result = await handlePromise;
    expect(result.result.kind).toBe("throw");
    // kill 同步释放信号量 → active 归零
    expect(semaphoreManager.getStatus("p1").active).toBe(0);
  });

  it("kill 后请求自然完成（竞态）→ 不双重 release，active 不超减为负", async () => {
    const orchestrator = createOrchestrator(semaphoreManager, tracker, new AdaptiveController(semaphoreManager))!;
    let resolveTransport!: () => void;
    // transportFn：既能被 abort，也能被外部手动 resolve（模拟自然完成）
    const transportFn = (_t: Target, signal?: AbortSignal) => new Promise<TransportResult>((resolve) => {
      resolveTransport = () => resolve({ kind: "success", statusCode: 200, body: "ok", headers: {}, sentHeaders: {}, sentBody: "" });
      signal?.addEventListener("abort", () => resolve(throwResult()), { once: true });
    });
    const { reply } = makeReply();
    const handlePromise = orchestrator.handle(makeRequest(), reply, "openai", makeConfig("req-race"), { transportFn });

    await tick(20);
    expect(semaphoreManager.getStatus("p1").active).toBe(1);

    tracker.killRequest("req-race"); // kill：release 置 token.released=true，active→0
    expect(semaphoreManager.getStatus("p1").active).toBe(0);

    resolveTransport(); // transport 自然完成 → withSlot finally 再调 release（应被幂等跳过）
    await handlePromise;

    expect(semaphoreManager.getStatus("p1").active).toBe(0); // 仍为 0，未超减
  });

  it("kill 排队中请求（未 acquire）→ releaseByReqId noop，不抛 TypeError，active 不变", async () => {
    const orchestrator = createOrchestrator(semaphoreManager, tracker, new AdaptiveController(semaphoreManager))!;
    // 第一个请求占住唯一槽位（hang）
    const hold = makeReply();
    const holdPromise = orchestrator.handle(makeRequest(), hold.reply, "openai", makeConfig("req-hold"), { transportFn: hangUntilAbort() });
    await tick(20);
    expect(semaphoreManager.getStatus("p1")).toEqual({ active: 1, queued: 0 });

    // 第二个请求进入排队（未 acquire）
    const queued = makeReply();
    const queuedPromise = orchestrator.handle(makeRequest(), queued.reply, "openai", makeConfig("req-queue"), { transportFn: hangUntilAbort() });
    await tick(20);
    expect(semaphoreManager.getStatus("p1")).toEqual({ active: 1, queued: 1 });

    // kill 排队中的请求：releaseByReqId 在 map 中无记录 → noop
    expect(() => tracker.killRequest("req-queue")).not.toThrow();
    expect(semaphoreManager.getStatus("p1").active).toBe(1); // 持有槽位的请求未受影响

    // 排队请求被 abort（acquire reject AbortError）→ handle 抛错
    await expect(queuedPromise).rejects.toThrow();

    // 清理持有槽位的请求
    hold.raw.destroy();
    await holdPromise;
    expect(semaphoreManager.getStatus("p1").active).toBe(0);
  });

  it("abortAllInflight 终止所有 inflight 请求（复用 kill 机制释放信号量）", async () => {
    // 两个 provider 各持有一个 inflight
    semaphoreManager.updateConfig("p2", { maxConcurrency: 1, queueTimeoutMs: 0, maxQueueSize: 0 });
    const orchestrator = createOrchestrator(semaphoreManager, tracker, new AdaptiveController(semaphoreManager))!;

    const r1 = makeReply();
    const p1 = orchestrator.handle(makeRequest(), r1.reply, "openai", makeConfig("req-a"), { transportFn: hangUntilAbort() });
    const cfg2 = makeConfig("req-b");
    cfg2.provider = { id: "p2", name: "P2", is_active: 1, api_type: "openai", base_url: "http://x", api_key: "k" };
    cfg2.resolved = { provider_id: "p2", backend_model: "m2" };
    const r2 = makeReply();
    const p2 = orchestrator.handle(makeRequest(), r2.reply, "openai", cfg2, { transportFn: hangUntilAbort() });

    await tick(20);
    expect(semaphoreManager.getStatus("p1").active).toBe(1);
    expect(semaphoreManager.getStatus("p2").active).toBe(1);

    tracker.abortAllInflight();
    await p1;
    await p2;

    expect(semaphoreManager.getStatus("p1").active).toBe(0);
    expect(semaphoreManager.getStatus("p2").active).toBe(0);
  });
});
