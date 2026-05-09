import { Transform, type TransformCallback } from "stream";
import type { PipelineContext } from "../pipeline/types.js";
import type { SSEEvent } from "../transform/plugin-types.js";

/**
 * SSE Layer 1 Transform: parses per-event SSE, calls on_stream_event hooks.
 * Does NOT modify the stream by default — hooks can transform events.
 */
export class SSEEventTransform extends Transform {
  private buffer = "";
  private readonly ctx: PipelineContext;

  constructor(ctx: PipelineContext) {
    super({ decodeStrings: true });
    this.ctx = ctx;
  }

  _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.buffer += chunk.toString("utf-8");

    const parts = this.buffer.split("\n\n");
    // Last part might be incomplete, keep in buffer
    this.buffer = parts.pop() ?? "";

    for (const part of parts) {
      if (!part.trim()) continue;

      const lines = part.split("\n");
      let event: string | undefined;
      let data = "";

      const EVENT_PREFIX_LEN = "event:".length;
      const DATA_PREFIX_LEN = "data:".length;
      for (const line of lines) {
        if (line.startsWith("event:")) {
          event = line.slice(EVENT_PREFIX_LEN).trim();
        } else if (line.startsWith("data:")) {
          const dataLine = line.slice(DATA_PREFIX_LEN);
          data += (data ? "\n" : "") + dataLine.trimStart();
        }
      }

      if (!data) continue;

      // Try to parse as JSON for hooks
      let parsedData: Record<string, unknown>;
      try {
        parsedData = JSON.parse(data);
      } catch {
        // Not JSON, forward as-is
        this.push(part + "\n\n");
        continue;
      }

      // Store parsed event for on_stream_event hooks
      const sseEvent: SSEEvent = { event, data: parsedData };
      this.ctx.metadata.set("currentSSEEvent", sseEvent);

      // Forward the original SSE event
      this.push(part + "\n\n");
    }

    callback();
  }

  _flush(callback: TransformCallback): void {
    // Discard incomplete trailing SSE events (no \n\n terminator)
    callback();
  }
}
