import { describe, it, expect } from "vitest";
import { AnthropicToOpenAITransform } from "../../../src/proxy/transform/stream-ant2oa.js";

function collectOutput(transform: NodeJS.ReadWriteStream): Promise<string> {
  return new Promise((resolve) => {
    const chunks: string[] = [];
    transform.on("data", (c: Buffer) => chunks.push(c.toString()));
    transform.on("end", () => resolve(chunks.join("")));
  });
}

describe("AnthropicToOpenAITransform", () => {
  it("converts text streaming", async () => {
    const t = new AnthropicToOpenAITransform("claude-3");
    const output = collectOutput(t);
    t.write('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","role":"assistant","content":[],"usage":{"input_tokens":10}}}\n\n');
    t.write('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n');
    t.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n');
    t.write('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n');
    t.write('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n');
    t.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    t.end();
    const result = await output;
    expect(result).toContain('"role":"assistant"');
    expect(result).toContain('"content":"Hello"');
    expect(result).toContain('"finish_reason":"stop"');
    expect(result).toContain('"prompt_tokens":10');
    expect(result).toContain('"completion_tokens":5');
    expect(result).toContain("[DONE]");
  });

  it("converts tool_use to tool_calls", async () => {
    const t = new AnthropicToOpenAITransform("claude-3");
    const output = collectOutput(t);
    t.write('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_2","role":"assistant","content":[],"usage":{"input_tokens":10}}}\n\n');
    t.write('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"get_weather","input":{}}}\n\n');
    t.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":\\"NYC\\"}"}}\n\n');
    t.write('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n');
    t.write('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":20}}\n\n');
    t.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    t.end();
    const result = await output;
    expect(result).toContain('"tool_calls"');
    expect(result).toContain('"id":"toolu_1"');
    expect(result).toContain('"name":"get_weather"');
    expect(result).toContain('"arguments":"{\\"city\\":\\"NYC\\"}"');
    expect(result).toContain('"finish_reason":"tool_calls"');
  });

  it("converts thinking_delta to reasoning_content", async () => {
    const t = new AnthropicToOpenAITransform("claude-3");
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
    expect(result).toContain('"reasoning_content":"Let me think..."');
    expect(result).toContain('"content":"The answer is 42"');
  });

  it("ignores ping events", async () => {
    const t = new AnthropicToOpenAITransform("claude-3");
    const output = collectOutput(t);
    t.write('event: ping\ndata: {"type":"ping"}\n\n');
    t.write('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_4","role":"assistant","content":[],"usage":{"input_tokens":5}}}\n\n');
    t.write('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n');
    t.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n');
    t.write('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n');
    t.write('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n');
    t.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    t.end();
    const result = await output;
    expect(result).toContain('"content":"Hi"');
    expect(result).not.toContain("ping");
  });

  it("converts error events", async () => {
    const t = new AnthropicToOpenAITransform("claude-3");
    const output = collectOutput(t);
    t.write('event: error\ndata: {"type":"error","error":{"type":"invalid_request_error","message":"Bad request"}}\n\n');
    t.end();
    const result = await output;
    expect(result).toContain('"error"');
    expect(result).toContain('"message":"Bad request"');
    expect(result).toContain("[DONE]");
  });

  it("handles multiple tool_calls", async () => {
    const t = new AnthropicToOpenAITransform("claude-3");
    const output = collectOutput(t);
    t.write('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_5","role":"assistant","content":[],"usage":{"input_tokens":10}}}\n\n');
    // tool_use 1
    t.write('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"fn1","input":{}}}\n\n');
    t.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{}"}}\n\n');
    t.write('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n');
    // tool_use 2
    t.write('event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_2","name":"fn2","input":{}}}\n\n');
    t.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{}"}}\n\n');
    t.write('event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n');
    t.write('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":30}}\n\n');
    t.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    t.end();
    const result = await output;
    expect(result).toContain('"id":"toolu_1"');
    expect(result).toContain('"id":"toolu_2"');
    expect(result).toContain('"name":"fn1"');
    expect(result).toContain('"name":"fn2"');
  });

  it("emits message_meta with thinking signature", async () => {
    const t = new AnthropicToOpenAITransform("claude-3");
    const output = collectOutput(t);
    t.write('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_6","role":"assistant","content":[],"usage":{"input_tokens":10}}}\n\n');
    t.write('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":"sig_abc"}}\n\n');
    t.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"hmm"}}\n\n');
    t.write('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n');
    t.write('event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}\n\n');
    t.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"answer"}}\n\n');
    t.write('event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n');
    t.write('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n');
    t.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    t.end();
    const result = await output;
    expect(result).toContain("event: message_meta");
    expect(result).toContain('"thinking_signatures"');
    expect(result).toContain('"signature":"sig_abc"');
  });

  it("emits message_meta with cache usage", async () => {
    const t = new AnthropicToOpenAITransform("claude-3");
    const output = collectOutput(t);
    t.write('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_7","role":"assistant","content":[],"usage":{"input_tokens":10,"cache_read_input_tokens":100,"cache_creation_input_tokens":50}}}\n\n');
    t.write('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n');
    t.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n');
    t.write('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n');
    t.write('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n');
    t.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    t.end();
    const result = await output;
    expect(result).toContain("event: message_meta");
    expect(result).toContain('"cache_read_input_tokens":100');
    expect(result).toContain('"cache_creation_input_tokens":50');
  });

  it("no message_meta when no PSF present", async () => {
    const t = new AnthropicToOpenAITransform("claude-3");
    const output = collectOutput(t);
    t.write('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_8","role":"assistant","content":[],"usage":{"input_tokens":10}}}\n\n');
    t.write('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n');
    t.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n');
    t.write('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n');
    t.write('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n');
    t.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
    t.end();
    const result = await output;
    expect(result).not.toContain("event: message_meta");
  });
});
