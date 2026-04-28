import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { PassThrough } from "stream";
import type { TransportResult } from "../src/proxy/types.js";

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

function createMockUpstreamRes(overrides: {
  statusCode?: number;
  headers?: Record<string, string>;
}) {
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

// 事件循环让步
function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

// ============================================================
// 非流式测试 (Step 5)
// ============================================================

describe("TransportLayer.callNonStream", () => {
  let mockReq: ReturnType<typeof createMockUpstreamReq>;

  beforeEach(() => {
    vi.resetModules();
    mockReq = createMockUpstreamReq();
    vi.doMock("../src/proxy/transport.js", async () => {
      const actual = await vi.importActual("../src/proxy/transport.js") as any;
      actual._transportInternals.createUpstreamRequest = () => mockReq;
      return actual;
    });
  });

  it("returns success on 200 response", async () => {
    const { callNonStream } = await import("../src/proxy/transport.js");
    const resultPromise = callNonStream(
      { base_url: "http://localhost:9000" },
      "sk-test",
      { model: "gpt-4" },
      {},
      "/v1/chat/completions",
      (_h, key) => ({ Authorization: `Bearer ${key}` }),
    );

    const mockRes = createMockUpstreamRes({ statusCode: 200 });
    mockReq.emit("response", mockRes);

    await tick();
    const body = JSON.stringify({ choices: [] });
    mockRes.emit("data", Buffer.from(body));
    mockRes.emit("end");

    const result = await resultPromise;
    expect(result.kind).toBe("success");
    if (result.kind !== "success") return;
    expect(result.statusCode).toBe(200);
    expect(result.body).toBe(body);
    expect(result.headers).toBeDefined();
  });

  it("returns error on 4xx/5xx response", async () => {
    const { callNonStream } = await import("../src/proxy/transport.js");
    const resultPromise = callNonStream(
      { base_url: "http://localhost:9000" },
      "sk-test",
      { model: "gpt-4" },
      {},
      "/v1/chat/completions",
      (_h, key) => ({ Authorization: `Bearer ${key}` }),
    );

    const mockRes = createMockUpstreamRes({ statusCode: 429 });
    mockReq.emit("response", mockRes);

    await tick();
    mockRes.emit("data", Buffer.from("rate limited"));
    mockRes.emit("end");

    const result = await resultPromise;
    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.statusCode).toBe(429);
    expect(result.body).toBe("rate limited");
  });

  it("returns throw on network error", async () => {
    const { callNonStream } = await import("../src/proxy/transport.js");
    const resultPromise = callNonStream(
      { base_url: "http://localhost:9000" },
      "sk-test",
      { model: "gpt-4" },
      {},
      "/v1/chat/completions",
      (_h, key) => ({ Authorization: `Bearer ${key}` }),
    );

    mockReq.emit("error", new Error("ECONNREFUSED"));

    const result = await resultPromise;
    expect(result.kind).toBe("throw");
    if (result.kind !== "throw") return;
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error.message).toBe("ECONNREFUSED");
  });
});

// ============================================================
// 流式正常完成测试 (Step 6)
// ============================================================

describe("TransportLayer.callStream", () => {
  let mockReq: ReturnType<typeof createMockUpstreamReq>;
  let mockReplyRaw: ReturnType<typeof createMockReplyRaw>;

  function createMockReply() {
    mockReplyRaw = createMockReplyRaw();
    return { raw: mockReplyRaw } as any;
  }

  beforeEach(() => {
    vi.resetModules();
    mockReq = createMockUpstreamReq();
    vi.doMock("../src/proxy/transport.js", async () => {
      const actual = await vi.importActual("../src/proxy/transport.js") as any;
      actual._transportInternals.createUpstreamRequest = () => mockReq;
      return actual;
    });
  });

  it("returns stream_success on normal SSE completion", async () => {
    const { callStream } = await import("../src/proxy/transport.js");
    const reply = createMockReply();

    const resultPromise = callStream(
      { base_url: "http://localhost:9000" },
      "sk-test",
      { model: "gpt-4", stream: true },
      {},
      reply,
      30000,
      "/v1/chat/completions",
      (_h, key) => ({ Authorization: `Bearer ${key}` }),
    );

    const mockRes = createMockUpstreamRes({ statusCode: 200 });
    mockReq.emit("response", mockRes);

    await tick();
    mockRes.emit("data", Buffer.from('data: {"content":"hi"}\n\n'));
    mockRes.emit("end");

    const result = await resultPromise;
    expect(result.kind).toBe("stream_success");
    expect(mockReplyRaw.writeHead).toHaveBeenCalled();
  });

  it("returns stream_success without early error checker", async () => {
    const { callStream } = await import("../src/proxy/transport.js");
    const reply = createMockReply();

    const resultPromise = callStream(
      { base_url: "http://localhost:9000" },
      "sk-test",
      { model: "gpt-4", stream: true },
      {},
      reply,
      30000,
      "/v1/chat/completions",
      (_h, key) => ({ Authorization: `Bearer ${key}` }),
      undefined, // metricsTransform
      undefined, // checkEarlyError
    );

    const mockRes = createMockUpstreamRes({ statusCode: 200 });
    mockReq.emit("response", mockRes);

    await tick();
    expect(mockReplyRaw.writeHead).toHaveBeenCalledWith(200, expect.any(Object));

    mockRes.emit("data", Buffer.from("data: {}\n\n"));
    mockRes.emit("end");

    const result = await resultPromise;
    expect(result.kind).toBe("stream_success");
  });
});

