import { describe, it, expect } from "vitest";
import { AnthropicToResponsesTransform } from "../../../src/proxy/transform/stream-ant2resp.js";
import { RESPONSES_SSE_EVENTS } from "../../../src/proxy/transform/types-responses.js";

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
    if (eventType === "" || !dataStr) continue;
    try {
      results.push({ event: eventType, data: JSON.parse(dataStr) });
    } catch {
      // skip unparseable
    }
  }
  return results;
}

describe("AnthropicToResponsesTransform", () => {
  it("emits response.created and response.in_progress on message_start", async () => {
    const t = new AnthropicToResponsesTransform("claude-3");
    const output = collectOutput(t);
    t.write('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","role":"assistant","content":[],"usage":{"input_tokens":10}}}\n\n');
    t.write('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n');
    t.write('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n');
    t.write('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n');
    t.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);
    const eventTypes = events.map((e) => e.event);
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.CREATED);
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.IN_PROGRESS);
    const created = events.find((e) => e.event === RESPONSES_SSE_EVENTS.CREATED);
    expect((created?.data as Record<string, unknown>)?.response).toBeDefined();
  });

  it("converts text delta flow", async () => {
    const t = new AnthropicToResponsesTransform("claude-3");
    const output = collectOutput(t);
    t.write('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","role":"assistant","content":[],"usage":{"input_tokens":10}}}\n\n');
    t.write('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n');
    t.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n');
    t.write('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n');
    t.write('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n');
    t.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
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

    // Should emit output_text.delta
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.OUTPUT_TEXT_DELTA);
    const textDelta = events.find((e) => e.event === RESPONSES_SSE_EVENTS.OUTPUT_TEXT_DELTA);
    expect((textDelta?.data as Record<string, unknown>)?.delta).toBe("Hello");

    // Should emit output_text.done, content_part.done, output_item.done
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.OUTPUT_TEXT_DONE);
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.CONTENT_PART_DONE);
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.OUTPUT_ITEM_DONE);

    // Should emit response.completed
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.COMPLETED);
  });

  it("converts tool_use flow to function_call events", async () => {
    const t = new AnthropicToResponsesTransform("claude-3");
    const output = collectOutput(t);
    t.write('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_2","role":"assistant","content":[],"usage":{"input_tokens":10}}}\n\n');
    t.write('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_abc123","name":"get_weather","input":{}}}\n\n');
    t.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":\\"NYC\\"}"}}\n\n');
    t.write('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n');
    t.write('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":20}}\n\n');
    t.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);
    const eventTypes = events.map((e) => e.event);

    // Should emit output_item.added with function_call type
    const itemAdded = events.find((e) => e.event === RESPONSES_SSE_EVENTS.OUTPUT_ITEM_ADDED);
    const item = (itemAdded?.data as Record<string, unknown>)?.item as Record<string, unknown>;
    expect(item?.type).toBe("function_call");
    expect(item?.call_id).toContain("fc_");
    expect(item?.name).toBe("get_weather");

    // Should emit function_call_arguments.delta
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.FUNCTION_CALL_ARGUMENTS_DELTA);
    const argsDelta = events.find((e) => e.event === RESPONSES_SSE_EVENTS.FUNCTION_CALL_ARGUMENTS_DELTA);
    expect((argsDelta?.data as Record<string, unknown>)?.delta).toBe('{"city":"NYC"}');

    // Should emit function_call_arguments.done
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.FUNCTION_CALL_ARGUMENTS_DONE);

    // Should emit output_item.done
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.OUTPUT_ITEM_DONE);

    // response.completed should have status "completed"
    const completed = events.find((e) => e.event === RESPONSES_SSE_EVENTS.COMPLETED);
    const resp = (completed?.data as Record<string, unknown>)?.response as Record<string, unknown>;
    expect(resp?.status).toBe("completed");
  });

  it("converts thinking flow to reasoning events", async () => {
    const t = new AnthropicToResponsesTransform("claude-3");
    const output = collectOutput(t);
    t.write('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_3","role":"assistant","content":[],"usage":{"input_tokens":10}}}\n\n');
    t.write('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n');
    t.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Let me think..."}}\n\n');
    t.write('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n');
    t.write('event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}\n\n');
    t.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"The answer is 42"}}\n\n');
    t.write('event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n');
    t.write('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":15}}\n\n');
    t.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);
    const eventTypes = events.map((e) => e.event);

    // Reasoning events
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.REASONING_SUMMARY_PART_ADDED);
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.REASONING_SUMMARY_TEXT_DELTA);
    const reasoningDelta = events.find((e) => e.event === RESPONSES_SSE_EVENTS.REASONING_SUMMARY_TEXT_DELTA);
    expect((reasoningDelta?.data as Record<string, unknown>)?.delta).toBe("Let me think...");
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.REASONING_SUMMARY_TEXT_DONE);
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.REASONING_SUMMARY_PART_DONE);

    // Text events
    expect(eventTypes).toContain(RESPONSES_SSE_EVENTS.OUTPUT_TEXT_DELTA);
    const textDelta = events.find((e) => e.event === RESPONSES_SSE_EVENTS.OUTPUT_TEXT_DELTA);
    expect((textDelta?.data as Record<string, unknown>)?.delta).toBe("The answer is 42");

    // Should have two output_item.done events (reasoning + message)
    const itemDoneEvents = events.filter((e) => e.event === RESPONSES_SSE_EVENTS.OUTPUT_ITEM_DONE);
    expect(itemDoneEvents.length).toBe(2);
  });

  it("maps max_tokens stop_reason to incomplete status", async () => {
    const t = new AnthropicToResponsesTransform("claude-3");
    const output = collectOutput(t);
    t.write('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_4","role":"assistant","content":[],"usage":{"input_tokens":10}}}\n\n');
    t.write('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n');
    t.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Partial..."}}\n\n');
    t.write('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n');
    t.write('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":100}}\n\n');
    t.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);
    const completed = events.find((e) => e.event === RESPONSES_SSE_EVENTS.COMPLETED);
    const resp = (completed?.data as Record<string, unknown>)?.response as Record<string, unknown>;
    expect(resp?.status).toBe("incomplete");
  });

  it("includes usage in response.completed", async () => {
    const t = new AnthropicToResponsesTransform("claude-3");
    const output = collectOutput(t);
    t.write('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_5","role":"assistant","content":[],"usage":{"input_tokens":42}}}\n\n');
    t.write('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n');
    t.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n');
    t.write('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n');
    t.write('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}\n\n');
    t.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);
    const completed = events.find((e) => e.event === RESPONSES_SSE_EVENTS.COMPLETED);
    const resp = (completed?.data as Record<string, unknown>)?.response as Record<string, unknown>;
    const usage = resp?.usage as Record<string, unknown>;
    expect(usage?.input_tokens).toBe(42);
    expect(usage?.output_tokens).toBe(7);
    expect(usage?.total_tokens).toBe(49);
  });

  it("increments sequence_number monotonically", async () => {
    const t = new AnthropicToResponsesTransform("claude-3");
    const output = collectOutput(t);
    t.write('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_6","role":"assistant","content":[],"usage":{"input_tokens":5}}}\n\n');
    t.write('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n');
    t.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n');
    t.write('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n');
    t.write('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n');
    t.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);
    const seqNums = events.map((e) => (e.data as Record<string, unknown>)?.sequence_number as number);
    // Check monotonically increasing
    for (let i = 1; i < seqNums.length; i++) {
      expect(seqNums[i]).toBeGreaterThan(seqNums[i - 1]);
    }
  });

  it("ignores ping events", async () => {
    const t = new AnthropicToResponsesTransform("claude-3");
    const output = collectOutput(t);
    t.write('event: ping\ndata: {"type":"ping"}\n\n');
    t.write('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_7","role":"assistant","content":[],"usage":{"input_tokens":5}}}\n\n');
    t.write('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n');
    t.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n');
    t.write('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n');
    t.write('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n');
    t.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    t.end();
    const result = await output;
    expect(result).not.toContain("ping");
    expect(result).toContain(RESPONSES_SSE_EVENTS.COMPLETED);
  });

  it("handles error events", async () => {
    const t = new AnthropicToResponsesTransform("claude-3");
    const output = collectOutput(t);
    t.write('event: error\ndata: {"type":"error","error":{"type":"invalid_request_error","message":"Bad request"}}\n\n');
    t.end();
    const result = await output;
    expect(result).toContain(RESPONSES_SSE_EVENTS.ERROR);
    expect(result).toContain('"message":"Bad request"');
    expect(result).toContain("[DONE]");
  });

  it("handles full flow with mixed content types", async () => {
    const t = new AnthropicToResponsesTransform("claude-3");
    const output = collectOutput(t);
    // message_start
    t.write('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_8","role":"assistant","content":[],"usage":{"input_tokens":100}}}\n\n');
    // thinking block
    t.write('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n');
    t.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Hmm..."}}\n\n');
    t.write('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n');
    // text block
    t.write('event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}\n\n');
    t.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Here is the answer."}}\n\n');
    t.write('event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n');
    // tool_use block
    t.write('event: content_block_start\ndata: {"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"toolu_xyz","name":"search","input":{}}}\n\n');
    t.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\\"q\\":\\"test\\"}"}}\n\n');
    t.write('event: content_block_stop\ndata: {"type":"content_block_stop","index":2}\n\n');
    // end
    t.write('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":50}}\n\n');
    t.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    t.end();
    const result = await output;
    const events = parseSSEEvents(result);
    const eventTypes = events.map((e) => e.event);

    // Should have 3 output_item.added (reasoning, message, function_call)
    const itemAddedEvents = events.filter((e) => e.event === RESPONSES_SSE_EVENTS.OUTPUT_ITEM_ADDED);
    expect(itemAddedEvents.length).toBe(3);

    // Should have 3 output_item.done
    const itemDoneEvents = events.filter((e) => e.event === RESPONSES_SSE_EVENTS.OUTPUT_ITEM_DONE);
    expect(itemDoneEvents.length).toBe(3);

    // Verify each type appeared
    const addedTypes = itemAddedEvents.map((e) => {
      const item = ((e.data as Record<string, unknown>)?.item as Record<string, unknown>)?.type;
      return item;
    });
    expect(addedTypes).toContain("reasoning");
    expect(addedTypes).toContain("message");
    expect(addedTypes).toContain("function_call");

    // Completed with tool_use → status "completed"
    const completed = events.find((e) => e.event === RESPONSES_SSE_EVENTS.COMPLETED);
    const resp = (completed?.data as Record<string, unknown>)?.response as Record<string, unknown>;
    expect(resp?.status).toBe("completed");
    expect((resp?.output as unknown[])?.length).toBe(3);
  });
});
