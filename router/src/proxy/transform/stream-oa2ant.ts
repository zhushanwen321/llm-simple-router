/**
 * Stream transform: OpenAI → Anthropic (mapping table pattern)
 * 映射表模式：processEvent 将 choice.delta 字段映射到对应 handler，消除长 if-else 链
 */
import { BaseSSETransform } from "./stream-transform-base.js";
import { generateMsgId } from "./id-utils.js";
import { mapFinishReasonToStopReason } from "./usage-mapper.js";

type OA2State = "init" | "text" | "thinking" | "tool_use" | "closing";
const FH = ["reasoning_content", "content", "tool_calls"] as const;

export class OpenAIToAnthropicTransform extends BaseSSETransform {
  private state: OA2State = "init";
  private bi = 0; private mid = generateMsgId();
  private it = 0; private ot = 0; private crt = 0;
  private psr: string | null = null;
  private hss = false; private hms = false; private frr = false;
  private act = -1; private tcBuf = new Map<number, string>();

  protected processEvent(ev: { event?: string; data?: string }): void {
    if (ev.data === "[DONE]") return;
    let c: Record<string, unknown>; try { c = JSON.parse(ev.data!); } catch { return; }
    this.extractUsage(c);
    if (c.usage && !Array.isArray(c.choices)) { if (this.psr) this.emitStopSeq(); return; }
    const ch = (c.choices as Array<Record<string, unknown>> | undefined)?.[0];
    const d = ch?.delta as Record<string, unknown> | undefined; if (!d) return;
    this.ensureMsgStart();
    for (const k of FH) {
      const v = d[k];
      if (v != null && v !== "") {
        if (k === "reasoning_content") this.onThinking(v);
        else if (k === "content") this.onText(v);
        else if (k === "tool_calls") this.onToolCalls(v);
      }
    }
    const fr = ch!.finish_reason as string | undefined;
    if (fr && !this.frr) { this.frr = true; this.closeBlock(); this.psr = mapFinishReasonToStopReason(fr); }
  }

  private extractUsage(c: Record<string, unknown>): void {
    if (!c.usage) return;
    const u = c.usage as Record<string, unknown>;
    this.it = (u.prompt_tokens as number) ?? this.it;
    this.ot = (u.completion_tokens as number) ?? this.ot;
    this.crt = ((u.prompt_tokens_details as Record<string, unknown> | undefined)?.cached_tokens as number) ?? this.crt;
  }

  private ensureMsgStart(): void {
    if (this.hss) return;
    this.push(`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: this.mid, type: "message", role: "assistant", content: [], model: this.model, status: "in_progress", usage: { input_tokens: Math.max(0, this.it - this.crt), cache_read_input_tokens: this.crt } } })}\n\n`);
    this.hss = true;
  }

  private onThinking(v: unknown): void { this.ensureBlock("thinking", { type: "thinking", thinking: "" }, "thinking_delta", "thinking", v as string); }
  private onText(v: unknown): void { this.ensureBlock("text", { type: "text", text: "" }, "text_delta", "text", v as string); }
  private onToolCalls(v: unknown): void { for (const tc of v as Array<Record<string, unknown>>) this.hTC(tc); }

  private ensureBlock(t: OA2State, bs: Record<string, unknown>, dt: string, df: string, v: string): void {
    if (this.state !== t) {
      if (this.state !== "init") this.closeBlock();
      this.bi++; this.pushSSE("content_block_start", { type: "content_block_start", index: this.bi, content_block: bs });
      this.state = t;
    }
    this.pushSSE("content_block_delta", { type: "content_block_delta", index: this.bi, delta: { type: dt, [df]: v } });
  }

  private hTC(tc: Record<string, unknown>): void {
    const idx = (tc.index as number) ?? 0;
    const fn = tc.function as Record<string, unknown> | undefined;
    const id = tc.id as string | undefined;
    const name = fn?.name as string | undefined;
    const args = fn?.arguments as string | undefined;

    if (id && name) {
      if (this.state !== "init") this.closeBlock();
      this.act = idx; this.state = "tool_use"; this.bi++;
      this.pushSSE("content_block_start", { type: "content_block_start", index: this.bi, content_block: { type: "tool_use", id, name, input: {} } });
      if (args) this.pushTCArg(args); return;
    }
    if (args) {
      if (this.state !== "tool_use") {
        if (this.state !== "init") this.closeBlock();
        this.act = idx; this.state = "tool_use"; this.bi++;
        this.pushSSE("content_block_start", { type: "content_block_start", index: this.bi, content_block: { type: "tool_use", id: `tool_${idx}`, name: `tool_${idx}`, input: {} } });
      }
      this.pushTCArg(args);
    }
  }

  private pushTCArg(a: string): void { this.pushSSE("content_block_delta", { type: "content_block_delta", index: this.bi, delta: { type: "input_json_delta", partial_json: a } }); }

  private pushSSE(evt: string, data: unknown): void { this.push(`event: ${evt}\ndata: ${JSON.stringify(data)}\n\n`); }

  private closeBlock(): void {
    if (this.state === "init" || this.state === "closing") return;
    this.pushSSE("content_block_stop", { type: "content_block_stop", index: this.bi });
    this.state = "closing";
  }

  private emitStopSeq(): void {
    if (this.hms) return;
    this.pushSSE("message_delta", { type: "message_delta", delta: { stop_reason: this.psr ?? "end_turn", stop_sequence: null }, usage: { input_tokens: Math.max(0, this.it - this.crt) || 0, output_tokens: this.ot, cache_read_input_tokens: this.crt } });
    this.push("event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n");
    this.hms = true; this.psr = null;
  }

  protected flushPendingData(): void {
    for (const [idx, args] of this.tcBuf) {
      if (!args) continue;
      this.emit("warning", { event: "buffered_tool_call", index: idx, argsLength: args.length });
      this.pushSSE("content_block_delta", { type: "content_block_delta", index: idx, delta: { type: "input_json_delta", partial_json: args } });
    } this.tcBuf.clear();
  }

  protected ensureTerminated(): void {
    if (this.hms) return;
    this.closeBlock();
    if (this.psr === null) this.psr = "end_turn";
    this.emitStopSeq(); this.done = true;
  }
}
