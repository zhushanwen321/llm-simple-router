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
