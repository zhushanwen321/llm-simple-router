# Task 4: Provider Specific Fields (provider-meta.ts)

**Files:**
- Create: `src/proxy/transform/provider-meta.ts`
- Create: `tests/proxy/transform/provider-meta.test.ts`
- Modify: `src/proxy/transform/response-transform.ts`
- Modify: `src/proxy/transform/request-transform.ts`
- Modify: `src/proxy/transform/stream-ant2oa.ts`
- Modify: `tests/proxy/transform/response-transform.test.ts`
- Modify: `tests/proxy/transform/request-transform.test.ts`

---

## Phase A: Core extraction/restore + non-streaming

- [ ] **Step 1: Write provider-meta tests**

Create `tests/proxy/transform/provider-meta.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { extractAnthropicMeta, stripProviderMeta } from "../../../src/proxy/transform/provider-meta.js";

describe("extractAnthropicMeta", () => {
  it("extracts thinking signatures", () => {
    const ant = {
      content: [
        { type: "thinking", thinking: "hmm", signature: "sig_abc" },
        { type: "text", text: "hello" },
      ],
    };
    const meta = extractAnthropicMeta(ant);
    expect(meta?.thinking_signatures).toEqual([{ index: 0, signature: "sig_abc" }]);
  });

  it("extracts redacted_thinking blocks", () => {
    const ant = {
      content: [
        { type: "redacted_thinking", data: "redacted_1" },
        { type: "text", text: "hello" },
      ],
    };
    const meta = extractAnthropicMeta(ant);
    expect(meta?.redacted_thinking).toEqual([{ type: "redacted_thinking", data: "redacted_1" }]);
  });

  it("extracts cache usage", () => {
    const ant = {
      content: [{ type: "text", text: "hi" }],
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 8, cache_creation_input_tokens: 3 },
    };
    const meta = extractAnthropicMeta(ant);
    expect(meta?.cache_usage).toEqual({ cache_read_input_tokens: 8, cache_creation_input_tokens: 3 });
  });

  it("returns undefined when no PSF present", () => {
    const ant = { content: [{ type: "text", text: "hi" }], usage: { input_tokens: 10 } };
    expect(extractAnthropicMeta(ant)).toBeUndefined();
  });
});

describe("stripProviderMeta", () => {
  it("extracts provider_meta from body and returns cleaned body", () => {
    const body = {
      model: "gpt-4",
      messages: [],
      provider_meta: { anthropic: { thinking_signatures: [{ index: 0, signature: "sig_1" }] } },
    };
    const { meta, body: cleaned } = stripProviderMeta(body);
    expect(meta?.thinking_signatures).toEqual([{ index: 0, signature: "sig_1" }]);
    expect(cleaned.provider_meta).toBeUndefined();
    expect(cleaned.model).toBe("gpt-4");
  });

  it("returns undefined meta when no provider_meta", () => {
    const body = { model: "gpt-4", messages: [] };
    const { meta, body: cleaned } = stripProviderMeta(body);
    expect(meta).toBeUndefined();
    expect(cleaned).toEqual(body);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/proxy/transform/provider-meta.test.ts
```

Expected: FAIL — module not found

- [ ] **Step 3: Write provider-meta implementation**

Create `src/proxy/transform/provider-meta.ts`:

```typescript
export interface AnthropicProviderMeta {
  thinking_signatures?: Array<{ index: number; signature: string }>;
  citations?: Array<{ block_index: number; citations: unknown[] }>;
  redacted_thinking?: unknown[];
  cache_usage?: {
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

export function extractAnthropicMeta(antResponse: Record<string, unknown>): AnthropicProviderMeta | undefined {
  const content = antResponse.content as Array<Record<string, unknown>> | undefined;
  if (!content) return undefined;

  const meta: AnthropicProviderMeta = {};
  let hasMeta = false;

  // thinking signatures
  const signatures: Array<{ index: number; signature: string }> = [];
  for (let i = 0; i < content.length; i++) {
    if (content[i].type === "thinking" && content[i].signature) {
      signatures.push({ index: i, signature: content[i].signature as string });
    }
  }
  if (signatures.length > 0) { meta.thinking_signatures = signatures; hasMeta = true; }

  // redacted_thinking
  const redacted = content.filter(b => b.type === "redacted_thinking");
  if (redacted.length > 0) { meta.redacted_thinking = redacted; hasMeta = true; }

  // citations
  const citations: Array<{ block_index: number; citations: unknown[] }> = [];
  for (let i = 0; i < content.length; i++) {
    if (content[i].citations) {
      citations.push({ block_index: i, citations: content[i].citations as unknown[] });
    }
  }
  if (citations.length > 0) { meta.citations = citations; hasMeta = true; }

  // cache usage
  const usage = antResponse.usage as Record<string, unknown> | undefined;
  if (usage?.cache_read_input_tokens != null || usage?.cache_creation_input_tokens != null) {
    meta.cache_usage = {
      cache_read_input_tokens: usage.cache_read_input_tokens as number | undefined,
      cache_creation_input_tokens: usage.cache_creation_input_tokens as number | undefined,
    };
    hasMeta = true;
  }

  return hasMeta ? meta : undefined;
}

export function stripProviderMeta(body: Record<string, unknown>): {
  meta: AnthropicProviderMeta | undefined;
  body: Record<string, unknown>;
} {
  const pm = body.provider_meta as Record<string, unknown> | undefined;
  if (!pm) return { meta: undefined, body };
  const cleaned = { ...body };
  delete cleaned.provider_meta;
  return { meta: pm.anthropic as AnthropicProviderMeta | undefined, body: cleaned };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/proxy/transform/provider-meta.test.ts
```

