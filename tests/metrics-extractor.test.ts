import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MetricsExtractor } from "../src/metrics/metrics-extractor.js";
import type { SSEEvent } from "../src/metrics/sse-parser.js";

// 固定 Date.now()，使 duration 计算可预测
const MOCK_NOW = 1000000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(MOCK_NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function makeEvent(eventType: string | undefined, data: string): SSEEvent {
  return { event: eventType, data };
}

// ============================================================
// Anthropic streaming
// ============================================================

describe("MetricsExtractor - Anthropic streaming", () => {
  it("should extract all metrics from a complete Anthropic stream", () => {
    const requestStart = MOCK_NOW - 500; // 请求发出时间
    const extractor = new MetricsExtractor("anthropic", requestStart);

    // message_start — 记录 input tokens 和 streamStartTime
    extractor.processEvent(
      makeEvent("message_start", JSON.stringify({
        type: "message_start",
        message: {
          usage: {
            input_tokens: 500,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 400,
          },
        },
      })),
    );

    // 第一个 content_block_delta — 记录 TTFT
    vi.advanceTimersByTime(200);
    extractor.processEvent(
      makeEvent("content_block_delta", JSON.stringify({
        type: "content_block_delta",
        delta: { type: "text_delta", text: "Hello" },
      })),
    );

    // 更多 delta（不应覆盖 TTFT）
    extractor.processEvent(
      makeEvent("content_block_delta", JSON.stringify({
        type: "content_block_delta",
        delta: { type: "text_delta", text: " world" },
      })),
    );

    // message_delta — 记录 output tokens 和 stop_reason
    vi.advanceTimersByTime(300);
    extractor.processEvent(
      makeEvent("message_delta", JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 42 },
      })),
    );

    // message_stop — 标记完成
    extractor.processEvent(
      makeEvent("message_stop", JSON.stringify({ type: "message_stop" })),
    );

    const metrics = extractor.getMetrics();

    expect(metrics.input_tokens).toBe(500);
    expect(metrics.cache_creation_tokens).toBe(0);
    expect(metrics.cache_read_tokens).toBe(400);
    expect(metrics.output_tokens).toBe(42);
    expect(metrics.stop_reason).toBe("end_turn");
    expect(metrics.is_complete).toBe(1);

    // TTFT: 从 requestStart 到首个 content_block_delta
    // requestStart = MOCK_NOW - 500，首个 delta 在 MOCK_NOW + 200
    expect(metrics.ttft_ms).toBe(700);

    // streamStartTime 在 message_start 时 = MOCK_NOW
    // streamEndTime 在 message_delta 时 = MOCK_NOW + 500
    // total = 500
    expect(metrics.total_duration_ms).toBe(500);

    // text_delta "Hello" + " world" = "Hello world" = 2 tokens (o200k_base)
    // textStreamStartTime at first text_delta = MOCK_NOW + 200
    // streamEndTime at message_delta = MOCK_NOW + 500
    // textDurationMs = 300ms
    // tokens_per_second = 2 / 0.3 = 6.67
    expect(metrics.tokens_per_second).toBeCloseTo(6.67, 1);
  });

  it("should handle thinking_delta for TTFT", () => {
    const extractor = new MetricsExtractor("anthropic", MOCK_NOW);

    extractor.processEvent(
      makeEvent("message_start", JSON.stringify({
        type: "message_start",
        message: { usage: { input_tokens: 100 } },
      })),
    );

    vi.advanceTimersByTime(150);
    extractor.processEvent(
      makeEvent("content_block_delta", JSON.stringify({
        type: "content_block_delta",
        delta: { type: "thinking_delta", thinking: "Let me think..." },
      })),
    );

    expect(extractor.getMetrics().ttft_ms).toBe(150);
  });

  describe("thinking model TPS correction", () => {
    it("should calculate TPS from text-only tokens for thinking models", () => {
      // 模拟 zhipu-coding-plan 场景：大量 thinking tokens + 少量 text tokens
      const requestStart = MOCK_NOW - 500;
      const extractor = new MetricsExtractor("anthropic", requestStart);

      // message_start
      extractor.processEvent(makeEvent("message_start", JSON.stringify({
        type: "message_start",
        message: { usage: { input_tokens: 1000 } },
      })));

      // thinking 阶段（10 个 thinking_delta，共 600 字符）
      vi.advanceTimersByTime(500);
      for (let i = 0; i < 10; i++) {
        extractor.processEvent(makeEvent("content_block_delta", JSON.stringify({
          type: "content_block_delta",
          delta: { type: "thinking_delta", thinking: "Let me analyze this problem carefully." },
        })));
      }

      // text 阶段（5 个 text_delta，共 25 字符）
      vi.advanceTimersByTime(1000);
      extractor.processEvent(makeEvent("content_block_delta", JSON.stringify({
        type: "content_block_delta",
        delta: { type: "text_delta", text: "Hello" },
      })));
      extractor.processEvent(makeEvent("content_block_delta", JSON.stringify({
        type: "content_block_delta",
        delta: { type: "text_delta", text: " world" },
      })));
      extractor.processEvent(makeEvent("content_block_delta", JSON.stringify({
        type: "content_block_delta",
        delta: { type: "text_delta", text: ", this" },
      })));
      extractor.processEvent(makeEvent("content_block_delta", JSON.stringify({
        type: "content_block_delta",
        delta: { type: "text_delta", text: " is a" },
      })));
      extractor.processEvent(makeEvent("content_block_delta", JSON.stringify({
        type: "content_block_delta",
        delta: { type: "text_delta", text: " test." },
      })));

      // message_delta: API 报告 output_tokens 包含 thinking + text 总量
      // 假设 thinking: 3000 tokens, text: 500 tokens, total: 3500
      vi.advanceTimersByTime(500);
      extractor.processEvent(makeEvent("message_delta", JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 3500 },
      })));
      extractor.processEvent(makeEvent("message_stop", JSON.stringify({ type: "message_stop" })));

      const metrics = extractor.getMetrics();

      // 基础指标不变
      expect(metrics.input_tokens).toBe(1000);
      expect(metrics.output_tokens).toBe(3500); // API 报告的总 tokens
      expect(metrics.stop_reason).toBe("end_turn");
      expect(metrics.is_complete).toBe(1);

      // TTFT 从第一个 content_block_delta (thinking) 开始
      // requestStart = MOCK_NOW - 500, first delta at MOCK_NOW + 500 => 1000ms
      expect(metrics.ttft_ms).toBe(1000);

      // total_duration_ms 仍然是全量时间: message_start 到 message_delta
      // streamStartTime = MOCK_NOW (message_start)
      // streamEndTime = MOCK_NOW + 2000 (message_delta)
      expect(metrics.total_duration_ms).toBe(2000);

      // 关键验证: TPS 基于 text-only tokens（gpt-tokenizer 精确计数）
      // text = "Hello world, this is a test." = 8 tokens (o200k_base)
      // text_duration = (MOCK_NOW + 2000) - (MOCK_NOW + 1500) = 500ms
      // TPS = 8 / 0.5 = 16
      //
      // 对比未修复时: TPS = 3500 / 2 = 1750 (严重虚高)
      expect(metrics.tokens_per_second).toBeCloseTo(16, 1);
    });

    it("should use original TPS formula when no thinking content is present", () => {
      const requestStart = MOCK_NOW - 500;
      const extractor = new MetricsExtractor("anthropic", requestStart);

      extractor.processEvent(makeEvent("message_start", JSON.stringify({
        type: "message_start",
        message: { usage: { input_tokens: 100 } },
      })));

      vi.advanceTimersByTime(200);
      extractor.processEvent(makeEvent("content_block_delta", JSON.stringify({
        type: "content_block_delta",
        delta: { type: "text_delta", text: "Hello world" },
      })));

      vi.advanceTimersByTime(300);
      extractor.processEvent(makeEvent("message_delta", JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 42 },
      })));
      extractor.processEvent(makeEvent("message_stop", JSON.stringify({ type: "message_stop" })));

      const metrics = extractor.getMetrics();

      // 无 thinking 内容但有 text_delta 内容，走 tokenizer
      // text = "Hello world" = 2 tokens, textDuration = 300ms
      // tokens_per_second = 2 / 0.3 = 6.67
      expect(metrics.tokens_per_second).toBeCloseTo(6.67, 1);
    });

    it("should handle thinking-only model with no text output (TPS = null)", () => {
      const extractor = new MetricsExtractor("anthropic", MOCK_NOW);

      extractor.processEvent(makeEvent("message_start", JSON.stringify({
        type: "message_start",
        message: { usage: { input_tokens: 100 } },
      })));

      vi.advanceTimersByTime(200);
      extractor.processEvent(makeEvent("content_block_delta", JSON.stringify({
        type: "content_block_delta",
        delta: { type: "thinking_delta", thinking: "Thinking only" },
      })));

      vi.advanceTimersByTime(300);
      extractor.processEvent(makeEvent("message_delta", JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 100 },
      })));

      // 有 thinking 但无 text content，TPS 应为 null
      const metrics = extractor.getMetrics();
      expect(metrics.tokens_per_second).toBeNull();
    });
  });

  it("should set is_complete=0 and output_tokens=null when stream interrupted before message_delta", () => {
    const extractor = new MetricsExtractor("anthropic", MOCK_NOW);

    extractor.processEvent(
      makeEvent("message_start", JSON.stringify({
        type: "message_start",
        message: { usage: { input_tokens: 200 } },
      })),
    );

    extractor.processEvent(
      makeEvent("content_block_delta", JSON.stringify({
        type: "content_block_delta",
        delta: { type: "text_delta", text: "partial" },
      })),
    );

    // 没有 message_delta，也没有 message_stop
    const metrics = extractor.getMetrics();

    expect(metrics.is_complete).toBe(0);
    expect(metrics.output_tokens).toBeNull();
    expect(metrics.ttft_ms).not.toBeNull();
  });

  it("should fallback input_tokens from message_delta when message_start has no usage (third-party compatible API)", () => {
    const extractor = new MetricsExtractor("anthropic", MOCK_NOW);

    // message_start 不带 usage（第三方 API 可能如此）
    extractor.processEvent(
      makeEvent("message_start", JSON.stringify({
        type: "message_start",
        message: {},
      })),
    );

    expect(extractor.getMetrics().input_tokens).toBeNull();

    // content_block_delta 触发 TTFT
    vi.advanceTimersByTime(100);
    extractor.processEvent(
      makeEvent("content_block_delta", JSON.stringify({
        type: "content_block_delta",
        delta: { type: "text_delta", text: "Hi" },
      })),
    );

    // message_delta 同时携带 output_tokens 和 input_tokens（OpenRouter/智谱 模式）
    vi.advanceTimersByTime(200);
    extractor.processEvent(
      makeEvent("message_delta", JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 30, input_tokens: 500 },
      })),
    );

    extractor.processEvent(
      makeEvent("message_stop", JSON.stringify({ type: "message_stop" })),
    );

    const metrics = extractor.getMetrics();
    expect(metrics.input_tokens).toBe(500);
    expect(metrics.output_tokens).toBe(30);
    expect(metrics.stop_reason).toBe("end_turn");
    expect(metrics.is_complete).toBe(1);
  });

  it("should not override input_tokens from message_start when message_delta also has input_tokens", () => {
    const extractor = new MetricsExtractor("anthropic", MOCK_NOW);

    extractor.processEvent(
      makeEvent("message_start", JSON.stringify({
        type: "message_start",
        message: { usage: { input_tokens: 800 } },
      })),
    );

    vi.advanceTimersByTime(100);
    extractor.processEvent(
      makeEvent("content_block_delta", JSON.stringify({
        type: "content_block_delta",
        delta: { type: "text_delta", text: "Hi" },
      })),
    );

    extractor.processEvent(
      makeEvent("message_delta", JSON.stringify({
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 20, input_tokens: 999 },
      })),
    );

    // message_start 的值优先，不被 message_delta 覆盖
    expect(extractor.getMetrics().input_tokens).toBe(800);
  });

  it("should set ttft_ms=null when stream interrupted before any content", () => {
    const extractor = new MetricsExtractor("anthropic", MOCK_NOW);

    extractor.processEvent(
      makeEvent("message_start", JSON.stringify({
        type: "message_start",
        message: { usage: { input_tokens: 200 } },
      })),
    );

    // 没有任何 content_block_delta
    const metrics = extractor.getMetrics();

    expect(metrics.ttft_ms).toBeNull();
    expect(metrics.is_complete).toBe(0);
  });
});

