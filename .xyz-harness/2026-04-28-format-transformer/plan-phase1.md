# Phase 1: 核心转换能力 实现计划

> TDD 流程：写测试 → 验证失败 → 实现 → 验证通过 → 提交

---

## Task 1: 类型定义

**Files:**
- Create: `src/proxy/transform/types.ts`

- [ ] **Step 1: 创建类型文件**

```typescript
export type TransformDirection = "openai-to-anthropic" | "anthropic-to-openai";

export interface AnthropicTextBlock { type: "text"; text: string; }
export interface AnthropicThinkingBlock { type: "thinking"; thinking: string; }
export interface AnthropicToolUseBlock { type: "tool_use"; id: string; name: string; input: Record<string, unknown>; }
export interface AnthropicToolResultBlock { type: "tool_result"; tool_use_id: string; content: string; }
export type AnthropicContentBlock = AnthropicTextBlock | AnthropicThinkingBlock | AnthropicToolUseBlock | AnthropicToolResultBlock;

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface TransformResult {
  body: Record<string, unknown>;
  upstreamPath: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/proxy/transform/types.ts
git commit -m "feat(transform): add type definitions for format conversion"
```

---

## Task 2: Stop reason 映射

**Files:**
- Create: `src/proxy/transform/usage-mapper.ts`
- Create: `tests/proxy/transform/usage-mapper.test.ts`

- [ ] **Step 1: 写测试**

```typescript
import { describe, it, expect } from "vitest";
import { mapFinishReasonToStopReason, mapStopReasonToFinishReason } from "../../../src/proxy/transform/usage-mapper.js";

describe("stop reason mapping", () => {
  it("OA→Ant: stop → end_turn", () => {
    expect(mapFinishReasonToStopReason("stop")).toBe("end_turn");
  });
  it("OA→Ant: length → max_tokens", () => {
    expect(mapFinishReasonToStopReason("length")).toBe("max_tokens");
  });
  it("OA→Ant: tool_calls → tool_use", () => {
    expect(mapFinishReasonToStopReason("tool_calls")).toBe("tool_use");
  });
  it("OA→Ant: unknown → end_turn", () => {
    expect(mapFinishReasonToStopReason("content_filter")).toBe("end_turn");
  });
  it("Ant→OA: end_turn → stop", () => {
    expect(mapStopReasonToFinishReason("end_turn")).toBe("stop");
  });
  it("Ant→OA: max_tokens → length", () => {
    expect(mapStopReasonToFinishReason("max_tokens")).toBe("length");
  });
  it("Ant→OA: stop_sequence → stop", () => {
    expect(mapStopReasonToFinishReason("stop_sequence")).toBe("stop");
  });
  it("Ant→OA: tool_use → tool_calls", () => {
    expect(mapStopReasonToFinishReason("tool_use")).toBe("tool_calls");
  });
  it("Ant→OA: unknown → stop", () => {
    expect(mapStopReasonToFinishReason("unknown")).toBe("stop");
  });
});
```

- [ ] **Step 2: 运行验证失败** `npx vitest run tests/proxy/transform/usage-mapper.test.ts`

- [ ] **Step 3: 实现**

```typescript
const OA_TO_ANT_STOP: Record<string, string> = {
  stop: "end_turn", length: "max_tokens", tool_calls: "tool_use",
};
const ANT_TO_OA_STOP: Record<string, string> = {
  end_turn: "stop", max_tokens: "length", stop_sequence: "stop", tool_use: "tool_calls",
};

export function mapFinishReasonToStopReason(reason: string): string {
  return OA_TO_ANT_STOP[reason] ?? "end_turn";
}

export function mapStopReasonToFinishReason(reason: string): string {
  return ANT_TO_OA_STOP[reason] ?? "stop";
}
```

- [ ] **Step 4: 运行验证通过** `npx vitest run tests/proxy/transform/usage-mapper.test.ts`

