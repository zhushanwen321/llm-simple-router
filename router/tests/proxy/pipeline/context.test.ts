/**
 * PipelineContext 工厂函数接口契约测试。
 *
 * 覆盖 spec 中 pipeline-hooks.md 对 PipelineContext 的定义：
 * - readonly 字段不可变（request, reply, rawBody, clientModel, apiType, sessionId）
 * - 可变字段正确初始化
 * - createPipelineContext 从 Fastify request 正确提取上下文
 */
import { describe, it, expect, vi } from "vitest";
import { createPipelineContext } from "../../../src/proxy/pipeline/context.js";

function createMockRequest(overrides: Record<string, unknown> = {}) {
  return {
    body: { model: "gpt-4", messages: [{ role: "user", content: "hi" }], stream: true, ...overrides.body },
    headers: { "content-type": "application/json", ...overrides.headers },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  } as any;
}

function createMockReply() {
  return {
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    raw: { write: vi.fn(), end: vi.fn(), headersSent: false },
    header: vi.fn().mockReturnThis(),
  } as any;
}

describe("PipelineContext", () => {
  it("extracts clientModel from body.model", () => {
    const ctx = createPipelineContext(createMockRequest(), createMockReply(), "openai");
    expect(ctx.clientModel).toBe("gpt-4");
  });

  it("defaults clientModel to 'unknown' when body.model is missing", () => {
    const req = createMockRequest({ body: { messages: [] } });
    const ctx = createPipelineContext(req, createMockReply(), "openai");
    expect(ctx.clientModel).toBe("unknown");
  });

  it("sets apiType from constructor parameter", () => {
    const ctx = createPipelineContext(createMockRequest(), createMockReply(), "anthropic");
    expect(ctx.apiType).toBe("anthropic");
  });

  it("extracts sessionId from x-claude-code-session-id header", () => {
    const req = createMockRequest({
      headers: { "x-claude-code-session-id": "sess-123" },
    });
    const ctx = createPipelineContext(req, createMockReply(), "openai");
    expect(ctx.sessionId).toBe("sess-123");
  });

  it("sets sessionId to undefined when header is missing", () => {
    const ctx = createPipelineContext(createMockRequest(), createMockReply(), "openai");
    expect(ctx.sessionId).toBeUndefined();
  });

  it("initializes isStream from body.stream", () => {
    const req = createMockRequest({ body: { model: "gpt-4", stream: true } });
    const ctx = createPipelineContext(req, createMockReply(), "openai");
    expect(ctx.isStream).toBe(true);
  });

  it("defaults isStream to false when body.stream is falsy", () => {
    const req = createMockRequest({ body: { model: "gpt-4" } });
    const ctx = createPipelineContext(req, createMockReply(), "openai");
    expect(ctx.isStream).toBe(false);
  });

  it("initializes mutable fields to null/empty", () => {
    const ctx = createPipelineContext(createMockRequest(), createMockReply(), "openai");
    expect(ctx.resolved).toBeNull();
    expect(ctx.provider).toBeNull();
    expect(ctx.transportResult).toBeNull();
    expect(ctx.resilienceResult).toBeNull();
    expect(ctx.injectedHeaders).toEqual({});
    expect(ctx.metadata).toBeInstanceOf(Map);
    expect(ctx.metadata.size).toBe(0);
  });

  it("stores a deep copy of the original body in rawBody", () => {
    const req = createMockRequest();
    const ctx = createPipelineContext(req, createMockReply(), "openai");
    // rawBody should be a copy, not the same reference
    expect(ctx.rawBody).toEqual(req.body);
    // Mutating body should not affect rawBody
    ctx.body.model = "changed";
    expect((ctx.rawBody as Record<string, unknown>).model).toBe("gpt-4");
  });
});
