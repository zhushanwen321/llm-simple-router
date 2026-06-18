import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import type { FastifyReply, FastifyRequest } from "fastify";
import { SemaphoreManager } from "../../../src/core/concurrency/semaphore.js";
import { RequestTracker } from "../../../src/core/monitor/request-tracker.js";
import { AdaptiveController } from "../../../src/core/concurrency/adaptive-controller.js";
import { createOrchestrator } from "../../../src/proxy/orchestration/orchestrator.js";
import type { OrchestratorConfig } from "../../../src/proxy/orchestration/orchestrator.js";
import { ResilienceLayer } from "../../../src/proxy/orchestration/resilience.js";
import type { Target, TransportResult } from "../../../src/core/types.js";

/** 模拟客户端响应端 raw stream：支持 close 事件 + writableEnded + destroy */
class MockReplyRaw extends EventEmitter {
  writableEnded = false;
  headersSent = false;
  destroyed = false;
  writeHead() { return this; }
  write() { return this; }
  end() { this.writableEnded = true; return this; }
  destroy() { this.destroyed = true; this.emit("close"); return this; }
}

function makeReply() {
  const raw = new MockReplyRaw();
  const reply = {
    raw,
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    header: vi.fn().mockReturnThis(),
  };
  return { reply: reply as unknown as FastifyReply, raw };
}

const makeRequest = () => ({ ip: "127.0.0.1" }) as unknown as FastifyRequest;

const makeConfig = (trackerId: string): OrchestratorConfig => ({
  resolved: { provider_id: "p1", backend_model: "m1" },
  provider: { id: "p1", name: "P1", is_active: 1, api_type: "openai", base_url: "http://x", api_key: "k" },
  clientModel: "cm",
  isStream: true,
  trackerId,
});

const throwResult = (): TransportResult => ({ kind: "throw", error: new Error("client aborted") });

/** transportFn：模拟上游 hang，仅在 signal abort 时 resolve throw */
function hangUntilAbort(): (target: Target, signal?: AbortSignal) => Promise<TransportResult> {
  return (_target, signal) => new Promise<TransportResult>((resolve) => {
    if (signal?.aborted) { resolve(throwResult()); return; }
    signal?.addEventListener("abort", () => resolve(throwResult()), { once: true });
  });
}

const tick = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

