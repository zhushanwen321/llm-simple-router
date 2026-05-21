/**
 * Task 1 测试：Pipeline.emit 异常降级 + core 字段
 *
 * 验证规则：
 * - PipelineAbort 始终短路传播
 * - priority < 100 或 core=true 的 hook 异常直接传播
 * - 非核心 hook 异常降级（记录日志，继续执行）
 */
import { describe, it, expect, vi } from "vitest";
import { ProxyPipeline } from "../../router/src/proxy/pipeline/pipeline.js";
import { PipelineAbort } from "../../router/src/proxy/pipeline/types.js";
import type { PipelineContext, PipelineHook, HookPhase } from "../../router/src/proxy/pipeline/types.js";

/** 构造最小 mock PipelineContext（只需 request.log） */
function mockContext(): PipelineContext {
  return {
    request: { log: { error: vi.fn() } } as unknown as PipelineContext["request"],
    reply: {} as PipelineContext["reply"],
    rawBody: {},
    clientModel: "gpt-4o",
    apiType: "openai",
    body: {},
    isStream: false,
    resolved: null,
    provider: null,
    effectiveUpstreamPath: "",
    effectiveApiType: "",
    injectedHeaders: {},
    metadata: new Map(),
    logId: "test-log-id",
    rootLogId: null,
    transportResult: null,
    resilienceResult: null,
    clientRequest: "",
    upstreamRequest: "",
    snapshot: {} as PipelineContext["snapshot"],
  };
}

/** 工厂：创建简单 hook */
function makeHook(
  name: string,
  phase: HookPhase,
  priority: number,
  core: boolean | undefined,
  fn: (ctx: PipelineContext) => void | Promise<void>,
): PipelineHook {
  return { name, phase, priority, core, execute: fn };
}

describe("ProxyPipeline.emit 异常降级", () => {
  const phase: HookPhase = "pre_route";

  it("非核心 hook (priority=200) 抛出普通 Error → emit 不抛异常，后续 hook 正常执行", async () => {
    const pipeline = new ProxyPipeline();
    const ctx = mockContext();
    const executed: string[] = [];

    pipeline.register(
      makeHook("failing-hook", phase, 200, undefined, () => {
        throw new Error("non-critical failure");
      }),
    );
    pipeline.register(
      makeHook("after-hook", phase, 210, undefined, () => {
        executed.push("after");
      }),
    );

    // 不应抛异常
    await pipeline.emit(phase, ctx);
    // 后续 hook 应正常执行
    expect(executed).toEqual(["after"]);
  });

  it("核心 hook (priority=50) 抛出 Error → emit 直接 throw", async () => {
    const pipeline = new ProxyPipeline();
    const ctx = mockContext();

    pipeline.register(
      makeHook("core-hook", phase, 50, undefined, () => {
        throw new Error("critical failure");
      }),
    );

    await expect(pipeline.emit(phase, ctx)).rejects.toThrow("critical failure");
  });

  it("核心 hook (core=true, priority=300) 抛出 Error → emit 直接 throw", async () => {
    const pipeline = new ProxyPipeline();
    const ctx = mockContext();

    pipeline.register(
      makeHook("core-explicit", phase, 300, true, () => {
        throw new Error("core=true failure");
      }),
    );

    await expect(pipeline.emit(phase, ctx)).rejects.toThrow("core=true failure");
  });

  it("任意 hook 抛出 PipelineAbort → emit 直接 throw（短路）", async () => {
    const pipeline = new ProxyPipeline();
    const ctx = mockContext();
    const executed: string[] = [];

    pipeline.register(
      makeHook("abort-hook", phase, 200, undefined, () => {
        throw new PipelineAbort(429, { error: "rate limited" });
      }),
    );
    pipeline.register(
      makeHook("after-hook", phase, 210, undefined, () => {
        executed.push("after");
      }),
    );

    await expect(pipeline.emit(phase, ctx)).rejects.toThrow("Pipeline aborted");
    // PipelineAbort 短路，后续 hook 不执行
    expect(executed).toEqual([]);
  });

  it("非核心 hook 异常后，request.log.error 被调用", async () => {
    const pipeline = new ProxyPipeline();
    const ctx = mockContext();
    const error = new Error("degradable");

    pipeline.register(
      makeHook("bad-hook", phase, 200, undefined, () => {
        throw error;
      }),
    );

    await pipeline.emit(phase, ctx);

    expect(ctx.request.log.error).toHaveBeenCalledOnce();
    expect(ctx.request.log.error).toHaveBeenCalledWith(
      { err: error, hook: "bad-hook", phase },
      "Pipeline hook error (degraded)",
    );
  });

  it("无异常时所有 hook 按序执行", async () => {
    const pipeline = new ProxyPipeline();
    const ctx = mockContext();
    const executed: string[] = [];

    pipeline.register(
      makeHook("hook-a", phase, 100, undefined, () => { executed.push("a"); }),
    );
    pipeline.register(
      makeHook("hook-b", phase, 200, undefined, () => { executed.push("b"); }),
    );
    pipeline.register(
      makeHook("hook-c", phase, 300, undefined, () => { executed.push("c"); }),
    );

    await pipeline.emit(phase, ctx);
    expect(executed).toEqual(["a", "b", "c"]);
  });
});
