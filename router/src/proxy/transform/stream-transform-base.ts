import { Transform, TransformCallback } from "stream";
import { SafeSSEParser } from "../patch/safe-sse-parser.js";

export abstract class BaseSSETransform extends Transform {
  protected parser = new SafeSSEParser();
  protected done = false;
  protected model: string;
  // 使用 TextDecoder 的 stream 模式处理 UTF-8 多字节字符边界
  // 避免 chunk.toString('utf-8') 在多字节字符截断时产生 U+FFFD
  private decoder = new TextDecoder("utf-8", { fatal: false });

  constructor(model: string) {
    super();
    this.model = model;
  }

  _transform(chunk: Buffer, _: BufferEncoding, callback: TransformCallback): void {
    if (this.done) { callback(); return; }
    try {
      // 使用 stream: true 模式，TextDecoder 会缓存不完整的字节序列
      // 等下一个 chunk 到达时再拼接解码，避免产生 U+FFFD
      const text = this.decoder.decode(chunk, { stream: true });
      const events = this.parser.feed(text);
      for (const event of events) {
        if (event.data == null) continue;
        try {
          this.processEvent(event);
        } catch (err) {
          this.emit("warning", { event: "process_error", error: err instanceof Error ? err.message : JSON.stringify(err) });
        }
      }
    } catch (err) {
      this.emit("warning", { event: "buffer_overflow", error: err instanceof Error ? err.message : JSON.stringify(err) });
      this.flushPendingData();
      this.ensureTerminated();
    }
    callback();
  }

  _flush(callback: TransformCallback): void {
    // 处理 TextDecoder 中缓存的残余字节（流结束时可能有不完整的字节序列）
    const remaining = this.decoder.decode();
    if (remaining) {
      const events = this.parser.feed(remaining);
      for (const event of events) {
        if (event.data == null) continue;
        try {
          this.processEvent(event);
        } catch (err) {
          this.emit("warning", { event: "process_error", error: err instanceof Error ? err.message : JSON.stringify(err) });
        }
      }
    }
    const events = this.parser.flush();
    for (const event of events) {
      try { this.processEvent(event); } catch (err) { this.emit("warning", err); }
    }
    this.flushPendingData();
    this.ensureTerminated();
    callback();
  }

  protected abstract processEvent(event: { event?: string; data?: string }): void;
  protected abstract flushPendingData(): void;
  protected abstract ensureTerminated(): void;

  protected pushAnthropicSSE(eventType: string, data: unknown): void {
    this.push(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  protected pushOpenAISSE(data: unknown): void {
    this.push(`data: ${JSON.stringify(data)}\n\n`);
  }

  protected pushResponsesSSE(eventType: string, data: unknown): void {
    this.push(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  protected pushDone(): void {
    this.push("data: [DONE]\n\n");
    this.done = true;
  }
}
