import { Transform, TransformCallback } from "stream";
import { SafeSSEParser } from "../patch/safe-sse-parser.js";

export abstract class BaseSSETransform extends Transform {
  protected parser = new SafeSSEParser();
  protected done = false;
  protected model: string;

  constructor(model: string) {
    super();
    this.model = model;
  }

  _transform(chunk: Buffer, _: BufferEncoding, callback: TransformCallback): void {
    if (this.done) { callback(); return; }
    try {
      const text = chunk.toString("utf-8");
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
