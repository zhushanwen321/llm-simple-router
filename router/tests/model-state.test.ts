import { describe, it, expect, beforeEach, vi } from "vitest";
import { ModelStateManager } from "../src/proxy/routing/model-state.js";

describe("ModelStateManager", () => {
  let mgr: ModelStateManager;

  beforeEach(() => {
    mgr = new ModelStateManager();
    vi.useFakeTimers();
  });

  it("记录和查询模型", () => {
    mgr.set("key-1", "glm-5.1");
    expect(mgr.get("key-1")).toBe("glm-5.1");
  });

  it("不同 key 隔离", () => {
    mgr.set("key-1", "glm-5.1");
    mgr.set("key-2", "deepseek-v3");
    expect(mgr.get("key-1")).toBe("glm-5.1");
    expect(mgr.get("key-2")).toBe("deepseek-v3");
  });

  it("default 清除记忆", () => {
    mgr.set("key-1", "glm-5.1");
    mgr.set("key-1", "default");
    expect(mgr.get("key-1")).toBeNull();
  });

  it("null key 支持", () => {
    mgr.set(null, "glm-5.1");
    expect(mgr.get(null)).toBe("glm-5.1");
  });

  it("24h TTL 过期", () => {
    mgr.set("key-1", "glm-5.1");
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1);
    expect(mgr.get("key-1")).toBeNull();
  });

  it("set 刷新 TTL", () => {
    mgr.set("key-1", "glm-5.1");
    vi.advanceTimersByTime(12 * 60 * 60 * 1000);
    mgr.set("key-1", "glm-5.1"); // refresh
    vi.advanceTimersByTime(12 * 60 * 60 * 1000);
    expect(mgr.get("key-1")).toBe("glm-5.1"); // not expired yet
  });

  it("未记录返回 null", () => {
    expect(mgr.get("unknown")).toBeNull();
  });
});

// --- Session-scoped tests ---

function createMockDb() {
  const mockRun = vi.fn();
  const mockGet = vi.fn().mockReturnValue(undefined);
  const mockAll = vi.fn().mockReturnValue([]);
  return {
    transaction: vi.fn((fn: () => void) => fn),
    prepare: vi.fn(() => ({ run: mockRun, get: mockGet, all: mockAll })),
    // 暴露内部 mock 以便断言
    _run: mockRun,
    _get: mockGet,
    _all: mockAll,
  };
}

describe("session-scoped", () => {
  let mgr: ModelStateManager;
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    mgr = new ModelStateManager();
    mockDb = createMockDb();
    mgr.init(mockDb as unknown as import("better-sqlite3").Database);
    vi.useFakeTimers();
  });

  it("set with sessionId writes to memory", () => {
    mgr.set("key-1", "glm-5.1", "sess-1");
    expect(mgr.get("key-1", "sess-1")).toBe("glm-5.1");
  });

  it("set with sessionId calls DB transaction", () => {
    mgr.set("key-1", "glm-5.1", "sess-1");
    expect(mockDb.transaction).toHaveBeenCalled();
  });

  it("get memory hit does not query DB", () => {
    mgr.set("key-1", "glm-5.1", "sess-1");
    mockDb.prepare.mockClear();
    expect(mgr.get("key-1", "sess-1")).toBe("glm-5.1");
    expect(mockDb.prepare).not.toHaveBeenCalled();
  });

  it("get memory miss queries DB and backfills", () => {
    // 模拟 DB 返回一行
    mockDb._get.mockReturnValueOnce({
      current_model: "deepseek-v3",
      router_key_id: "key-1",
      session_id: "sess-1",
    });

    // 不 set，直接 get（内存 miss）
    const result = mgr.get("key-1", "sess-1");
    expect(result).toBe("deepseek-v3");

    // 第二次 get 应命中内存，不再查 DB
    mockDb.prepare.mockClear();
    const result2 = mgr.get("key-1", "sess-1");
    expect(result2).toBe("deepseek-v3");
    expect(mockDb.prepare).not.toHaveBeenCalled();
  });

  it("get memory miss + DB miss returns null", () => {
    mockDb._get.mockReturnValueOnce(undefined);
    expect(mgr.get("key-1", "sess-1")).toBeNull();
  });

  it("delete clears memory + DB", () => {
    mgr.set("key-1", "glm-5.1", "sess-1");
    expect(mgr.get("key-1", "sess-1")).toBe("glm-5.1");

    mgr.delete("key-1", "sess-1");
    expect(mgr.get("key-1", "sess-1")).toBeNull();
    expect(mockDb.transaction).toHaveBeenCalled();
  });

  it("set default with sessionId deletes memory + DB", () => {
    mgr.set("key-1", "glm-5.1", "sess-1");
    expect(mgr.get("key-1", "sess-1")).toBe("glm-5.1");

    mgr.set("key-1", "default", "sess-1");
    expect(mgr.get("key-1", "sess-1")).toBeNull();
    expect(mockDb.transaction).toHaveBeenCalled();
  });

  it("no sessionId preserves original behavior", () => {
    mgr.set("key-1", "glm-5.1");
    expect(mgr.get("key-1")).toBe("glm-5.1");
    // 不带 sessionId 不触发 DB 写入
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("different sessionIds are isolated", () => {
    mgr.set("key-1", "glm-5.1", "sess-1");
    mgr.set("key-1", "deepseek-v3", "sess-2");
    expect(mgr.get("key-1", "sess-1")).toBe("glm-5.1");
    expect(mgr.get("key-1", "sess-2")).toBe("deepseek-v3");
  });
});