Expected: PASS

- [ ] **Step 5: Integrate PSF extraction into response-transform.ts**

Modify `src/proxy/transform/response-transform.ts`:

1. Add import:
```typescript
import { extractAnthropicMeta } from "./provider-meta.js";
```

2. Modify `anthropicResponseToOpenAI` to attach provider_meta. After building the result object (around line 63-70), add PSF extraction:

```typescript
export function anthropicResponseToOpenAI(bodyStr: string): string {
  const ant = JSON.parse(bodyStr);
  const blocks = (ant.content ?? []) as Array<Record<string, unknown>>;

  const thinkingText = blocks.filter(b => b.type === "thinking").map(b => b.thinking as string).join("");
  const textContent = blocks.filter(b => b.type === "text").map(b => b.text as string).join("");
  const toolBlocks = blocks.filter(b => b.type === "tool_use");

  const message: Record<string, unknown> = { role: "assistant" };
  if (thinkingText) message.reasoning_content = thinkingText;
  if (textContent) message.content = textContent;
  if (toolBlocks.length > 0) {
    message.tool_calls = toolBlocks.map(b => ({
      id: b.id,
      type: "function",
      function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
    }));
  }

  const result: Record<string, unknown> = {
    id: ant.id ?? generateChatcmplId(),
    object: "chat.completion",
    created: Math.floor(Date.now() / MS_PER_SECOND),
    model: ant.model,
    choices: [{ index: 0, message, finish_reason: mapStopReasonToFinishReason(ant.stop_reason ?? "end_turn") }],
    usage: mapUsageAnt2OA(ant.usage),
  };

  // 附加 provider_meta
  const meta = extractAnthropicMeta(ant);
  if (meta) {
    result.provider_meta = { anthropic: meta };
  }

  return JSON.stringify(result);
}
```

- [ ] **Step 6: Add PSF extraction test to response-transform.test.ts**

Append to `tests/proxy/transform/response-transform.test.ts`:

```typescript
it("preserves thinking signature in provider_meta", () => {
  const ant = JSON.stringify({
    id: "msg_4", model: "claude-3", role: "assistant",
    content: [
      { type: "thinking", thinking: "Let me think...", signature: "sig_abc" },
      { type: "text", text: "The answer" },
    ],
    stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 },
  });
  const result = JSON.parse(anthropicResponseToOpenAI(ant));
  expect(result.provider_meta?.anthropic?.thinking_signatures).toEqual([{ index: 0, signature: "sig_abc" }]);
});

it("preserves cache usage in provider_meta", () => {
  const ant = JSON.stringify({
    id: "msg_5", model: "claude-3", role: "assistant",
    content: [{ type: "text", text: "hi" }],
    stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 8 },
  });
  const result = JSON.parse(anthropicResponseToOpenAI(ant));
  expect(result.provider_meta?.anthropic?.cache_usage?.cache_read_input_tokens).toBe(8);
});

it("no provider_meta when no PSF present", () => {
  const result = JSON.parse(anthropicResponseToOpenAI(ANT_SUCCESS));
  expect(result.provider_meta).toBeUndefined();
});
```

- [ ] **Step 7: Integrate PSF restore into request-transform.ts**

Modify `src/proxy/transform/request-transform.ts`:

1. Add import:
```typescript
import { stripProviderMeta } from "./provider-meta.js";
```

