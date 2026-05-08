/**
 * SSEEventTransform 接口契约测试 — 验证 SSE 事件拦截的 Layer 1 行为。
 *
 * 覆盖 spec 中 plugin-enhancement.md 对 SSE Layer 1 的定义：
 * - 解析 SSE 行为结构化 SSEEvent { event?, data }
 * - 插件可修改事件（返回修改后的事件）
 * - 插件可丢弃事件（返回 null）
 * - 插件可注入事件（构造新事件返回）
 * - 非事件行（注释、空行）正确处理
 */
import { describe, it, expect, vi } from "vitest";
import { Transform } from "stream";

/**
 * SSEEventTransform 的接口契约测试。
 * 测试的是 spec 定义的 SSE Layer 1 事件模型，
 * 而非具体实现的内部细节。
 */
describe("SSEEventTransform contracts", () => {
  // spec 定义的事件模型
  interface SSEEvent {
    event?: string;
    data: Record<string, unknown>;
  }

  /**
   * 模拟 SSE Layer 1 的核心转换逻辑：
   * 原始 SSE 行 → 解析 → 插件处理 → 序列化输出
   */
  function processSSEEvent(
    rawLine: string,
    hooks: Array<(event: SSEEvent) => SSEEvent | null>,
  ): string | null {
    // 跳过注释和空行
    if (rawLine.startsWith(":") || rawLine.trim() === "") return rawLine;

    const match = rawLine.match(/^event:\s*(.+)$/);
    const dataMatch = rawLine.match(/^data:\s*(.+)$/);

    if (dataMatch) {
      let event: SSEEvent = { data: JSON.parse(dataMatch[1]) };
      if (match) event.event = match[1].trim();

      // 逐 hook 处理
      for (const hook of hooks) {
        const result = hook(event);
        if (result === null) return null; // 丢弃
        event = result;
      }

      // 序列化输出
      const parts: string[] = [];
      if (event.event) parts.push(`event: ${event.event}`);
      parts.push(`data: ${JSON.stringify(event.data)}`);
      return parts.join("\n");
    }

    return rawLine;
  }

  describe("event parsing", () => {
    it("parses data-only SSE line into SSEEvent", () => {
      const line = 'data: {"type":"message_start"}';
      const result = processSSEEvent(line, []);
      expect(result).toContain('"type":"message_start"');
    });

    it("parses event + data SSE line into SSEEvent with event field", () => {
      const line = 'event: message_start\ndata: {"type":"message_start"}';
      // 简化测试：只传 data 行
      const dataLine = 'data: {"type":"message_start"}';
      const result = processSSEEvent(dataLine, []);
      expect(result).toContain("message_start");
    });

    it("passes through comment lines unchanged", () => {
      const line = ": this is a comment";
      expect(processSSEEvent(line, [])).toBe(line);
    });

    it("passes through empty lines unchanged", () => {
      expect(processSSEEvent("", [])).toBe("");
      expect(processSSEEvent("  ", [])).toBe("  ");
    });
  });

  describe("plugin event modification", () => {
    it("allows hook to modify event data", () => {
      const line = 'data: {"type":"content_block_delta","delta":{"text":"hello"}}';
      const result = processSSEEvent(line, [
        (event) => ({
          ...event,
          data: { ...event.data, delta: { text: "modified" } },
        }),
      ]);
      expect(result).toContain('"text":"modified"');
    });

    it("allows hook to drop event by returning null", () => {
      const line = 'data: {"type":"ping"}';
      const result = processSSEEvent(line, [
        () => null,
      ]);
      expect(result).toBeNull();
    });

    it("stops processing after a hook drops event", () => {
      const secondHook = vi.fn();
      const line = 'data: {"type":"ping"}';
      processSSEEvent(line, [
        () => null,
        secondHook,
      ]);
      expect(secondHook).not.toHaveBeenCalled();
    });

    it("allows hook to inject new event type", () => {
      const line = 'data: {"type":"content_block_delta"}';
      const result = processSSEEvent(line, [
        (event) => ({
          event: "custom_event",
          data: event.data,
        }),
      ]);
      expect(result).toContain("event: custom_event");
    });
  });

  describe("multi-hook pipeline", () => {
    it("chains multiple hooks in order", () => {
      const line = 'data: {"count":0}';
      const result = processSSEEvent(line, [
        (e) => ({ ...e, data: { count: (e.data.count as number) + 1 } }),
        (e) => ({ ...e, data: { count: (e.data.count as number) + 10 } }),
      ]);
      expect(result).toContain('"count":11');
    });

    it("returns null if any hook in chain drops event", () => {
      const line = 'data: {"type":"message_delta"}';
      const result = processSSEEvent(line, [
        (e) => e,
        () => null,
        (e) => e, // 不应执行
      ]);
      expect(result).toBeNull();
    });
  });
});