// ============================================================
// 流式错误路径测试 (Step 7)
// ============================================================

describe("StreamProxy state machine - error paths", () => {
  let mockReq: ReturnType<typeof createMockUpstreamReq>;
  let mockReplyRaw: ReturnType<typeof createMockReplyRaw>;

  function createMockReply() {
    mockReplyRaw = createMockReplyRaw();
    return { raw: mockReplyRaw } as any;
  }

  beforeEach(() => {
    vi.resetModules();
    mockReq = createMockUpstreamReq();
    vi.doMock("../src/proxy/transport.js", async () => {
      const actual = await vi.importActual("../src/proxy/transport.js") as any;
      actual._transportInternals.createUpstreamRequest = () => mockReq;
      return actual;
    });
  });

  it("returns stream_error on upstream non-200 status", async () => {
    const { callStream } = await import("../src/proxy/transport.js");
    const reply = createMockReply();

    const resultPromise = callStream(
      { base_url: "http://localhost:9000" },
      "sk-test",
      { model: "gpt-4", stream: true },
      {},
      reply,
      30000,
      "/v1/chat/completions",
      (_h, key) => ({ Authorization: `Bearer ${key}` }),
    );

    const mockRes = createMockUpstreamRes({ statusCode: 429 });
    mockReq.emit("response", mockRes);

    await tick();
    mockRes.emit("data", Buffer.from("rate limited"));
    mockRes.emit("end");

    const result = await resultPromise;
    expect(result.kind).toBe("stream_error");
    if (result.kind !== "stream_error") return;
    expect(result.statusCode).toBe(429);
    expect(mockReplyRaw.writeHead).not.toHaveBeenCalled();
  });

  it("returns stream_error when early error detected in buffer phase", async () => {
    const { callStream } = await import("../src/proxy/transport.js");
    const reply = createMockReply();

    const checkEarlyError = vi.fn().mockReturnValue(true);

    const resultPromise = callStream(
      { base_url: "http://localhost:9000" },
      "sk-test",
      { model: "gpt-4", stream: true },
      {},
      reply,
      30000,
      "/v1/chat/completions",
      (_h, key) => ({ Authorization: `Bearer ${key}` }),
      undefined,
      checkEarlyError,
    );

    const mockRes = createMockUpstreamRes({ statusCode: 200 });
    mockReq.emit("response", mockRes);

    await tick();
    mockRes.emit("data", Buffer.from('data: {"error":"invalid_api_key"}\n\n'));

    const result = await resultPromise;
    expect(result.kind).toBe("stream_error");
    expect(mockReplyRaw.writeHead).not.toHaveBeenCalled();
  });

  it("returns stream_abort when client disconnects during streaming", async () => {
    const { callStream } = await import("../src/proxy/transport.js");
    const reply = createMockReply();

    const resultPromise = callStream(
      { base_url: "http://localhost:9000" },
      "sk-test",
      { model: "gpt-4", stream: true },
      {},
      reply,
      30000,
      "/v1/chat/completions",
      (_h, key) => ({ Authorization: `Bearer ${key}` }),
    );

    const mockRes = createMockUpstreamRes({ statusCode: 200 });
    mockReq.emit("response", mockRes);

    await tick();
    mockRes.emit("data", Buffer.from("data: {}\n\n"));
    mockReplyRaw.emit("close");

    const result = await resultPromise;
    expect(result.kind).toBe("stream_abort");
  });

  it("returns throw on upstream network error", async () => {
    const { callStream } = await import("../src/proxy/transport.js");
    const reply = createMockReply();

    const resultPromise = callStream(
      { base_url: "http://localhost:9000" },
      "sk-test",
      { model: "gpt-4", stream: true },
      {},
      reply,
      30000,
      "/v1/chat/completions",
      (_h, key) => ({ Authorization: `Bearer ${key}` }),
    );

    mockReq.emit("error", new Error("ETIMEDOUT"));

    const result = await resultPromise;
    expect(result.kind).toBe("throw");
    if (result.kind !== "throw") return;
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error.message).toBe("ETIMEDOUT");
  });

  it("transitions BUFFERING→STREAMING after receiving full event", async () => {
    const { callStream } = await import("../src/proxy/transport.js");
    const reply = createMockReply();

    const checkEarlyError = vi.fn().mockReturnValue(false);

    const resultPromise = callStream(
      { base_url: "http://localhost:9000" },
      "sk-test",
      { model: "gpt-4", stream: true },
      {},
      reply,
      30000,
      "/v1/chat/completions",
      (_h, key) => ({ Authorization: `Bearer ${key}` }),
      undefined,
      checkEarlyError,
    );

    const mockRes = createMockUpstreamRes({ statusCode: 200 });
    mockReq.emit("response", mockRes);

    await tick();
    mockRes.emit("data", Buffer.from('data: {"content":"hello"}\n\n'));

    expect(mockReplyRaw.writeHead).toHaveBeenCalledWith(200, expect.any(Object));

    mockRes.emit("end");
    const result = await resultPromise;
    expect(result.kind).toBe("stream_success");
  });

  it("transitions BUFFERING→STREAMING when buffer exceeds limit", async () => {
    const { callStream } = await import("../src/proxy/transport.js");
    const reply = createMockReply();

    const checkEarlyError = vi.fn().mockReturnValue(false);

    const resultPromise = callStream(
      { base_url: "http://localhost:9000" },
      "sk-test",
      { model: "gpt-4", stream: true },
      {},
      reply,
      30000,
      "/v1/chat/completions",
      (_h, key) => ({ Authorization: `Bearer ${key}` }),
      undefined,
      checkEarlyError,
    );

    const mockRes = createMockUpstreamRes({ statusCode: 200 });
    mockReq.emit("response", mockRes);

    await tick();
    const largeChunk = Buffer.alloc(5000, "x");
    mockRes.emit("data", largeChunk);

    expect(mockReplyRaw.writeHead).toHaveBeenCalledWith(200, expect.any(Object));

    mockRes.emit("end");
    const result = await resultPromise;
    expect(result.kind).toBe("stream_success");
  });
});