describe("orchestrator client disconnect", () => {
  let semaphoreManager: SemaphoreManager;
  let tracker: RequestTracker;
  let adaptiveController: AdaptiveController;

  beforeEach(() => {
    semaphoreManager = new SemaphoreManager();
    semaphoreManager.updateConfig("p1", { maxConcurrency: 1, queueTimeoutMs: 0, maxQueueSize: 0 });
    tracker = new RequestTracker({ semaphoreManager });
    adaptiveController = new AdaptiveController(semaphoreManager);
    adaptiveController.init("p1", { max: 1 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
    tracker.setReleaseSlotProvider((reqId) => semaphoreManager.releaseByReqId(reqId));
  });

  it("reply.raw close (TTFT 阶段) → controller.abort → transport throw → 槽位释放", async () => {
    const orchestrator = createOrchestrator(semaphoreManager, tracker, adaptiveController)!;
    const { reply, raw } = makeReply();
    const config = makeConfig("req-1");

    const handlePromise = orchestrator.handle(makeRequest(), reply, "openai", config, { transportFn: hangUntilAbort() });

    await tick(20);
    expect(semaphoreManager.getStatus("p1").active).toBe(1);

    raw.destroy(); // 模拟客户端断连

    const result = await handlePromise;

    expect(result.result.kind).toBe("throw");
    expect(semaphoreManager.getStatus("p1").active).toBe(0);
  });

  it("客户端断连后 resilience 不重试（attempts.length === 1）", async () => {
    const orchestrator = createOrchestrator(semaphoreManager, tracker, adaptiveController)!;
    const { reply, raw } = makeReply();
    let callCount = 0;

    const handlePromise = orchestrator.handle(makeRequest(), reply, "openai", makeConfig("req-2"), {
      transportFn: async (_t, signal) => {
        callCount++;
        return new Promise<TransportResult>((resolve) => {
          if (signal?.aborted) { resolve(throwResult()); return; }
          signal?.addEventListener("abort", () => resolve(throwResult()), { once: true });
        });
      },
    });

    await tick(20);
    raw.destroy();
    const result = await handlePromise;

    expect(callCount).toBe(1);
    expect(result.attempts).toHaveLength(1);
    expect(result.finalDecision?.action).toBe("abort");
  });

  it("客户端断连不计入 adaptive 失败统计（onRequestComplete 不被调用）", async () => {
    const orchestrator = createOrchestrator(semaphoreManager, tracker, adaptiveController)!;
    const spy = vi.spyOn(adaptiveController, "onRequestComplete");
    const { reply, raw } = makeReply();

    const handlePromise = orchestrator.handle(makeRequest(), reply, "openai", makeConfig("req-3"), { transportFn: hangUntilAbort() });

    await tick(20);
    raw.destroy();
    await handlePromise;

    expect(spy).not.toHaveBeenCalled();
  });
});

describe("ResilienceLayer signal 短路", () => {
  it("retry sleep 期间 signal abort → 短路返回 client_aborted，不再重试", async () => {
    const layer = new ResilienceLayer();
    const controller = new AbortController();
    const target: Target = { provider_id: "p1", backend_model: "m1" };
    let calls = 0;
    // ETIMEDOUT 为可重试 throw，触发 retry → sleep(baseDelayMs)
    const fn = async (): Promise<TransportResult> => {
      calls++;
      const err = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
      return { kind: "throw", error: err };
    };

    const p = layer.execute(() => [target], fn, { baseDelayMs: 50, failoverThreshold: 400, isFailover: false }, controller.signal);
    await tick(10); // 等待进入 retry sleep
    controller.abort(); // sleep 期间客户端断连
    const result = await p;

    expect(calls).toBe(1);
    expect(result.finalDecision).toMatchObject({ action: "abort", reason: "client_aborted" });
    expect(result.result.kind).toBe("throw");
  });
});

describe("orchestrator failover multi-iteration client disconnect (MF-1 regression)", () => {
  let semaphoreManager: SemaphoreManager;
  let tracker: RequestTracker;
  let adaptiveController: AdaptiveController;

  beforeEach(() => {
    semaphoreManager = new SemaphoreManager();
    semaphoreManager.updateConfig("p1", { maxConcurrency: 1, queueTimeoutMs: 0, maxQueueSize: 0 });
    tracker = new RequestTracker({ semaphoreManager });
    adaptiveController = new AdaptiveController(semaphoreManager);
    adaptiveController.init("p1", { max: 1 }, { queueTimeoutMs: 0, maxQueueSize: 0 });
    tracker.setReleaseSlotProvider((reqId) => semaphoreManager.releaseByReqId(reqId));
  });

  it("failover 复用同一 reply：迭代 2 期间客户端断连 → iteration 2 transport 被 abort + 槽位释放", async () => {
    const orchestrator = createOrchestrator(semaphoreManager, tracker, adaptiveController)!;
    const { reply, raw } = makeReply();

    // 迭代 1：上游立即 throw（模拟触发 failover 的失败，由外层 failover-loop 复用 reply 进入迭代 2）
    const iter1 = await orchestrator.handle(makeRequest(), reply, "openai", makeConfig("req-iter1"), {
      transportFn: async () => ({ kind: "throw", error: new Error("upstream 502") }),
    });
    expect(iter1.result.kind).toBe("throw");
    // 迭代 1 完成后槽位释放
    expect(semaphoreManager.getStatus("p1").active).toBe(0);

    // 迭代 2：模拟 failover-loop 复用同一 reply 再次调用 handle
    let iter2Aborted = false;
    const iter2Promise = orchestrator.handle(makeRequest(), reply, "openai", makeConfig("req-iter2"), {
      transportFn: (_target, signal) =>
        new Promise<TransportResult>((resolve) => {
          if (signal?.aborted) {
            iter2Aborted = true;
            resolve(throwResult());
            return;
          }
          signal?.addEventListener(
            "abort",
            () => {
              iter2Aborted = true;
              resolve(throwResult());
            },
            { once: true },
          );
        }),
    });

    await tick(20);
    expect(semaphoreManager.getStatus("p1").active).toBe(1);

    raw.destroy(); // 模拟客户端断连

    const iter2Result = await iter2Promise;

    // 关键：iteration 2 的 controller 被 abort（旧 WeakSet 实现下此处为 false → Promise 永挂）
    expect(iter2Aborted).toBe(true);
    expect(iter2Result.result.kind).toBe("throw");
    expect(semaphoreManager.getStatus("p1").active).toBe(0);
  });
});
