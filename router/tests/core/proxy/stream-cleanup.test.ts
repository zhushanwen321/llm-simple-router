import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "events";
import type { ClientRequest, IncomingMessage } from "http";
import type { FastifyReply } from "fastify";
import { PassThrough } from "stream";
import { StreamProxy } from "../../../src/proxy/transport/stream.js";
import type { StreamLoopGuard } from "../../../src/core/loop-prevention/index.js";
import type { TransportResult } from "../../../src/core/types.js";

// ---------- Mock factories ----------

interface MockUpstream {
  res: IncomingMessage;
  req: ClientRequest;
  resDestroy: ReturnType<typeof vi.fn>;
  reqDestroy: ReturnType<typeof vi.fn>;
}

function createMockUpstream(): MockUpstream {
  const resEmitter = new EventEmitter();
  const res = resEmitter as unknown as IncomingMessage & {
    destroyed: boolean;
    destroy: () => void;
  };
  res.destroyed = false;
  const resDestroy = vi.fn(() => {
    res.destroyed = true;
  });
  res.destroy = resDestroy;

  const reqEmitter = new EventEmitter();
  const req = reqEmitter as unknown as ClientRequest & {
    destroyed: boolean;
    destroy: () => void;
  };
  req.destroyed = false;
  const reqDestroy = vi.fn(() => {
    req.destroyed = true;
  });
  req.destroy = reqDestroy;

  return { res, req, resDestroy, reqDestroy };
}

function createMockReply(): FastifyReply {
  const raw = new EventEmitter();
  Object.assign(raw, {
    writeHead: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
    headersSent: false,
    writableEnded: false,
    socket: undefined,
  });
  return { raw } as unknown as FastifyReply;
}

/** 构造一个带 mock 上游的 StreamProxy（timeoutMs=Infinity 禁用 idleTimer）。 */
function createProxy(
  upstream: MockUpstream,
  onResolve?: (result: TransportResult) => void,
): StreamProxy {
  const proxy = new StreamProxy(
    200, // statusCode
    {}, // rawUpstreamHeaders
    {}, // sentUpstreamHeaders
    createMockReply(),
    undefined, // metricsTransform
    undefined, // checkEarlyError
    Infinity, // timeoutMs（禁用 idleTimer）
    undefined, // loopGuard
    undefined, // formatTransform
    undefined, // timeoutContext
    undefined, // onTimeoutAbort
    upstream.res,
    upstream.req,
  );
  proxy.bindResolve(onResolve ?? (() => {
    /* no-op，避免未绑定 resolve 报错 */
  }));
  return proxy;
}

/** 访问 StreamProxy 内部 passThrough（白盒测试，仅测试用）。 */
function getPassThrough(proxy: StreamProxy): PassThrough {
  return (proxy as unknown as { passThrough: PassThrough }).passThrough;
}

// ---------- Tests ----------

describe("StreamProxy.cleanup destroys upstream resources", () => {
  it("onUpstreamError destroys upstreamRes and upstreamReq", () => {
    const upstream = createMockUpstream();
    const proxy = createProxy(upstream);

    proxy.onUpstreamError(new Error("upstream reset"));

    expect(upstream.res.destroyed).toBe(true);
    expect(upstream.req.destroyed).toBe(true);
    expect(upstream.resDestroy).toHaveBeenCalledTimes(1);
    expect(upstream.reqDestroy).toHaveBeenCalledTimes(1);
  });

  it("startStreaming + loop_detection terminal destroys upstream resources", () => {
    const upstream = createMockUpstream();
    const reply = createMockReply();
    const loopGuard = { isTriggered: () => true } as unknown as StreamLoopGuard;

    const proxy = new StreamProxy(
      200, {}, {}, reply, undefined, undefined, Infinity,
      loopGuard, undefined, undefined, undefined,
      upstream.res, upstream.req,
    );
    proxy.bindResolve(() => {});

    // 进入 STREAMING 阶段（startStreaming 注册管道 + passThrough listeners）
    proxy.startStreaming();
    // 推入数据触发 loopGuard → terminal("stream_abort") → cleanup
    proxy.onData(Buffer.from("data: {}\n\n"));

    expect(upstream.res.destroyed).toBe(true);
    expect(upstream.req.destroyed).toBe(true);
  });
});

describe("StreamProxy.cleanup idempotency", () => {
  it("repeated onUpstreamError does not double-destroy or throw", () => {
    const upstream = createMockUpstream();
    const proxy = createProxy(upstream);

    proxy.onUpstreamError(new Error("first"));
    expect(() => proxy.onUpstreamError(new Error("second"))).not.toThrow();

    // resolved 标志保护：destroy 只调用一次
    expect(upstream.resDestroy).toHaveBeenCalledTimes(1);
    expect(upstream.reqDestroy).toHaveBeenCalledTimes(1);
  });

  it("onEnd after onUpstreamError is a no-op (resolved guard)", () => {
    const upstream = createMockUpstream();
    const proxy = createProxy(upstream);

    proxy.onUpstreamError(new Error("upstream error"));
    expect(() => proxy.onEnd()).not.toThrow();
    expect(upstream.resDestroy).toHaveBeenCalledTimes(1);
  });
});

describe("StreamProxy passThrough error does not bubble uncaughtException", () => {
  it("absorbs passThrough error via registered listener and runs cleanup", () => {
    const upstream = createMockUpstream();
    const proxy = createProxy(upstream);
    proxy.startStreaming(); // 注册 passThrough error listener

    const passThrough = getPassThrough(proxy);

    // 未注册 listener 时 emit("error") 会 throw；此处应被 listener 吸收
    expect(() => passThrough.emit("error", new Error("pipe broken"))).not.toThrow();

    // cleanup 应被触发，上游资源已销毁
    expect(upstream.res.destroyed).toBe(true);
    expect(upstream.req.destroyed).toBe(true);
  });

  it("does not register process-level uncaughtException on passThrough error", () => {
    const upstream = createMockUpstream();
    const proxy = createProxy(upstream);
    proxy.startStreaming();

    let uncaught = false;
    const handler = () => {
      uncaught = true;
    };
    process.once("uncaughtException", handler);

    try {
      getPassThrough(proxy).emit("error", new Error("transform failed"));
      // 同步执行后，不应触发 process uncaughtException
      expect(uncaught).toBe(false);
    } finally {
      process.removeListener("uncaughtException", handler);
    }
  });
});

describe("StreamProxy passThrough error resolves Promise (W-1 regression)", () => {
  it("passThrough emit error 后 callStream Promise 被 resolve 为 stream_abort/pipe_error", () => {
    const upstream = createMockUpstream();
    let resolved: TransportResult | undefined;
    const proxy = createProxy(upstream, (r) => {
      resolved = r;
    });
    proxy.startStreaming();

    getPassThrough(proxy).emit("error", new Error("pipe broken"));

    // 关键：Promise 被 resolve，不永挂（旧实现只调 cleanup 不 resolve）
    expect(resolved).toBeDefined();
    expect(resolved!.kind).toBe("stream_abort");
    if (resolved!.kind === "stream_abort") {
      expect(resolved!.abortReason).toBe("pipe_error");
    }
    // cleanup 仍被触发，上游资源销毁
    expect(upstream.res.destroyed).toBe(true);
    expect(upstream.req.destroyed).toBe(true);
  });
});
