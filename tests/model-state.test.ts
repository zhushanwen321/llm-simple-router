import { describe, it, expect, beforeEach, vi } from "vitest";
import { ModelStateManager } from "../src/proxy/model-state.js";

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
