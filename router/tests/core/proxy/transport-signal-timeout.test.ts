import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "events";
import type { FastifyReply } from "fastify";
import { callNonStream, callStream } from "../../../src/proxy/transport/http.js";
import { createMockBackend } from "../../helpers/mock-backend.js";

// ---------- Mock helpers ----------

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

const tick = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------- callNonStream: signal + timeout ----------

describe("callNonStream signal + timeout", () => {
  it("resolves throw on upstream inactivity timeout (timeoutMs=100, upstream hang)", async () => {
    // 上游 accept 连接但不回响应，模拟 hang
    const { port, close } = await createMockBackend(() => {
      /* hang: 不 writeHead/end */
    });

    try {
      const start = Date.now();
      const result = await callNonStream(
        { base_url: `http://127.0.0.1:${port}` },
        "sk-test",
        { model: "gpt-4" },
        {},
        "/v1/chat/completions",
        (_h, key) => ({ Authorization: `Bearer ${key}` }),
        undefined,
        { timeoutMs: 100 },
      );
      const elapsed = Date.now() - start;

      expect(result.kind).toBe("throw");
      if (result.kind !== "throw") return;
      expect(result.error.message).toContain("inactivity timeout");
      // 100ms 超时应触发（允许调度抖动）
      expect(elapsed).toBeGreaterThanOrEqual(80);
      expect(elapsed).toBeLessThan(1500);
    } finally {
      await close();
    }
  });

  it("resolves throw with 'client aborted' when signal aborts", async () => {
    const { port, close } = await createMockBackend(() => {
      /* hang */
    });

    try {
      const controller = new AbortController();
      const resultPromise = callNonStream(
        { base_url: `http://127.0.0.1:${port}` },
        "sk-test",
        { model: "gpt-4" },
        {},
        "/v1/chat/completions",
        (_h, key) => ({ Authorization: `Bearer ${key}` }),
        undefined,
        { signal: controller.signal },
      );
      // 等请求发出后再 abort
      await tick(50);
      controller.abort();

      const result = await resultPromise;
      expect(result.kind).toBe("throw");
      if (result.kind !== "throw") return;
      expect(result.error.message).toBe("client aborted");
    } finally {
      await close();
    }
  });

  it("skips setTimeout when timeoutMs=0 (normal response resolves success)", async () => {
    const { port, close } = await createMockBackend((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c));
      req.on("end", () => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });

    try {
      const result = await callNonStream(
        { base_url: `http://127.0.0.1:${port}` },
        "sk-test",
        { model: "gpt-4" },
        {},
        "/v1/chat/completions",
        (_h, key) => ({ Authorization: `Bearer ${key}` }),
        undefined,
        { timeoutMs: 0 },
      );
      expect(result.kind).toBe("success");
      if (result.kind !== "success") return;
      expect(result.body).toContain('"ok":true');
    } finally {
      await close();
    }
  });

  it("aborts immediately when signal is already aborted", async () => {
    const { port, close } = await createMockBackend(() => {
      /* hang */
    });

    try {
      const controller = new AbortController();
      controller.abort(); // 提前 abort

      const result = await callNonStream(
        { base_url: `http://127.0.0.1:${port}` },
        "sk-test",
        { model: "gpt-4" },
        {},
        "/v1/chat/completions",
        (_h, key) => ({ Authorization: `Bearer ${key}` }),
        undefined,
        { signal: controller.signal },
      );
      expect(result.kind).toBe("throw");
      if (result.kind !== "throw") return;
      expect(result.error.message).toBe("client aborted");
    } finally {
      await close();
    }
  });

  it("signal 先于 timeout 触发时 resolve 'client aborted'（signal+timeout 组合竞态）", async () => {
    // 同时设置 timeoutMs 与 signal：signal 在 timeout 前触发 → 应 resolve 'client aborted' 而非 timeout
    const { port, close } = await createMockBackend(() => {
      /* hang */
    });

    try {
      const controller = new AbortController();
      const resultPromise = callNonStream(
        { base_url: `http://127.0.0.1:${port}` },
        "sk-test",
        { model: "gpt-4" },
        {},
        "/v1/chat/completions",
        (_h, key) => ({ Authorization: `Bearer ${key}` }),
        undefined,
        { timeoutMs: 200, signal: controller.signal },
      );
      // timeoutMs=200，在 50ms 时 signal abort → signal 赢，不走 timeout
      await tick(50);
      controller.abort();

      const result = await resultPromise;
      expect(result.kind).toBe("throw");
      if (result.kind !== "throw") return;
      expect(result.error.message).toBe("client aborted");
    } finally {
      await close();
    }
  });
});

// ---------- callStream: signal abort during TTFT ----------

describe("callStream signal abort (TTFT / pre-response)", () => {
  it("resolves throw on signal abort before upstream responds", async () => {
    const { port, close } = await createMockBackend(() => {
      /* hang: 不回响应头，停留在 TTFT 阶段 */
    });

    try {
      const reply = createMockReply();
      const controller = new AbortController();
      const resultPromise = callStream(
        { base_url: `http://127.0.0.1:${port}` },
        "sk-test",
        { model: "gpt-4", stream: true },
        {},
        reply,
        30_000,
        "/v1/chat/completions",
        (_h, key) => ({ Authorization: `Bearer ${key}` }),
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        { signal: controller.signal },
      );
      await tick(50);
      controller.abort();

      const result = await resultPromise;
      expect(result.kind).toBe("throw");
      if (result.kind !== "throw") return;
      expect(result.error.message).toBe("client aborted");
    } finally {
      await close();
    }
  });

  it("resolves throw on connectTimeoutMs when upstream hangs pre-response", async () => {
    const { port, close } = await createMockBackend(() => {
      /* hang */
    });

    try {
      const reply = createMockReply();
      const start = Date.now();
      const resultPromise = callStream(
        { base_url: `http://127.0.0.1:${port}` },
        "sk-test",
        { model: "gpt-4", stream: true },
        {},
        reply,
        30_000, // idleTimer（响应头后），本场景到不了
        "/v1/chat/completions",
        (_h, key) => ({ Authorization: `Bearer ${key}` }),
        undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        { connectTimeoutMs: 100 },
      );
      const result = await resultPromise;
      const elapsed = Date.now() - start;

      expect(result.kind).toBe("throw");
      if (result.kind !== "throw") return;
      expect(result.error.message).toContain("pre-response");
      expect(elapsed).toBeGreaterThanOrEqual(80);
      expect(elapsed).toBeLessThan(1500);
    } finally {
      await close();
    }
  });
});
