import { describe, it, expect } from "vitest";
import { ResponsesToAnthropicTransform } from "../../../src/proxy/transform/stream-resp2ant.js";

function collectOutput(transform: NodeJS.ReadWriteStream): Promise<string> {
  return new Promise((resolve) => {
    const chunks: string[] = [];
    transform.on("data", (c: Buffer) => chunks.push(c.toString()));
    transform.on("end", () => resolve(chunks.join("")));
  });
}

function parseAnthropicEvents(output: string): Array<{ event: string; data: unknown }> {
  const results: Array<{ event: string; data: unknown }> = [];
  const chunks = output.split("\n\n").filter(Boolean);
  for (const chunk of chunks) {
    const lines = chunk.split("\n");
    let eventType = "";
    let dataStr = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) eventType = line.slice(7);
      else if (line.startsWith("data: ")) dataStr = line.slice(6);
    }
    if (eventType === "" && dataStr === "[DONE]") continue;
    if (!eventType || !dataStr) continue;
    try {
      results.push({ event: eventType, data: JSON.parse(dataStr) });
    } catch {
      // skip unparseable
    }
  }
  return results;
}

// Helper to build Responses SSE event strings
function respSSE(eventType: string, data: unknown): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

describe("ResponsesToAnthropicTransform", () => {
  it("emits message_start on first output_item event", async () => {
    const t = new ResponsesToAnthropicTransform("claude-3");
    const output = collectOutput(t);
    t.write(respSSE("response.created", {
      type: "response.created",
      response: { id: "resp_1", object: "response", model: "gpt-4o", status: "queued", output: [] },
    }));
    t.write(respSSE("response.in_progress", {
      type: "response.in_progress",
      response: { id: "resp_1", object: "response", model: "gpt-4o", status: "in_progress", output: [] },
    }));
    t.write(respSSE("response.output_item.added", {
      type: "response.output_item.added",
      output_index: 0,
      item: { type: "message", id: "msg_1", role: "assistant", content: [], status: "in_progress" },
    }));
    t.write(respSSE("response.content_part.added", {
      type: "response.content_part.added",
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    }));
    t.write(respSSE("response.output_text.done", {
      type: "response.output_text.done",
      output_index: 0,
      content_index: 0,
      text: "",
    }));
    t.write(respSSE("response.content_part.done", {
      type: "response.content_part.done",
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    }));
    t.write(respSSE("response.output_item.done", {
      type: "response.output_item.done",
      output_index: 0,
      item: { type: "message", id: "msg_1", role: "assistant", content: [{ type: "output_text", text: "", annotations: [] }], status: "completed" },
    }));
    t.write(respSSE("response.completed", {
      type: "response.completed",
      response: {
        id: "resp_1", object: "response", model: "gpt-4o", status: "completed",
        output: [], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      },
    }));
    t.end();
    const result = await output;
    const events = parseAnthropicEvents(result);
    const eventTypes = events.map((e) => e.event);

    expect(eventTypes).toContain("message_start");
    const msgStart = events.find((e) => e.event === "message_start");
    const msg = (msgStart?.data as Record<string, unknown>)?.message as Record<string, unknown>;
    expect(msg?.role).toBe("assistant");
    expect(msg?.model).toBe("claude-3");
  });

  it("converts output_text.delta to text_delta content_block", async () => {
    const t = new ResponsesToAnthropicTransform("claude-3");
    const output = collectOutput(t);
    t.write(respSSE("response.output_item.added", {
      type: "response.output_item.added",
      output_index: 0,
      item: { type: "message", id: "msg_1", role: "assistant", content: [], status: "in_progress" },
    }));
    t.write(respSSE("response.content_part.added", {
      type: "response.content_part.added",
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    }));
    t.write(respSSE("response.output_text.delta", {
      type: "response.output_text.delta",
      output_index: 0,
      content_index: 0,
      delta: "Hello world",
    }));
    t.write(respSSE("response.output_text.done", {
      type: "response.output_text.done",
      output_index: 0,
      content_index: 0,
      text: "Hello world",
    }));
    t.write(respSSE("response.content_part.done", {
      type: "response.content_part.done",
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: "Hello world", annotations: [] },
    }));
    t.write(respSSE("response.output_item.done", {
      type: "response.output_item.done",
      output_index: 0,
      item: { type: "message", id: "msg_1", role: "assistant", content: [{ type: "output_text", text: "Hello world", annotations: [] }], status: "completed" },
    }));
    t.write(respSSE("response.completed", {
      type: "response.completed",
      response: {
        id: "resp_1", object: "response", model: "gpt-4o", status: "completed",
        output: [], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
      },
    }));
    t.end();
    const result = await output;
    const events = parseAnthropicEvents(result);
    const eventTypes = events.map((e) => e.event);

    // Should have content_block_start with text type
    expect(eventTypes).toContain("content_block_start");
    const blockStart = events.find((e) => e.event === "content_block_start");
    const block = (blockStart?.data as Record<string, unknown>)?.content_block as Record<string, unknown>;
    expect(block?.type).toBe("text");

    // Should have text_delta
    expect(eventTypes).toContain("content_block_delta");
    const blockDelta = events.find((e) => e.event === "content_block_delta");
    const delta = (blockDelta?.data as Record<string, unknown>)?.delta as Record<string, unknown>;
    expect(delta?.type).toBe("text_delta");
    expect(delta?.text).toBe("Hello world");

    // Should have content_block_stop
    expect(eventTypes).toContain("content_block_stop");

    // Should have message_delta with end_turn
    expect(eventTypes).toContain("message_delta");
    const msgDelta = events.find((e) => e.event === "message_delta");
    const deltaData = (msgDelta?.data as Record<string, unknown>)?.delta as Record<string, unknown>;
    expect(deltaData?.stop_reason).toBe("end_turn");

    expect(eventTypes).toContain("message_stop");
  });

  it("converts function_call to tool_use content block", async () => {
    const t = new ResponsesToAnthropicTransform("claude-3");
    const output = collectOutput(t);
    t.write(respSSE("response.output_item.added", {
      type: "response.output_item.added",
      output_index: 0,
      item: { type: "function_call", id: "fc_1", call_id: "fc_1", name: "get_weather", arguments: "", status: "in_progress" },
    }));
    t.write(respSSE("response.function_call_arguments.delta", {
      type: "response.function_call_arguments.delta",
      output_index: 0,
      item_id: "fc_1",
      call_id: "fc_1",
      delta: '{"city":"NYC"}',
    }));
    t.write(respSSE("response.function_call_arguments.done", {
      type: "response.function_call_arguments.done",
      output_index: 0,
      item_id: "fc_1",
      call_id: "fc_1",
      arguments: '{"city":"NYC"}',
    }));
    t.write(respSSE("response.output_item.done", {
      type: "response.output_item.done",
      output_index: 0,
      item: { type: "function_call", id: "fc_1", call_id: "fc_1", name: "get_weather", arguments: '{"city":"NYC"}', status: "completed" },
    }));
    t.write(respSSE("response.completed", {
      type: "response.completed",
      response: {
        id: "resp_1", object: "response", model: "gpt-4o", status: "completed",
        output: [], usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
      },
    }));
    t.end();
    const result = await output;
    const events = parseAnthropicEvents(result);
    const eventTypes = events.map((e) => e.event);

    // content_block_start with tool_use
    expect(eventTypes).toContain("content_block_start");
    const blockStart = events.find((e) => e.event === "content_block_start");
    const block = (blockStart?.data as Record<string, unknown>)?.content_block as Record<string, unknown>;
    expect(block?.type).toBe("tool_use");
    expect(block?.id).toBe("toolu_fc_1");
    expect(block?.name).toBe("get_weather");

    // input_json_delta
    expect(eventTypes).toContain("content_block_delta");
    const blockDelta = events.find((e) => e.event === "content_block_delta");
    const delta = (blockDelta?.data as Record<string, unknown>)?.delta as Record<string, unknown>;
    expect(delta?.type).toBe("input_json_delta");
    expect(delta?.partial_json).toBe('{"city":"NYC"}');

    // content_block_stop
    expect(eventTypes).toContain("content_block_stop");

    // message_delta with tool_use stop_reason
    const msgDelta = events.find((e) => e.event === "message_delta");
    const deltaData = (msgDelta?.data as Record<string, unknown>)?.delta as Record<string, unknown>;
    expect(deltaData?.stop_reason).toBe("tool_use");
  });

  it("converts reasoning to thinking block", async () => {
    const t = new ResponsesToAnthropicTransform("claude-3");
    const output = collectOutput(t);
    t.write(respSSE("response.output_item.added", {
      type: "response.output_item.added",
      output_index: 0,
      item: { type: "reasoning", id: "rs_1", summary: [] },
    }));
    t.write(respSSE("response.reasoning_summary_text.delta", {
      type: "response.reasoning_summary_text.delta",
      output_index: 0,
      summary_index: 0,
      delta: "Let me think about this...",
    }));
    t.write(respSSE("response.reasoning_summary_text.done", {
      type: "response.reasoning_summary_text.done",
      output_index: 0,
      summary_index: 0,
      text: "Let me think about this...",
    }));
    t.write(respSSE("response.output_item.done", {
      type: "response.output_item.done",
      output_index: 0,
      item: { type: "reasoning", id: "rs_1", summary: [{ type: "summary_text", text: "Let me think about this..." }] },
    }));
    t.write(respSSE("response.output_item.added", {
      type: "response.output_item.added",
      output_index: 1,
      item: { type: "message", id: "msg_1", role: "assistant", content: [], status: "in_progress" },
    }));
    t.write(respSSE("response.content_part.added", {
      type: "response.content_part.added",
      output_index: 1,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    }));
    t.write(respSSE("response.output_text.delta", {
      type: "response.output_text.delta",
      output_index: 1,
      content_index: 0,
      delta: "The answer is 42",
    }));
    t.write(respSSE("response.output_item.done", {
      type: "response.output_item.done",
      output_index: 1,
      item: { type: "message", id: "msg_1", role: "assistant", content: [{ type: "output_text", text: "The answer is 42" }], status: "completed" },
    }));
    t.write(respSSE("response.completed", {
      type: "response.completed",
      response: {
        id: "resp_1", object: "response", model: "gpt-4o", status: "completed",
        output: [], usage: { input_tokens: 10, output_tokens: 30, total_tokens: 40 },
      },
    }));
    t.end();
    const result = await output;
    const events = parseAnthropicEvents(result);
    const eventTypes = events.map((e) => e.event);

    // Should have thinking block
    const blockStarts = events.filter((e) => e.event === "content_block_start");
    expect(blockStarts.length).toBe(2);

    const thinkingBlock = (blockStarts[0]?.data as Record<string, unknown>)?.content_block as Record<string, unknown>;
    expect(thinkingBlock?.type).toBe("thinking");

    const textBlock = (blockStarts[1]?.data as Record<string, unknown>)?.content_block as Record<string, unknown>;
    expect(textBlock?.type).toBe("text");

    // thinking_delta
    const deltas = events.filter((e) => e.event === "content_block_delta");
    const thinkingDelta = (deltas[0]?.data as Record<string, unknown>)?.delta as Record<string, unknown>;
    expect(thinkingDelta?.type).toBe("thinking_delta");
    expect(thinkingDelta?.thinking).toBe("Let me think about this...");

    // text_delta
    const textDelta = (deltas[1]?.data as Record<string, unknown>)?.delta as Record<string, unknown>;
    expect(textDelta?.type).toBe("text_delta");
    expect(textDelta?.text).toBe("The answer is 42");

    // Two content_block_stop events
    const blockStops = events.filter((e) => e.event === "content_block_stop");
    expect(blockStops.length).toBe(2);
  });

  it("maps incomplete status to max_tokens stop_reason", async () => {
    const t = new ResponsesToAnthropicTransform("claude-3");
    const output = collectOutput(t);
    t.write(respSSE("response.output_item.added", {
      type: "response.output_item.added",
      output_index: 0,
      item: { type: "message", id: "msg_1", role: "assistant", content: [], status: "in_progress" },
    }));
    t.write(respSSE("response.content_part.added", {
      type: "response.content_part.added",
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    }));
    t.write(respSSE("response.output_text.delta", {
      type: "response.output_text.delta",
      output_index: 0,
      content_index: 0,
      delta: "Partial",
    }));
    t.write(respSSE("response.output_item.done", {
      type: "response.output_item.done",
      output_index: 0,
      item: { type: "message", id: "msg_1", role: "assistant", content: [{ type: "output_text", text: "Partial" }], status: "completed" },
    }));
    t.write(respSSE("response.incomplete", {
      type: "response.incomplete",
      response: {
        id: "resp_1", object: "response", model: "gpt-4o", status: "incomplete",
        output: [], usage: { input_tokens: 10, output_tokens: 100, total_tokens: 110 },
      },
    }));
    t.end();
    const result = await output;
    const events = parseAnthropicEvents(result);
    const msgDelta = events.find((e) => e.event === "message_delta");
    const deltaData = (msgDelta?.data as Record<string, unknown>)?.delta as Record<string, unknown>;
    expect(deltaData?.stop_reason).toBe("max_tokens");
  });

  it("includes output_tokens from usage in message_delta", async () => {
    const t = new ResponsesToAnthropicTransform("claude-3");
    const output = collectOutput(t);
    t.write(respSSE("response.output_item.added", {
      type: "response.output_item.added",
      output_index: 0,
      item: { type: "message", id: "msg_1", role: "assistant", content: [], status: "in_progress" },
    }));
    t.write(respSSE("response.content_part.added", {
      type: "response.content_part.added",
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    }));
    t.write(respSSE("response.output_text.delta", {
      type: "response.output_text.delta",
      output_index: 0,
      content_index: 0,
      delta: "Hi",
    }));
    t.write(respSSE("response.output_item.done", {
      type: "response.output_item.done",
      output_index: 0,
      item: { type: "message", id: "msg_1", role: "assistant", content: [{ type: "output_text", text: "Hi" }], status: "completed" },
    }));
    t.write(respSSE("response.completed", {
      type: "response.completed",
      response: {
        id: "resp_1", object: "response", model: "gpt-4o", status: "completed",
        output: [], usage: { input_tokens: 42, output_tokens: 7, total_tokens: 49 },
      },
    }));
    t.end();
    const result = await output;
    const events = parseAnthropicEvents(result);
    const msgDelta = events.find((e) => e.event === "message_delta");
    const usage = (msgDelta?.data as Record<string, unknown>)?.usage as Record<string, unknown>;
    expect(usage?.output_tokens).toBe(7);
  });

  it("handles error events", async () => {
    const t = new ResponsesToAnthropicTransform("claude-3");
    const output = collectOutput(t);
    t.write(respSSE("response.failed", {
      type: "response.failed",
      response: {
        id: "resp_1", object: "response", model: "gpt-4o", status: "failed",
        error: { code: "server_error", message: "Internal error" },
      },
    }));
    t.end();
    const result = await output;
    const events = parseAnthropicEvents(result);
    const errorEvent = events.find((e) => e.event === "error");
    expect(errorEvent).toBeDefined();
    const error = (errorEvent?.data as Record<string, unknown>)?.error as Record<string, unknown>;
    expect(error?.message).toBe("Internal error");
  });

  it("handles mixed content: text + function_call", async () => {
    const t = new ResponsesToAnthropicTransform("claude-3");
    const output = collectOutput(t);

    // Text output
    t.write(respSSE("response.output_item.added", {
      type: "response.output_item.added",
      output_index: 0,
      item: { type: "message", id: "msg_1", role: "assistant", content: [], status: "in_progress" },
    }));
    t.write(respSSE("response.content_part.added", {
      type: "response.content_part.added",
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    }));
    t.write(respSSE("response.output_text.delta", {
      type: "response.output_text.delta",
      output_index: 0,
      content_index: 0,
      delta: "Let me search for that.",
    }));
    t.write(respSSE("response.output_item.done", {
      type: "response.output_item.done",
      output_index: 0,
      item: { type: "message", id: "msg_1", role: "assistant", content: [{ type: "output_text", text: "Let me search for that." }], status: "completed" },
    }));
    // Function call
    t.write(respSSE("response.output_item.added", {
      type: "response.output_item.added",
      output_index: 1,
      item: { type: "function_call", id: "fc_1", call_id: "fc_1", name: "search", arguments: "", status: "in_progress" },
    }));
    t.write(respSSE("response.function_call_arguments.delta", {
      type: "response.function_call_arguments.delta",
      output_index: 1,
      item_id: "fc_1",
      call_id: "fc_1",
      delta: '{"query":"test"}',
    }));
    t.write(respSSE("response.output_item.done", {
      type: "response.output_item.done",
      output_index: 1,
      item: { type: "function_call", id: "fc_1", call_id: "fc_1", name: "search", arguments: '{"query":"test"}', status: "completed" },
    }));
    t.write(respSSE("response.completed", {
      type: "response.completed",
      response: {
        id: "resp_1", object: "response", model: "gpt-4o", status: "completed",
        output: [], usage: { input_tokens: 50, output_tokens: 25, total_tokens: 75 },
      },
    }));
    t.end();
    const result = await output;
    const events = parseAnthropicEvents(result);
    const eventTypes = events.map((e) => e.event);

    // Should have 2 content_block_start (text + tool_use)
    const blockStarts = events.filter((e) => e.event === "content_block_start");
    expect(blockStarts.length).toBe(2);

    // Tool use block
    const toolBlock = (blockStarts[1]?.data as Record<string, unknown>)?.content_block as Record<string, unknown>;
    expect(toolBlock?.type).toBe("tool_use");
    expect(toolBlock?.name).toBe("search");

    // Should end with tool_use stop_reason (because function_call was present)
    const msgDelta = events.find((e) => e.event === "message_delta");
    const deltaData = (msgDelta?.data as Record<string, unknown>)?.delta as Record<string, unknown>;
    expect(deltaData?.stop_reason).toBe("tool_use");
  });
});