- [ ] **Step 5: Commit** `git commit -m "feat(transform): add stop reason mapping"`

---

## Task 3: Usage 映射

**Files:**
- Modify: `src/proxy/transform/usage-mapper.ts`
- Modify: `tests/proxy/transform/usage-mapper.test.ts`

- [ ] **Step 1: 追加测试**

```typescript
describe("usage mapping", () => {
  it("OA→Ant: maps prompt/completion tokens", () => {
    const result = mapUsageOA2Ant({ prompt_tokens: 10, completion_tokens: 20 });
    expect(result).toEqual({ input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
  });
  it("OA→Ant: maps cached tokens", () => {
    const result = mapUsageOA2Ant({ prompt_tokens: 10, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 5 } });
    expect(result.cache_read_input_tokens).toBe(5);
  });
  it("OA→Ant: undefined usage returns zeros", () => {
    const result = mapUsageOA2Ant(undefined);
    expect(result).toEqual({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
  });
  it("Ant→OA: maps input/output tokens", () => {
    const result = mapUsageAnt2OA({ input_tokens: 10, output_tokens: 20 });
    expect(result.prompt_tokens).toBe(10);
    expect(result.completion_tokens).toBe(20);
    expect(result.total_tokens).toBe(30);
  });
  it("Ant→OA: includes cache in prompt_tokens", () => {
    const result = mapUsageAnt2OA({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3 });
    expect(result.prompt_tokens).toBe(13);
  });
});
```

- [ ] **Step 2: 运行验证失败**

- [ ] **Step 3: 实现**

```typescript
export function mapUsageOA2Ant(u: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!u) return { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const details = u.prompt_tokens_details as Record<string, unknown> | undefined;
  return {
    input_tokens: u.prompt_tokens ?? 0,
    output_tokens: u.completion_tokens ?? 0,
    cache_read_input_tokens: details?.cached_tokens ?? 0,
    cache_creation_input_tokens: details?.cached_write_tokens ?? 0,
  };
}

export function mapUsageAnt2OA(u: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!u) return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const input = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  const output = u.output_tokens ?? 0;
  return { prompt_tokens: input, completion_tokens: output, total_tokens: input + output, prompt_tokens_details: { cached_tokens: u.cache_read_input_tokens ?? 0 } };
}
```

- [ ] **Step 4: 运行验证通过**

- [ ] **Step 5: Commit** `git commit -m "feat(transform): add usage mapping"`

---

## Task 4: Tool 映射

**Files:**
- Create: `src/proxy/transform/tool-mapper.ts`
- Create: `tests/proxy/transform/tool-mapper.test.ts`

- [ ] **Step 1: 写测试**

覆盖: OA工具定义→Ant, Ant→OA, tool_choice 双向, tool_choice "none"→undefined, parallel_tool_calls 映射

```typescript
describe("tool mapping", () => {
  it("converts OA tools to Ant format", () => {
    const tools = [{ type: "function", function: { name: "get_weather", description: "Get weather", parameters: { type: "object" } } }];
    const result = convertToolsOA2Ant(tools);
    expect(result[0]).toEqual({ name: "get_weather", description: "Get weather", input_schema: { type: "object" } });
  });
  it("converts Ant tools to OA format", () => {
    const tools = [{ name: "get_weather", description: "Get weather", input_schema: { type: "object" } }];
    const result = convertToolsAnt2OA(tools);
    expect(result[0]).toEqual({ type: "function", function: { name: "get_weather", description: "Get weather", parameters: { type: "object" } });
  });
  it("OA tool_choice 'none' returns undefined", () => {
    expect(mapToolChoiceOA2Ant("none")).toBeUndefined();
  });
  it("OA tool_choice 'required' → {type:'any'}", () => {
    expect(mapToolChoiceOA2Ant("required")).toEqual({ type: "any" });
  });
  it("Ant tool_choice {type:'any'} → 'required'", () => {
    expect(mapToolChoiceAnt2OA({ type: "any" })).toBe("required");
  });
});
```

