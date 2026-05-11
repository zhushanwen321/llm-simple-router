// TDD test for BP-M3 — StreamProxy BUFFERING 阶段避免每 chunk 做 Buffer.concat
// 预期 FAIL until implementation
//
// 当前实现：每次 onData() 在 BUFFERING 状态时都调用 Buffer.concat(bufferChunks) 做完整拼接
// 优化目标：维护 totalBuffered 累积字节计数，只在达到阈值或检测到 \n\n 时做一次 concat
// 本测试验证：
// 1. 多个小 chunk（不带 \n\n）不应每次触发 concat
// 2. 包含 \n\n 的 chunk 应正确检测并切换到 streaming 状态
// 3. BUFFER_SIZE_LIMIT 仍然生效

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { PassThrough } from "stream";

// ---------- Mock factories ----------

function createMockUpstreamReq() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    write: vi.fn(),
    end: vi.fn(),
    on: emitter.on.bind(emitter),
    emit: emitter.emit.bind(emitter),
  });
}

function createMockUpstreamRes(overrides: { statusCode?: number; headers?: Record<string, string> }) {
  const emitter = new EventEmitter() as any;
  emitter.statusCode = overrides.statusCode ?? 200;
  emitter.headers = overrides.headers ?? { "content-type": "text/event-stream" };
  emitter.destroy = vi.fn();
  return emitter;
}

function createMockReplyRaw() {
  const emitter = new EventEmitter() as any;
  emitter.writeHead = vi.fn();
  emitter.write = vi.fn();
  emitter.end = vi.fn();
  emitter.headersSent = false;
  emitter.writableEnded = false;
  emitter.destroy = vi.fn();
  return emitter;
}

