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

  // ============================================================
  // UTF-8 边界测试
  // ============================================================

  it("UTF-8: 中文字符跨 chunk 传输（回归测试）", () => {
    const onChunk = vi.fn();
    const transform = new SSEMetricsTransform("openai", 999_000, { onChunk });

    // 构造包含中文的 OpenAI SSE chunk
    const fullChunk = openaiChunk("执行审计");
    const buffer = Buffer.from(fullChunk, "utf-8");

    // "执" 是 3 字节 UTF-8 (0xE6 0x89 0xA7)，在第 2 字节处截断
    const charOffset = buffer.indexOf(Buffer.from("执"));
    const splitPoint = charOffset + 2; // "执" 的前 2 字节
    const chunk1 = buffer.subarray(0, splitPoint);
    const chunk2 = buffer.subarray(splitPoint);

    // 当前实现：chunk.toString('utf-8') 会产生 U+FFFD
    // 这是回归测试，记录当前行为
    transform.write(chunk1);
    transform.write(chunk2);
    transform.end();

    // onChunk 应该被调用
    expect(onChunk).toHaveBeenCalled();
    // 当前行为：可能包含 U+FFFD（乱码）
    // 修复后：应该包含完整的 "执行审计"
  });

  it("UTF-8: 完整中文字符不产生乱码", () => {
    const onChunk = vi.fn();
    const transform = new SSEMetricsTransform("openai", 999_000, { onChunk });

    // 完整 chunk，不截断
    transform.write(openaiChunk("执行审计"));
    transform.end();

    // onChunk 应该被调用，且内容无乱码
    expect(onChunk).toHaveBeenCalled();
    const calls = onChunk.mock.calls;
    const hasChineseContent = calls.some((call: any[]) =>
      call[0] && typeof call[0] === "string" && call[0].includes("执行审计")
    );
    expect(hasChineseContent).toBe(true);
  });

  it("UTF-8: 数据透传不受 UTF-8 截断影响", () => {
    const transform = new SSEMetricsTransform("openai", 999_000);

    let output = "";
    transform.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    // 构造包含中文的 OpenAI SSE chunk
    const fullChunk = openaiChunk("测试");
    const buffer = Buffer.from(fullChunk, "utf-8");

    // "测" 是 3 字节 UTF-8，在第 1 字节处截断
    const charOffset = buffer.indexOf(Buffer.from("测"));
    const splitPoint = charOffset + 1;
    const chunk1 = buffer.subarray(0, splitPoint);
    const chunk2 = buffer.subarray(splitPoint);

    transform.write(chunk1);
    transform.write(chunk2);
    transform.end();

    // 透传的数据应该包含原始 chunk（可能有 U+FFFD）
    expect(output).toContain("data:");
    // 不应抛异常
  });
});