- [ ] **Step 2-5: TDD 流程 + Commit** `git commit -m "feat(transform): add tool definition and tool_choice mapping"`

---

## Task 5: Thinking 映射

**Files:**
- Create: `src/proxy/transform/thinking-mapper.ts`
- Create: `tests/proxy/transform/thinking-mapper.test.ts`

- [ ] **Step 1: 写测试**

```typescript
describe("thinking mapping", () => {
  it("maps reasoning effort to thinking budget", () => {
    const result = mapReasoningToThinking({ effort: "high" });
    expect(result).toEqual({ type: "enabled", budget_tokens: 32768 });
  });
  it("max_tokens overrides effort budget", () => {
    const result = mapReasoningToThinking({ effort: "low", max_tokens: 5000 });
    expect(result.budget_tokens).toBe(5000);
  });
  it("maps thinking to reasoning", () => {
    const result = mapThinkingToReasoning({ type: "enabled", budget_tokens: 10000 });
    expect(result).toEqual({ max_tokens: 10000 });
  });
  it("returns undefined for disabled thinking", () => {
    expect(mapThinkingToReasoning({ type: "disabled" })).toBeUndefined();
  });
});
```

- [ ] **Step 2-5: TDD 流程 + Commit** `git commit -m "feat(transform): add thinking/reasoning mapping"`

---

## Task 6: 消息映射

**Files:**
- Create: `src/proxy/transform/message-mapper.ts`
- Create: `tests/proxy/transform/message-mapper.test.ts`

最复杂的模块。按函数分 describe 块。

- [ ] **Step 1: 写测试 - extractSystemMessages**

```typescript
describe("extractSystemMessages", () => {
  it("extracts system messages from front", () => {
    const msgs = [{ role: "system", content: "You are helpful" }, { role: "user", content: "Hi" }];
    const { systemParts, nonSystemMsgs } = extractSystemMessages(msgs);
    expect(systemParts).toEqual(["You are helpful"]);
    expect(nonSystemMsgs).toHaveLength(1);
  });
  it("extracts multiple system messages", () => {
    const msgs = [{ role: "system", content: "A" }, { role: "system", content: "B" }, { role: "user", content: "Hi" }];
    const { systemParts } = extractSystemMessages(msgs);
    expect(systemParts).toEqual(["A", "B"]);
  });
});
```

- [ ] **Step 2: 写测试 - convertMessagesOA2Ant**

覆盖: tool_calls→tool_use, 连续tool合并, assistant含text+tool_calls, 交替强制

```typescript
describe("convertMessagesOA2Ant", () => {
  it("converts assistant with text and tool_calls", () => {
    const msgs = [{ role: "assistant", content: "Let me check", tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: "{\"city\":\"NYC\"}" } }] }];
    const { messages } = convertMessagesOA2Ant(msgs);
    expect(messages[0].content).toEqual([
      { type: "text", text: "Let me check" },
      { type: "tool_use", id: "call_1", name: "get_weather", input: { city: "NYC" } },
    ]);
  });
  it("merges consecutive tool messages into single user message", () => {
    const msgs = [{ role: "tool", tool_call_id: "c1", content: "72F" }, { role: "tool", tool_call_id: "c2", content: "Sunny" }];
    const { messages } = convertMessagesOA2Ant(msgs);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toHaveLength(2);
  });
  it("enforces user/assistant alternation by merging", () => {
    const msgs = [{ role: "user", content: "A" }, { role: "user", content: "B" }];
    const { messages } = convertMessagesOA2Ant(msgs);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toHaveLength(2);
  });
});
```

- [ ] **Step 3: 写测试 - convertMessagesAnt2OA**

覆盖: system→role:"system", tool_use→tool_calls, tool_result→role:"tool"

- [ ] **Step 4: 运行验证失败**