// ============================================================
// close handler 测试 (Step 8)
// ============================================================

describe("StreamProxy close handler", () => {
  let mockReq: ReturnType<typeof createMockUpstreamReq>;
  let mockReplyRaw: ReturnType<typeof createMockReplyRaw>;

  function createMockReply() {
    mockReplyRaw = createMockReplyRaw();
    return { raw: mockReplyRaw } as any;
  }

  beforeEach(() => {
    vi.resetModules();
    mockReq = createMockUpstreamReq();
    vi.doMock("../src/proxy/transport.js", async () => {
      const actual = await vi.importActual("../src/proxy/transport.js") as any;
      actual._transportInternals.createUpstreamRequest = () => mockReq;
      return actual;
    });
  });

  it("registers reply.raw close handler only once", async () => {
    const { callStream } = await import("../src/proxy/transport.js");
    const reply = createMockReply();

    const onSpy = vi.fn((event: string, handler: () => void) => {
      mockReplyRaw.__proto__.on?.call(mockReplyRaw, event, handler);
    });
    mockReplyRaw.on = onSpy;

    const resultPromise = callStream(
      { base_url: "http://localhost:9000" },
      "sk-test",
      { model: "gpt-4", stream: true },
      {},
      reply,
      30000,
      "/v1/chat/completions",
      (_h, key) => ({ Authorization: `Bearer ${key}` }),
    );

    const mockRes = createMockUpstreamRes({ statusCode: 200 });
    mockReq.emit("response", mockRes);

    await tick();

    const closeCalls = onSpy.mock.calls.filter((c: string[]) => c[0] === "close");
    expect(closeCalls).toHaveLength(1);

    mockRes.emit("data", Buffer.from("data: {}\n\n"));
    mockRes.emit("end");
    await resultPromise;
  });

  it("terminal() prevents duplicate resolve", async () => {
    const { callStream } = await import("../src/proxy/transport.js");
    const reply = createMockReply();

    const resultPromise = callStream(
      { base_url: "http://localhost:9000" },
      "sk-test",
      { model: "gpt-4", stream: true },
      {},
      reply,
      30000,
      "/v1/chat/completions",
      (_h, key) => ({ Authorization: `Bearer ${key}` }),
    );

    const mockRes = createMockUpstreamRes({ statusCode: 200 });
    mockReq.emit("response", mockRes);

    await tick();
    mockRes.emit("data", Buffer.from("data: {}\n\n"));
    mockRes.emit("end");

    const result = await resultPromise;
    expect(result.kind).toBe("stream_success");

    mockReplyRaw.emit("close");
    expect(result.kind).toBe("stream_success");
  });
});

