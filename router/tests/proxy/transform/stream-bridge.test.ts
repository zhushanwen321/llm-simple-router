import { describe, it, expect } from "vitest";
import { ChatToResponsesBridgeTransform } from "../../../src/proxy/transform/stream-bridge-chat2resp.js";
import { ResponsesToChatBridgeTransform } from "../../../src/proxy/transform/stream-bridge-resp2chat.js";
import { RESPONSES_SSE_EVENTS } from "../../../src/proxy/transform/types-responses.js";

// ---------- Helpers ----------

function collectOutput(transform: NodeJS.ReadWriteStream): Promise<string> {
  return new Promise((resolve) => {
    const chunks: string[] = [];
    transform.on("data", (c: Buffer) => chunks.push(c.toString()));
    transform.on("end", () => resolve(chunks.join("")));
  });
}

function parseSSEEvents(output: string): Array<{ event: string; data: unknown }> {
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

function parseOpenAIChunks(output: string): Array<Record<string, unknown>> {
  const results: Array<Record<string, unknown>> = [];
  const chunks = output.split("\n\n").filter(Boolean);
  for (const chunk of chunks) {
    const lines = chunk.split("\n");
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const dataStr = line.slice(6);
        if (dataStr === "[DONE]") continue;
        try { results.push(JSON.parse(dataStr)); } catch { /* skip */ }
      }
    }
  }
  return results;
}