function createMockReply() {
  const raw = createMockReplyRaw();
  return { raw, __raw: raw } as any;
}

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("BP-M3: StreamProxy BUFFERING optimization", () => {
  let mockReq: ReturnType<typeof createMockUpstreamReq>;
  let mockReplyRaw: ReturnType<typeof createMockReplyRaw>;

  beforeEach(() => {
    vi.resetModules();
    mockReq = createMockUpstreamReq();
    vi.doMock("../../src/proxy/transport/http.js", async () => {
      const actual = await vi.importActual("../../src/proxy/transport/http.js") as any;
      actual._transportInternals.createUpstreamRequest = () => mockReq;
      return actual;
    });
  });

  it("多个小 chunk 不带 \\n\\n 不应触发 writeHead", async () => {
    const { callStream } = await import("../../src/proxy/transport/stream.js");
    const reply = createMockReply();
    mockReplyRaw = reply.__raw;

    const checkEarlyError = vi.fn().mockReturnValue(false);

    const resultPromise = callStream(
      { base_url: "http://localhost:9000" }, "sk-test", { model: "gpt-4", stream: true },
      {}, reply, 30000, "/v1/chat/completions",
      (_h: any, key: string) => ({ Authorization: `Bearer ${key}` }),
      undefined, checkEarlyError,
    );

    const mockRes = createMockUpstreamRes({ statusCode: 200 });
    mockReq.emit("response", mockRes);
    await tick();

    // 发送多个小 chunk，不带 \n\n
    mockRes.emit("data", Buffer.from("data: "));
    mockRes.emit("data", Buffer.from('{"content":'));
    mockRes.emit("data", Buffer.from('"hello"}'));
    await tick();

    // 还没收到 \n\n，应该还在 BUFFERING 状态，不应调用 writeHead
    expect(mockReplyRaw.writeHead).not.toHaveBeenCalled();

    // 发送 \n\n 完成事件，触发切换到 STREAMING
    mockRes.emit("data", Buffer.from("\n\n"));
    await tick();

    expect(mockReplyRaw.writeHead).toHaveBeenCalledWith(200, expect.any(Object));

    mockRes.emit("end");
    const result = await resultPromise;
    expect(result.kind).toBe("stream_success");
  });

  it("BUFFER_SIZE_LIMIT 仍然生效 — 大于 4096 字节触发 streaming", async () => {
    const { callStream } = await import("../../src/proxy/transport/stream.js");
    const reply = createMockReply();
    mockReplyRaw = reply.__raw;

    const checkEarlyError = vi.fn().mockReturnValue(false);

    const resultPromise = callStream(
      { base_url: "http://localhost:9000" }, "sk-test", { model: "gpt-4", stream: true },
      {}, reply, 30000, "/v1/chat/completions",
      (_h: any, key: string) => ({ Authorization: `Bearer ${key}` }),
      undefined, checkEarlyError,
    );

    const mockRes = createMockUpstreamRes({ statusCode: 200 });
    mockReq.emit("response", mockRes);
    await tick();

    // 发送超过 4096 字节的数据（不带 \n\n）
    const largeChunk = Buffer.alloc(5000, "x");
    mockRes.emit("data", largeChunk);
    await tick();

    // 超过 BUFFER_SIZE_LIMIT 应触发 streaming
    expect(mockReplyRaw.writeHead).toHaveBeenCalledWith(200, expect.any(Object));

    mockRes.emit("end");
    const result = await resultPromise;
    expect(result.kind).toBe("stream_success");
  });

  it("Buffer.concat 不应在每个小 chunk 时被调用", async () => {
    // 通过 spy Buffer.concat 来验证优化
    const originalConcat = Buffer.concat;
    let concatCalls = 0;
    const concatSpy = vi.fn((...args: Parameters<typeof Buffer.concat>) => {
      concatCalls++;
      return originalConcat(...args);
    });
    vi.spyOn(Buffer, "concat").mockImplementation(concatSpy);

    const { callStream } = await import("../../src/proxy/transport/stream.js");
    const reply = createMockReply();
    mockReplyRaw = reply.__raw;

    const checkEarlyError = vi.fn().mockReturnValue(false);

    const resultPromise = callStream(
      { base_url: "http://localhost:9000" }, "sk-test", { model: "gpt-4", stream: true },
      {}, reply, 30000, "/v1/chat/completions",
      (_h: any, key: string) => ({ Authorization: `Bearer ${key}` }),
      undefined, checkEarlyError,
    );

    const mockRes = createMockUpstreamRes({ statusCode: 200 });
    mockReq.emit("response", mockRes);
    await tick();

    const concatBefore = concatCalls;

    // 发送 5 个小 chunk（不带 \n\n）
    for (let i = 0; i < 5; i++) {
      mockRes.emit("data", Buffer.from(`chunk-${i}`));
    }
    await tick();

    const concatDuringBuffering = concatCalls - concatBefore;

    // 优化前：每个 chunk 都调用 Buffer.concat → 至少 5 次（当前实现 5 次以上）
    // 优化后：维护 totalBuffered 累积计数，中间过程不 concat → 0 次
    // 只在检测到 \n\n 或超过 BUFFER_SIZE_LIMIT 时才调用一次 Buffer.concat
    //
    // 当前实现 FAIL：concatDuringBuffering >= 5（每个 chunk 都 concat）
    // 优化后 PASS：concatDuringBuffering === 0（只在 \n\n 时 concat）
    expect(concatDuringBuffering).toBe(0); // 优化目标：BUFFERING 中间过程不 concat

    // 先完成流
    mockRes.emit("data", Buffer.from("\n\n"));
    await tick();
    mockRes.emit("end");
    await resultPromise;

    vi.restoreAllMocks();
  });

  it("分割的 \\n\\n 跨 chunk 边界应正确检测", async () => {
    const { callStream } = await import("../../src/proxy/transport/stream.js");
    const reply = createMockReply();
    mockReplyRaw = reply.__raw;

    const checkEarlyError = vi.fn().mockReturnValue(false);

    const resultPromise = callStream(
      { base_url: "http://localhost:9000" }, "sk-test", { model: "gpt-4", stream: true },
      {}, reply, 30000, "/v1/chat/completions",
      (_h: any, key: string) => ({ Authorization: `Bearer ${key}` }),
      undefined, checkEarlyError,
    );

    const mockRes = createMockUpstreamRes({ statusCode: 200 });
    mockReq.emit("response", mockRes);
    await tick();

    // 先发一个不带 \n\n 的 chunk
    mockRes.emit("data", Buffer.from('data: {"content":"hi"}'));
    await tick();
    expect(mockReplyRaw.writeHead).not.toHaveBeenCalled();

    // \n\n 跨 chunk 边界
    mockRes.emit("data", Buffer.from("\n"));
    mockRes.emit("data", Buffer.from("\n"));
    await tick();

    expect(mockReplyRaw.writeHead).toHaveBeenCalledWith(200, expect.any(Object));

    mockRes.emit("end");
    const result = await resultPromise;
    expect(result.kind).toBe("stream_success");
  });
});
