import { describe, it, expect, vi } from "vitest";
import type { PipelineContext } from "../../router/src/proxy/pipeline/types.js";

function createMockContext(): PipelineContext {
  return {
    request: { log: { warn: vi.fn() } } as unknown as PipelineContext["request"],
    reply: {} as PipelineContext["reply"],
    rawBody: {},
    clientModel: "test",
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
    transportResult: null,
    resilienceResult: null,
    clientRequest: "",
    upstreamRequest: "",
    snapshot: { toJSON: () => "{}" } as unknown as PipelineContext["snapshot"],
  };
}

describe("ProxyPipeline emit error handling", () => {
  it("propagates error from core hook", async () => {
    const { ProxyPipeline } = await import(
      "../../router/src/proxy/pipeline/pipeline.js"
    );
    const pipeline = new ProxyPipeline();
    const error = new Error("core hook failed");
    pipeline.register({
      name: "core-hook",
      phase: "pre_route",
      priority: 100,
      core: true,
      execute: () => {
        throw error;
      },
    });
    const ctx = createMockContext();
    await expect(pipeline.emit("pre_route", ctx)).rejects.toThrow(
      "core hook failed",
    );
  });

  it("catches and logs error from non-core hook, continues execution", async () => {
    const { ProxyPipeline } = await import(
      "../../router/src/proxy/pipeline/pipeline.js"
    );
    const pipeline = new ProxyPipeline();
    const succeedingHook = vi.fn();
    pipeline.register({
      name: "failing-hook",
      phase: "pre_route",
      priority: 100,
      execute: () => {
        throw new Error("non-core failed");
      },
    });
    pipeline.register({
      name: "succeeding-hook",
      phase: "pre_route",
      priority: 200,
      execute: succeedingHook,
    });
    const ctx = createMockContext();
    await pipeline.emit("pre_route", ctx);
    expect(succeedingHook).toHaveBeenCalled();
    expect(ctx.request.log.warn).toHaveBeenCalled();
  });

  it("returns empty array for phase with no hooks in getAllHooks", async () => {
    const { ProxyPipeline } = await import(
      "../../router/src/proxy/pipeline/pipeline.js"
    );
    const pipeline = new ProxyPipeline();
    const result = pipeline.getAllHooks();
    expect(result.on_error).toEqual([]);
  });
});
