import { Transform, TransformCallback } from "stream";
import { SSEParser } from "./sse-parser.js";
import { MetricsExtractor } from "./metrics-extractor.js";
import type { MetricsResult } from "../core/types.js";

const DEFAULT_THROTTLE_MS = 5000;

export interface MetricsTransformOptions {
  /** 每次处理 SSE 事件后触发的回调，附带当前指标快照 */
  onMetrics?: (metrics: MetricsResult) => void;
  /** 每收到一个 SSE data 行时触发，传入原始文本行 */
  onChunk?: (rawLine: string) => void;
  /** 每次提取到内容文本（thinking / text / tool JSON delta）时触发，用于流式循环检测 */
  onContentDelta?: (text: string) => void;
  /** 回调节流间隔（毫秒），默认 5000 */
  throttleMs?: number;
}

/**
 * 旁路采集 SSE 指标的 Transform stream
 *
 * 管道位置: upstream → SSEMetricsTransform → PassThrough → reply.raw
 * 不修改流经的数据，仅解析 SSE 事件并提取指标。
 */
export class SSEMetricsTransform extends Transform {
  private parser: SSEParser;
  private extractor: MetricsExtractor;
  private readonly apiType: "openai" | "anthropic";
  private onMetrics?: (metrics: MetricsResult) => void;
  private onChunk?: (rawLine: string) => void;
  private onContentDelta?: (text: string) => void;
  private throttleMs: number;
  private lastCallbackTime: number = 0;
  private flushed = false;

  constructor(
    apiType: "openai" | "anthropic",
    requestStartTime: number,
    options?: MetricsTransformOptions,
  ) {
    super();
    this.apiType = apiType;
    this.parser = new SSEParser();
    this.extractor = new MetricsExtractor(apiType, requestStartTime);
    this.onMetrics = options?.onMetrics;
    this.onChunk = options?.onChunk;
    this.onContentDelta = options?.onContentDelta;
    this.throttleMs = options?.throttleMs ?? DEFAULT_THROTTLE_MS;
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    const text = chunk.toString("utf-8");
    const events = this.parser.feed(text);
    for (const event of events) {
      this.extractor.processEvent(event);
      this.emitContentDelta(event);
      if (event.data != null && this.onChunk) {
        this.onChunk(`data: ${event.data}`);
      }
    }
    this.emitMetricsIfReady();
    callback(null, chunk);
  }

  _flush(callback: TransformCallback): void {
    const events = this.parser.flush();
    for (const event of events) {
      this.extractor.processEvent(event);
      this.emitContentDelta(event);
    }
    if (this.onMetrics && !this.flushed) {
      this.flushed = true;
      this.lastCallbackTime = Date.now();
      this.onMetrics(this.extractor.getMetrics());
    }
    callback();
  }

  getExtractor(): MetricsExtractor {
    return this.extractor;
  }

  /** 从 SSE 事件中提取内容文本，触发 onContentDelta 回调 */
  private emitContentDelta(event: { data?: string }): void {
    if (!this.onContentDelta || !event.data) return;
    const delta = this.extractContentDelta(event.data);
    if (delta) this.onContentDelta(delta);
  }

  /**
   * 从 SSE data 字段中提取实际内容文本（thinking / text / tool JSON delta）。
   * 忽略框架事件（message_start、ping 等），仅返回模型输出的内容。
   */
  private extractContentDelta(data: string): string | undefined {
    try {
      const parsed: Record<string, unknown> = JSON.parse(data);
      if (this.apiType === "anthropic") {
        if (parsed.type !== "content_block_delta" || typeof parsed.delta !== "object" || !parsed.delta) return undefined;
        const delta = parsed.delta as Record<string, unknown>;
        if (delta.type === "thinking_delta" && typeof delta.thinking === "string") return delta.thinking;
        if (delta.type === "text_delta" && typeof delta.text === "string") return delta.text;
        if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") return delta.partial_json;
      } else {
        const choices = parsed.choices;
        if (!Array.isArray(choices) || choices.length === 0) return undefined;
        const first = choices[0] as Record<string, unknown>;
        if (typeof first.delta !== "object" || !first.delta) return undefined;
        const delta = first.delta as Record<string, unknown>;
        if (typeof delta.content === "string") return delta.content;
      }
    } catch { /* 非 JSON 数据行，跳过 */ }
    return undefined;
  }

  /** 节流逻辑：首次或距上次回调超过 throttleMs 时触发 */
  private emitMetricsIfReady(): void {
    if (!this.onMetrics) return;
    const now = Date.now();
    if (now - this.lastCallbackTime >= this.throttleMs) {
      this.lastCallbackTime = now;
      this.onMetrics(this.extractor.getMetrics());
    }
  }
}
