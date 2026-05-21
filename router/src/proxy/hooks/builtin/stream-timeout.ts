import type { PipelineHook, PipelineContext } from "../../pipeline/types.js";

/** post_response: 处理 stream_abort 结果，向客户端发送超时 SSE 事件 */
export const streamTimeoutHook: PipelineHook = {
  name: "builtin:stream-timeout",
  phase: "post_response",
  priority: 110,
  execute(ctx: PipelineContext): void {
    const result = ctx.resilienceResult?.result;
    if (!result || result.kind !== "stream_abort") return;
    if (!result.timeoutContext) return;

    const { modelId, providerId } = result.timeoutContext;
    const msg = `Stream timeout: no data received for ${result.timeoutMs ?? 0}ms (model: ${modelId}, provider: ${providerId})`;
    const errBody =
      ctx.apiType === "anthropic"
        ? { type: "error", error: { type: "api_error", message: msg } }
        : { error: { message: msg, type: "server_error", code: "stream_timeout" } };
    try {
      ctx.reply.raw.write(`data: ${JSON.stringify(errBody)}\n\n`);
    } catch {
      /* client disconnected, ignore write failure */
      ctx.request.log.debug("SSE write failed: client disconnected");
    }
    try {
      ctx.reply.raw.end();
    } catch {
      /* client disconnected, ignore close failure */
      ctx.request.log.debug("SSE end failed: client disconnected");
    }
  },
};