function chatSSE(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function respSSE(eventType: string, data: unknown): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

// ---------- ChatToResponsesBridgeTransform ----------

describe("ChatToResponsesBridgeTransform", () => {
  it("emits response.created + response.in_progress on first role chunk", async () => {
    const t = new ChatToResponsesBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);
    const eventTypes = events.map((e) => e.event);
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.CREATED);
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.IN_PROGRESS);

    const created = events.find((e) => e.event === RESPONSES_SSE_EVENTS.CREATED);
    const resp = (created?.data as Record<string, unknown>)?.response as Record<string, unknown>;
    expect(resp?.status).toBe("queued");

    const inProgress = events.find((e) => e.event === RESPONSES_SSE_EVENTS.IN_PROGRESS);
    const resp2 = (inProgress?.data as Record<string, unknown>)?.response as Record<string, unknown>;
    expect(resp2?.status).toBe("in_progress");
  });

  it("converts text delta to output_text.delta events", async () => {
    const t = new ChatToResponsesBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: " world" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);
    const eventTypes = events.map((e) => e.event);

    // Should emit output_item.added for message type
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.OUTPUT_ITEM_ADDED);
    const itemAdded = events.find((e) => e.event === RESPONSES_SSE_EVENTS.OUTPUT_ITEM_ADDED);
    const item = (itemAdded?.data as Record<string, unknown>)?.item as Record<string, unknown>;
    expect(item?.type).toBe("message");

    // Should emit content_part.added
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.CONTENT_PART_ADDED);

    // Should emit two output_text.delta events
    const textDeltas = events.filter((e) => e.event === RESPONSES_SSE_EVENTS.OUTPUT_TEXT_DELTA);
    expect(textDeltas.length).toBe(2);
    expect((textDeltas[0]?.data as Record<string, unknown>)?.delta).toBe("Hello");
    expect((textDeltas[1]?.data as Record<string, unknown>)?.delta).toBe(" world");

    // Should close items and emit response.completed
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.OUTPUT_TEXT_DONE);
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.CONTENT_PART_DONE);
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.OUTPUT_ITEM_DONE);
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.COMPLETED);
  });

  it("converts tool_calls to function_call events", async () => {
    const t = new ChatToResponsesBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }));
    t.write(chatSSE({
      id: "chatcmpl-1", object: "chat.completion.chunk",
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index: 0, id: "call_abc", type: "function", function: { name: "get_weather", arguments: "" } }] },
        finish_reason: null,
      }],
    }));
    t.write(chatSSE({
      id: "chatcmpl-1", object: "chat.completion.chunk",
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index: 0, function: { arguments: '{"city":"NYC"}' } }] },
        finish_reason: null,
      }],
    }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }));
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);
    const eventTypes = events.map((e) => e.event);

    // Should emit output_item.added with function_call type
    const itemAdded = events.find((e) => e.event === RESPONSES_SSE_EVENTS.OUTPUT_ITEM_ADDED);
    const item = (itemAdded?.data as Record<string, unknown>)?.item as Record<string, unknown>;
    expect(item?.type).toBe("function_call");
    expect(item?.call_id).toBe("call_abc");
    expect(item?.name).toBe("get_weather");

    // Should emit function_call_arguments.delta
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.FUNCTION_CALL_ARGUMENTS_DELTA);
    const argsDelta = events.find((e) => e.event === RESPONSES_SSE_EVENTS.FUNCTION_CALL_ARGUMENTS_DELTA);
    expect((argsDelta?.data as Record<string, unknown>)?.delta).toBe('{"city":"NYC"}');

    // Should emit function_call_arguments.done
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.FUNCTION_CALL_ARGUMENTS_DONE);

    // Should emit output_item.done
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.OUTPUT_ITEM_DONE);

    // response.completed
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.COMPLETED);
  });

  it("converts reasoning_content to reasoning events", async () => {
    const t = new ChatToResponsesBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { reasoning_content: "Let me think..." }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "The answer is 42" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 15, total_tokens: 25 } }));
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);
    const eventTypes = events.map((e) => e.event);

    // Reasoning events
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.REASONING_SUMMARY_PART_ADDED);
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.REASONING_SUMMARY_TEXT_DELTA);
    const reasoningDelta = events.find((e) => e.event === RESPONSES_SSE_EVENTS.REASONING_SUMMARY_TEXT_DELTA);
    expect((reasoningDelta?.data as Record<string, unknown>)?.delta).toBe("Let me think...");

    // Text events
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.OUTPUT_TEXT_DELTA);
    const textDelta = events.find((e) => e.event === RESPONSES_SSE_EVENTS.OUTPUT_TEXT_DELTA);
    expect((textDelta?.data as Record<string, unknown>)?.delta).toBe("The answer is 42");

    // Should have 2 output_item.done events (reasoning + message)
    const itemDoneEvents = events.filter((e) => e.event === RESPONSES_SSE_EVENTS.OUTPUT_ITEM_DONE);
    expect(itemDoneEvents.length).toBe(2);
  });

  it("emits response.completed with usage", async () => {
    const t = new ChatToResponsesBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 } }));
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);
    const completed = events.find((e) => e.event === RESPONSES_SSE_EVENTS.COMPLETED);
    const resp = (completed?.data as Record<string, unknown>)?.response as Record<string, unknown>;
    expect(resp?.status).toBe("completed");
    const usage = resp?.usage as Record<string, unknown>;
    expect(usage?.input_tokens).toBe(42);
    expect(usage?.output_tokens).toBe(7);
    expect(usage?.total_tokens).toBe(49);
  });

  it("increments sequence_number monotonically", async () => {
    const t = new ChatToResponsesBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } }));
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);
    const seqNums = events.map((e) => (e.data as Record<string, unknown>)?.sequence_number as number);
    for (let i = 1; i < seqNums.length; i++) {
      expect(seqNums[i]).toBeGreaterThan(seqNums[i - 1]);
    }
  });

  it("handles usage-only chunk after finish_reason", async () => {
    const t = new ChatToResponsesBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: null }] }));
    // finish_reason without usage
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }));
    // Separate usage chunk (no choices)
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }));
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);
    const eventTypes = events.map((e) => e.event);
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.COMPLETED);

    const completed = events.find((e) => e.event === RESPONSES_SSE_EVENTS.COMPLETED);
    const resp = (completed?.data as Record<string, unknown>)?.response as Record<string, unknown>;
    const usage = resp?.usage as Record<string, unknown>;
    expect(usage?.input_tokens).toBe(10);
    expect(usage?.output_tokens).toBe(2);
  });

  it("handles multiple tool calls", async () => {
    const t = new ChatToResponsesBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }));
    // First tool call
    t.write(chatSSE({
      id: "chatcmpl-1", object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "get_weather", arguments: "" } }] }, finish_reason: null }],
    }));
    t.write(chatSSE({
      id: "chatcmpl-1", object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"city":"NYC"}' } }] }, finish_reason: null }],
    }));
    // Second tool call
    t.write(chatSSE({
      id: "chatcmpl-1", object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { tool_calls: [{ index: 1, id: "call_2", type: "function", function: { name: "get_time", arguments: "" } }] }, finish_reason: null }],
    }));
    t.write(chatSSE({
      id: "chatcmpl-1", object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { tool_calls: [{ index: 1, function: { arguments: '{"tz":"EST"}' } }] }, finish_reason: null }],
    }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }));
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);
    const itemAddedEvents = events.filter((e) => e.event === RESPONSES_SSE_EVENTS.OUTPUT_ITEM_ADDED);
    expect(itemAddedEvents.length).toBe(2);
    const names = itemAddedEvents.map((e) => ((e.data as Record<string, unknown>)?.item as Record<string, unknown>)?.name);
    expect(names).toContain("get_weather");
    expect(names).toContain("get_time");

    const itemDoneEvents = events.filter((e) => e.event === RESPONSES_SSE_EVENTS.OUTPUT_ITEM_DONE);
    expect(itemDoneEvents.length).toBe(2);
  });

  // ---------- Text accumulation: done events contain full accumulated text ----------

  it("output_text.done contains full accumulated text from deltas", async () => {
    const t = new ChatToResponsesBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: " world" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } }));
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);
    const textDone = events.find((e) => e.event === RESPONSES_SSE_EVENTS.OUTPUT_TEXT_DONE);
    expect(textDone).toBeDefined();
    expect((textDone!.data as Record<string, unknown>).text).toBe("Hello world");
  });

  it("content_part.done contains full accumulated text", async () => {
    const t = new ChatToResponsesBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: " world" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } }));
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);
    const partDone = events.find((e) => e.event === RESPONSES_SSE_EVENTS.CONTENT_PART_DONE);
    expect(partDone).toBeDefined();
    const part = (partDone!.data as Record<string, unknown>).part as Record<string, unknown>;
    expect(part.text).toBe("Hello world");
  });

  it("output_item.done contains full accumulated text in item.content", async () => {
    const t = new ChatToResponsesBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: " world" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } }));
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);
    const messageItemDone = events.find((e) => {
      const eData = e.data as Record<string, unknown>;
      const item = eData?.item as Record<string, unknown>;
      return e.event === RESPONSES_SSE_EVENTS.OUTPUT_ITEM_DONE && item?.type === "message";
    });
    expect(messageItemDone).toBeDefined();
    const item = (messageItemDone!.data as Record<string, unknown>).item as Record<string, unknown>;
    const content = item.content as Array<Record<string, unknown>>;
    expect(content[0].text).toBe("Hello world");
  });

  it("response.completed output contains full accumulated text", async () => {
    const t = new ChatToResponsesBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: " world" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } }));
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);
    const completed = events.find((e) => e.event === RESPONSES_SSE_EVENTS.COMPLETED);
    expect(completed).toBeDefined();
    const resp = (completed!.data as Record<string, unknown>).response as Record<string, unknown>;
    const outputItems = resp.output as Array<Record<string, unknown>>;
    const messageItem = outputItems.find((o) => o.type === "message") as Record<string, unknown>;
    expect(messageItem).toBeDefined();
    const content = messageItem.content as Array<Record<string, unknown>>;
    expect(content[0].text).toBe("Hello world");
  });

  // ---------- Reasoning text accumulation ----------

  it("reasoning_summary_text.done contains full accumulated reasoning text", async () => {
    const t = new ChatToResponsesBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { reasoning_content: "Let me" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { reasoning_content: " think..." }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "42" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }));
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);
    const reasoningDone = events.find((e) => e.event === RESPONSES_SSE_EVENTS.REASONING_SUMMARY_TEXT_DONE);
    expect(reasoningDone).toBeDefined();
    expect((reasoningDone!.data as Record<string, unknown>).text).toBe("Let me think...");
  });

  it("reasoning_summary_part.done contains full accumulated reasoning text", async () => {
    const t = new ChatToResponsesBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { reasoning_content: "Let me" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { reasoning_content: " think..." }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "42" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }));
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);
    const partDone = events.find((e) => e.event === RESPONSES_SSE_EVENTS.REASONING_SUMMARY_PART_DONE);
    expect(partDone).toBeDefined();
    const part = (partDone!.data as Record<string, unknown>).part as Record<string, unknown>;
    expect(part.text).toBe("Let me think...");
  });

  it("reasoning output_item.done contains full accumulated reasoning text in summary", async () => {
    const t = new ChatToResponsesBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { reasoning_content: "Let me" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { reasoning_content: " think..." }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "42" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }));
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);
    const reasoningItemDone = events.find((e) => {
      const eData = e.data as Record<string, unknown>;
      const item = eData?.item as Record<string, unknown>;
      return e.event === RESPONSES_SSE_EVENTS.OUTPUT_ITEM_DONE && item?.type === "reasoning";
    });
    expect(reasoningItemDone).toBeDefined();
    const item = (reasoningItemDone!.data as Record<string, unknown>).item as Record<string, unknown>;
    const summary = item.summary as Array<Record<string, unknown>>;
    expect(summary[0].text).toBe("Let me think...");
  });

  it("response.completed output contains full accumulated reasoning text", async () => {
    const t = new ChatToResponsesBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { reasoning_content: "Let me" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { reasoning_content: " think..." }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "42" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }));
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);
    const completed = events.find((e) => e.event === RESPONSES_SSE_EVENTS.COMPLETED);
    expect(completed).toBeDefined();
    const resp = (completed!.data as Record<string, unknown>).response as Record<string, unknown>;
    const outputItems = resp.output as Array<Record<string, unknown>>;
    const reasoningItem = outputItems.find((o) => o.type === "reasoning") as Record<string, unknown>;
    expect(reasoningItem).toBeDefined();
    const summary = reasoningItem.summary as Array<Record<string, unknown>>;
    expect(summary[0].text).toBe("Let me think...");
  });

  // ---------- Function call arguments accumulation ----------

  it("function_call_arguments.done contains full accumulated arguments", async () => {
    const t = new ChatToResponsesBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }));
    t.write(chatSSE({
      id: "chatcmpl-1", object: "chat.completion.chunk",
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index: 0, id: "call_abc", type: "function", function: { name: "get_weather", arguments: "" } }] },
        finish_reason: null,
      }],
    }));
    t.write(chatSSE({
      id: "chatcmpl-1", object: "chat.completion.chunk",
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index: 0, function: { arguments: '{"city":"NYC"}' } }] },
        finish_reason: null,
      }],
    }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }));
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);
    const argsDone = events.find((e) => e.event === RESPONSES_SSE_EVENTS.FUNCTION_CALL_ARGUMENTS_DONE);
    expect(argsDone).toBeDefined();
    expect((argsDone!.data as Record<string, unknown>).arguments).toBe('{"city":"NYC"}');
  });

  it("function_call output_item.done contains full accumulated arguments", async () => {
    const t = new ChatToResponsesBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }));
    t.write(chatSSE({
      id: "chatcmpl-1", object: "chat.completion.chunk",
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index: 0, id: "call_abc", type: "function", function: { name: "get_weather", arguments: "" } }] },
        finish_reason: null,
      }],
    }));
    t.write(chatSSE({
      id: "chatcmpl-1", object: "chat.completion.chunk",
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index: 0, function: { arguments: '{"city":"NYC"}' } }] },
        finish_reason: null,
      }],
    }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }));
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);
    const fcItemDone = events.find((e) => {
      const eData = e.data as Record<string, unknown>;
      const item = eData?.item as Record<string, unknown>;
      return e.event === RESPONSES_SSE_EVENTS.OUTPUT_ITEM_DONE && item?.type === "function_call";
    });
    expect(fcItemDone).toBeDefined();
    const item = (fcItemDone!.data as Record<string, unknown>).item as Record<string, unknown>;
    expect(item.arguments).toBe('{"city":"NYC"}');
  });

  it("response.completed output contains full accumulated function_call arguments", async () => {
    const t = new ChatToResponsesBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }));
    t.write(chatSSE({
      id: "chatcmpl-1", object: "chat.completion.chunk",
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index: 0, id: "call_abc", type: "function", function: { name: "get_weather", arguments: "" } }] },
        finish_reason: null,
      }],
    }));
    t.write(chatSSE({
      id: "chatcmpl-1", object: "chat.completion.chunk",
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index: 0, function: { arguments: '{"city":"NYC"}' } }] },
        finish_reason: null,
      }],
    }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }));
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);
    const completed = events.find((e) => e.event === RESPONSES_SSE_EVENTS.COMPLETED);
    expect(completed).toBeDefined();
    const resp = (completed!.data as Record<string, unknown>).response as Record<string, unknown>;
    const outputItems = resp.output as Array<Record<string, unknown>>;
    const fcItem = outputItems.find((o) => o.type === "function_call") as Record<string, unknown>;
    expect(fcItem).toBeDefined();
    expect(fcItem.arguments).toBe('{"city":"NYC"}');
  });

  // ---------- Integration: full end-to-end text accumulation ----------

  it("full end-to-end flow accumulates all text types correctly", async () => {
    const t = new ChatToResponsesBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }));
    // Reasoning chunks (multi-chunk)
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { reasoning_content: "I need to" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { reasoning_content: " analyze this." }, finish_reason: null }] }));
    // Text chunks (multi-chunk)
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "The answer" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: " is 42." }, finish_reason: null }] }));
    // Tool call (multi-chunk)
    t.write(chatSSE({
      id: "chatcmpl-1", object: "chat.completion.chunk",
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "search", arguments: "" } }] },
        finish_reason: null,
      }],
    }));
    t.write(chatSSE({
      id: "chatcmpl-1", object: "chat.completion.chunk",
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index: 0, function: { arguments: '{"query"' } }] },
        finish_reason: null,
      }],
    }));
    t.write(chatSSE({
      id: "chatcmpl-1", object: "chat.completion.chunk",
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index: 0, function: { arguments: ':"life"}' } }] },
        finish_reason: null,
      }],
    }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 25, total_tokens: 35 } }));
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);

    // Verify reasoning done events
    const reasoningTextDone = events.find((e) => e.event === RESPONSES_SSE_EVENTS.REASONING_SUMMARY_TEXT_DONE);
    expect(reasoningTextDone).toBeDefined();
    expect((reasoningTextDone!.data as Record<string, unknown>).text).toBe("I need to analyze this.");

    const reasoningPartDone = events.find((e) => e.event === RESPONSES_SSE_EVENTS.REASONING_SUMMARY_PART_DONE);
    expect(reasoningPartDone).toBeDefined();
    const rPart = (reasoningPartDone!.data as Record<string, unknown>).part as Record<string, unknown>;
    expect(rPart.text).toBe("I need to analyze this.");

    // Verify text done events
    const textDone = events.find((e) => e.event === RESPONSES_SSE_EVENTS.OUTPUT_TEXT_DONE);
    expect(textDone).toBeDefined();
    expect((textDone!.data as Record<string, unknown>).text).toBe("The answer is 42.");

    const contentPartDone = events.find((e) => e.event === RESPONSES_SSE_EVENTS.CONTENT_PART_DONE);
    expect(contentPartDone).toBeDefined();
    const cPart = (contentPartDone!.data as Record<string, unknown>).part as Record<string, unknown>;
    expect(cPart.text).toBe("The answer is 42.");

    // Verify function call done events
    const argsDone = events.find((e) => e.event === RESPONSES_SSE_EVENTS.FUNCTION_CALL_ARGUMENTS_DONE);
    expect(argsDone).toBeDefined();
    expect((argsDone!.data as Record<string, unknown>).arguments).toBe('{"query":"life"}');

    // Verify response.completed output
    const completed = events.find((e) => e.event === RESPONSES_SSE_EVENTS.COMPLETED);
    expect(completed).toBeDefined();
    const resp = (completed!.data as Record<string, unknown>).response as Record<string, unknown>;
    const outputItems = resp.output as Array<Record<string, unknown>>;

    // Should have 3 output items: reasoning, message, function_call
    expect(outputItems.length).toBe(3);

    // Reasoning item
    const reasoningItem = outputItems.find((o) => o.type === "reasoning") as Record<string, unknown>;
    expect(reasoningItem).toBeDefined();
    const rSummary = reasoningItem.summary as Array<Record<string, unknown>>;
    expect(rSummary[0].text).toBe("I need to analyze this.");

    // Message item
    const messageItem = outputItems.find((o) => o.type === "message") as Record<string, unknown>;
    expect(messageItem).toBeDefined();
    const mContent = messageItem.content as Array<Record<string, unknown>>;
    expect(mContent[0].text).toBe("The answer is 42.");

    // Function call item
    const fcItem = outputItems.find((o) => o.type === "function_call") as Record<string, unknown>;
    expect(fcItem).toBeDefined();
    expect(fcItem.arguments).toBe('{"query":"life"}');
  });

  // ---------- Interface-level: boundary & edge cases ----------

  it("empty stream produces completed with empty output and no done events", async () => {
    const t = new ChatToResponsesBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);
    const eventTypes = events.map((e) => e.event);

    // Should emit response.created, response.in_progress, response.completed
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.CREATED);
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.IN_PROGRESS);
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.COMPLETED);

    // No done events (OUTPUT_TEXT_DONE, CONTENT_PART_DONE, OUTPUT_ITEM_DONE, etc.)
    expect(eventTypes).not.toContain(RESPONSES_SSE_EVENTS.OUTPUT_TEXT_DONE);
    expect(eventTypes).not.toContain(RESPONSES_SSE_EVENTS.CONTENT_PART_DONE);
    expect(eventTypes).not.toContain(RESPONSES_SSE_EVENTS.REASONING_SUMMARY_TEXT_DONE);
    expect(eventTypes).not.toContain(RESPONSES_SSE_EVENTS.FUNCTION_CALL_ARGUMENTS_DONE);

    // Completed response should have empty output
    const completed = events.find((e) => e.event === RESPONSES_SSE_EVENTS.COMPLETED);
    expect(completed).toBeDefined();
    const resp = (completed!.data as Record<string, unknown>).response as Record<string, unknown>;
    const outputItems = resp.output as Array<unknown>;
    expect(outputItems).toEqual([]);
  });

  it("content in same chunk as finish_reason is accumulated", async () => {
    const t = new ChatToResponsesBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }));
    // Add text to trigger message item open, finish in same chunk
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } }));
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);

    // Since we DID send "Hi" in the finish chunk, the buffer should have it
    const textDone = events.find((e) => e.event === RESPONSES_SSE_EVENTS.OUTPUT_TEXT_DONE);
    expect(textDone).toBeDefined();
    expect((textDone!.data as Record<string, unknown>).text).toBe("Hi");
  });

  it("empty content deltas do not add to buffer", async () => {
    const t = new ChatToResponsesBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }));
    // Empty content string — should not add to buffer
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }] }));
    // Another empty content
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: " world" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } }));
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);

    // Empty content should be skipped, buffer should be "Hello world"
    const textDone = events.find((e) => e.event === RESPONSES_SSE_EVENTS.OUTPUT_TEXT_DONE);
    expect(textDone).toBeDefined();
    expect((textDone!.data as Record<string, unknown>).text).toBe("Hello world");

    // Verify only 2 delta events (empty ones are skipped)
    const textDeltas = events.filter((e) => e.event === RESPONSES_SSE_EVENTS.OUTPUT_TEXT_DELTA);
    expect(textDeltas.length).toBe(2);
    expect((textDeltas[0]?.data as Record<string, unknown>)?.delta).toBe("Hello");
    expect((textDeltas[1]?.data as Record<string, unknown>)?.delta).toBe(" world");
  });

  it("tool call with initial arguments in first chunk accumulates correctly", async () => {
    const t = new ChatToResponsesBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }));
    // First chunk has id + name + partial arguments
    t.write(chatSSE({
      id: "chatcmpl-1", object: "chat.completion.chunk",
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index: 0, id: "call_abc", type: "function", function: { name: "search", arguments: '{"query"' } }] },
        finish_reason: null,
      }],
    }));
    // Continuation
    t.write(chatSSE({
      id: "chatcmpl-1", object: "chat.completion.chunk",
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index: 0, function: { arguments: ':"test","limit":5}' } }] },
        finish_reason: null,
      }],
    }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 } }));
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);

    const argsDone = events.find((e) => e.event === RESPONSES_SSE_EVENTS.FUNCTION_CALL_ARGUMENTS_DONE);
    expect(argsDone).toBeDefined();
    expect((argsDone!.data as Record<string, unknown>).arguments).toBe('{"query":"test","limit":5}');

    // Also verify output_item.done
    const fcItemDone = events.find((e) => {
      const eData = e.data as Record<string, unknown>;
      const item = eData?.item as Record<string, unknown>;
      return e.event === RESPONSES_SSE_EVENTS.OUTPUT_ITEM_DONE && item?.type === "function_call";
    });
    expect(fcItemDone).toBeDefined();
    const item = (fcItemDone!.data as Record<string, unknown>).item as Record<string, unknown>;
    expect(item.arguments).toBe('{"query":"test","limit":5}');
  });

  it("many small argument continuation chunks accumulate correctly", async () => {
    const t = new ChatToResponsesBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }));
    t.write(chatSSE({
      id: "chatcmpl-1", object: "chat.completion.chunk",
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "analyze", arguments: "" } }] },
        finish_reason: null,
      }],
    }));
    // 5 small continuation chunks
    const parts = ['{"', 'data"', ':', '"x"', '}'];
    for (const part of parts) {
      t.write(chatSSE({
        id: "chatcmpl-1", object: "chat.completion.chunk",
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: part } }] }, finish_reason: null }],
      }));
    }
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 5, completion_tokens: 15, total_tokens: 20 } }));
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);

    const argsDone = events.find((e) => e.event === RESPONSES_SSE_EVENTS.FUNCTION_CALL_ARGUMENTS_DONE);
    expect(argsDone).toBeDefined();
    expect((argsDone!.data as Record<string, unknown>).arguments).toBe('{"data":"x"}');

    // Verify 5 delta events
    const argsDeltas = events.filter((e) => e.event === RESPONSES_SSE_EVENTS.FUNCTION_CALL_ARGUMENTS_DELTA);
    expect(argsDeltas.length).toBe(5);
  });

  it("consecutive function calls have isolated argument buffers", async () => {
    const t = new ChatToResponsesBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }));
    // First function call: init + continuation
    t.write(chatSSE({
      id: "chatcmpl-1", object: "chat.completion.chunk",
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "fn1", arguments: "" } }] },
        finish_reason: null,
      }],
    }));
    t.write(chatSSE({
      id: "chatcmpl-1", object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"a":1}' } }] }, finish_reason: null }],
    }));
    // Second function call closes first, starts new
    t.write(chatSSE({
      id: "chatcmpl-1", object: "chat.completion.chunk",
      choices: [{
        index: 0,
        delta: { tool_calls: [{ index: 1, id: "call_2", type: "function", function: { name: "fn2", arguments: "" } }] },
        finish_reason: null,
      }],
    }));
    t.write(chatSSE({
      id: "chatcmpl-1", object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { tool_calls: [{ index: 1, function: { arguments: '{"b":2}' } }] }, finish_reason: null }],
    }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 5, completion_tokens: 20, total_tokens: 25 } }));
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);

    // Find all function_call output_item.done events
    const fcDoneEvents = events.filter((e) => {
      const eData = e.data as Record<string, unknown>;
      const item = eData?.item as Record<string, unknown>;
      return e.event === RESPONSES_SSE_EVENTS.OUTPUT_ITEM_DONE && item?.type === "function_call";
    });
    expect(fcDoneEvents.length).toBe(2);

    // First call should have only its own arguments
    const item1 = (fcDoneEvents[0]!.data as Record<string, unknown>).item as Record<string, unknown>;
    expect(item1.name).toBe("fn1");
    expect(item1.arguments).toBe('{"a":1}');

    // Second call should have only its own arguments (no leak)
    const item2 = (fcDoneEvents[1]!.data as Record<string, unknown>).item as Record<string, unknown>;
    expect(item2.name).toBe("fn2");
    expect(item2.arguments).toBe('{"b":2}');

    // Verify response.completed output also isolates correctly
    const completed = events.find((e) => e.event === RESPONSES_SSE_EVENTS.COMPLETED);
    const resp = (completed!.data as Record<string, unknown>).response as Record<string, unknown>;
    const outputItems = resp.output as Array<Record<string, unknown>>;
    const fcItems = outputItems.filter((o) => o.type === "function_call");
    expect(fcItems.length).toBe(2);
    expect(fcItems[0]?.arguments).toBe('{"a":1}');
    expect(fcItems[1]?.arguments).toBe('{"b":2}');
  });

  it("consecutive reasoning items have isolated text buffers", async () => {
    const t = new ChatToResponsesBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }));
    // First reasoning item
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { reasoning_content: "Thinking step 1." }, finish_reason: null }] }));
    // Text in between closes reasoning item
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "Interjection." }, finish_reason: null }] }));
    // Second reasoning item (new buffer)
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { reasoning_content: "Thinking step 2." }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 } }));
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);

    // Find both reasoning output_item.done events
    const reasoningDoneEvents = events.filter((e) => {
      const eData = e.data as Record<string, unknown>;
      const item = eData?.item as Record<string, unknown>;
      return e.event === RESPONSES_SSE_EVENTS.OUTPUT_ITEM_DONE && item?.type === "reasoning";
    });
    expect(reasoningDoneEvents.length).toBe(2);

    // First reasoning item should have "Thinking step 1."
    const item1 = (reasoningDoneEvents[0]!.data as Record<string, unknown>).item as Record<string, unknown>;
    const s1 = item1.summary as Array<Record<string, unknown>>;
    expect(s1[0].text).toBe("Thinking step 1.");

    // Second reasoning item should have "Thinking step 2." (not concatenated)
    const item2 = (reasoningDoneEvents[1]!.data as Record<string, unknown>).item as Record<string, unknown>;
    const s2 = item2.summary as Array<Record<string, unknown>>;
    expect(s2[0].text).toBe("Thinking step 2.");
  });

  it("non-JSON data is gracefully skipped without crashing", async () => {
    const t = new ChatToResponsesBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    // Valid chunk first
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }] }));
    // Invalid JSON: should not crash, should emit warning
    t.write(chatSSE("not valid json at all"));
    // More valid data after error
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: " world" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 } }));
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);

    // Text accumulation should still work correctly (invalid chunk skipped)
    const textDone = events.find((e) => e.event === RESPONSES_SSE_EVENTS.OUTPUT_TEXT_DONE);
    expect(textDone).toBeDefined();
    expect((textDone!.data as Record<string, unknown>).text).toBe("Hello world");

    // response.completed should still be emitted
    const eventTypes = events.map((e) => e.event);
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.COMPLETED);
  });

  it("usage-only chunk without pending completion does not emit completed", async () => {
    const t = new ChatToResponsesBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: null }] }));
    // Send usage-only without prior finish_reason — should update tokens but not complete
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }));
    // Now finish
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }));
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);

    // Should have exactly one completed event (not two)
    const completedEvents = events.filter((e) => e.event === RESPONSES_SSE_EVENTS.COMPLETED);
    expect(completedEvents.length).toBe(1);

    // Usage should be tracked from the usage-only chunk
    const completed = completedEvents[0];
    const resp = (completed!.data as Record<string, unknown>).response as Record<string, unknown>;
    const usage = resp?.usage as Record<string, unknown>;
    expect(usage?.input_tokens).toBe(10);
    expect(usage?.output_tokens).toBe(2);
  });

  it("unicode CJK characters accumulate correctly", async () => {
    const t = new ChatToResponsesBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "你好" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "世界！" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 } }));
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);

    const textDone = events.find((e) => e.event === RESPONSES_SSE_EVENTS.OUTPUT_TEXT_DONE);
    expect(textDone).toBeDefined();
    expect((textDone!.data as Record<string, unknown>).text).toBe("你好世界！");

    const completed = events.find((e) => e.event === RESPONSES_SSE_EVENTS.COMPLETED);
    const resp = (completed!.data as Record<string, unknown>).response as Record<string, unknown>;
    const outputItems = resp.output as Array<Record<string, unknown>>;
    const messageItem = outputItems.find((o) => o.type === "message") as Record<string, unknown>;
    const content = messageItem.content as Array<Record<string, unknown>>;
    expect(content[0].text).toBe("你好世界！");
  });

  it("ensureTerminated emits completed with accumulated output when stream is interrupted", async () => {
    const t = new ChatToResponsesBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    // Start streaming text but then end without finish_reason
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }));
    t.write(chatSSE({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "Partial response" }, finish_reason: null }] }));
    // No finish_reason — t.end() triggers ensureTerminated
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);

    const eventTypes = events.map((e) => e.event);
    // Should still emit completed
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.COMPLETED);

    // Text accumulation should still work (buffer has "Partial response")
    const textDone = events.find((e) => e.event === RESPONSES_SSE_EVENTS.OUTPUT_TEXT_DONE);
    expect(textDone).toBeDefined();
    expect((textDone!.data as Record<string, unknown>).text).toBe("Partial response");

    // Completed output should contain the accumulated text
    const completed = events.find((e) => e.event === RESPONSES_SSE_EVENTS.COMPLETED);
    const resp = (completed!.data as Record<string, unknown>).response as Record<string, unknown>;
    const outputItems = resp.output as Array<Record<string, unknown>>;
    expect(outputItems.length).toBe(1);
    const msg = outputItems[0] as Record<string, unknown>;
    expect(msg.type).toBe("message");
    const c = msg.content as Array<Record<string, unknown>>;
    expect(c[0].text).toBe("Partial response");
  });
});

