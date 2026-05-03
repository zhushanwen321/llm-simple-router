import { describe, it, expect } from "vitest";
import { SSEParser } from "../src/metrics/sse-parser.js";

describe("SSEParser", () => {
  it("should parse a simple single event in one chunk", () => {
    const parser = new SSEParser();
    const events = parser.feed('data: {"id":"chatcmpl-xxx","choices":[]}\n\n');
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      event: undefined,
      data: '{"id":"chatcmpl-xxx","choices":[]}',
    });
  });

  it("should parse event split across two chunks", () => {
    const parser = new SSEParser();
    const e1 = parser.feed('data: {"id":"chatcmpl-xxx"');
    expect(e1).toHaveLength(0);
    const e2 = parser.feed(',"choices":[]}\n\n');
    expect(e2).toHaveLength(1);
    expect(e2[0].data).toBe('{"id":"chatcmpl-xxx","choices":[]}');
  });

  it("should parse multiple events in one chunk", () => {
    const parser = new SSEParser();
    const events = parser.feed(
      'data: first\n\ndata: second\n\ndata: third\n\n',
    );
    expect(events).toHaveLength(3);
    expect(events[0].data).toBe("first");
    expect(events[1].data).toBe("second");
    expect(events[2].data).toBe("third");
  });

  it("should detect [DONE] and set isDone", () => {
    const parser = new SSEParser();
    const events = parser.feed("data: hello\n\ndata: [DONE]\n\n");
    // [DONE] 不作为事件返回
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe("hello");
    expect(parser.isDone).toBe(true);
  });

  it("should ignore events after [DONE]", () => {
    const parser = new SSEParser();
    parser.feed("data: [DONE]\n\n");
    const events = parser.feed("data: after-done\n\n");
    expect(events).toHaveLength(0);
  });

  it("should return empty array for empty chunks", () => {
    const parser = new SSEParser();
    expect(parser.feed("")).toHaveLength(0);
    expect(parser.feed("\n")).toHaveLength(0);
    expect(parser.feed("\n\n")).toHaveLength(0);
  });

  it("should ignore SSE comment lines (starting with :)", () => {
    const parser = new SSEParser();
    const events = parser.feed(": this is a comment\ndata: real\n\n");
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe("real");
  });

  it("should parse event with both event: and data: fields", () => {
    const parser = new SSEParser();
    const events = parser.feed(
      'event: message_start\ndata: {"type":"message_start"}\n\n',
    );
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("message_start");
    expect(events[0].data).toBe('{"type":"message_start"}');
  });

  it("should parse event with only data: field (no event type)", () => {
    const parser = new SSEParser();
    const events = parser.feed('data: {"id":"123"}\n\n');
    expect(events).toHaveLength(1);
    expect(events[0].event).toBeUndefined();
    expect(events[0].data).toBe('{"id":"123"}');
  });

  it("should strip single leading space after colon in data values", () => {
    const parser = new SSEParser();
    // SSE 规范只去除第一个空格: "data: value" -> "value"
    const events = parser.feed("data: hello world\n\n");
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe("hello world");
  });

  it("should only strip one leading space even with multiple spaces", () => {
    const parser = new SSEParser();
    // "data:  hello" -> " hello"（只去一个空格，符合 SSE 规范）
    const events = parser.feed("data:  hello world\n\n");
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe(" hello world");
  });

  it("should not strip leading space when data starts without space", () => {
    const parser = new SSEParser();
    const events = parser.feed("data:hello\n\n");
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe("hello");
  });

  it("should join multiple data lines with newline per SSE spec", () => {
    const parser = new SSEParser();
    const events = parser.feed("data: line1\ndata: line2\ndata: line3\n\n");
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe("line1\nline2\nline3");
  });

  it("should handle flush for incomplete buffer", () => {
    const parser = new SSEParser();
    parser.feed("data: incomplete");
    const events = parser.flush();
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe("incomplete");
  });

  it("should handle flush on empty buffer", () => {
    const parser = new SSEParser();
    const events = parser.flush();
    expect(events).toHaveLength(0);
  });

  it("should handle realistic OpenAI streaming chunk sequence", () => {
    const parser = new SSEParser();
    const chunks = [
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"delta":{"role":"assistant"},"index":0}]}\n\n',
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hello"},"index":0}]}\n\n',
      'data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"delta":{"content":" world"},"index":0}]}\n\n',
      "data: [DONE]\n\n",
    ];

    let allEvents: any[] = [];
    for (const chunk of chunks) {
      allEvents = allEvents.concat(parser.feed(chunk));
    }

    expect(allEvents).toHaveLength(3);
    expect(allEvents[0].data).toContain('"role":"assistant"');
    expect(allEvents[1].data).toContain('"content":"Hello"');
    expect(allEvents[2].data).toContain('"content":" world"');
    expect(parser.isDone).toBe(true);
  });

  it("should handle realistic Anthropic streaming events", () => {
    const parser = new SSEParser();
    // 每个 SSE 事件块以 \n\n 分隔；join("\n") 把数组元素用 \n 连接，
    // 所以需要两个连续空字符串来产生 \n\n
    const events = parser.feed(
      [
        'event: message_start',
        'data: {"type":"message_start","message":{"id":"msg_123"}}',
        "",
        "",
        'event: content_block_start',
        'data: {"type":"content_block_start","index":0}',
        "",
        "",
        'event: content_block_delta',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}',
        "",
        "",
        'event: message_stop',
        'data: {"type":"message_stop"}',
        "",
        "",
      ].join("\n"),
    );

    expect(events).toHaveLength(4);
    expect(events[0].event).toBe("message_start");
    expect(events[0].data).toContain("message_start");
    expect(events[1].event).toBe("content_block_start");
    expect(events[2].event).toBe("content_block_delta");
    expect(events[2].data).toContain('"text":"Hi"');
    expect(events[3].event).toBe("message_stop");
  });

  it("should handle CRLF (\\r\\n) line endings per SSE spec", () => {
    const parser = new SSEParser();
    const events = parser.feed("data: hello\r\n\r\ndata: world\r\n\r\n");
    expect(events).toHaveLength(2);
    expect(events[0].data).toBe("hello");
    expect(events[1].data).toBe("world");
  });

  it("should handle mixed CRLF and LF line endings", () => {
    const parser = new SSEParser();
    const events = parser.feed("data: first\r\n\r\ndata: second\n\n");
    expect(events).toHaveLength(2);
    expect(events[0].data).toBe("first");
    expect(events[1].data).toBe("second");
  });

  it("should handle \\r\\n split across chunk boundary", () => {
    const parser = new SSEParser();
    // 第一个 chunk 以 \r 结尾，第二个 chunk 以 \n\r\n 开头
    const e1 = parser.feed("data: first\r");
    expect(e1).toHaveLength(0);
    const e2 = parser.feed("\n\r\ndata: second\r\n\r\n");
    expect(e2).toHaveLength(2);
    expect(e2[0].data).toBe("first");
    expect(e2[1].data).toBe("second");
  });

  it("should handle chunk boundary splitting in the middle of \\n\\n", () => {
    const parser = new SSEParser();
    // 第一次 feed 只有 "data: first\n"，没有 \n\n，不会产生事件
    const e1 = parser.feed("data: first\n");
    expect(e1).toHaveLength(0);
    // 第二次 feed 补上 \n，buffer 变成 "data: first\n\ndata: second\n\n"
    // 两个事件都在这一次解析完成
    const e2 = parser.feed("\ndata: second\n\n");
    expect(e2).toHaveLength(2);
    expect(e2[0].data).toBe("first");
    expect(e2[1].data).toBe("second");
    // buffer 已经清空
    expect(parser.flush()).toHaveLength(0);
  });
});