- [ ] **Step 5: 实现**

核心函数:
- `extractSystemMessages(msgs)`: 过滤 role:"system"，返回 systemParts + nonSystemMsgs
- `convertMessagesOA2Ant(msgs)`: 提取 system → 遍历非 system 消息 → 归一化 content → tool 合并 → 交替强制
- `convertMessagesAnt2OA(system, msgs)`: system→unshift → 遍历 messages → 拆分 content blocks → tool_result→独立 tool 消息

- [ ] **Step 6: 运行验证通过**

- [ ] **Step 7: Commit** `git commit -m "feat(transform): add message mapping with tool merging and alternation"`

---

## Task 7: 请求转换

**Files:**
- Create: `src/proxy/transform/request-transform.ts`
- Create: `tests/proxy/transform/request-transform.test.ts`

- [ ] **Step 1: 写测试 - OA→Ant**

```typescript
describe("openaiToAnthropicRequest", () => {
  it("maps max_tokens with default 4096", () => {
    const result = openaiToAnthropicRequest({ model: "gpt-4", messages: [], stream: true }, "claude-3");
    expect(result.max_tokens).toBe(4096);
  });
  it("injects stream_options for Ant→OA stream", () => {
    const result = anthropicToOpenAIRequest({ model: "claude-3", messages: [], stream: true }, "gpt-4");
    expect(result.stream_options).toEqual({ include_usage: true });
  });
  it("wraps stop string into array", () => {
    const result = openaiToAnthropicRequest({ model: "gpt-4", messages: [], stop: "STOP" }, "claude-3");
    expect(result.stop_sequences).toEqual(["STOP"]);
  });
});
```

- [ ] **Step 2-5: TDD 流程**

实现 `openaiToAnthropicRequest`, `anthropicToOpenAIRequest`, `transformRequestBody`（入口函数，根据方向分发）。

- [ ] **Step 6: Commit** `git commit -m "feat(transform): add request body transformation"`

---

## Task 8: 非流式响应转换

**Files:**
- Create: `src/proxy/transform/response-transform.ts`
- Create: `tests/proxy/transform/response-transform.test.ts`

- [ ] **Step 1: 写测试**

```typescript
describe("response transformation", () => {
  it("OA→Ant: converts choices to content blocks", () => {
    const oaiResponse = JSON.stringify({ id: "chatcmpl-1", model: "gpt-4", choices: [{ message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
    const result = JSON.parse(openaiResponseToAnthropic(oaiResponse));
    expect(result.type).toBe("message");
    expect(result.content[0]).toEqual({ type: "text", text: "Hello" });
    expect(result.stop_reason).toBe("end_turn");
  });
  it("OA→Ant: maps tool_calls to tool_use blocks", () => {
    const oaiResponse = JSON.stringify({ id: "chatcmpl-1", model: "gpt-4", choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: "{\"city\":\"NYC\"}" } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 20 } });
    const result = JSON.parse(openaiResponseToAnthropic(oaiResponse));
    expect(result.content[0].type).toBe("tool_use");
    expect(result.stop_reason).toBe("tool_use");
  });
  it("Ant→OA: converts content blocks to choices", () => {
    const antResponse = JSON.stringify({ id: "msg_1", model: "claude-3", role: "assistant", content: [{ type: "text", text: "Hello" }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } });
    const result = JSON.parse(anthropicResponseToOpenAI(antResponse));
    expect(result.object).toBe("chat.completion");
    expect(result.choices[0].message.content).toBe("Hello");
    expect(result.choices[0].finish_reason).toBe("stop");
  });
  it("transforms error responses cross-format", () => {
    const antError = JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Bad request" } });
    const result = JSON.parse(transformErrorResponse(antError, "anthropic", "openai"));
    expect(result.error.message).toBe("Bad request");
  });
});
```