// ---------- ResponsesToChatBridgeTransform ----------

describe("ResponsesToChatBridgeTransform", () => {
  it("emits role chunk on first content delta", async () => {
    const t = new ResponsesToChatBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(respSSE("response.output_text.delta", {
      type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "Hello",
    }));
    t.write(respSSE("response.completed", {
      type: "response.completed",
      response: { id: "resp_1", object: "response", model: "gpt-4o", status: "completed", output: [], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } },
    }));
    t.end();
    const result = await output;
    const chunks = parseOpenAIChunks(result);

    // First chunk should have role
    expect(chunks[0]).toBeDefined();
    const firstChoice = (chunks[0] as Record<string, unknown>)?.choices as Array<Record<string, unknown>>;
    expect(firstChoice?.[0]?.delta).toEqual({ role: "assistant" });
  });

  it("converts output_text.delta to content delta", async () => {
    const t = new ResponsesToChatBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(respSSE("response.output_text.delta", {
      type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "Hello world",
    }));
    t.write(respSSE("response.completed", {
      type: "response.completed",
      response: { id: "resp_1", object: "response", model: "gpt-4o", status: "completed", output: [], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } },
    }));
    t.end();
    const result = await output;
    const chunks = parseOpenAIChunks(result);

    // Find content delta chunk
    const contentChunk = chunks.find((c) => {
      const choices = c.choices as Array<Record<string, unknown>> | undefined;
      const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
      return delta?.content != null;
    });
    expect(contentChunk).toBeDefined();
    const delta = ((contentChunk as Record<string, unknown>)?.choices as Array<Record<string, unknown>>)?.[0]?.delta as Record<string, unknown>;
    expect(delta?.content).toBe("Hello world");
  });

  it("converts function_call to tool_calls delta", async () => {
    const t = new ResponsesToChatBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(respSSE("response.output_item.added", {
      type: "response.output_item.added", output_index: 0,
      item: { type: "function_call", id: "fc_1", call_id: "fc_1", name: "get_weather", arguments: "", status: "in_progress" },
    }));
    t.write(respSSE("response.function_call_arguments.delta", {
      type: "response.function_call_arguments.delta", output_index: 0, item_id: "fc_1", call_id: "fc_1", delta: '{"city":"NYC"}',
    }));
    t.write(respSSE("response.completed", {
      type: "response.completed",
      response: { id: "resp_1", object: "response", model: "gpt-4o", status: "completed", output: [], usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } },
    }));
    t.end();
    const result = await output;
    const chunks = parseOpenAIChunks(result);

    // Find tool_calls init chunk
    const tcChunk = chunks.find((c) => {
      const choices = c.choices as Array<Record<string, unknown>> | undefined;
      const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
      const tcs = delta?.tool_calls as Array<Record<string, unknown>> | undefined;
      return tcs?.some((tc) => tc.id != null) ?? false;
    });
    expect(tcChunk).toBeDefined();
    const tcDelta = ((tcChunk as Record<string, unknown>)?.choices as Array<Record<string, unknown>>)?.[0]?.delta as Record<string, unknown>;
    const tc = (tcDelta?.tool_calls as Array<Record<string, unknown>>)?.[0] as Record<string, unknown>;
    expect(tc?.id).toBe("fc_1");
    const fn = tc?.function as Record<string, unknown>;
    expect(fn?.name).toBe("get_weather");

    // Find arguments delta chunk
    const argsChunk = chunks.find((c) => {
      const choices = c.choices as Array<Record<string, unknown>> | undefined;
      const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
      const tcs = delta?.tool_calls as Array<Record<string, unknown>> | undefined;
      const tcFn = tcs?.[0]?.function as Record<string, unknown> | undefined;
      return tcFn?.arguments != null && tcFn.arguments !== "";
    });
    expect(argsChunk).toBeDefined();
    const argsDelta = ((argsChunk as Record<string, unknown>)?.choices as Array<Record<string, unknown>>)?.[0]?.delta as Record<string, unknown>;
    const argsFn = ((argsDelta?.tool_calls as Array<Record<string, unknown>>)?.[0]?.function as Record<string, unknown>);
    expect(argsFn?.arguments).toBe('{"city":"NYC"}');

    // finish_reason should be "tool_calls"
    const finishChunk = chunks.find((c) => {
      const choices = c.choices as Array<Record<string, unknown>> | undefined;
      return choices?.[0]?.finish_reason != null;
    });
    expect(finishChunk).toBeDefined();
    const finishChoice = ((finishChunk as Record<string, unknown>)?.choices as Array<Record<string, unknown>>)?.[0];
    expect(finishChoice?.finish_reason).toBe("tool_calls");
  });

  it("converts reasoning to reasoning_content delta", async () => {
    const t = new ResponsesToChatBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(respSSE("response.reasoning_summary_text.delta", {
      type: "response.reasoning_summary_text.delta", output_index: 0, summary_index: 0, delta: "Let me think about this...",
    }));
    t.write(respSSE("response.output_text.delta", {
      type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "The answer is 42",
    }));
    t.write(respSSE("response.completed", {
      type: "response.completed",
      response: { id: "resp_1", object: "response", model: "gpt-4o", status: "completed", output: [], usage: { input_tokens: 10, output_tokens: 30, total_tokens: 40 } },
    }));
    t.end();
    const result = await output;
    const chunks = parseOpenAIChunks(result);

    // Find reasoning chunk
    const reasoningChunk = chunks.find((c) => {
      const choices = c.choices as Array<Record<string, unknown>> | undefined;
      const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
      return delta?.reasoning_content != null;
    });
    expect(reasoningChunk).toBeDefined();
    const rDelta = ((reasoningChunk as Record<string, unknown>)?.choices as Array<Record<string, unknown>>)?.[0]?.delta as Record<string, unknown>;
    expect(rDelta?.reasoning_content).toBe("Let me think about this...");

    // Find content chunk
    const contentChunk = chunks.find((c) => {
      const choices = c.choices as Array<Record<string, unknown>> | undefined;
      const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
      return delta?.content === "The answer is 42";
    });
    expect(contentChunk).toBeDefined();
  });

  it("emits finish_reason + usage + [DONE] on response.completed", async () => {
    const t = new ResponsesToChatBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(respSSE("response.output_text.delta", {
      type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "Hi",
    }));
    t.write(respSSE("response.completed", {
      type: "response.completed",
      response: { id: "resp_1", object: "response", model: "gpt-4o", status: "completed", output: [], usage: { input_tokens: 42, output_tokens: 7, total_tokens: 49 } },
    }));
    t.end();
    const result = await output;

    // Should contain [DONE]
    expect(result).toContain("[DONE]");

    const chunks = parseOpenAIChunks(result);

    // Should have finish_reason: "stop"
    const finishChunk = chunks.find((c) => {
      const choices = c.choices as Array<Record<string, unknown>> | undefined;
      return choices?.[0]?.finish_reason != null;
    });
    expect(finishChunk).toBeDefined();
    const finishChoice = ((finishChunk as Record<string, unknown>)?.choices as Array<Record<string, unknown>>)?.[0];
    expect(finishChoice?.finish_reason).toBe("stop");

    // Should have usage chunk
    const usageChunk = chunks.find((c) => (c as Record<string, unknown>)?.usage != null);
    expect(usageChunk).toBeDefined();
    const usage = (usageChunk as Record<string, unknown>)?.usage as Record<string, number>;
    expect(usage?.prompt_tokens).toBe(42);
    expect(usage?.completion_tokens).toBe(7);
    expect(usage?.total_tokens).toBe(49);
  });

  it("emits finish_reason: length on response.incomplete", async () => {
    const t = new ResponsesToChatBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(respSSE("response.output_text.delta", {
      type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "Partial",
    }));
    t.write(respSSE("response.incomplete", {
      type: "response.incomplete",
      response: { id: "resp_1", object: "response", model: "gpt-4o", status: "incomplete", output: [], usage: { input_tokens: 10, output_tokens: 100, total_tokens: 110 } },
    }));
    t.end();
    const result = await output;
    const chunks = parseOpenAIChunks(result);
    const finishChunk = chunks.find((c) => {
      const choices = c.choices as Array<Record<string, unknown>> | undefined;
      return choices?.[0]?.finish_reason != null;
    });
    expect(finishChunk).toBeDefined();
    const finishChoice = ((finishChunk as Record<string, unknown>)?.choices as Array<Record<string, unknown>>)?.[0];
    expect(finishChoice?.finish_reason).toBe("length");
  });

  it("handles error events", async () => {
    const t = new ResponsesToChatBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(respSSE("response.failed", {
      type: "response.failed",
      response: { id: "resp_1", object: "response", model: "gpt-4o", status: "failed", error: { code: "server_error", message: "Internal error" } },
    }));
    t.end();
    const result = await output;
    const chunks = parseOpenAIChunks(result);
    const errorChunk = chunks.find((c) => (c as Record<string, unknown>)?.error != null);
    expect(errorChunk).toBeDefined();
    const error = (errorChunk as Record<string, unknown>)?.error as Record<string, string>;
    expect(error?.message).toBe("Internal error");
  });

  it("skips non-mappable events", async () => {
    const t = new ResponsesToChatBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    t.write(respSSE("response.output_item.added", {
      type: "response.output_item.added", output_index: 0,
      item: { type: "message", id: "msg_1", role: "assistant", content: [], status: "in_progress" },
    }));
    t.write(respSSE("response.content_part.added", {
      type: "response.content_part.added", output_index: 0, content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    }));
    t.write(respSSE("response.output_text.delta", {
      type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "Hello",
    }));
    t.write(respSSE("response.output_text.done", {
      type: "response.output_text.done", output_index: 0, content_index: 0, text: "Hello",
    }));
    t.write(respSSE("response.content_part.done", {
      type: "response.content_part.done", output_index: 0, content_index: 0,
      part: { type: "output_text", text: "Hello", annotations: [] },
    }));
    t.write(respSSE("response.output_item.done", {
      type: "response.output_item.done", output_index: 0,
      item: { type: "message", id: "msg_1", role: "assistant", content: [{ type: "output_text", text: "Hello" }], status: "completed" },
    }));
    t.write(respSSE("response.completed", {
      type: "response.completed",
      response: { id: "resp_1", object: "response", model: "gpt-4o", status: "completed", output: [], usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } },
    }));
    t.end();
    const result = await output;
    const chunks = parseOpenAIChunks(result);

    // Only relevant chunks: role, content delta, finish_reason, usage
    const contentChunks = chunks.filter((c) => {
      const choices = c.choices as Array<Record<string, unknown>> | undefined;
      const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
      return delta?.content != null;
    });
    expect(contentChunks.length).toBe(1);
  });

  it("handles multiple tool calls", async () => {
    const t = new ResponsesToChatBridgeTransform("gpt-4o");
    const output = collectOutput(t);
    // First function call
    t.write(respSSE("response.output_item.added", {
      type: "response.output_item.added", output_index: 0,
      item: { type: "function_call", id: "fc_1", call_id: "fc_1", name: "get_weather", arguments: "", status: "in_progress" },
    }));
    t.write(respSSE("response.function_call_arguments.delta", {
      type: "response.function_call_arguments.delta", output_index: 0, item_id: "fc_1", call_id: "fc_1", delta: '{"city":"NYC"}',
    }));
    // Second function call
    t.write(respSSE("response.output_item.added", {
      type: "response.output_item.added", output_index: 1,
      item: { type: "function_call", id: "fc_2", call_id: "fc_2", name: "get_time", arguments: "", status: "in_progress" },
    }));
    t.write(respSSE("response.function_call_arguments.delta", {
      type: "response.function_call_arguments.delta", output_index: 1, item_id: "fc_2", call_id: "fc_2", delta: '{"tz":"EST"}',
    }));
    t.write(respSSE("response.completed", {
      type: "response.completed",
      response: { id: "resp_1", object: "response", model: "gpt-4o", status: "completed", output: [], usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } },
    }));
    t.end();
    const result = await output;
    const chunks = parseOpenAIChunks(result);

    // Find tool_calls init chunks
    const tcInitChunks = chunks.filter((c) => {
      const choices = c.choices as Array<Record<string, unknown>> | undefined;
      const delta = choices?.[0]?.delta as Record<string, unknown> | undefined;
      const tcs = delta?.tool_calls as Array<Record<string, unknown>> | undefined;
      return tcs?.some((tc) => tc.id != null) ?? false;
    });
    expect(tcInitChunks.length).toBe(2);

    // Verify indices
    const tc0 = ((tcInitChunks[0] as Record<string, unknown>)?.choices as Array<Record<string, unknown>>)?.[0]?.delta as Record<string, unknown>;
    const tc0Data = (tc0?.tool_calls as Array<Record<string, unknown>>)?.[0] as Record<string, unknown>;
    expect(tc0Data?.index).toBe(0);
    expect((tc0Data?.function as Record<string, unknown>)?.name).toBe("get_weather");

    const tc1 = ((tcInitChunks[1] as Record<string, unknown>)?.choices as Array<Record<string, unknown>>)?.[0]?.delta as Record<string, unknown>;
    const tc1Data = (tc1?.tool_calls as Array<Record<string, unknown>>)?.[0] as Record<string, unknown>;
    expect(tc1Data?.index).toBe(1);
    expect((tc1Data?.function as Record<string, unknown>)?.name).toBe("get_time");
  });
});