// ============================================================
// Anthropic non-stream
// ============================================================

describe("MetricsExtractor - Anthropic non-stream", () => {
  it("should extract metrics from Anthropic non-stream response", () => {
    const body = JSON.stringify({
      usage: {
        input_tokens: 25,
        output_tokens: 150,
        cache_creation_input_tokens: 10,
        cache_read_input_tokens: 400,
      },
      stop_reason: "end_turn",
    });

    const metrics = MetricsExtractor.fromNonStreamResponse("anthropic", body);

    expect(metrics).not.toBeNull();
    expect(metrics!.input_tokens).toBe(25);
    expect(metrics!.output_tokens).toBe(150);
    expect(metrics!.cache_creation_tokens).toBe(10);
    expect(metrics!.cache_read_tokens).toBe(400);
    expect(metrics!.stop_reason).toBe("end_turn");
    expect(metrics!.is_complete).toBe(1);
    // 非流式没有时序指标
    expect(metrics!.ttft_ms).toBeNull();
    expect(metrics!.total_duration_ms).toBeNull();
    expect(metrics!.tokens_per_second).toBeNull();
  });
});

// ============================================================
// OpenAI streaming
// ============================================================

describe("MetricsExtractor - OpenAI streaming", () => {
  it("should extract all metrics from a complete OpenAI stream with usage chunk", () => {
    const requestStart = MOCK_NOW - 500;
    const extractor = new MetricsExtractor("openai", requestStart);

    // role-only chunk — 不应触发 TTFT
    extractor.processEvent(
      makeEvent(undefined, JSON.stringify({
        id: "chatcmpl-123",
        choices: [{ delta: { role: "assistant" }, index: 0 }],
      })),
    );

    // 第一个有 content 的 chunk
    vi.advanceTimersByTime(300);
    extractor.processEvent(
      makeEvent(undefined, JSON.stringify({
        id: "chatcmpl-123",
        choices: [{ delta: { content: "Hello" }, index: 0 }],
      })),
    );

    // 更多内容
    extractor.processEvent(
      makeEvent(undefined, JSON.stringify({
        id: "chatcmpl-123",
        choices: [{ delta: { content: " world" }, index: 0 }],
      })),
    );

    // finish_reason chunk
    extractor.processEvent(
      makeEvent(undefined, JSON.stringify({
        id: "chatcmpl-123",
        choices: [{ delta: {}, finish_reason: "stop", index: 0 }],
      })),
    );

    // usage chunk
    extractor.processEvent(
      makeEvent(undefined, JSON.stringify({
        id: "chatcmpl-123",
        choices: [],
        usage: {
          prompt_tokens: 19,
          completion_tokens: 2919,
          prompt_tokens_details: { cached_tokens: 5 },
        },
      })),
    );

    // [DONE] 由 SSEParser 处理，不会产生事件
    // 但调用 processEvent 模拟直接传入
    extractor.processEvent(makeEvent(undefined, "[DONE]"));

    const metrics = extractor.getMetrics();

    expect(metrics.input_tokens).toBe(19);
    expect(metrics.output_tokens).toBe(2919);
    expect(metrics.cache_read_tokens).toBe(5);
    expect(metrics.cache_creation_tokens).toBeNull();
    expect(metrics.stop_reason).toBe("stop");
    expect(metrics.is_complete).toBe(1);

    // TTFT: requestStart 到首个 content chunk
    // requestStart = MOCK_NOW - 500, content at MOCK_NOW + 300 => 800ms
    expect(metrics.ttft_ms).toBe(800);

    // streamStartTime 由 usage chunk 设为 requestStart (MOCK_NOW - 500)
    // streamEndTime 由 usage chunk 设为 Date.now() (MOCK_NOW + 300)
    // total = 800
    expect(metrics.total_duration_ms).toBe(800);

    // tokens_per_second = 2919 / (800/1000) = 2919 / 0.8 = 3648.75
    expect(metrics.tokens_per_second).toBeCloseTo(3648.75);
  });

  it("should not set TTFT for role-only first chunk", () => {
    const extractor = new MetricsExtractor("openai", MOCK_NOW);

    extractor.processEvent(
      makeEvent(undefined, JSON.stringify({
        choices: [{ delta: { role: "assistant" }, index: 0 }],
      })),
    );

    expect(extractor.getMetrics().ttft_ms).toBeNull();
  });

  it("should handle empty content string in delta (not treated as first token)", () => {
    const extractor = new MetricsExtractor("openai", MOCK_NOW);

    // 空字符串 content 不算首次内容
    extractor.processEvent(
      makeEvent(undefined, JSON.stringify({
        choices: [{ delta: { content: "" }, index: 0 }],
      })),
    );

    expect(extractor.getMetrics().ttft_ms).toBeNull();

    // 真正的内容
    vi.advanceTimersByTime(100);
    extractor.processEvent(
      makeEvent(undefined, JSON.stringify({
        choices: [{ delta: { content: "real" }, index: 0 }],
      })),
    );

    expect(extractor.getMetrics().ttft_ms).toBe(100);
  });
});

