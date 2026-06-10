import { describe, it, expect, vi } from "vitest";
import { ProxyPipeline } from "../../../src/proxy/pipeline/pipeline.js";
import type { PipelineContext } from "../../../src/proxy/pipeline/types.js";

function createMockContext(): PipelineContext {
  return {
    request: { log: { warn: vi.fn() } } as unknown as PipelineContext["request"],
    reply: {} as PipelineContext["reply"],
    rawBody: {},
    clientModel: "gpt-4",
    apiType: "openai",
    body: {},
    isStream: false,
    resolved: null,
    provider: null,
    effectiveUpstreamPath: "",
    effectiveApiType: "openai",
    injectedHeaders: {},
    metadata: new Map(),
    logId: "test",
    rootLogId: null,
    clientRequest: "",
    upstreamRequest: "",
    snapshot: { toJSON: () => "{}" } as unknown as PipelineContext["snapshot"],
  };
}

describe("ProxyPipeline", () => {
  it("executes hooks in priority order within a phase", async () => {
    const order: string[] = [];
    const pipeline = new ProxyPipeline();

    pipeline.register({ name: "late", phase: "pre_route", priority: 200, execute: () => { order.push("late"); } });
    pipeline.register({ name: "early", phase: "pre_route", priority: 100, execute: () => { order.push("early"); } });
    pipeline.register({ name: "mid", phase: "pre_route", priority: 150, execute: () => { order.push("mid"); } });

    await pipeline.emit("pre_route", createMockContext());
    expect(order).toEqual(["early", "mid", "late"]);
  });

  it("does not mix hooks from different phases", async () => {
    const order: string[] = [];
    const pipeline = new ProxyPipeline();

    pipeline.register({ name: "a", phase: "pre_route", priority: 100, execute: () => { order.push("a"); } });
    pipeline.register({ name: "b", phase: "post_route", priority: 100, execute: () => { order.push("b"); } });

    await pipeline.emit("pre_route", createMockContext());
    expect(order).toEqual(["a"]);
  });

  it("getHookChain returns registered hooks for a phase", () => {
    const pipeline = new ProxyPipeline();
    pipeline.register({ name: "hook1", phase: "pre_route", priority: 100, execute: () => {} });
    pipeline.register({ name: "hook2", phase: "pre_route", priority: 200, execute: () => {} });

    const chain = pipeline.getHookChain("pre_route");
    expect(chain).toEqual([
      { name: "hook1", priority: 100 },
      { name: "hook2", priority: 200 },
    ]);
  });

  it("getHookChain returns empty array for unregistered phase", () => {
    const pipeline = new ProxyPipeline();
    expect(pipeline.getHookChain("on_error")).toEqual([]);
  });

  it("emit does nothing for phase with no hooks", async () => {
    const pipeline = new ProxyPipeline();
    await pipeline.emit("on_stream_event", createMockContext());
    // should not throw
  });

  it("supports async hooks", async () => {
    const order: string[] = [];
    const pipeline = new ProxyPipeline();

    pipeline.register({
      name: "async-hook",
      phase: "pre_transport",
      priority: 100,
      async execute() {
        await new Promise((r) => setTimeout(r, 10));
        order.push("async");
      },
    });

    await pipeline.emit("pre_transport", createMockContext());
    expect(order).toEqual(["async"]);
  });

  it("catches error from non-core hook and continues execution", async () => {
    const order: string[] = [];
    const pipeline = new ProxyPipeline();

    pipeline.register({ name: "a", phase: "pre_route", priority: 100, execute: () => { order.push("a"); } });
    pipeline.register({ name: "b", phase: "pre_route", priority: 200, execute: () => { throw new Error("boom"); } });
    pipeline.register({ name: "c", phase: "pre_route", priority: 300, execute: () => { order.push("c"); } });

    const ctx = createMockContext();
    await pipeline.emit("pre_route", ctx);
    // a 执行，b 抛异常被 catch，c 继续执行
    expect(order).toEqual(["a", "c"]);
    expect(ctx.request.log.warn).toHaveBeenCalled();
  });

  it("propagates error from core hook and stops execution", async () => {
    const order: string[] = [];
    const pipeline = new ProxyPipeline();

    pipeline.register({ name: "a", phase: "pre_route", priority: 100, execute: () => { order.push("a"); } });
    pipeline.register({ name: "b", phase: "pre_route", priority: 200, core: true, execute: () => { throw new Error("core boom"); } });
    pipeline.register({ name: "c", phase: "pre_route", priority: 300, execute: () => { order.push("c"); } });

    await expect(pipeline.emit("pre_route", createMockContext())).rejects.toThrow("core boom");
    expect(order).toEqual(["a"]);
  });
});
