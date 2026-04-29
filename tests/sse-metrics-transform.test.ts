import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SSEMetricsTransform } from "../src/metrics/sse-metrics-transform.js";

// 辅助：构建 OpenAI SSE data chunk
function openaiChunk(
  content: string,
  opts?: { finish_reason?: string; usage?: object },
): string {
  const choice: Record<string, unknown> = { delta: { content } };
  if (opts?.finish_reason) choice.finish_reason = opts.finish_reason;
  const obj: Record<string, unknown> = { choices: [choice] };
  if (opts?.usage) obj.usage = opts.usage;
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function openaiDone(): string {
  return "data: [DONE]\n\n";
}

describe("SSEMetricsTransform", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("onMetrics callback is called after processing events (if throttle allows)", () => {
    const onMetrics = vi.fn();
    const transform = new SSEMetricsTransform("openai", 999_000, { onMetrics });

    // 首次写入，无节流限制，应触发回调
    transform.write(openaiChunk("hello"));
    expect(onMetrics).toHaveBeenCalledTimes(1);
    expect(onMetrics.mock.calls[0][0]).toHaveProperty("is_complete", 0);
  });

  it("onMetrics is NOT called within throttle window (5s default)", () => {
    const onMetrics = vi.fn();
    const transform = new SSEMetricsTransform("openai", 999_000, { onMetrics });

    // 首次写入触发回调
    transform.write(openaiChunk("hello"));
    expect(onMetrics).toHaveBeenCalledTimes(1);

    // 在节流窗口内再次写入，不应触发回调
    vi.advanceTimersByTime(1000);
    transform.write(openaiChunk("world"));
    expect(onMetrics).toHaveBeenCalledTimes(1);
  });

  it("onMetrics IS called again after throttle window passes", () => {
    const onMetrics = vi.fn();
    const transform = new SSEMetricsTransform("openai", 999_000, { onMetrics });

    transform.write(openaiChunk("hello"));
    expect(onMetrics).toHaveBeenCalledTimes(1);

    // 超过节流窗口后再次写入
    vi.advanceTimersByTime(5001);
    transform.write(openaiChunk("world"));
    expect(onMetrics).toHaveBeenCalledTimes(2);
  });

  it("onMetrics is called unconditionally in _flush", () => {
    const onMetrics = vi.fn();
    const startTime = 999_000;
    const transform = new SSEMetricsTransform("openai", startTime, { onMetrics });

    // 写入数据，触发首次回调
    transform.write(openaiChunk("hello"));
    expect(onMetrics).toHaveBeenCalledTimes(1);

    // 在节流窗口内 flush，仍然应触发回调
    vi.advanceTimersByTime(1000);
    transform.end();
    expect(onMetrics).toHaveBeenCalledTimes(2);
  });

  it("onMetrics is called in _flush even if no prior _transform callbacks fired", () => {
    const onMetrics = vi.fn();
    const transform = new SSEMetricsTransform("openai", 999_000, { onMetrics });

    // 不写入任何数据，直接 end 触发 flush
    transform.end();
    // flush 中仍有回调（即使指标都是 null）
    expect(onMetrics).toHaveBeenCalledTimes(1);
  });

  it("without onMetrics option, transform works normally (backward compatibility)", () => {
    const transform = new SSEMetricsTransform("openai", 999_000);

    let output = "";
    transform.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    const chunk1 = openaiChunk("hello");
    transform.write(chunk1);
    transform.end();

    // 数据应原样透传
    expect(output).toContain("hello");
    // 不应抛出异常
  });

  it("custom throttleMs works", () => {
    const onMetrics = vi.fn();
    const transform = new SSEMetricsTransform("openai", 999_000, {
      onMetrics,
      throttleMs: 2000,
    });

    transform.write(openaiChunk("a"));
    expect(onMetrics).toHaveBeenCalledTimes(1);

    // 距离上次调用只过了 1.5s，小于 throttleMs=2000，不应触发
    vi.advanceTimersByTime(1500);
    transform.write(openaiChunk("b"));
    expect(onMetrics).toHaveBeenCalledTimes(1);

    // 再过 1s（总共 2.5s），超过 throttleMs，应触发
    vi.advanceTimersByTime(1000);
    transform.write(openaiChunk("c"));
    expect(onMetrics).toHaveBeenCalledTimes(2);
  });

  describe("onContentDelta", () => {
    it("fires for OpenAI text content", () => {
      const onContentDelta = vi.fn();
      const transform = new SSEMetricsTransform("openai", 999_000, { onContentDelta });
      transform.write(openaiChunk("Hello world"));
      expect(onContentDelta).toHaveBeenCalledTimes(1);
      expect(onContentDelta).toHaveBeenCalledWith("Hello world");
    });

    it("does NOT fire for OpenAI chunks without content", () => {
      const onContentDelta = vi.fn();
      const transform = new SSEMetricsTransform("openai", 999_000, { onContentDelta });
      const obj = { choices: [{ delta: { role: "assistant" } }] };
      transform.write(`data: ${JSON.stringify(obj)}\n\n`);
      expect(onContentDelta).not.toHaveBeenCalled();
    });

    it("fires for Anthropic text_delta content", () => {
      const onContentDelta = vi.fn();
      const transform = new SSEMetricsTransform("anthropic", 999_000, { onContentDelta });
      const event = { type: "content_block_delta", delta: { type: "text_delta", text: "Hello" } };
      transform.write(`event: content_block_delta\ndata: ${JSON.stringify(event)}\n\n`);
      expect(onContentDelta).toHaveBeenCalledTimes(1);
      expect(onContentDelta).toHaveBeenCalledWith("Hello");
    });

    it("fires for Anthropic thinking_delta content", () => {
      const onContentDelta = vi.fn();
      const transform = new SSEMetricsTransform("anthropic", 999_000, { onContentDelta });
      const event = { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "Let me think..." } };
      transform.write(`event: content_block_delta\ndata: ${JSON.stringify(event)}\n\n`);
      expect(onContentDelta).toHaveBeenCalledTimes(1);
      expect(onContentDelta).toHaveBeenCalledWith("Let me think...");
    });

    it("fires for Anthropic input_json_delta content", () => {
      const onContentDelta = vi.fn();
      const transform = new SSEMetricsTransform("anthropic", 999_000, { onContentDelta });
      const event = { type: "content_block_delta", delta: { type: "input_json_delta", partial_json: '{"command": "ls' } };
      transform.write(`event: content_block_delta\ndata: ${JSON.stringify(event)}\n\n`);
      expect(onContentDelta).toHaveBeenCalledTimes(1);
      expect(onContentDelta).toHaveBeenCalledWith('{"command": "ls');
    });

    it("does NOT fire for Anthropic message_start event", () => {
      const onContentDelta = vi.fn();
      const transform = new SSEMetricsTransform("anthropic", 999_000, { onContentDelta });
      const event = { type: "message_start", message: { usage: { input_tokens: 100 } } };
      transform.write(`event: message_start\ndata: ${JSON.stringify(event)}\n\n`);
      expect(onContentDelta).not.toHaveBeenCalled();
    });

    it("does not fire when onContentDelta is not provided", () => {
      const transform = new SSEMetricsTransform("openai", 999_000);
      transform.write(openaiChunk("Hello"));
      transform.end();
      // 不应抛出异常
    });
  });
});
