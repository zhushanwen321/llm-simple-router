import { Transform, TransformCallback } from "stream";
import { SSEParser } from "./sse-parser.js";
import { MetricsExtractor } from "./metrics-extractor.js";
import type { MetricsResult } from "./metrics-extractor.js";

export interface MetricsTransformOptions {
  /** 每次处理 SSE 事件后触发的回调，附带当前指标快照 */
  onMetrics?: (metrics: MetricsResult) => void;
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
  private onMetrics?: (metrics: MetricsResult) => void;
  private throttleMs: number;
  private lastCallbackTime: number = 0;
  private flushed = false;

  constructor(
    apiType: "openai" | "anthropic",
    requestStartTime: number,
    options?: MetricsTransformOptions,
  ) {
    super();
    this.parser = new SSEParser();
    this.extractor = new MetricsExtractor(apiType, requestStartTime);
    this.onMetrics = options?.onMetrics;
    this.throttleMs = options?.throttleMs ?? 5000;
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    const events = this.parser.feed(chunk.toString("utf-8"));
    for (const event of events) {
      this.extractor.processEvent(event);
    }
    this.emitMetricsIfReady();
    callback(null, chunk);
  }

  _flush(callback: TransformCallback): void {
    const events = this.parser.flush();
    for (const event of events) {
      this.extractor.processEvent(event);
    }
    // flush 无条件推送最终状态，确保消费者能拿到完整指标
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
