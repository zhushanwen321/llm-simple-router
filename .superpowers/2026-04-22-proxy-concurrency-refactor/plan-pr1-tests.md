# PR-1 测试代码 - `tests/transport.test.ts`

> 主文档: [plan-pr1-transport.md](./plan-pr1-transport.md)
> 本文件包含 Steps 5-8 的完整测试断言代码，mock factory 定义见 Step 4

---

## 非流式测试 (Step 5)

```typescript
describe("TransportLayer.callNonStream", () => {
  let mockReq: ReturnType<typeof createMockUpstreamReq>;

  beforeEach(() => {
    vi.resetModules();
    mockReq = createMockUpstreamReq();
    vi.doMock("../src/proxy/transport.js", async () => {
      const actual = await vi.importActual("../src/proxy/transport.js");
      return { ...actual, createUpstreamRequest: () => mockReq };
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

    // 模拟 upstreamReq 收到 response 事件
    const mockRes = createMockUpstreamRes({ statusCode: 200 });
    mockReq.emit("response", mockRes);

    // response 的 data/end 事件在下一 tick 模拟
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

    // 不发送 response，直接 emit error
    mockReq.emit("error", new Error("ECONNREFUSED"));

    const result = await resultPromise;
    expect(result.kind).toBe("throw");
    if (result.kind !== "throw") return;
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error.message).toBe("ECONNREFUSED");
  });
});
```

---

## 流式正常完成测试 (Step 6)

```typescript
describe("TransportLayer.callStream", () => {
  let mockReq: ReturnType<typeof createMockUpstreamReq>;
  let mockReplyRaw: ReturnType<typeof createMockReplyRaw>;

  // 构造模拟的 FastifyReply，只暴露 raw 属性
  function createMockReply() {
    mockReplyRaw = createMockReplyRaw();
    return { raw: mockReplyRaw } as any;
  }

  beforeEach(() => {
    vi.resetModules();
    mockReq = createMockUpstreamReq();
    vi.doMock("../src/proxy/transport.js", async () => {
      const actual = await vi.importActual("../src/proxy/transport.js");
      return { ...actual, createUpstreamRequest: () => mockReq };
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
    // 发送 SSE chunk
    mockRes.emit("data", Buffer.from("data: {\"content\":\"hi\"}\n\n"));
    // 流式结束
    mockRes.emit("end");

    const result = await resultPromise;
    expect(result.kind).toBe("stream_success");
    // writeHead 应在进入 STREAMING 状态后被调用
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
      undefined, // checkEarlyError — 无早期错误检测，立即进入 STREAMING
    );

    const mockRes = createMockUpstreamRes({ statusCode: 200 });
    mockReq.emit("response", mockRes);

    await tick();
    // 无 checkEarlyError 时 startStreaming 在 response 事件中立即调用
    // 所以 headersSent 此时已为 true
    expect(mockReplyRaw.writeHead).toHaveBeenCalledWith(200, expect.any(Object));

    mockRes.emit("data", Buffer.from("data: {}\n\n"));
    mockRes.emit("end");

    const result = await resultPromise;
    expect(result.kind).toBe("stream_success");
  });
});
```

---

## 流式错误路径测试 (Step 7)

```typescript
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
      const actual = await vi.importActual("../src/proxy/transport.js");
      return { ...actual, createUpstreamRequest: () => mockReq };
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

    // 非 200 状态码直接走 stream_error 路径，不进入状态机
    const mockRes = createMockUpstreamRes({ statusCode: 429 });
    mockReq.emit("response", mockRes);

    await tick();
    mockRes.emit("data", Buffer.from("rate limited"));
    mockRes.emit("end");

    const result = await resultPromise;
    expect(result.kind).toBe("stream_error");
    if (result.kind !== "stream_error") return;
    expect(result.statusCode).toBe(429);
    // 非 200 时 writeHead 不应被调用（不向下游转发 header）
    expect(mockReplyRaw.writeHead).not.toHaveBeenCalled();
  });

  it("returns stream_error when early error detected in buffer phase", async () => {
    const { callStream } = await import("../src/proxy/transport.js");
    const reply = createMockReply();

    // checkEarlyError 在收到包含 \n\n 的数据后检测到错误
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
    // 发送包含完整事件的数据触发 checkEarlyError
    mockRes.emit("data", Buffer.from('data: {"error":"invalid_api_key"}\n\n'));

    const result = await resultPromise;
    expect(result.kind).toBe("stream_error");
    // BUFFERING → EARLY_ERROR，writeHead 不应被调用
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
    // 先发数据进入 STREAMING
    mockRes.emit("data", Buffer.from("data: {}\n\n"));

    // 模拟客户端断连
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

    // 不触发 response，直接触发请求级网络错误
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

    // checkEarlyError 返回 false，允许通过
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
    // 发送包含 \n\n 的数据，触发 BUFFERING → STREAMING 转换
    mockRes.emit("data", Buffer.from("data: {\"content\":\"hello\"}\n\n"));

    // writeHead 在 STREAMING 状态开始时被调用
    expect(mockReplyRaw.writeHead).toHaveBeenCalledWith(200, expect.any(Object));

    mockRes.emit("end");
    const result = await resultPromise;
    expect(result.kind).toBe("stream_success");
  });

  it("transitions BUFFERING→STREAMING when buffer exceeds limit", async () => {
    const { callStream } = await import("../src/proxy/transport.js");
    const reply = createMockReply();

    // checkEarlyError 存在但数据不含 \n\n，需要靠 buffer 超限触发转换
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
    // 发送超过 4096 字节但不含 \n\n 的数据
    const largeChunk = Buffer.alloc(5000, "x");
    mockRes.emit("data", largeChunk);

    // buffer 超限自动进入 STREAMING
    expect(mockReplyRaw.writeHead).toHaveBeenCalledWith(200, expect.any(Object));

    mockRes.emit("end");
    const result = await resultPromise;
    expect(result.kind).toBe("stream_success");
  });
});
```

---

## close handler 测试 (Step 8)

```typescript
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
      const actual = await vi.importActual("../src/proxy/transport.js");
      return { ...actual, createUpstreamRequest: () => mockReq };
    });
  });

  it("registers reply.raw close handler only once", async () => {
    const { callStream } = await import("../src/proxy/transport.js");
    const reply = createMockReply();

    // 包装 on 方法以追踪调用次数
    const onSpy = vi.fn((event: string, handler: () => void) => {
      // 委托给原始 EventEmitter 行为
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

    // close handler 应只注册一次
    const closeCalls = onSpy.mock.calls.filter((c: string[]) => c[0] === "close");
    expect(closeCalls).toHaveLength(1);

    // 清理：完成流以解除 promise
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
    // 正常完成流
    mockRes.emit("data", Buffer.from("data: {}\n\n"));
    mockRes.emit("end");

    // 等待正常结束 resolve
    const result = await resultPromise;
    expect(result.kind).toBe("stream_success");

    // 之后触发 close（不应改变已 resolve 的结果）
    // terminal() 内的 resolved 守卫会阻止重复 resolve
    mockReplyRaw.emit("close");

    // promise 已 resolved，结果不会变为 stream_abort
    expect(result.kind).toBe("stream_success");
  });
});
```

---

## 辅助工具

```typescript
// 事件循环让步，确保异步回调执行
function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
```