// ============================================================
// Mid-stream SSE error detection (STREAMING 阶段 error 检测)
// ============================================================

describe("StreamProxy mid-stream SSE error detection", () => {
  let mockReq: ReturnType<typeof createMockUpstreamReq>;
  let mockReplyRaw: ReturnType<typeof createMockReplyRaw>;

  function createMockReply() {
    mockReplyRaw = createMockReplyRaw();
    return { raw: mockReplyRaw } as any;
  }

  beforeEach(() => {
    vi.resetModules();
    mockReq = createMockUpstreamReq();
    vi.doMock("../src/proxy/transport.js", async () => {
      const actual = await vi.importActual("../src/proxy/transport.js") as any;
      actual._transportInternals.createUpstreamRequest = () => mockReq;
      return actual;
    });
  });

  it("detects mid-stream SSE error event after normal data", async () => {
    const { callStream } = await import("../src/proxy/transport.js");
    const reply = createMockReply();

    const checkEarlyError = vi.fn((data: string) =>
      /"error".*"code"\s*:\s*"1234"/.test(data),
    );

    const resultPromise = callStream(
      { base_url: "http://localhost:9000" }, "sk-test", { model: "gpt-4", stream: true },
      {}, reply, 30000, "/v1/chat/completions",
      (_h, key) => ({ Authorization: `Bearer ${key}` }), undefined, checkEarlyError,
    );

    const mockRes = createMockUpstreamRes({ statusCode: 200 });
    mockReq.emit("response", mockRes);
    await tick();

    // 第一个正常 SSE event（触发 BUFFERING → STREAMING）
    mockRes.emit("data", Buffer.from('data: {"content":"Hello"}\n\n'));
    await tick();
    expect(mockReplyRaw.writeHead).toHaveBeenCalledWith(200, expect.any(Object));

    // 第二个 chunk 是 SSE error event
    mockRes.emit("data", Buffer.from('event: error\ndata: {"error":{"code":"1234","message":"网络错误"}}\n\n'));
    await tick();

    const result = await resultPromise;
    expect(result.kind).toBe("stream_error");
    if (result.kind !== "stream_error") return;
    expect(result.statusCode).toBe(200);
    expect(result.body).toContain("1234");
    expect(mockReplyRaw.end).toHaveBeenCalled();
  });

  it("does not trigger false positive for normal content", async () => {
    const { callStream } = await import("../src/proxy/transport.js");
    const reply = createMockReply();

    const checkEarlyError = vi.fn((data: string) =>
      /"error".*"code"\s*:\s*"1234"/.test(data),
    );

    const resultPromise = callStream(
      { base_url: "http://localhost:9000" }, "sk-test", { model: "gpt-4", stream: true },
      {}, reply, 30000, "/v1/chat/completions",
      (_h, key) => ({ Authorization: `Bearer ${key}` }), undefined, checkEarlyError,
    );

    const mockRes = createMockUpstreamRes({ statusCode: 200 });
    mockReq.emit("response", mockRes);
    await tick();

    mockRes.emit("data", Buffer.from('data: {"content":"Error handling is important"}\n\n'));
    mockRes.emit("data", Buffer.from('data: {"content":"No problem here"}\n\n'));
    mockRes.emit("end");

    const result = await resultPromise;
    expect(result.kind).toBe("stream_success");
  });

  it("detects error across chunk boundaries", async () => {
    const { callStream } = await import("../src/proxy/transport.js");
    const reply = createMockReply();

    const checkEarlyError = vi.fn((data: string) =>
      /"error".*"code"\s*:\s*"1234"/.test(data),
    );

    const resultPromise = callStream(
      { base_url: "http://localhost:9000" }, "sk-test", { model: "gpt-4", stream: true },
      {}, reply, 30000, "/v1/chat/completions",
      (_h, key) => ({ Authorization: `Bearer ${key}` }), undefined, checkEarlyError,
    );

    const mockRes = createMockUpstreamRes({ statusCode: 200 });
    mockReq.emit("response", mockRes);
    await tick();

    mockRes.emit("data", Buffer.from('data: {"content":"Hello"}\n\n'));
    await tick();

    // Error event 被拆分为两个 chunk
    mockRes.emit("data", Buffer.from('event: erro'));
    mockRes.emit("data", Buffer.from('r\ndata: {"error":{"code":"1234","message":"网络错误"}}\n\n'));
    await tick();

    const result = await resultPromise;
    expect(result.kind).toBe("stream_error");
  });
});

