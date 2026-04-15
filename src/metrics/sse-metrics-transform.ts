import { Transform, TransformCallback } from "stream";
import { SSEParser } from "./sse-parser.js";
import { MetricsExtractor } from "./metrics-extractor.js";

/**
 * 旁路采集 SSE 指标的 Transform stream
 *
 * 管道位置: upstream → SSEMetricsTransform → PassThrough → reply.raw
 * 不修改流经的数据，仅解析 SSE 事件并提取指标。
 */
export class SSEMetricsTransform extends Transform {
  private parser: SSEParser;
  private extractor: MetricsExtractor;

  constructor(apiType: "openai" | "anthropic", requestStartTime: number) {
    super();
    this.parser = new SSEParser();
    this.extractor = new MetricsExtractor(apiType, requestStartTime);
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    const events = this.parser.feed(chunk.toString("utf-8"));
    for (const event of events) {
      this.extractor.processEvent(event);
    }
    callback(null, chunk);
  }

  _flush(callback: TransformCallback): void {
    const events = this.parser.flush();
    for (const event of events) {
      this.extractor.processEvent(event);
    }
    callback();
  }

  getExtractor(): MetricsExtractor {
    return this.extractor;
  }
}