- [ ] **Step 2-5: TDD 流程 + Commit** `git commit -m "feat(transform): add response body transformation"`

---

## Task 9: SafeSSEParser

**Files:**
- Create: `src/proxy/patch/safe-sse-parser.ts`
- Create: `tests/proxy/transform/safe-sse-parser.test.ts`

- [ ] **Step 1: 写测试**

```typescript
import { SafeSSEParser } from "../../../src/proxy/patch/safe-sse-parser.js";

describe("SafeSSEParser", () => {
  it("parses normal SSE events", () => {
    const parser = new SafeSSEParser();
    const events = parser.feed("data: {\"type\":\"ping\"}\n\n");
    expect(events).toHaveLength(1);
  });
  it("throws when buffer exceeds limit", () => {
    const parser = new SafeSSEParser();
    expect(() => {
      for (let i = 0; i < 10000; i++) parser.feed("data: " + "x".repeat(10) + "\n\n");
    }).toThrow("SSE buffer exceeded");
  });
});
```

- [ ] **Step 2-5: TDD 流程 + Commit** `git commit -m "feat(transform): add SafeSSEParser with buffer limit"`

---

## Task 10: OA→Ant 流式转换

**Files:**
- Create: `src/proxy/transform/stream-transform.ts`
- Create: `tests/proxy/transform/stream-transform-oa2ant.test.ts`

- [ ] **Step 1: 写测试**

```typescript
import { OpenAIToAnthropicTransform } from "../../../src/proxy/transform/stream-transform.js";

function collectOutput(transform: Transform): Promise<string> {
  return new Promise(resolve => {
    const chunks: string[] = [];
    transform.on("data", (c: Buffer) => chunks.push(c.toString()));
    transform.on("end", () => resolve(chunks.join("")));
  });
}

describe("OpenAIToAnthropicTransform", () => {
  it("converts text streaming", async () => {
    const t = new OpenAIToAnthropicTransform("gpt-4");
    const output = collectOutput(t);
    t.write('data: {"choices":[{"delta":{"role":"assistant"},"finish_reason":null}]}\n\n');
    t.write('data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n');
    t.write('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n');
    t.write('data: {"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n');
    t.end();
    const result = await output;
    expect(result).toContain("event: message_start");
    expect(result).toContain("event: content_block_delta");
    expect(result).toContain("event: message_stop");
  });
});
```

- [ ] **Step 2-4: TDD 流程**

实现 FormatStreamTransform 基类 + OpenAIToAnthropicTransform 状态机。

基类核心逻辑:
- `_transform`: SafeSSEParser.feed → 遍历 events → try/catch processEvent → callback()
- `_flush`: parser.flush → flushPendingData → ensureTerminated → callback()
- `pushAnthropicSSE(type, data)`: `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`

OA→Ant 状态机核心:
- init: 首 chunk → emit message_start（含 model）
- delta.content → ensureBlockState("text") + delta
- delta.reasoning_content → ensureBlockState("thinking") + delta
- delta.tool_calls 首次 → close prev + content_block_start(tool_use, {id,name,input:{}})
- finish_reason → close block + 缓存 stop_reason
- usage 或 [DONE] → emitStopSequence()

- [ ] **Step 5: Commit** `git commit -m "feat(transform): add OA→Ant streaming transform"`

---

## Task 11: Ant→OA 流式转换

**Files:**
- Modify: `src/proxy/transform/stream-transform.ts`
- Create: `tests/proxy/transform/stream-transform-ant2oa.test.ts`

- [ ] **Step 1: 写测试**

```typescript
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
    expect(result).toContain("[DONE]");
  });
});
```

- [ ] **Step 2-4: TDD 流程**

AnthropicToOpenAITransform:
- message_start: 记录 input_tokens
- content_block_start(text): 首次发 role chunk
- content_block_delta: 转对应 delta
- message_delta(stop_reason): finish_reason chunk
- message_stop: usage chunk + [DONE]
- ping: 丢弃
- error: 转错误格式 + [DONE]