// ============================================================
// Mid-stream SSE error detection (STREAMING 阶段 error 检测)
// ============================================================

describe("StreamProxy mid-stream SSE error detection", () => {
  let mockReq: ReturnType<typeof createMockUpstreamReq>;
  let mockReplyRaw: ReturnType<typeof createMockReplyRaw>;

  function createMockReply() {
    mockReplyRaw = createMockReplyRaw();
    return { raw: mockReplyRaw } as any;
  }

  beforeEach(() => {
    vi.resetModules();
    mockReq = createMockUpstreamReq();
    vi.doMock("../src/proxy/transport.js", async () => {
      const actual = await vi.importActual("../src/proxy/transport.js") as any;
      actual._transportInternals.createUpstreamRequest = () => mockReq;
      return actual;
    });
  });

  it("detects mid-stream SSE error event after normal data", async () => {
    const { callStream } = await import("../src/proxy/transport.js");
    const reply = createMockReply();

    const checkEarlyError = vi.fn((data: string) =>
      /"error".*"code"\s*:\s*"1234"/.test(data),
    );

    const resultPromise = callStream(
      { base_url: "http://localhost:9000" },
      "sk-test",
      { model: "gpt-4", stream: true },
      {},
      reply,
      30000,
      "/v1/chat/completions",
      (_h, key) => ({ Authorization: `Bearer ${key}` }),
      undefined,
      checkEarlyError,
    );

    const mockRes = createMockUpstreamRes({ statusCode: 200 });
    mockReq.emit("response", mockRes);

    await tick();
    mockRes.emit("data", Buffer.from('data: {"content":"Hello"}\n\n'));
    await tick();

    expect(mockReplyRaw.writeHead).toHaveBeenCalledWith(200, expect.any(Object));

    mockRes.emit("data", Buffer.from('event: error\ndata: {"error":{"code":"1234","message":"网络错误"}}\n\n'));
    await tick();

    const result = await resultPromise;
    expect(result.kind).toBe("stream_error");
    if (result.kind !== "stream_error") return;
    expect(result.statusCode).toBe(200);
    expect(result.body).toContain("1234");
    expect(mockReplyRaw.end).toHaveBeenCalled();
  });

  it("does not trigger false positive for normal content", async () => {
    const { callStream } = await import("../src/proxy/transport.js");
    const reply = createMockReply();

    const checkEarlyError = vi.fn((data: string) =>
      /"error".*"code"\s*:\s*"1234"/.test(data),
    );

    const resultPromise = callStream(
      { base_url: "http://localhost:9000" },
      "sk-test",
      { model: "gpt-4", stream: true },
      {},
      reply,
      30000,
      "/v1/chat/completions",
      (_h, key) => ({ Authorization: `Bearer ${key}` }),
      undefined,
      checkEarlyError,
    );

    const mockRes = createMockUpstreamRes({ statusCode: 200 });
    mockReq.emit("response", mockRes);

    await tick();
    mockRes.emit("data", Buffer.from('data: {"content":"Error handling is important"}\n\n'));
    await tick();
    mockRes.emit("data", Buffer.from('data: {"content":"No error here"}\n\n'));
    mockRes.emit("end");

    const result = await resultPromise;
    expect(result.kind).toBe("stream_success");
  });

  it("detects error across chunk boundaries", async () => {
    const { callStream } = await import("../src/proxy/transport.js");
    const reply = createMockReply();

    const checkEarlyError = vi.fn((data: string) =>
      /"error".*"code"\s*:\s*"1234"/.test(data),
    );

    const resultPromise = callStream(
      { base_url: "http://localhost:9000" },
      "sk-test",
      { model: "gpt-4", stream: true },
      {},
      reply,
      30000,
      "/v1/chat/completions",
      (_h, key) => ({ Authorization: `Bearer ${key}` }),
      undefined,
      checkEarlyError,
    );

    const mockRes = createMockUpstreamRes({ statusCode: 200 });
    mockReq.emit("response", mockRes);

    await tick();
    mockRes.emit("data", Buffer.from('data: {"content":"Hello"}\n\n'));
    await tick();

    mockRes.emit("data", Buffer.from('event: erro'));
    mockRes.emit("data", Buffer.from('r\ndata: {"error":{"code":"1234","message":"网络错误"}}\n\n'));
    await tick();

    const result = await resultPromise;
    expect(result.kind).toBe("stream_error");
  });
});