2. Add `provider_meta` to `OA_KNOWN_FIELDS` (so it doesn't trigger dropped-fields warning):
```typescript
const OA_KNOWN_FIELDS = new Set([
  "model", "messages", "max_completion_tokens", "max_tokens",
  "stop", "temperature", "top_p", "stream", "tools", "tool_choice",
  "parallel_tool_calls", "reasoning", "user", "n", "stream_options",
  "response_format", "provider_meta",
]);
```

3. In `openaiToAnthropicRequest`, strip provider_meta before conversion. Add at the start of the function (after line 27):

```typescript
export function openaiToAnthropicRequest(body: Record<string, unknown>): Record<string, unknown> {
  const { meta: antMeta, body: cleanBody } = stripProviderMeta(body);
  // ... rest uses cleanBody instead of body
```

Replace all `body.` references in the function with `cleanBody.`:
- `cleanBody.model` instead of `body.model`
- `cleanBody.messages` instead of `body.messages`
- etc.

After message conversion, restore signatures if meta exists. Add before `logDroppedFields`:

```typescript
  // 还原 thinking signatures 到 assistant 消息中的 thinking blocks
  if (antMeta?.thinking_signatures?.length) {
    let sigIdx = 0;
    for (const msg of result.messages as Array<Record<string, unknown>>) {
      if (msg.role !== "assistant") continue;
      const content = msg.content as Array<Record<string, unknown>> | undefined;
      if (!content) continue;
      for (const block of content) {
        if (block.type === "thinking" && sigIdx < antMeta.thinking_signatures.length) {
          block.signature = antMeta.thinking_signatures[sigIdx].signature;
          sigIdx++;
        }
      }
    }
  }

  // 还原 redacted_thinking blocks
  if (antMeta?.redacted_thinking?.length) {
    for (const msg of result.messages as Array<Record<string, unknown>>) {
      if (msg.role !== "assistant") continue;
      const content = msg.content as Array<Record<string, unknown>>;
      msg.content = [...antMeta.redacted_thinking, ...content];
      break; // 只插入到第一个 assistant 消息
    }
  }
```

- [ ] **Step 8: Add PSF restore test to request-transform.test.ts**

Append to `tests/proxy/transform/request-transform.test.ts`:

```typescript
it("strips provider_meta from request body", () => {
  const result = openaiToAnthropicRequest({
    model: "gpt-4", messages: [],
    provider_meta: { anthropic: { thinking_signatures: [{ index: 0, signature: "sig_1" }] } },
  });
  expect((result as Record<string, unknown>).provider_meta).toBeUndefined();
});
```

- [ ] **Step 9: Run all affected tests**

```bash
npx vitest run tests/proxy/transform/provider-meta.test.ts tests/proxy/transform/response-transform.test.ts tests/proxy/transform/request-transform.test.ts
```

Expected: ALL PASS

## Phase B: Streaming PSF

- [ ] **Step 10: Add PSF tracking to stream-ant2oa.ts**

Modify `src/proxy/transform/stream-ant2oa.ts`:

1. Add import:
```typescript
import type { AnthropicProviderMeta } from "./provider-meta.js";
```

2. Add private fields to class:
```typescript
private thinkingSignatures: Array<{ index: number; signature: string }> = [];
private cacheUsage: AnthropicProviderMeta["cache_usage"];
```

3. In `content_block_stop` case (line 93-95), capture thinking signature:
```typescript
case "content_block_stop": {
  const blockIdx = (data.index as number) ?? 0;
  // thinking block 的 signature 在 content_block_stop 事件中
  const block = data.content_block as Record<string, unknown> | undefined;
  if (block?.type === "thinking" && block?.signature) {
    this.thinkingSignatures.push({ index: blockIdx, signature: block.signature as string });
  }
  break;
}
```

4. In `message_start` case (line 19-23), capture cache usage:
```typescript
case "message_start": {
  const msg = data.message as Record<string, unknown> | undefined;
  const usage = msg?.usage as Record<string, unknown> | undefined;
  this.inputTokens = (usage?.input_tokens as number) ?? 0;
  // cache usage
  if (usage?.cache_read_input_tokens != null || usage?.cache_creation_input_tokens != null) {
    this.cacheUsage = {
      cache_read_input_tokens: usage?.cache_read_input_tokens as number | undefined,
      cache_creation_input_tokens: usage?.cache_creation_input_tokens as number | undefined,
    };
  }
  break;
}
```

5. In `message_stop` case (line 118-130), emit message_meta before pushDone:

```typescript
case "message_stop": {
  this.emitProviderMeta();
  this.pushOpenAISSE({
    id: this.chatcmplId, object: "chat.completion.chunk",
    choices: [],
    usage: {
      prompt_tokens: this.inputTokens,
      completion_tokens: this.outputTokens,
      total_tokens: this.inputTokens + this.outputTokens,
    },
  });
  this.pushDone();
  break;
}
```

6. Add private method to emit provider_meta:

```typescript
private emitProviderMeta(): void {
  if (this.thinkingSignatures.length === 0 && !this.cacheUsage) return;
  const meta: { anthropic: AnthropicProviderMeta } = { anthropic: {} };
  if (this.thinkingSignatures.length > 0) meta.anthropic.thinking_signatures = this.thinkingSignatures;
  if (this.cacheUsage) meta.anthropic.cache_usage = this.cacheUsage;
  // 使用 Anthropic 格式的事件名，客户端可选择性监听
  this.push(`event: message_meta\ndata: ${JSON.stringify({ provider_meta: meta })}\n\n`);
}
```

- [ ] **Step 11: Run all tests**

```bash
npx vitest run tests/proxy/transform/
```

Expected: ALL PASS

- [ ] **Step 12: Run lint**

```bash
npx eslint src/proxy/transform/provider-meta.ts src/proxy/transform/response-transform.ts src/proxy/transform/request-transform.ts src/proxy/transform/stream-ant2oa.ts
```

- [ ] **Step 13: Commit**

```bash
git add src/proxy/transform/provider-meta.ts src/proxy/transform/response-transform.ts src/proxy/transform/request-transform.ts src/proxy/transform/stream-ant2oa.ts tests/proxy/transform/provider-meta.test.ts tests/proxy/transform/response-transform.test.ts tests/proxy/transform/request-transform.test.ts
git commit -m "feat(transform): add provider-specific fields preservation (PSF)"
```
