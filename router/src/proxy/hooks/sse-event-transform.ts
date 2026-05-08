import { Transform, type TransformCallback } from "stream";
import type { PipelineContext } from "../pipeline/types.js";
import type { ProxyPipeline } from "../pipeline/pipeline.js";
import type { SSEEvent } from "../transform/plugin-types.js";

/**
 * SSE Layer 1 Transform: parses per-event SSE, calls on_stream_event hooks.
 * Does NOT modify the stream by default — hooks can transform events.
 */
export class SSEEventTransform extends Transform {
  private buffer = "";
  private readonly pipeline: ProxyPipeline;
  private readonly ctx: PipelineContext;

  constructor(ctx: PipelineContext, pipeline: ProxyPipeline) {
    super({ decodeStrings: true });
    this.ctx = ctx;
    this.pipeline = pipeline;
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

      for (const line of lines) {
        if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          const dataLine = line.slice(5);
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

      // Emit hooks with the parsed event
      const sseEvent: SSEEvent = { event, data: parsedData };
      // Store event in metadata for hooks to access
      this.ctx.metadata.set("currentSSEEvent", sseEvent);

      // Fire hooks synchronously (we don't await in stream transform)
      // Hooks that need async should use separate mechanisms
      const hookChain = this.pipeline.getHookChain("on_stream_event");
      for (const _hookInfo of hookChain) {
        // In the future, this will call hook.execute(ctx)
        // For now, just pass through
      }

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