- [ ] **Step 5: Commit** `git commit -m "feat(transform): add Ant→OA streaming transform"`

---

## Task 12: TransformCoordinator

**Files:**
- Create: `src/proxy/transform/transform-coordinator.ts`
- Create: `tests/proxy/transform/transform-coordinator.test.ts`

- [ ] **Step 1: 写测试**

```typescript
describe("TransformCoordinator", () => {
  it("returns false when apiTypes match", () => {
    const c = new TransformCoordinator();
    expect(c.needsTransform("openai", "openai")).toBe(false);
  });
  it("returns true when apiTypes differ", () => {
    const c = new TransformCoordinator();
    expect(c.needsTransform("openai", "anthropic")).toBe(true);
  });
  it("transforms request OA→Ant", () => {
    const c = new TransformCoordinator();
    const result = c.transformRequest({ model: "gpt-4", messages: [], stream: true }, "openai", "anthropic", "gpt-4");
    expect(result.upstreamPath).toBe("/v1/messages");
    expect(result.body.max_tokens).toBe(4096);
  });
  it("creates formatTransform for cross-format streaming", () => {
    const c = new TransformCoordinator();
    const transform = c.createFormatTransform("openai", "anthropic", "gpt-4");
    expect(transform).toBeDefined();
  });
  it("returns undefined formatTransform for same format", () => {
    const c = new TransformCoordinator();
    const transform = c.createFormatTransform("openai", "openai", "gpt-4");
    expect(transform).toBeUndefined();
  });
});
```

- [ ] **Step 2-5: TDD 流程 + Commit** `git commit -m "feat(transform): add TransformCoordinator"`

---

## Task 13: 集成到 proxy-handler + stream-proxy

**Files:**
- Modify: `src/proxy/proxy-handler.ts`
- Modify: `src/proxy/stream-proxy.ts`
- Modify: `src/proxy/transport-fn.ts`
- Modify: `src/proxy/transport.ts`
- Modify: `src/proxy/proxy-core.ts`

这个 Task 是集成层，用 Phase 2 集成测试覆盖。

- [ ] **Step 1: proxy-core.ts - 注入 anthropic-version header**

在 `buildUpstreamHeaders` 中，当 apiType === "anthropic" 时注入:
```typescript
if (apiType === "anthropic") {
  headers["anthropic-version"] = "2023-06-01";
}
```

- [ ] **Step 2: stream-proxy.ts - 增加 formatTransform 参数**

构造函数增加 `formatTransform?: Transform`，`startStreaming()` 中串联:
```typescript
if (this.metricsTransform) {
  this.metricsTransform.pipe(this.formatTransform ?? this.passThrough, { end: true });
}
if (this.formatTransform) {
  this.formatTransform.pipe(this.passThrough, { end: true });
}
```

- [ ] **Step 3: transport.ts + transport-fn.ts - 传递 formatTransform**

`callStream` 签名增加 `formatTransform?: Transform`，传给 StreamProxy。
`TransportFnParams` 增加 `formatTransform?`，流式时传给 callStream。

- [ ] **Step 4: proxy-handler.ts - 核心集成**

1. 移除 `provider.api_type !== apiType` 硬拒绝（改为 needsTransform 判断）
2. 在 failover loop 中创建 coordinator 实例
3. 请求方向：`resolveMapping` 后，如果 needsTransform，调用 `coordinator.transformRequest()`
4. 非流式响应：transportFn 返回后，如果 needsTransform 且 result.kind === "success"，调用 `coordinator.transformResponse()`
5. 流式：如果 needsTransform，调用 `coordinator.createFormatTransform()` 传给 buildTransportFn

- [ ] **Step 5: 运行现有测试确保无回归** `npm test`

- [ ] **Step 6: Commit** `git commit -m "feat(transform): integrate format transformer into proxy pipeline"`