// ============================================================
// OpenAI non-stream
// ============================================================

describe("MetricsExtractor - OpenAI non-stream", () => {
  it("should extract metrics from OpenAI non-stream response", () => {
    const body = JSON.stringify({
      usage: {
        prompt_tokens: 19,
        completion_tokens: 2919,
        prompt_tokens_details: { cached_tokens: 5 },
      },
      choices: [{ finish_reason: "stop" }],
    });

    const metrics = MetricsExtractor.fromNonStreamResponse("openai", body);

    expect(metrics).not.toBeNull();
    expect(metrics!.input_tokens).toBe(19);
    expect(metrics!.output_tokens).toBe(2919);
    expect(metrics!.cache_read_tokens).toBe(5);
    expect(metrics!.cache_creation_tokens).toBeNull();
    expect(metrics!.stop_reason).toBe("stop");
    expect(metrics!.is_complete).toBe(1);
    expect(metrics!.ttft_ms).toBeNull();
    expect(metrics!.total_duration_ms).toBeNull();
    expect(metrics!.tokens_per_second).toBeNull();
  });
});

// ============================================================
// JSON parse error handling
// ============================================================

describe("MetricsExtractor - error handling", () => {
  it("should silently skip SSE events with invalid JSON", () => {
    const extractor = new MetricsExtractor("anthropic", MOCK_NOW);

    // 无效 JSON，不应抛出
    extractor.processEvent(makeEvent("message_start", "not-json{"));
    extractor.processEvent(makeEvent("content_block_delta", "broken"));

    const metrics = extractor.getMetrics();
    expect(metrics.input_tokens).toBeNull();
    expect(metrics.ttft_ms).toBeNull();
  });

  it("should return null from fromNonStreamResponse for invalid JSON", () => {
    const result = MetricsExtractor.fromNonStreamResponse("openai", "not json");
    expect(result).toBeNull();
  });

  it("should handle null data in SSEEvent gracefully", () => {
    const extractor = new MetricsExtractor("openai", MOCK_NOW);

    extractor.processEvent({ event: undefined, data: undefined });
    extractor.processEvent({ event: "test", data: null as any });

    expect(extractor.getMetrics().ttft_ms).toBeNull();
  });

  it("should handle missing usage fields gracefully in non-stream", () => {
    const body = JSON.stringify({ id: "chatcmpl-123" });
    const metrics = MetricsExtractor.fromNonStreamResponse("openai", body);

    expect(metrics).not.toBeNull();
    expect(metrics!.input_tokens).toBeNull();
    expect(metrics!.output_tokens).toBeNull();
  });
});
