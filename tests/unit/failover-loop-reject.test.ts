import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { initDatabase } from "../../router/src/db/index.js";
import { rejectAndReply, applyPluginAdjustments } from "../../router/src/proxy/handler/reject-helpers.js";

describe("rejectAndReply", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDatabase(":memory:");
  });

  it("sends error response with correct status code", () => {
    const mockReply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };
    const params = {
      db,
      logId: "test-log-id",
      apiType: "openai",
      model: "gpt-4",
      startTime: Date.now(),
      isStream: false,
      routerKeyId: null,
      originalBody: {},
      clientHeaders: {} as Record<string, string>,
      isFailover: false,
      originalRequestId: null,
      sessionId: undefined,
    };

    rejectAndReply(
      mockReply as never,
      params,
      { statusCode: 404, body: { error: { message: "not found" } } },
      "Model not found",
    );

    expect(mockReply.code).toHaveBeenCalledWith(404);
    expect(mockReply.send).toHaveBeenCalledWith({ error: { message: "not found" } });
  });

  it("calls afterLog callback after logging", () => {
    const mockReply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };
    const params = {
      db,
      logId: "test-log-id",
      apiType: "openai",
      model: "gpt-4",
      startTime: Date.now(),
      isStream: false,
      routerKeyId: null,
      originalBody: {},
      clientHeaders: {} as Record<string, string>,
      isFailover: false,
      originalRequestId: null,
      sessionId: undefined,
    };
    const afterLog = vi.fn();

    rejectAndReply(
      mockReply as never,
      params,
      { statusCode: 500, body: {} },
      "error",
      undefined,
      afterLog,
    );

    expect(afterLog).toHaveBeenCalled();
  });

  it("swallows afterLog errors without affecting response", () => {
    const mockReply = {
      code: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    };
    const params = {
      db,
      logId: "test-log-id",
      apiType: "openai",
      model: "gpt-4",
      startTime: Date.now(),
      isStream: false,
      routerKeyId: null,
      originalBody: {},
      clientHeaders: {} as Record<string, string>,
      isFailover: false,
      originalRequestId: null,
      sessionId: undefined,
    };
    const afterLog = vi.fn().mockImplementation(() => { throw new Error("log failed"); });

    // Should not throw
    rejectAndReply(
      mockReply as never,
      params,
      { statusCode: 500, body: {} },
      "error",
      undefined,
      afterLog,
    );

    expect(mockReply.code).toHaveBeenCalledWith(500);
    expect(mockReply.send).toHaveBeenCalled();
  });
});

describe("applyPluginAdjustments", () => {
  it("returns empty headers when no plugin registry", () => {
    const result = applyPluginAdjustments(undefined, {}, "openai", {
      id: "p1", name: "test", base_url: "http://test", api_type: "openai",
    });
    expect(result).toEqual({ headers: {} });
  });

  it("calls beforeRequest and afterRequest hooks", () => {
    const mockRegistry = {
      applyBeforeRequest: vi.fn(),
      applyAfterRequest: vi.fn(),
    };
    const provider = { id: "p1", name: "test", base_url: "http://test", api_type: "openai" };

    applyPluginAdjustments(mockRegistry as never, { model: "gpt-4" }, "openai", provider);

    expect(mockRegistry.applyBeforeRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { model: "gpt-4" },
        sourceApiType: "openai",
        targetApiType: "openai",
      }),
    );
    expect(mockRegistry.applyAfterRequest).toHaveBeenCalled();
  });
});
