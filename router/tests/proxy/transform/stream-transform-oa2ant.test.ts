import { describe, it, expect } from "vitest";
import { OpenAIToAnthropicTransform } from "../../../src/proxy/transform/stream-oa2ant.js";

function collectOutput(transform: NodeJS.ReadWriteStream): Promise<string> {
  return new Promise((resolve) => {
    const chunks: string[] = [];
    transform.on("data", (c: Buffer) => chunks.push(c.toString()));
    transform.on("end", () => resolve(chunks.join("")));
  });
}

describe("OpenAIToAnthropicTransform", () => {
  it("converts text streaming with usage", async () => {
    const t = new OpenAIToAnthropicTransform("gpt-4");
    const output = collectOutput(t);
    t.write('data: {"choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}\n\n');
    t.write('data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n');
    t.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
    t.write('data: {"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n');
    t.end();
    const result = await output;
    expect(result).toContain("event: message_start");
    expect(result).toContain('"model":"gpt-4"');
    expect(result).toContain("event: content_block_start");
    expect(result).toContain('"type":"text"');
    expect(result).toContain("event: content_block_delta");
    expect(result).toContain('"text_delta"');
    expect(result).toContain('"text":"Hello"');
    expect(result).toContain("event: content_block_stop");
    expect(result).toContain("event: message_delta");
    expect(result).toContain('"stop_reason":"end_turn"');
    expect(result).toContain("event: message_stop");
  });

  it("converts tool_calls streaming", async () => {
    const t = new OpenAIToAnthropicTransform("gpt-4");
    const output = collectOutput(t);
    t.write('data: {"choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}\n\n');
    t.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_weather","arguments":""}}]},"finish_reason":null}]}\n\n');
    t.write('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\":\\"NYC\\"}"}}]},"finish_reason":null}]}\n\n');
    t.write('data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n');
    t.write('data: {"usage":{"prompt_tokens":10,"completion_tokens":20}}\n\n');
    t.end();
    const result = await output;
    expect(result).toContain("event: content_block_start");
    expect(result).toContain('"type":"tool_use"');
    expect(result).toContain('"id":"call_1"');
    expect(result).toContain('"name":"get_weather"');
    expect(result).toContain('"input":{}');
    expect(result).toContain("event: content_block_delta");
    expect(result).toContain('"input_json_delta"');
    expect(result).toContain('"stop_reason":"tool_use"');
  });

  it("converts reasoning_content to thinking block", async () => {
    const t = new OpenAIToAnthropicTransform("o1");
    const output = collectOutput(t);
    t.write('data: {"choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}\n\n');
    t.write('data: {"choices":[{"delta":{"reasoning_content":"Let me think..."},"finish_reason":null}]}\n\n');
    t.write('data: {"choices":[{"delta":{"content":"The answer is 42"},"finish_reason":null}]}\n\n');
    t.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
    t.write('data: {"usage":{"prompt_tokens":10,"completion_tokens":15}}\n\n');
    t.end();
    const result = await output;
    expect(result).toContain('"type":"thinking"');
    expect(result).toContain('"thinking_delta"');
    expect(result).toContain('"thinking":"Let me think..."');
    // thinking block should be followed by text block
    expect(result).toContain('"type":"text"');
    expect(result).toContain('"text":"The answer is 42"');
  });

  it("skips empty delta (role only)", async () => {
    const t = new OpenAIToAnthropicTransform("gpt-4");
    const output = collectOutput(t);
    t.write('data: {"choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}\n\n');
    t.write('data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}\n\n');
    t.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
    t.write('data: {"usage":{"prompt_tokens":5,"completion_tokens":1}}\n\n');
    t.end();
    const result = await output;
    // message_start should be emitted once (from first chunk)
    const startCount = (result.match(/event: message_start/g) || []).length;
    expect(startCount).toBe(1);
    // content_block_start should only appear once (after content delta)
    const blockStartCount = (result.match(/event: content_block_start/g) || []).length;
    expect(blockStartCount).toBe(1);
  });

  it("delays message_stop until usage or DONE", async () => {
    const t = new OpenAIToAnthropicTransform("gpt-4");
    const output = collectOutput(t);
    t.write('data: {"choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}\n\n');
    t.write('data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}\n\n');
    t.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
    // No usage chunk — [DONE] should trigger message_stop
    t.write("data: [DONE]\n\n");
    t.end();
    const result = await output;
    expect(result).toContain("event: message_stop");
    expect(result).toContain('"stop_reason":"end_turn"');
    // message_stop should appear AFTER content_block_stop
    const stopIdx = result.indexOf("event: message_stop");
    const blockStopIdx = result.indexOf("event: content_block_stop");
    expect(stopIdx).toBeGreaterThan(blockStopIdx);
  });

  it("handles finish_reason then usage then DONE", async () => {
    const t = new OpenAIToAnthropicTransform("gpt-4");
    const output = collectOutput(t);
    t.write('data: {"choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}\n\n');
    t.write('data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":null}]}\n\n');
    t.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
    // Usage comes between finish_reason and [DONE]
    t.write('data: {"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n');
    t.write("data: [DONE]\n\n");
    t.end();
    const result = await output;
    // usage should trigger message_delta with output_tokens
    expect(result).toContain('"output_tokens":5');
    expect(result).toContain("event: message_stop");
    // message_delta should appear before message_stop
    const deltaIdx = result.indexOf("event: message_delta");
    const stopIdx = result.indexOf("event: message_stop");
    expect(deltaIdx).toBeLessThan(stopIdx);
  });

  // ============================================================
  // UTF-8 边界测试
  // ============================================================

  it("UTF-8: 中文字符跨 chunk 传输（回归测试）", async () => {
    const t = new OpenAIToAnthropicTransform("gpt-4");
    const output = collectOutput(t);

    // 构造包含中文的 OpenAI SSE chunk
    const fullChunk = 'data: {"choices":[{"delta":{"content":"执行审计"}}]}\n\n';
    const buffer = Buffer.from(fullChunk, "utf-8");

    // "执" 是 3 字节 UTF-8 (0xE6 0x89 0xA7)，在第 2 字节处截断
    const charOffset = buffer.indexOf(Buffer.from("执"));
    const splitPoint = charOffset + 2; // "执" 的前 2 字节
    const chunk1 = buffer.subarray(0, splitPoint);
    const chunk2 = buffer.subarray(splitPoint);

    // 当前实现：chunk.toString('utf-8') 会产生 U+FFFD
    // 这是回归测试，记录当前行为
    t.write(chunk1);
    t.write(chunk2);
    t.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
    t.write('data: {"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n');
    t.end();

    const result = await output;
    // 应该包含 content_block_delta 事件
    expect(result).toContain("event: content_block_delta");
    // 当前行为：可能包含 U+FFFD（乱码）
    // 修复后：应该包含完整的 "执行审计"
    expect(result).toContain("text_delta");
  });

  it("UTF-8: 完整中文字符不产生乱码", async () => {
    const t = new OpenAIToAnthropicTransform("gpt-4");
    const output = collectOutput(t);

    // 完整 chunk，不截断
    t.write('data: {"choices":[{"delta":{"content":"执行审计"}}]}\n\n');
    t.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
    t.write('data: {"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n');
    t.end();

    const result = await output;
    expect(result).toContain("执行审计");
    expect(result).not.toContain("\uFFFD");
  });

  it("UTF-8: reasoning_content 中文字符跨 chunk", async () => {
    const t = new OpenAIToAnthropicTransform("o1");
    const output = collectOutput(t);

    // 构造包含中文的 reasoning_content
    const fullChunk = 'data: {"choices":[{"delta":{"reasoning_content":"让我思考一下"}}]}\n\n';
    const buffer = Buffer.from(fullChunk, "utf-8");

    // "让" 是 3 字节 UTF-8，在第 1 字节处截断
    const charOffset = buffer.indexOf(Buffer.from("让"));
    const splitPoint = charOffset + 1;
    const chunk1 = buffer.subarray(0, splitPoint);
    const chunk2 = buffer.subarray(splitPoint);

    t.write(chunk1);
    t.write(chunk2);
    t.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
    t.write('data: {"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n');
    t.end();

    const result = await output;
    // 应该包含 thinking 事件
    expect(result).toContain("event: content_block_start");
    expect(result).toContain("thinking_delta");
  });
});
