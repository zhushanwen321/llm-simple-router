# OpenAI Responses API 端点支持 — 详细实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 llm-simple-router 新增 OpenAI Responses API (`/v1/responses`) 端点支持，采用 Responses ↔ Anthropic 一级转换 + Chat 桥接的架构。

**Architecture:** 新增 `"openai-responses"` 作为第三种 api_type。Responses ↔ Anthropic 作为一级（近无损）转换对，Responses ↔ Chat 作为二级桥接。现有 Anthropic ↔ Chat 直连路径保留。TransformCoordinator 扩展为支持 3×3 转换矩阵。需要同步修改 patch 系统、plugin 系统、metrics 系统、monitor 系统等所有使用 api_type 的模块。

**Tech Stack:** TypeScript, Fastify, SQLite (better-sqlite3), stream.Transform (SSE), Vitest

**架构决策文档:** `docs/architecture-decision.md`
**调研报告:** `docs/api-research.md`

---

## 文件结构

### 新增文件（按职责分组）

**类型定义：**
| 文件 | 职责 |
|------|------|
| `src/proxy/transform/types-responses.ts` | Responses API 请求/响应/流式事件 TypeScript 类型 |

**一级转换（Responses ↔ Anthropic，近无损）：**
| 文件 | 职责 |
|------|------|
| `src/proxy/transform/request-transform-responses.ts` | Responses ↔ Anthropic 请求转换 |
| `src/proxy/transform/response-transform-responses.ts` | Responses ↔ Anthropic 响应转换 |
| `src/proxy/transform/stream-ant2resp.ts` | Anthropic SSE → Responses SSE 流式转换 |
| `src/proxy/transform/stream-resp2ant.ts` | Responses SSE → Anthropic SSE 流式转换 |

**二级桥接（Responses ↔ Chat，有损）：**
| 文件 | 职责 |
|------|------|
| `src/proxy/transform/request-bridge-responses.ts` | Responses ↔ Chat 请求桥接 |
| `src/proxy/transform/response-bridge-responses.ts` | Responses ↔ Chat 响应桥接 |
| `src/proxy/transform/stream-bridge-resp2chat.ts` | Responses SSE → Chat SSE 桥接 |
| `src/proxy/transform/stream-bridge-chat2resp.ts` | Chat SSE → Responses SSE 桥接 |

**端点路由：**
| 文件 | 职责 |
|------|------|
| `src/proxy/handler/responses.ts` | Responses API 端点 Fastify 插件 |

**测试：**
| 文件 | 职责 |
|------|------|
| `tests/proxy/transform/request-transform-responses.test.ts` | 一级请求转换测试 |
| `tests/proxy/transform/response-transform-responses.test.ts` | 一级响应转换测试 |
| `tests/proxy/transform/request-bridge-responses.test.ts` | 桥接请求转换测试 |
| `tests/proxy/transform/response-bridge-responses.test.ts` | 桥接响应转换测试 |
| `tests/proxy/transform/stream-ant2resp.test.ts` | Anthropic→Responses 流式测试 |
| `tests/proxy/transform/stream-resp2ant.test.ts` | Responses→Anthropic 流式测试 |

### 修改文件

| 文件 | 修改内容 |
|------|---------|
| `src/db/providers.ts` | api_type 联合类型扩展为含 `"openai-responses"` |
| `src/core/constants.ts` | PROXY_API_TYPES 增加 Responses 路由映射 |
| `src/core/types.ts` | ApiType 联合类型（如有） |
| `src/proxy/transform/types.ts` | TransformDirection 扩展 |
| `src/proxy/transform/transform-coordinator.ts` | 3×3 转换矩阵 |
| `src/proxy/handler/proxy-handler.ts` | apiType 类型签名扩展 |
| `src/proxy/handler/proxy-handler-utils.ts` | serializeBlocksForStorage apiType 扩展 |
| `src/proxy/proxy-core.ts` | buildUpstreamHeaders 支持 openai-responses |
| `src/proxy/patch/index.ts` | applyProviderPatches 兼容 openai-responses |
| `src/proxy/patch/deepseek/index.ts` | applyDeepSeekPatches apiType 签名扩展 |
| `src/proxy/patch/tool-round-limiter.ts` | apiType 签名扩展 |
| `src/proxy/loop-prevention/tool-loop-guard.ts` | apiType 签名扩展 |
| `src/proxy/transport/transport-fn.ts` | apiType 签名扩展 |
| `src/proxy/transform/plugin-types.ts` | apiType 签名扩展 |
| `src/proxy/response-transform.ts` | maybeInjectModelInfoTag 兼容 Responses |
| `src/proxy/proxy-logging.ts` | apiType 签名扩展 |
| `src/proxy/orchestration/orchestrator.ts` | apiType 签名扩展 |
| `src/monitor/stream-content-accumulator.ts` | apiType 签名扩展 |
| `src/monitor/stream-extractor.ts` | extractStreamText 支持 openai-responses |
| `src/monitor/request-tracker.ts` | apiType 签名扩展 |
| `src/monitor/types.ts` | apiType 签名扩展 |
| `src/metrics/sse-metrics-transform.ts` | apiType 签名扩展 + Responses SSE 解析 |
| `src/metrics/metrics-extractor.ts` | apiType 签名扩展 + Responses 指标提取 |
| `src/index.ts` | 注册 Responses 路由 |
| `frontend/src/views/Providers.vue` | 添加 openai-responses 选项 |

---

## Task 1: 定义 ApiType 联合类型 + Responses API 类型

**Files:**
- Create: `src/proxy/transform/types-responses.ts`
- Modify: `src/proxy/transform/types.ts`

- [ ] **Step 1: 在 types.ts 中定义 ApiType 联合类型**

在 `src/proxy/transform/types.ts` 末尾添加：

```typescript
/** 所有支持的 API 格式类型 */
export type ApiType = "openai" | "openai-responses" | "anthropic";
```

同时修改现有的 `TransformDirection`：

```typescript
/** 格式转换方向 */
export type TransformDirection =
  // 现有
  | "openai-to-anthropic" | "anthropic-to-openai"
  // 一级：Responses ↔ Anthropic
  | "openai-responses-to-anthropic" | "anthropic-to-openai-responses"
  // 二级：Responses ↔ Chat
  | "openai-to-openai-responses" | "openai-responses-to-openai";
```

- [ ] **Step 2: 创建 Responses API 类型定义**

创建 `src/proxy/transform/types-responses.ts`：

```typescript
// ---------- Responses API 输入 item 类型 ----------

export interface ResponseInputMessage {
  type: "message";
  role: "user" | "assistant" | "system" | "developer";
  content: string | ResponseInputContentPart[];
}

export interface ResponseInputText {
  type: "input_text";
  text: string;
}

export interface ResponseInputImage {
  type: "input_image";
  image_url: string;
  detail?: "auto" | "low" | "high";
}

export interface ResponseFunctionCallInput {
  type: "function_call";
  id: string;
  call_id: string;
  name: string;
  arguments: string;
}

export interface ResponseFunctionCallOutputInput {
  type: "function_call_output";
  call_id: string;
  output: string;
}

export interface ResponseReasoningInput {
  type: "reasoning";
  id: string;
  summary: Array<{ type: "summary_text"; text: string }>;
  encrypted_content?: string;
}

export type ResponseInputItem =
  | ResponseInputMessage
  | ResponseInputText
  | ResponseInputImage
  | ResponseFunctionCallInput
  | ResponseFunctionCallOutputInput
  | ResponseReasoningInput;

export interface ResponseInputContentPart {
  type: "input_text" | "input_image" | "input_file";
  text?: string;
  image_url?: string;
  file_url?: string;
  file_data?: string;
  filename?: string;
}

// ---------- Responses API 工具类型 ----------

export interface ResponseFunctionTool {
  type: "function";
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  strict?: boolean;
}

export interface ResponseWebSearchTool {
  type: "web_search_preview";
  search_context_size?: "low" | "medium" | "high";
  user_location?: { type: "approximate"; city?: string; country?: string };
}

export interface ResponseFileSearchTool {
  type: "file_search";
  vector_store_ids?: string[];
}

export type ResponseTool =
  | ResponseFunctionTool
  | ResponseWebSearchTool
  | ResponseFileSearchTool
  | Record<string, unknown>; // 其他内置工具（computer_use_preview 等）

// ---------- Responses API 响应输出 ----------

export interface ResponseOutputMessage {
  type: "message";
  id: string;
  role: "assistant";
  content: ResponseOutputContent[];
  status?: string;
}

export interface ResponseOutputContent {
  type: "output_text";
  text: string;
  annotations?: unknown[];
}

export interface ResponseFunctionCallOutput {
  type: "function_call";
  id: string;
  call_id: string;
  name: string;
  arguments: string;
  status?: string;
}

export interface ResponseReasoningOutput {
  type: "reasoning";
  id: string;
  summary: Array<{ type: "summary_text"; text: string }>;
  encrypted_content?: string;
}

export type ResponseOutputItem =
  | ResponseOutputMessage
  | ResponseFunctionCallOutput
  | ResponseReasoningOutput
  | Record<string, unknown>; // web_search_call, file_search_call 等

// ---------- Responses API 完整请求 ----------

export interface ResponsesApiRequest {
  model: string;
  input: string | ResponseInputItem[];
  instructions?: string;
  max_output_tokens?: number;
  temperature?: number;
  top_p?: number;
  tools?: ResponseTool[];
  tool_choice?: "auto" | "none" | "required" | { type: "function"; name: string };
  stream?: boolean;
  stream_options?: { include_usage?: boolean };
  reasoning?: {
    effort?: "low" | "medium" | "high";
    max_tokens?: number;
    summary?: "auto" | "concise" | "detailed";
  };
  previous_response_id?: string;
  metadata?: Record<string, string>;
  text?: { format: { type: "json_schema"; json_schema: unknown } };
  parallel_tool_calls?: boolean;
  store?: boolean;
}

// ---------- Responses API 完整响应 ----------

export interface ResponsesApiResponse {
  id: string;
  object: "response";
  model: string;
  status: "completed" | "failed" | "in_progress" | "incomplete";
  output: ResponseOutputItem[];
  usage?: ResponsesApiUsage;
  error?: { code: string; message: string };
  created_at?: number;
  completed_at?: number;
}

export interface ResponsesApiUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  input_tokens_details?: { cached_tokens: number };
  output_tokens_details?: { reasoning_tokens: number };
}

// ---------- Responses SSE 流式事件类型 ----------

export const RESPONSES_SSE_EVENTS = {
  CREATED: "response.created",
  IN_PROGRESS: "response.in_progress",
  QUEUED: "response.queued",
  OUTPUT_ITEM_ADDED: "response.output_item.added",
  OUTPUT_ITEM_DONE: "response.output_item.done",
  CONTENT_PART_ADDED: "response.content_part.added",
  CONTENT_PART_DONE: "response.content_part.done",
  OUTPUT_TEXT_DELTA: "response.output_text.delta",
  OUTPUT_TEXT_DONE: "response.output_text.done",
  REFUSAL_DELTA: "response.refusal.delta",
  REFUSAL_DONE: "response.refusal.done",
  FUNCTION_CALL_ARGUMENTS_DELTA: "response.function_call_arguments.delta",
  FUNCTION_CALL_ARGUMENTS_DONE: "response.function_call_arguments.done",
  REASONING_ITEM_ADDED: "response.output_item.added", // item.type === "reasoning"
  REASONING_SUMMARY_PART_ADDED: "response.reasoning_summary_part.added",
  REASONING_SUMMARY_PART_DONE: "response.reasoning_summary_part.done",
  REASONING_SUMMARY_TEXT_DELTA: "response.reasoning_summary_text.delta",
  REASONING_SUMMARY_TEXT_DONE: "response.reasoning_summary_text.done",
  REASONING_TEXT_DELTA: "response.reasoning_text.delta",
  REASONING_TEXT_DONE: "response.reasoning_text.done",
  COMPLETED: "response.completed",
  FAILED: "response.failed",
  INCOMPLETE: "response.incomplete",
  ERROR: "error",
} as const;
```

- [ ] **Step 3: 验证类型无报错**

Run: `cd /Users/zhushanwen/Code/llm-simple-router-workspace/feat-openai-response-endpoint && npx tsc --noEmit 2>&1 | head -20`
Expected: 0 errors（新增文件未被任何模块 import，不影响编译）

- [ ] **Step 4: Commit**

```bash
git add src/proxy/transform/types-responses.ts src/proxy/transform/types.ts
git commit -m "feat(responses): add ApiType union and Responses API type definitions"
```

---

## Task 2: api_type 全局扩展 — 所有模块签名统一

**Files:**
- Modify: `src/db/providers.ts`
- Modify: `src/proxy/handler/proxy-handler.ts`
- Modify: `src/proxy/handler/proxy-handler-utils.ts`
- Modify: `src/proxy/proxy-core.ts`
- Modify: `src/proxy/patch/index.ts`
- Modify: `src/proxy/patch/deepseek/index.ts`
- Modify: `src/proxy/patch/tool-round-limiter.ts`
- Modify: `src/proxy/loop-prevention/tool-loop-guard.ts`
- Modify: `src/proxy/transport/transport-fn.ts`
- Modify: `src/proxy/transform/plugin-types.ts`
- Modify: `src/proxy/proxy-logging.ts`
- Modify: `src/proxy/orchestration/orchestrator.ts`
- Modify: `src/monitor/stream-content-accumulator.ts`
- Modify: `src/monitor/stream-extractor.ts`
- Modify: `src/monitor/request-tracker.ts`
- Modify: `src/monitor/types.ts`
- Modify: `src/metrics/sse-metrics-transform.ts`
- Modify: `src/metrics/metrics-extractor.ts`
- Modify: `src/core/constants.ts`

> 策略：所有 `"openai" | "anthropic"` 字面联合类型替换为从 `types.ts` 导入 `ApiType`。这是一次性全局替换，所有模块行为不变（openai-responses 的特殊行为在后续 Task 中逐步添加）。

- [ ] **Step 1: 在 src/db/providers.ts 中扩展 api_type**

将所有 `"openai" | "anthropic"` 替换为 `"openai" | "openai-responses" | "anthropic"`。涉及 3 处：

1. Provider 接口 `api_type` 字段类型（约第 8 行）
2. `getActiveProviders` 函数（约第 34 行）
3. `createProvider` / provider 相关的验证

```typescript
// src/db/providers.ts — 3 处修改
// 第 8 行
api_type: "openai" | "openai-responses" | "anthropic";

// 第 34 行
apiType: "openai" | "openai-responses" | "anthropic",

// 第 53 行  
api_type: "openai" | "openai-responses" | "anthropic";
```

- [ ] **Step 2: 扩展 proxy-handler.ts 中的 apiType 类型**

3 处 `"openai" | "anthropic"` → `"openai" | "openai-responses" | "anthropic"`：

1. `FailoverContext.apiType`（约第 46 行）
2. `RejectParams.apiType`（约第 67 行）
3. `handleProxyRequest` 参数（约第 119 行）

- [ ] **Step 3: 扩展 proxy-handler-utils.ts**

```typescript
// src/proxy/handler/proxy-handler-utils.ts 第 17 行
export function serializeBlocksForStorage(blocks: ContentBlock[] | undefined, apiType: "openai" | "openai-responses" | "anthropic"): string {
```

- [ ] **Step 4: 扩展 proxy-core.ts — buildUpstreamHeaders**

```typescript
// src/proxy/proxy-core.ts 第 118 行
export function buildUpstreamHeaders(
  clientHeaders: RawHeaders,
  apiKey: string,
  payloadBytes?: number,
  apiType?: "openai" | "openai-responses" | "anthropic"
): Record<string, string> {
  const headers = selectHeaders(clientHeaders, SKIP_UPSTREAM);
  if (apiType === "anthropic") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] ??= "2023-06-01";
  } else {
    // openai 和 openai-responses 都用 Bearer token
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
```

函数体不变，因为 `openai-responses` 和 `openai` 的认证方式相同（Bearer token）。只是类型签名扩展。

- [ ] **Step 5: 扩展 patch 系统**

`src/proxy/patch/index.ts` — `ProviderInfo.api_type` 已经是 `string`，无需改签名。但需要确认 `applyDeepSeekPatches` 的分支逻辑：

```typescript
// src/proxy/patch/deepseek/index.ts 第 26 行
export function applyDeepSeekPatches(
  body: Record<string, unknown>,
  apiType: "openai" | "openai-responses" | "anthropic",
): void {
  if (apiType === "anthropic") {
    patchThinkingParam(body, apiType);
    stripCacheControl(body);
    patchMissingThinkingBlocks(body);
    patchOrphanToolResults(body);
  } else {
    // openai 和 openai-responses 共用 OpenAI 格式的 patch
    patchNonDeepSeekToolMessages(body);
    patchOrphanToolResultsOA(body);
  }
}
```

> 注意：DeepSeek patch 目前只对 OpenAI 格式和 Anthropic 格式有效。`openai-responses` 格式走 `else` 分支（与 openai 相同的 patch 逻辑），因为 DeepSeek 不支持 Responses API，转换后到达 patch 层时 body 已经是 OpenAI Chat 格式了（由 TransformCoordinator 转换）。如果 entryApiType 是 `openai-responses`，格式转换在 patch 之前执行，所以 patch 层看到的始终是 provider 的 api_type 格式。

- [ ] **Step 6: 扩展 tool-round-limiter.ts**

```typescript
// src/proxy/patch/tool-round-limiter.ts 第 79 行
export function applyToolRoundLimit(
  body: Record<string, unknown>,
  apiType: "openai" | "openai-responses" | "anthropic",
  maxRounds: number = DEFAULT_MAX_ROUNDS,
```

> 注意：此函数在 proxy-handler 中以 `apiType`（入口格式）调用。当入口是 `openai-responses` 时，body 是 Responses 格式，没有 `messages` 字段而是 `input`。需要在 Task 9 中处理 Responses 格式的工具轮数检测。此处仅扩展类型签名，暂不改变行为（Responses 格式的 body.messages 为 undefined，会走 `messages.length === 0` 分支直接返回，安全）。

- [ ] **Step 7: 扩展 tool-loop-guard.ts**

```typescript
// src/proxy/loop-prevention/tool-loop-guard.ts 第 45 行
injectLoopBreakPrompt(body: Record<string, unknown>, apiType: "openai" | "openai-responses" | "anthropic", toolName: string): Record<string, unknown> {
```

函数体中 `apiType === "anthropic"` 分支不变。`openai-responses` 走 else 分支（与 openai 相同的注入方式），安全但不精确。后续 Task 9 会优化。

- [ ] **Step 8: 扩展 transport-fn.ts**

```typescript
// src/proxy/transport/transport-fn.ts 第 51 行
apiType: "openai" | "openai-responses" | "anthropic";
```

TransportFnParams.apiType 类型扩展。Transport 层不关心具体格式，仅透传 apiType 到 metrics 和 headers。

- [ ] **Step 9: 扩展 plugin-types.ts**

```typescript
// src/proxy/transform/plugin-types.ts
// 第 9 行
apiType?: "openai" | "openai-responses" | "anthropic";
// 第 15-16 行
sourceApiType: "openai" | "openai-responses" | "anthropic";
targetApiType: "openai" | "openai-responses" | "anthropic";
// 第 22-23 行
sourceApiType: "openai" | "openai-responses" | "anthropic";
targetApiType: "openai" | "openai-responses" | "anthropic";
```

- [ ] **Step 10: 扩展 proxy-logging.ts**

3 处 `"openai" | "anthropic"` → `"openai" | "openai-responses" | "anthropic"`（第 36, 73, 187 行）。

- [ ] **Step 11: 扩展 orchestration/orchestrator.ts**

2 处（第 77, 127 行）。

- [ ] **Step 12: 扩展 monitor 模块**

4 个文件各 1 处：
- `src/monitor/stream-content-accumulator.ts` 第 18 行
- `src/monitor/stream-extractor.ts` 第 10 行
- `src/monitor/request-tracker.ts` 第 120 行
- `src/monitor/types.ts` 第 19 行

- [ ] **Step 13: 扩展 metrics 模块**

2 个文件：
- `src/metrics/sse-metrics-transform.ts` 第 28, 37 行
- `src/metrics/metrics-extractor.ts` 第 68, 161 行

- [ ] **Step 14: 扩展 core/constants.ts — PROXY_API_TYPES**

```typescript
// src/core/constants.ts — PROXY_API_TYPES 添加 Responses 路由
export const PROXY_API_TYPES: Record<string, string> = {
  "/v1/chat/completions": "openai",
  "/v1/models": "openai",
  "/v1/messages": "anthropic",
  "/v1/responses": "openai-responses",
  "/responses": "openai-responses",
};
```

- [ ] **Step 15: 运行全部测试确认无回归**

Run: `cd /Users/zhushanwen/Code/llm-simple-router-workspace/feat-openai-response-endpoint && npm test -- --run 2>&1 | tail -30`
Expected: 所有现有测试 PASS（行为未改变，只是类型签名扩展）

- [ ] **Step 16: Commit**

```bash
git add -A
git commit -m "feat(responses): extend api_type to 'openai | openai-responses | anthropic' across all modules"
```

---

## Task 3: 一级请求转换 — Responses ↔ Anthropic

**Files:**
- Create: `src/proxy/transform/request-transform-responses.ts`
- Create: `tests/proxy/transform/request-transform-responses.test.ts`

- [ ] **Step 1: 编写测试**

创建 `tests/proxy/transform/request-transform-responses.test.ts`：

```typescript
import { describe, it, expect } from "vitest";
import {
  responsesToAnthropicRequest,
  anthropicToResponsesRequest,
} from "../../../src/proxy/transform/request-transform-responses.js";

describe("responsesToAnthropicRequest", () => {
  it("converts basic text input (string)", () => {
    const result = responsesToAnthropicRequest({
      model: "gpt-4o",
      input: "Hello",
      instructions: "You are helpful.",
      max_output_tokens: 1024,
    });
    expect(result.model).toBe("gpt-4o");
    expect(result.system).toBe("You are helpful.");
    expect(result.max_tokens).toBe(1024);
    const msgs = result.messages as Array<Record<string, unknown>>;
    expect(msgs.length).toBe(1);
    expect(msgs[0].role).toBe("user");
  });

  it("converts input items with function_call and function_call_output", () => {
    const result = responsesToAnthropicRequest({
      model: "gpt-4o",
      input: [
        { type: "message", role: "user", content: "What's the weather?" },
        { type: "function_call", id: "fc_1", call_id: "call_1", name: "get_weather", arguments: '{"city":"SF"}' },
        { type: "function_call_output", call_id: "call_1", output: '{"temp":72}' },
      ],
      tools: [{ type: "function", name: "get_weather", parameters: { type: "object", properties: { city: { type: "string" } } } }],
    });
    const msgs = result.messages as Array<Record<string, unknown>>;
    // user → assistant(tool_use) → user(tool_result)
    expect(msgs.length).toBeGreaterThanOrEqual(3);
    expect(msgs[0].role).toBe("user");
    expect(msgs[1].role).toBe("assistant");
    const assistantContent = msgs[1].content as Array<Record<string, unknown>>;
    expect(assistantContent.some(b => b.type === "tool_use")).toBe(true);
    expect(msgs[2].role).toBe("user");
    const userContent = msgs[2].content as Array<Record<string, unknown>>;
    expect(userContent.some(b => b.type === "tool_result")).toBe(true);
  });

  it("converts reasoning input to thinking", () => {
    const result = responsesToAnthropicRequest({
      model: "o3",
      input: "Solve this",
      reasoning: { effort: "high" },
    });
    expect(result.thinking).toBeDefined();
    expect((result.thinking as Record<string, unknown>).type).toBe("enabled");
    expect((result.thinking as Record<string, unknown>).budget_tokens).toBe(32768);
  });

  it("maps tool_choice correctly", () => {
    const required = responsesToAnthropicRequest({ model: "gpt-4o", input: "hi", tool_choice: "required" });
    expect((required.tool_choice as Record<string, unknown>).type).toBe("any");

    const auto = responsesToAnthropicRequest({ model: "gpt-4o", input: "hi", tool_choice: "auto" });
    expect((auto.tool_choice as Record<string, unknown>).type).toBe("auto");

    const none = responsesToAnthropicRequest({ model: "gpt-4o", input: "hi", tool_choice: "none" });
    expect(none.tool_choice).toBeUndefined();

    const func = responsesToAnthropicRequest({ model: "gpt-4o", input: "hi", tool_choice: { type: "function", name: "foo" } });
    expect((func.tool_choice as Record<string, unknown>).type).toBe("tool");
    expect((func.tool_choice as Record<string, unknown>).name).toBe("foo");
  });

  it("converts tools (function type)", () => {
    const result = responsesToAnthropicRequest({
      model: "gpt-4o",
      input: "hi",
      tools: [{ type: "function", name: "foo", parameters: { type: "object" } }],
    });
    const tools = result.tools as Array<Record<string, unknown>>;
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe("foo");
    expect(tools[0].input_schema).toBeDefined();
    expect(tools[0].input_schema).toEqual({ type: "object" });
  });

  it("maps parallel_tool_calls=false to disable_parallel_tool_use", () => {
    const result = responsesToAnthropicRequest({
      model: "gpt-4o",
      input: "hi",
      tools: [{ type: "function", name: "foo", parameters: {} }],
      parallel_tool_calls: false,
    });
    const tc = result.tool_choice as Record<string, unknown>;
    expect(tc.disable_parallel_tool_use).toBe(true);
  });
});

describe("anthropicToResponsesRequest", () => {
  it("converts basic text with system", () => {
    const result = anthropicToResponsesRequest({
      model: "claude-sonnet-4-20250514",
      system: "You are helpful.",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 1024,
    });
    expect(result.model).toBe("claude-sonnet-4-20250514");
    expect(result.instructions).toBe("You are helpful.");
    expect(result.max_output_tokens).toBe(1024);
    const input = result.input as Array<Record<string, unknown>>;
    expect(input.length).toBe(1);
    expect(input[0].type).toBe("message");
    expect(input[0].role).toBe("user");
  });

  it("converts tool_use and tool_result to function_call items", () => {
    const result = anthropicToResponsesRequest({
      model: "claude-sonnet-4-20250514",
      messages: [
        { role: "user", content: "Weather?" },
        { role: "assistant", content: [
          { type: "text", text: "Let me check." },
          { type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "SF" } },
        ]},
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: '{"temp":72}' }] },
      ],
      max_tokens: 4096,
    });
    const input = result.input as Array<Record<string, unknown>>;
    // user(message) → assistant(message) + function_call → function_call_output
    expect(input.some(i => i.type === "function_call")).toBe(true);
    expect(input.some(i => i.type === "function_call_output")).toBe(true);
  });

  it("converts thinking to reasoning", () => {
    const result = anthropicToResponsesRequest({
      model: "claude-sonnet-4-20250514",
      messages: [{ role: "user", content: "Think" }],
      thinking: { type: "enabled", budget_tokens: 10000 },
      max_tokens: 16000,
    });
    expect(result.reasoning).toBeDefined();
    expect((result.reasoning as Record<string, unknown>).max_tokens).toBe(10000);
  });

  it("maps anthropic tool_choice to responses", () => {
    const anyChoice = anthropicToResponsesRequest({ model: "x", messages: [], max_tokens: 1, tool_choice: { type: "any" } });
    expect(anyChoice.tool_choice).toBe("required");

    const toolChoice = anthropicToResponsesRequest({ model: "x", messages: [], max_tokens: 1, tool_choice: { type: "tool", name: "foo" } });
    expect((toolChoice.tool_choice as Record<string, unknown>).type).toBe("function");
  });

  it("converts tools (input_schema → parameters)", () => {
    const result = anthropicToResponsesRequest({
      model: "x",
      messages: [],
      max_tokens: 1,
      tools: [{ name: "foo", input_schema: { type: "object" } }],
    });
    const tools = result.tools as Array<Record<string, unknown>>;
    expect(tools.length).toBe(1);
    expect(tools[0].type).toBe("function");
    expect(tools[0].name).toBe("foo");
    expect(tools[0].parameters).toBeDefined();
  });
});

describe("Responses ↔ Anthropic round-trip", () => {
  it("preserves core fields after Responses → Anthropic → Responses", () => {
    const original = {
      model: "gpt-4o",
      input: "Hello",
      instructions: "Be helpful",
      max_output_tokens: 2048,
      temperature: 0.7,
    };
    const ant = responsesToAnthropicRequest(original);
    const back = anthropicToResponsesRequest(ant);
    expect(back.model).toBe("gpt-4o");
    expect(back.instructions).toBe("Be helpful");
    expect(back.max_output_tokens).toBe(2048);
    expect(back.temperature).toBe(0.7);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/zhushanwen/Code/llm-simple-router-workspace/feat-openai-response-endpoint && npx vitest run tests/proxy/transform/request-transform-responses.test.ts 2>&1 | tail -20`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 responsesToAnthropicRequest 和 anthropicToResponsesRequest**

创建 `src/proxy/transform/request-transform-responses.ts`。核心实现：

```typescript
import { parseToolArguments } from "./sanitize.js";

// ---------- Reasoning ↔ Thinking 映射 ----------

const EFFORT_BUDGET: Record<string, number> = { low: 1024, medium: 8192, high: 32768 };
const DEFAULT_BUDGET = 8192;

function mapReasoningToThinking(reasoning: Record<string, unknown>): Record<string, unknown> {
  const effort = reasoning.effort as string | undefined;
  const maxTokens = reasoning.max_tokens as number | undefined;
  const budget = maxTokens ?? EFFORT_BUDGET[effort ?? ""] ?? DEFAULT_BUDGET;
  return { type: "enabled", budget_tokens: budget };
}

function mapThinkingToReasoning(thinking: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!thinking || thinking.type !== "enabled") return undefined;
  return { max_tokens: thinking.budget_tokens };
}

// ---------- Tool 映射 ----------

function convertToolsResp2Ant(tools: unknown[]): unknown[] {
  return tools
    .filter(t => (t as Record<string, unknown>).type === "function")
    .map(t => {
      const tool = t as Record<string, unknown>;
      const result: Record<string, unknown> = { name: tool.name };
      if (tool.description != null) result.description = tool.description;
      if (tool.parameters != null) result.input_schema = tool.parameters;
      return result;
    });
}

function convertToolsAnt2Resp(tools: unknown[]): unknown[] {
  return tools.map(t => {
    const tool = t as Record<string, unknown>;
    const result: Record<string, unknown> = { type: "function", name: tool.name };
    if (tool.description != null) result.description = tool.description;
    if (tool.input_schema != null) result.parameters = tool.input_schema;
    return result;
  });
}

// ---------- Tool Choice 映射 ----------

function mapToolChoiceResp2Ant(tc: unknown, parallelToolCalls?: boolean): unknown | undefined {
  if (tc === "none") return undefined;
  if (tc === "auto") {
    const result: Record<string, unknown> = { type: "auto" };
    if (parallelToolCalls === false) result.disable_parallel_tool_use = true;
    return result;
  }
  if (tc === "required") {
    const result: Record<string, unknown> = { type: "any" };
    if (parallelToolCalls === false) result.disable_parallel_tool_use = true;
    return result;
  }
  if (typeof tc === "object" && tc !== null) {
    const obj = tc as Record<string, unknown>;
    if (obj.type === "function" && obj.name) {
      const result: Record<string, unknown> = { type: "tool", name: obj.name };
      if (parallelToolCalls === false) result.disable_parallel_tool_use = true;
      return result;
    }
  }
  return { type: "auto" };
}

function mapToolChoiceAnt2Resp(tc: unknown): unknown {
  if (typeof tc === "string") return "auto";
  if (typeof tc === "object" && tc !== null) {
    const obj = tc as Record<string, unknown>;
    if (obj.type === "auto") return "auto";
    if (obj.type === "any") return "required";
    if (obj.type === "tool" && obj.name) return { type: "function", name: obj.name };
  }
  return "auto";
}

// ---------- Input Items ↔ Anthropic Messages ----------

interface AntMsg { role: string; content: Array<Record<string, unknown>> }

function convertInputToMessages(input: unknown): AntMsg[] {
  if (typeof input === "string") {
    return [{ role: "user", content: [{ type: "text", text: input }] }];
  }
  if (!Array.isArray(input)) return [];

  const raw: AntMsg[] = [];
  for (const item of input) {
    const it = item as Record<string, unknown>;
    switch (it.type) {
      case "message": {
        const content = normalizeRespContent(it.content);
        raw.push({ role: it.role as string, content });
        break;
      }
      case "input_text": {
        raw.push({ role: "user", content: [{ type: "text", text: it.text as string }] });
        break;
      }
      case "function_call": {
        const input = parseToolArguments(it.arguments as string);
        raw.push({
          role: "assistant",
          content: [{ type: "tool_use", id: `toolu_${it.call_id ?? it.id}`, name: it.name as string, input }],
        });
        break;
      }
      case "function_call_output": {
        raw.push({
          role: "user",
          content: [{ type: "tool_result", tool_use_id: `toolu_${it.call_id}`, content: it.output as string }],
        });
        break;
      }
      case "reasoning": {
        const summary = (it.summary as Array<Record<string, unknown>>)?.map(s => s.text).join("") ?? "";
        raw.push({ role: "assistant", content: [{ type: "thinking", thinking: summary }] });
        break;
      }
      default: {
        // 未知类型跳过
        break;
      }
    }
  }

  // 合并连续同角色消息（Anthropic 要求严格交替）
  const merged: AntMsg[] = [];
  for (const msg of raw) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === msg.role) {
      prev.content = [...prev.content, ...msg.content];
    } else {
      merged.push({ ...msg, content: [...msg.content] });
    }
  }

  // 确保首条是 user
  if (merged.length > 0 && merged[0].role !== "user") {
    merged.unshift({ role: "user", content: [{ type: "text", text: "" }] });
  }

  return merged;
}

function normalizeRespContent(content: unknown): Array<Record<string, unknown>> {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (Array.isArray(content)) {
    return (content as Array<Record<string, unknown>>).map(part => {
      if (part.type === "input_text") return { type: "text", text: part.text ?? "" };
      if (part.type === "input_image") return { type: "image", source: { type: "url", url: part.image_url ?? "" } };
      return part;
    });
  }
  return [];
}

function convertMessagesToInput(messages: unknown[]): unknown[] {
  const items: unknown[] = [];
  for (const msg of messages) {
    const m = msg as Record<string, unknown>;
    const content = m.content as Array<Record<string, unknown>> | undefined;

    if (m.role === "user") {
      if (!content || !Array.isArray(content)) {
        items.push({ type: "message", role: "user", content: String(m.content ?? "") });
        continue;
      }
      const textParts = content.filter(b => b.type === "text");
      const toolResults = content.filter(b => b.type === "tool_result");
      const imageParts = content.filter(b => b.type === "image");

      if (textParts.length > 0 || imageParts.length > 0) {
        const msgContent: unknown[] = [];
        for (const tp of textParts) msgContent.push({ type: "input_text", text: tp.text ?? "" });
        for (const ip of imageParts) {
          const src = ip.source as Record<string, unknown> | undefined;
          msgContent.push({ type: "input_image", image_url: src?.url ?? "" });
        }
        items.push({ type: "message", role: "user", content: msgContent });
      }
      for (const tr of toolResults) {
        items.push({
          type: "function_call_output",
          call_id: (tr.tool_use_id as string ?? "").replace("toolu_", ""),
          output: tr.content ?? "",
        });
      }
    } else if (m.role === "assistant") {
      if (!content || !Array.isArray(content)) {
        items.push({ type: "message", role: "assistant", content: String(m.content ?? "") });
        continue;
      }
      const textParts = content.filter(b => b.type === "text");
      const toolUseParts = content.filter(b => b.type === "tool_use");
      const thinkingParts = content.filter(b => b.type === "thinking");

      // thinking → reasoning items
      for (const tp of thinkingParts) {
        items.push({
          type: "reasoning",
          id: `rs_${Math.random().toString(36).slice(2, 10)}`,
          summary: [{ type: "summary_text", text: tp.thinking ?? "" }],
        });
      }
      // text → message item
      if (textParts.length > 0) {
        const text = textParts.map(b => b.text ?? "").join("");
        items.push({ type: "message", role: "assistant", content: [{ type: "output_text", text }] });
      }
      // tool_use → function_call items
      for (const tu of toolUseParts) {
        const callId = (tu.id as string ?? "").replace("toolu_", "");
        items.push({
          type: "function_call",
          id: `fc_${callId}`,
          call_id: callId,
          name: tu.name,
          arguments: JSON.stringify(tu.input ?? {}),
        });
      }
    }
  }
  return items;
}

// ---------- 公共接口 ----------

const RESP_KNOWN_FIELDS = new Set([
  "model", "input", "instructions", "max_output_tokens", "temperature", "top_p",
  "tools", "tool_choice", "stream", "stream_options", "reasoning", "previous_response_id",
  "metadata", "text", "parallel_tool_calls", "store",
]);

const ANT_KNOWN_FIELDS = new Set([
  "model", "system", "messages", "max_tokens", "stop_sequences", "temperature", "top_p",
  "stream", "tools", "tool_choice", "thinking", "metadata",
]);

export function responsesToAnthropicRequest(body: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  result.model = body.model;

  // instructions → system
  if (body.instructions) result.system = body.instructions;

  // input → messages
  result.messages = convertInputToMessages(body.input);

  // max_output_tokens → max_tokens
  result.max_tokens = body.max_output_tokens ?? 4096;

  // 直通字段
  if (body.temperature != null) result.temperature = body.temperature;
  if (body.top_p != null) result.top_p = body.top_p;
  if (body.stream != null) result.stream = body.stream;

  // tools (仅 function 类型)
  if (body.tools) {
    const antTools = convertToolsResp2Ant(body.tools as unknown[]);
    if (antTools.length > 0) result.tools = antTools;
  }

  // tool_choice
  if (body.tool_choice != null) {
    const mapped = mapToolChoiceResp2Ant(body.tool_choice, body.parallel_toolCalls as boolean | undefined);
    if (mapped != null) result.tool_choice = mapped;
  } else if (body.parallel_tool_calls === false && result.tools) {
    result.tool_choice = { type: "auto", disable_parallel_tool_use: true };
  }

  // reasoning → thinking
  if (body.reasoning) {
    result.thinking = mapReasoningToThinking(body.reasoning as Record<string, unknown>);
    const thinkingBudget = (result.thinking as Record<string, unknown>).budget_tokens as number;
    if (thinkingBudget > (result.max_tokens as number)) {
      result.max_tokens = thinkingBudget;
    }
  }

  // metadata → metadata
  if (body.metadata) {
    const meta = body.metadata as Record<string, string>;
    if (meta.user_id) result.metadata = { user_id: meta.user_id };
  }

  // text.format → 忽略（Anthropic 无对应，日志警告）
  if (body.text) {
    console.warn("[request-transform-responses] text.format dropped: Anthropic has no JSON mode in this conversion path");
  }

  // log dropped fields
  const dropped = Object.keys(body).filter(k => !RESP_KNOWN_FIELDS.has(k));
  if (dropped.length > 0) {
    console.warn(`[request-transform-responses] Responses→Ant: dropped fields: ${dropped.join(", ")}`);
  }

  return result;
}

export function anthropicToResponsesRequest(body: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  result.model = body.model;

  // system → instructions
  if (body.system != null) {
    if (typeof body.system === "string") {
      result.instructions = body.system;
    } else if (Array.isArray(body.system)) {
      result.instructions = (body.system as Array<Record<string, unknown>>).map(b => b.text ?? "").join("\n");
    }
  }

  // messages → input
  result.input = convertMessagesToInput(body.messages as unknown[] ?? []);

  // max_tokens → max_output_tokens
  if (body.max_tokens != null) result.max_output_tokens = body.max_tokens;

  // 直通
  if (body.temperature != null) result.temperature = body.temperature;
  if (body.top_p != null) result.top_p = body.top_p;
  if (body.stream != null) result.stream = body.stream;

  // tools
  if (body.tools) {
    result.tools = convertToolsAnt2Resp(body.tools as unknown[]);
  }

  // tool_choice
  if (body.tool_choice != null) {
    result.tool_choice = mapToolChoiceAnt2Resp(body.tool_choice);
  }

  // thinking → reasoning
  if (body.thinking) {
    const reasoning = mapThinkingToReasoning(body.thinking as Record<string, unknown>);
    if (reasoning) result.reasoning = reasoning;
  }

  // metadata.user_id
  const meta = body.metadata as Record<string, unknown> | undefined;
  if (meta?.user_id) {
    result.metadata = { user_id: meta.user_id as string };
  }

  // stop_sequences — Responses 无对应，日志警告
  if (body.stop_sequences) {
    console.warn("[request-transform-responses] Ant→Responses: stop_sequences dropped (no Responses equivalent)");
  }

  const dropped = Object.keys(body).filter(k => !ANT_KNOWN_FIELDS.has(k));
  if (dropped.length > 0) {
    console.warn(`[request-transform-responses] Ant→Responses: dropped fields: ${dropped.join(", ")}`);
  }

  return result;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /Users/zhushanwen/Code/llm-simple-router-workspace/feat-openai-response-endpoint && npx vitest run tests/proxy/transform/request-transform-responses.test.ts 2>&1 | tail -20`
Expected: 所有测试 PASS

- [ ] **Step 5: Commit**

```bash
git add src/proxy/transform/request-transform-responses.ts tests/proxy/transform/request-transform-responses.test.ts
git commit -m "feat(responses): implement Responses↔Anthropic request transform (tier-1)"
```

---

## Task 4: 一级响应转换 — Responses ↔ Anthropic

**Files:**
- Create: `src/proxy/transform/response-transform-responses.ts`
- Create: `tests/proxy/transform/response-transform-responses.test.ts`

- [ ] **Step 1: 编写测试**

创建 `tests/proxy/transform/response-transform-responses.test.ts`：

```typescript
import { describe, it, expect } from "vitest";
import {
  responsesToAnthropicResponse,
  anthropicToResponsesResponse,
} from "../../../src/proxy/transform/response-transform-responses.js";

describe("responsesToAnthropicResponse", () => {
  it("converts basic text output", () => {
    const resp = JSON.stringify({
      id: "resp_123", object: "response", model: "gpt-4o",
      status: "completed",
      output: [{ type: "message", id: "msg_1", role: "assistant", content: [{ type: "output_text", text: "Hello!" }] }],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    });
    const result = JSON.parse(responsesToAnthropicResponse(resp));
    expect(result.type).toBe("message");
    expect(result.role).toBe("assistant");
    expect(result.stop_reason).toBe("end_turn");
    const content = result.content as Array<Record<string, unknown>>;
    expect(content.some(b => b.type === "text" && b.text === "Hello!")).toBe(true);
    expect(result.usage.input_tokens).toBe(10);
  });

  it("converts function_call output to tool_use", () => {
    const resp = JSON.stringify({
      id: "resp_123", object: "response", model: "gpt-4o",
      status: "completed",
      output: [
        { type: "function_call", id: "fc_1", call_id: "call_1", name: "get_weather", arguments: '{"city":"SF"}' },
      ],
      usage: { input_tokens: 5, output_tokens: 10, total_tokens: 15 },
    });
    const result = JSON.parse(responsesToAnthropicResponse(resp));
    const content = result.content as Array<Record<string, unknown>>;
    expect(content.some(b => b.type === "tool_use")).toBe(true);
    const toolUse = content.find(b => b.type === "tool_use")!;
    expect(toolUse.name).toBe("get_weather");
  });

  it("converts reasoning output to thinking", () => {
    const resp = JSON.stringify({
      id: "resp_123", object: "response", model: "o3",
      status: "completed",
      output: [
        { type: "reasoning", id: "rs_1", summary: [{ type: "summary_text", text: "Let me think..." }] },
        { type: "message", id: "msg_1", role: "assistant", content: [{ type: "output_text", text: "Answer" }] },
      ],
      usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    });
    const result = JSON.parse(responsesToAnthropicResponse(resp));
    const content = result.content as Array<Record<string, unknown>>;
    expect(content[0].type).toBe("thinking");
  });

  it("maps status to stop_reason", () => {
    const completed = JSON.parse(responsesToAnthropicResponse(JSON.stringify({
      id: "r", object: "response", model: "x", status: "completed", output: [], usage: {},
    })));
    expect(completed.stop_reason).toBe("end_turn");

    const incomplete = JSON.parse(responsesToAnthropicResponse(JSON.stringify({
      id: "r", object: "response", model: "x", status: "incomplete", output: [], usage: {},
    })));
    expect(incomplete.stop_reason).toBe("max_tokens");
  });
});

describe("anthropicToResponsesResponse", () => {
  it("converts basic text content", () => {
    const ant = JSON.stringify({
      id: "msg_123", type: "message", role: "assistant", model: "claude-sonnet-4-20250514",
      content: [{ type: "text", text: "Hello!" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const result = JSON.parse(anthropicToResponsesResponse(ant));
    expect(result.object).toBe("response");
    expect(result.status).toBe("completed");
    expect(Array.isArray(result.output)).toBe(true);
  });

  it("converts tool_use to function_call output", () => {
    const ant = JSON.stringify({
      id: "msg_123", type: "message", role: "assistant", model: "claude",
      content: [{ type: "tool_use", id: "toolu_abc", name: "foo", input: { x: 1 } }],
      stop_reason: "tool_use",
      usage: { input_tokens: 5, output_tokens: 10 },
    });
    const result = JSON.parse(anthropicToResponsesResponse(ant));
    const funcCall = result.output.find((o: Record<string, unknown>) => o.type === "function_call");
    expect(funcCall).toBeDefined();
    expect(funcCall.name).toBe("foo");
    expect(funcCall.call_id).toBe("abc");
  });

  it("converts thinking to reasoning output", () => {
    const ant = JSON.stringify({
      id: "msg_123", type: "message", role: "assistant", model: "claude",
      content: [
        { type: "thinking", thinking: "hmm..." },
        { type: "text", text: "Answer" },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 20 },
    });
    const result = JSON.parse(anthropicToResponsesResponse(ant));
    const reasoning = result.output.find((o: Record<string, unknown>) => o.type === "reasoning");
    expect(reasoning).toBeDefined();
    expect(reasoning.summary[0].text).toBe("hmm...");
  });

  it("maps stop_reason to status", () => {
    const endTurn = JSON.parse(anthropicToResponsesResponse(JSON.stringify({
      id: "x", type: "message", role: "assistant", model: "x", content: [{ type: "text", text: "" }], stop_reason: "end_turn", usage: {},
    })));
    expect(endTurn.status).toBe("completed");

    const maxTokens = JSON.parse(anthropicToResponsesResponse(JSON.stringify({
      id: "x", type: "message", role: "assistant", model: "x", content: [{ type: "text", text: "" }], stop_reason: "max_tokens", usage: {},
    })));
    expect(maxTokens.status).toBe("incomplete");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/zhushanwen/Code/llm-simple-router-workspace/feat-openai-response-endpoint && npx vitest run tests/proxy/transform/response-transform-responses.test.ts 2>&1 | tail -20`

- [ ] **Step 3: 实现 responsesToAnthropicResponse 和 anthropicToResponsesResponse**

创建 `src/proxy/transform/response-transform-responses.ts`：

```typescript
import { generateMsgId, generateRespId } from "./id-utils.js";

// ---------- Status ↔ Stop Reason ----------

const STATUS_TO_STOP: Record<string, string> = {
  completed: "end_turn",
  incomplete: "max_tokens",
  failed: "end_turn",
};

const STOP_TO_STATUS: Record<string, string> = {
  end_turn: "completed",
  max_tokens: "incomplete",
  stop_sequence: "completed",
  tool_use: "completed",
};

// ---------- Responses → Anthropic ----------

export function responsesToAnthropicResponse(bodyStr: string): string {
  const resp = JSON.parse(bodyStr);
  const content: Array<Record<string, unknown>> = [];

  for (const item of (resp.output ?? []) as Array<Record<string, unknown>>) {
    switch (item.type) {
      case "message": {
        const msgContent = item.content as Array<Record<string, unknown>> ?? [];
        for (const part of msgContent) {
          if (part.type === "output_text" && part.text) {
            content.push({ type: "text", text: part.text });
          }
        }
        break;
      }
      case "function_call": {
        let input: unknown = {};
        try { input = JSON.parse(item.arguments as string ?? "{}"); } catch { /* keep empty */ }
        content.push({
          type: "tool_use",
          id: `toolu_${item.call_id ?? item.id}`,
          name: item.name,
          input,
        });
        break;
      }
      case "reasoning": {
        const summary = (item.summary as Array<Record<string, unknown>> ?? []).map(s => s.text ?? "").join("");
        content.push({ type: "thinking", thinking: summary });
        break;
      }
      default:
        // 其他输出类型（web_search_call 等）跳过
        break;
    }
  }

  if (content.length === 0) content.push({ type: "text", text: "" });

  const usage = resp.usage as Record<string, number> | undefined;
  return JSON.stringify({
    id: generateMsgId(),
    type: "message",
    role: "assistant",
    content,
    model: resp.model,
    stop_reason: STATUS_TO_STOP[resp.status] ?? "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: usage?.input_tokens ?? 0,
      output_tokens: usage?.output_tokens ?? 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: usage?.input_tokens_details?.cached_tokens ?? 0,
    },
  });
}

// ---------- Anthropic → Responses ----------

export function anthropicToResponsesResponse(bodyStr: string): string {
  const ant = JSON.parse(bodyStr);
  const blocks = (ant.content ?? []) as Array<Record<string, unknown>>;
  const output: Array<Record<string, unknown>> = [];

  for (const block of blocks) {
    switch (block.type) {
      case "thinking": {
        output.push({
          type: "reasoning",
          id: `rs_${Math.random().toString(36).slice(2, 10)}`,
          summary: [{ type: "summary_text", text: block.thinking ?? "" }],
        });
        break;
      }
      case "text": {
        output.push({
          type: "message",
          id: `msg_${Math.random().toString(36).slice(2, 10)}`,
          role: "assistant",
          content: [{ type: "output_text", text: block.text ?? "" }],
        });
        break;
      }
      case "tool_use": {
        const callId = (block.id as string).replace("toolu_", "");
        output.push({
          type: "function_call",
          id: `fc_${callId}`,
          call_id: callId,
          name: block.name,
          arguments: JSON.stringify(block.input ?? {}),
        });
        break;
      }
      default:
        break;
    }
  }

  if (output.length === 0) {
    output.push({
      type: "message",
      id: `msg_${Math.random().toString(36).slice(2, 10)}`,
      role: "assistant",
      content: [{ type: "output_text", text: "" }],
    });
  }

  const usage = ant.usage as Record<string, number> | undefined;
  const inputTokens = (usage?.input_tokens ?? 0) + (usage?.cache_read_input_tokens ?? 0) + (usage?.cache_creation_input_tokens ?? 0);
  const outputTokens = usage?.output_tokens ?? 0;

  return JSON.stringify({
    id: generateRespId(),
    object: "response",
    model: ant.model,
    status: STOP_TO_STATUS[ant.stop_reason] ?? "completed",
    output,
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      total_tokens: inputTokens + outputTokens,
      input_tokens_details: { cached_tokens: usage?.cache_read_input_tokens ?? 0 },
      output_tokens_details: { reasoning_tokens: 0 },
    },
  });
}
```

- [ ] **Step 4: 在 id-utils.ts 中添加 generateRespId**

在 `src/proxy/transform/id-utils.ts` 中添加：

```typescript
/** 生成 resp_xxx 格式 ID（Responses API） */
export function generateRespId(): string {
  return `resp_${randomHex(24)}`;
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd /Users/zhushanwen/Code/llm-simple-router-workspace/feat-openai-response-endpoint && npx vitest run tests/proxy/transform/response-transform-responses.test.ts 2>&1 | tail -20`

- [ ] **Step 6: Commit**

```bash
git add src/proxy/transform/response-transform-responses.ts src/proxy/transform/id-utils.ts tests/proxy/transform/response-transform-responses.test.ts
git commit -m "feat(responses): implement Responses↔Anthropic response transform (tier-1)"
```

---

## Task 5: 二级桥接请求转换 — Responses ↔ Chat

**Files:**
- Create: `src/proxy/transform/request-bridge-responses.ts`
- Create: `tests/proxy/transform/request-bridge-responses.test.ts`

- [ ] **Step 1: 编写测试**

```typescript
import { describe, it, expect } from "vitest";
import {
  responsesToChatRequest,
  chatToResponsesRequest,
} from "../../../src/proxy/transform/request-bridge-responses.js";

describe("responsesToChatRequest", () => {
  it("converts instructions → system message, input string → user message", () => {
    const result = responsesToChatRequest({
      model: "gpt-4o",
      input: "Hello",
      instructions: "Be helpful",
      max_output_tokens: 1024,
    });
    const msgs = result.messages as Array<Record<string, unknown>>;
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toBe("Be helpful");
    expect(msgs[1].role).toBe("user");
    expect(result.max_completion_tokens).toBe(1024);
  });

  it("converts function_call input items to tool_calls", () => {
    const result = responsesToChatRequest({
      model: "gpt-4o",
      input: [
        { type: "message", role: "user", content: "Weather?" },
        { type: "function_call", id: "fc_1", call_id: "call_1", name: "get_weather", arguments: '{"city":"SF"}' },
        { type: "function_call_output", call_id: "call_1", output: '{"temp":72}' },
      ],
    });
    const msgs = result.messages as Array<Record<string, unknown>>;
    // Should have: user, assistant(tool_calls), tool
    expect(msgs.some(m => m.role === "assistant" && m.tool_calls)).toBe(true);
    expect(msgs.some(m => m.role === "tool")).toBe(true);
  });

  it("converts tools (function type, flatten parameters)", () => {
    const result = responsesToChatRequest({
      model: "gpt-4o",
      input: "hi",
      tools: [{ type: "function", name: "foo", parameters: { type: "object" } }],
    });
    const tools = result.tools as Array<Record<string, unknown>>;
    expect(tools[0].type).toBe("function");
    expect((tools[0].function as Record<string, unknown>).name).toBe("foo");
    expect((tools[0].function as Record<string, unknown>).parameters).toEqual({ type: "object" });
  });

  it("converts reasoning.max_tokens", () => {
    const result = responsesToChatRequest({
      model: "o3",
      input: "Think",
      reasoning: { max_tokens: 5000 },
    });
    expect(result.reasoning).toBeDefined();
    expect((result.reasoning as Record<string, unknown>).max_tokens).toBe(5000);
  });
});

describe("chatToResponsesRequest", () => {
  it("converts system message → instructions", () => {
    const result = chatToResponsesRequest({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "Be helpful" },
        { role: "user", content: "Hello" },
      ],
    });
    expect(result.instructions).toBe("Be helpful");
    const input = result.input as Array<Record<string, unknown>>;
    expect(input[0].type).toBe("message");
  });

  it("converts tool_calls to function_call items", () => {
    const result = chatToResponsesRequest({
      model: "gpt-4o",
      messages: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: null, tool_calls: [
          { id: "call_1", type: "function", function: { name: "foo", arguments: '{"x":1}' } },
        ]},
        { role: "tool", tool_call_id: "call_1", content: "result" },
      ],
    });
    const input = result.input as Array<Record<string, unknown>>;
    expect(input.some(i => i.type === "function_call")).toBe(true);
    expect(input.some(i => i.type === "function_call_output")).toBe(true);
  });

  it("converts max_completion_tokens → max_output_tokens", () => {
    const result = chatToResponsesRequest({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      max_completion_tokens: 2048,
    });
    expect(result.max_output_tokens).toBe(2048);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现桥接逻辑**

创建 `src/proxy/transform/request-bridge-responses.ts`。核心思路：

**Responses → Chat**：`instructions` → `messages[system]`，`input items` → `messages`（function_call → assistant.tool_calls, function_call_output → role=tool），`tools[type=function]` → `tools[type=function].function`，`max_output_tokens` → `max_completion_tokens`

**Chat → Responses**：`messages[system]` → `instructions`，`assistant.tool_calls` → `function_call items`，`role=tool` → `function_call_output`，`max_completion_tokens` → `max_output_tokens`

（完整代码约 200 行，遵循与 Task 3 相同的模式，此处省略以节省篇幅但实现时必须写完整）

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: Commit**

```bash
git add src/proxy/transform/request-bridge-responses.ts tests/proxy/transform/request-bridge-responses.test.ts
git commit -m "feat(responses): implement Responses↔Chat bridge request transform"
```

---

## Task 6: 二级桥接响应转换 — Responses ↔ Chat

**Files:**
- Create: `src/proxy/transform/response-bridge-responses.ts`
- Create: `tests/proxy/transform/response-bridge-responses.test.ts`

- [ ] **Step 1: 编写测试**

```typescript
import { describe, it, expect } from "vitest";
import {
  responsesToChatResponse,
  chatToResponsesResponse,
} from "../../../src/proxy/transform/response-bridge-responses.js";

describe("responsesToChatResponse", () => {
  it("converts output message to choices", () => {
    const resp = JSON.stringify({
      id: "resp_1", object: "response", model: "gpt-4o", status: "completed",
      output: [{ type: "message", id: "msg_1", role: "assistant", content: [{ type: "output_text", text: "Hi!" }] }],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    });
    const result = JSON.parse(responsesToChatResponse(resp));
    expect(result.object).toBe("chat.completion");
    expect(result.choices[0].message.content).toBe("Hi!");
    expect(result.choices[0].finish_reason).toBe("stop");
    expect(result.usage.prompt_tokens).toBe(10);
  });

  it("converts function_call output to tool_calls", () => {
    const resp = JSON.stringify({
      id: "resp_1", object: "response", model: "gpt-4o", status: "completed",
      output: [{ type: "function_call", id: "fc_1", call_id: "call_1", name: "foo", arguments: '{"x":1}' }],
      usage: { input_tokens: 5, output_tokens: 10, total_tokens: 15 },
    });
    const result = JSON.parse(responsesToChatResponse(resp));
    expect(result.choices[0].message.tool_calls).toBeDefined();
    expect(result.choices[0].message.tool_calls[0].function.name).toBe("foo");
  });

  it("converts reasoning output to reasoning_content (flattened)", () => {
    const resp = JSON.stringify({
      id: "resp_1", object: "response", model: "o3", status: "completed",
      output: [
        { type: "reasoning", id: "rs_1", summary: [{ type: "summary_text", text: "thinking..." }] },
        { type: "message", id: "msg_1", role: "assistant", content: [{ type: "output_text", text: "Answer" }] },
      ],
      usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    });
    const result = JSON.parse(responsesToChatResponse(resp));
    expect(result.choices[0].message.reasoning_content).toBe("thinking...");
    expect(result.choices[0].message.content).toBe("Answer");
  });
});

describe("chatToResponsesResponse", () => {
  it("converts choices to output items", () => {
    const chat = JSON.stringify({
      id: "chatcmpl-1", object: "chat.completion", model: "gpt-4o",
      choices: [{ index: 0, message: { role: "assistant", content: "Hi!" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
    const result = JSON.parse(chatToResponsesResponse(chat));
    expect(result.object).toBe("response");
    expect(result.status).toBe("completed");
    expect(result.output).toBeDefined();
  });

  it("converts tool_calls to function_call output", () => {
    const chat = JSON.stringify({
      id: "chatcmpl-1", object: "chat.completion", model: "gpt-4o",
      choices: [{ index: 0, message: { role: "assistant", tool_calls: [
        { id: "call_1", type: "function", function: { name: "foo", arguments: '{"x":1}' } },
      ]}, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
    });
    const result = JSON.parse(chatToResponsesResponse(chat));
    expect(result.output.some((o: Record<string, unknown>) => o.type === "function_call")).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现桥接响应转换**

创建 `src/proxy/transform/response-bridge-responses.ts`。

**Responses → Chat**：`output[message]` → `choices[0].message.content`，`output[function_call]` → `choices[0].message.tool_calls[]`，`output[reasoning]` → `choices[0].message.reasoning_content`（扁平化），`status` → `finish_reason`，`usage` 重新映射。

**Chat → Responses**：`choices[0].message.content` → `output[message]`，`choices[0].message.tool_calls` → `output[function_call]`，`choices[0].message.reasoning_content` → `output[reasoning]`，`finish_reason` → `status`。

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: Commit**

```bash
git add src/proxy/transform/response-bridge-responses.ts tests/proxy/transform/response-bridge-responses.test.ts
git commit -m "feat(responses): implement Responses↔Chat bridge response transform"
```

---

## Task 7: 流式转换 — Anthropic SSE ↔ Responses SSE（一级）

**Files:**
- Create: `src/proxy/transform/stream-ant2resp.ts`
- Create: `src/proxy/transform/stream-resp2ant.ts`
- Create: `tests/proxy/transform/stream-ant2resp.test.ts`
- Create: `tests/proxy/transform/stream-resp2ant.test.ts`

- [ ] **Step 1: 编写 Anthropic→Responses 流式测试**

```typescript
import { describe, it, expect } from "vitest";
import { AnthropicToResponsesTransform } from "../../../src/proxy/transform/stream-ant2resp.js";
import { PassThrough } from "stream";

function collectOutput(transform: AnthropicToResponsesTransform): string[] {
  const output: string[] = [];
  transform.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  return output;
}

describe("AnthropicToResponsesTransform", () => {
  it("converts message_start → response.created + response.in_progress", () => {
    const t = new AnthropicToResponsesTransform("gpt-4o");
    const out = collectOutput(t);
    t.write(`event: message_start\ndata: ${JSON.stringify({
      type: "message_start",
      message: { id: "msg_1", type: "message", role: "assistant", content: [], model: "gpt-4o", usage: { input_tokens: 10 } },
    })}\n\n`);
    t.end();
    const joined = out.join("");
    expect(joined).toContain("response.created");
    expect(joined).toContain("response.in_progress");
  });

  it("converts text_delta → response.output_text.delta", () => {
    const t = new AnthropicToResponsesTransform("gpt-4o");
    const out = collectOutput(t);
    // 先发 message_start
    t.write(`event: message_start\ndata: ${JSON.stringify({
      type: "message_start", message: { id: "msg_1", role: "assistant", content: [], usage: { input_tokens: 10 } },
    })}\n\n`);
    // 发 content_block_start (text)
    t.write(`event: content_block_start\ndata: ${JSON.stringify({
      type: "content_block_start", index: 0, content_block: { type: "text", text: "" },
    })}\n\n`);
    // 发 text delta
    t.write(`event: content_block_delta\ndata: ${JSON.stringify({
      type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" },
    })}\n\n`);
    // 发 message_delta (stop)
    t.write(`event: message_delta\ndata: ${JSON.stringify({
      type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 },
    })}\n\n`);
    t.write(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
    t.end();
    const joined = out.join("");
    expect(joined).toContain("response.output_text.delta");
    expect(joined).toContain("response.completed");
  });

  it("converts tool_use → function_call events", () => {
    const t = new AnthropicToResponsesTransform("gpt-4o");
    const out = collectOutput(t);
    t.write(`event: message_start\ndata: ${JSON.stringify({
      type: "message_start", message: { id: "msg_1", role: "assistant", content: [], usage: { input_tokens: 5 } },
    })}\n\n`);
    t.write(`event: content_block_start\ndata: ${JSON.stringify({
      type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_abc", name: "foo", input: {} },
    })}\n\n`);
    t.write(`event: content_block_delta\ndata: ${JSON.stringify({
      type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"x":1}' },
    })}\n\n`);
    t.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`);
    t.write(`event: message_delta\ndata: ${JSON.stringify({
      type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 10 },
    })}\n\n`);
    t.write(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
    t.end();
    const joined = out.join("");
    expect(joined).toContain("response.function_call_arguments.delta");
    expect(joined).toContain("abc"); // call_id
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现 AnthropicToResponsesTransform**

创建 `src/proxy/transform/stream-ant2resp.ts`，继承 `BaseSSETransform`。

状态机字段：
```typescript
type Ant2RespState = "init" | "text" | "thinking" | "tool_use" | "closing";
private state: Ant2RespState = "init";
private responseId = generateRespId();
private currentOutputIndex = 0;
private currentContentIndex = 0;
private sequenceNumber = 0;
private hasResponseCreated = false;
private hasContentPartStarted = false;
private inputTokens = 0;
private outputTokens = 0;
private pendingStatus: string | null = null;
private activeToolCallId = "";
private activeToolCallName = "";
```

SSE 事件映射逻辑：

| Anthropic 事件 | Responses SSE 事件 |
|---|---|
| `message_start` | `response.created` + `response.in_progress` |
| `content_block_start[thinking]` | `response.output_item.added[reasoning]` + `response.reasoning_summary_part.added` |
| `content_block_delta[thinking_delta]` | `response.reasoning_summary_text.delta` |
| `content_block_start[text]` | `response.output_item.added[message]` + `response.content_part.added[output_text]` |
| `content_block_delta[text_delta]` | `response.output_text.delta` |
| `content_block_start[tool_use]` | `response.output_item.added[function_call]` |
| `content_block_delta[input_json_delta]` | `response.function_call_arguments.delta` |
| `content_block_stop` | `response.content_part.done` / `response.function_call_arguments.done` + `response.output_item.done` |
| `message_delta[stop_reason]` | 记录 pendingStatus + outputTokens |
| `message_stop` | `response.completed` |

- [ ] **Step 4: 编写 Responses→Anthropic 流式测试**

类似结构，反向验证。

- [ ] **Step 5: 实现 ResponsesToAnthropicTransform**

创建 `src/proxy/transform/stream-resp2ant.ts`。

| Responses SSE 事件 | Anthropic SSE 事件 |
|---|---|
| `response.created/in_progress` | `message_start` |
| `response.output_item.added[message]` | 记录 outputIndex |
| `response.content_part.added[output_text]` | `content_block_start[text]` |
| `response.output_text.delta` | `content_block_delta[text_delta]` |
| `response.output_item.added[function_call]` | `content_block_start[tool_use]` |
| `response.function_call_arguments.delta` | `content_block_delta[input_json_delta]` |
| `response.output_item.added[reasoning]` | `content_block_start[thinking]` |
| `response.reasoning_summary_text.delta` | `content_block_delta[thinking_delta]` |
| `response.completed` | `message_delta[stop_reason]` + `message_stop` |

- [ ] **Step 6: 运行所有流式测试确认通过**

Run: `cd /Users/zhushanwen/Code/llm-simple-router-workspace/feat-openai-response-endpoint && npx vitest run tests/proxy/transform/stream-ant2resp.test.ts tests/proxy/transform/stream-resp2ant.test.ts 2>&1 | tail -20`

- [ ] **Step 7: Commit**

```bash
git add src/proxy/transform/stream-ant2resp.ts src/proxy/transform/stream-resp2ant.ts tests/proxy/transform/stream-ant2resp.test.ts tests/proxy/transform/stream-resp2ant.test.ts
git commit -m "feat(responses): implement Anthropic↔Responses SSE streaming transforms (tier-1)"
```

---

## Task 8: 流式桥接 — Responses SSE ↔ Chat SSE（二级）

**Files:**
- Create: `src/proxy/transform/stream-bridge-chat2resp.ts`
- Create: `src/proxy/transform/stream-bridge-resp2chat.ts`
- Create: `tests/proxy/transform/stream-bridge.test.ts`

- [ ] **Step 1: 编写测试**

测试 Chat→Responses 桥接和 Responses→Chat 桥接两种方向。

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现 ChatToResponsesBridgeTransform**

`stream-bridge-chat2resp.ts`：将 Chat SSE 匿名 delta 转为 Responses 命名事件。

| Chat delta | Responses SSE 事件 |
|---|---|
| `delta: {role: "assistant"}` | `response.created` + `response.in_progress` |
| `delta: {content: "..."}` | `response.output_item.added[message]` + `response.content_part.added` + `response.output_text.delta` |
| `delta: {tool_calls: [{id, name}]}` | `response.output_item.added[function_call]` |
| `delta: {tool_calls: [{arguments}]}` | `response.function_call_arguments.delta` |
| `delta: {reasoning_content: "..."}` | `response.output_item.added[reasoning]` + `response.reasoning_summary_text.delta` |
| `finish_reason` | `response.completed` |
| `data: [DONE]` | （已由 response.completed 处理） |

- [ ] **Step 4: 实现 ResponsesToChatBridgeTransform**

`stream-bridge-resp2chat.ts`：将 Responses 命名事件转为 Chat 匿名 delta。

| Responses SSE 事件 | Chat delta |
|---|---|
| `response.output_text.delta` | `delta: {content: "..."}` |
| `response.output_item.added[function_call]` | `delta: {tool_calls: [{id, name}]}` |
| `response.function_call_arguments.delta` | `delta: {tool_calls: [{arguments}]}` |
| `response.reasoning_summary_text.delta` | `delta: {reasoning_content: "..."}` |
| `response.completed` | `finish_reason: "stop"` + `data: [DONE]` |

- [ ] **Step 5: 运行测试确认通过**

- [ ] **Step 6: Commit**

```bash
git add src/proxy/transform/stream-bridge-chat2resp.ts src/proxy/transform/stream-bridge-resp2chat.ts tests/proxy/transform/stream-bridge.test.ts
git commit -m "feat(responses): implement Responses↔Chat SSE bridge streaming transforms"
```

---

## Task 9: 扩展 TransformCoordinator — 3×3 转换矩阵 + 错误转换

**Files:**
- Modify: `src/proxy/transform/transform-coordinator.ts`
- Create: `tests/proxy/transform/transform-coordinator-responses.test.ts`

- [ ] **Step 1: 编写测试**

```typescript
import { describe, it, expect } from "vitest";
import { TransformCoordinator } from "../../../src/proxy/transform/transform-coordinator.js";

describe("TransformCoordinator 3×3 matrix", () => {
  const c = new TransformCoordinator();

  it("openai → openai: no transform", () => {
    expect(c.needsTransform("openai", "openai")).toBe(false);
  });

  it("anthropic → anthropic: no transform", () => {
    expect(c.needsTransform("anthropic", "anthropic")).toBe(false);
  });

  it("openai-responses → openai-responses: no transform", () => {
    expect(c.needsTransform("openai-responses", "openai-responses")).toBe(false);
  });

  it("openai-responses → anthropic: tier-1 request transform", () => {
    const result = c.transformRequest(
      { model: "gpt-4o", input: "Hello", instructions: "Hi" },
      "openai-responses", "anthropic", "gpt-4o",
    );
    expect(result.upstreamPath).toBe("/v1/messages");
    expect(result.body.system).toBe("Hi");
    expect(result.body.messages).toBeDefined();
  });

  it("anthropic → openai-responses: tier-1 request transform", () => {
    const result = c.transformRequest(
      { model: "claude", system: "Hi", messages: [{ role: "user", content: "Hello" }], max_tokens: 1024 },
      "anthropic", "openai-responses", "claude",
    );
    expect(result.upstreamPath).toBe("/v1/responses");
    expect(result.body.instructions).toBe("Hi");
    expect(result.body.input).toBeDefined();
  });

  it("openai → anthropic: existing transform preserved", () => {
    const result = c.transformRequest(
      { model: "gpt-4o", messages: [{ role: "user", content: "Hello" }] },
      "openai", "anthropic", "gpt-4o",
    );
    expect(result.upstreamPath).toBe("/v1/messages");
    expect(result.body.system).toBeUndefined();
    expect(result.body.messages).toBeDefined();
  });

  it("anthropic → openai: existing transform preserved", () => {
    const result = c.transformRequest(
      { model: "claude", system: "Hi", messages: [{ role: "user", content: "Hello" }], max_tokens: 1024 },
      "anthropic", "openai", "claude",
    );
    expect(result.upstreamPath).toBe("/v1/chat/completions");
    expect(result.body.messages).toBeDefined();
  });

  it("openai-responses → openai: bridge request transform", () => {
    const result = c.transformRequest(
      { model: "gpt-4o", input: "Hello", instructions: "Hi", max_output_tokens: 1024 },
      "openai-responses", "openai", "gpt-4o",
    );
    expect(result.upstreamPath).toBe("/v1/chat/completions");
    expect(result.body.messages).toBeDefined();
    expect(result.body.max_completion_tokens).toBe(1024);
  });

  it("openai → openai-responses: bridge request transform", () => {
    const result = c.transformRequest(
      { model: "gpt-4o", messages: [{ role: "system", content: "Hi" }, { role: "user", content: "Hello" }] },
      "openai", "openai-responses", "gpt-4o",
    );
    expect(result.upstreamPath).toBe("/v1/responses");
    expect(result.body.instructions).toBe("Hi");
    expect(result.body.input).toBeDefined();
  });

  it("creates correct stream transforms for each direction", () => {
    // 一级
    expect(c.createFormatTransform("openai-responses", "anthropic", "m")?.constructor.name).toContain("ResponsesToAnthropic");
    expect(c.createFormatTransform("anthropic", "openai-responses", "m")?.constructor.name).toContain("AnthropicToResponses");
    // 现有
    expect(c.createFormatTransform("anthropic", "openai", "m")?.constructor.name).toContain("AnthropicToOpenAI");
    expect(c.createFormatTransform("openai", "anthropic", "m")?.constructor.name).toContain("OpenAIToAnthropic");
    // 桥接
    expect(c.createFormatTransform("openai-responses", "openai", "m")?.constructor.name).toContain("ResponsesToChatBridge");
    expect(c.createFormatTransform("openai", "openai-responses", "m")?.constructor.name).toContain("ChatToResponsesBridge");
  });

  it("getUpstreamPath returns correct paths", () => {
    expect(c.transformRequest({ model: "x" }, "openai", "openai", "x").upstreamPath).toBe("/v1/chat/completions");
    expect(c.transformRequest({ model: "x" }, "anthropic", "anthropic", "x").upstreamPath).toBe("/v1/messages");
    expect(c.transformRequest({ model: "x" }, "openai-responses", "openai-responses", "x").upstreamPath).toBe("/v1/responses");
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 重写 TransformCoordinator**

用 3×3 矩阵重写 `transform-coordinator.ts`：

```typescript
import type { Transform } from "stream";
import { transformRequestBody } from "./request-transform.js";
import { transformResponseBody, transformErrorResponse } from "./response-transform.js";
import { OpenAIToAnthropicTransform } from "./stream-oa2ant.js";
import { AnthropicToOpenAITransform } from "./stream-ant2oa.js";
import {
  responsesToAnthropicRequest,
  anthropicToResponsesRequest,
} from "./request-transform-responses.js";
import {
  responsesToAnthropicResponse,
  anthropicToResponsesResponse,
} from "./response-transform-responses.js";
import {
  responsesToChatRequest,
  chatToResponsesRequest,
} from "./request-bridge-responses.js";
import {
  responsesToChatResponse,
  chatToResponsesResponse,
} from "./response-bridge-responses.js";
import { AnthropicToResponsesTransform } from "./stream-ant2resp.js";
import { ResponsesToAnthropicTransform } from "./stream-resp2ant.js";
import { ChatToResponsesBridgeTransform } from "./stream-bridge-chat2resp.js";
import { ResponsesToChatBridgeTransform } from "./stream-bridge-resp2chat.js";

export class TransformCoordinator {
  needsTransform(entryApiType: string, providerApiType: string): boolean {
    return entryApiType !== providerApiType;
  }

  transformRequest(
    body: Record<string, unknown>,
    entryApiType: string,
    providerApiType: string,
    model: string,
  ): { body: Record<string, unknown>; upstreamPath: string } {
    if (entryApiType === providerApiType) {
      return { body, upstreamPath: this.getUpstreamPath(providerApiType) };
    }

    // 一级：Responses ↔ Anthropic
    if (entryApiType === "openai-responses" && providerApiType === "anthropic") {
      return { body: responsesToAnthropicRequest(body), upstreamPath: "/v1/messages" };
    }
    if (entryApiType === "anthropic" && providerApiType === "openai-responses") {
      return { body: anthropicToResponsesRequest(body), upstreamPath: "/v1/responses" };
    }

    // 现有：OpenAI Chat ↔ Anthropic（保留）
    if (entryApiType === "openai" && providerApiType === "anthropic") {
      return { body: transformRequestBody(body, "openai", "anthropic", model), upstreamPath: "/v1/messages" };
    }
    if (entryApiType === "anthropic" && providerApiType === "openai") {
      return { body: transformRequestBody(body, "anthropic", "openai", model), upstreamPath: "/v1/chat/completions" };
    }

    // 二级：Responses ↔ Chat
    if (entryApiType === "openai-responses" && providerApiType === "openai") {
      return { body: responsesToChatRequest(body), upstreamPath: "/v1/chat/completions" };
    }
    if (entryApiType === "openai" && providerApiType === "openai-responses") {
      return { body: chatToResponsesRequest(body), upstreamPath: "/v1/responses" };
    }

    return { body, upstreamPath: this.getUpstreamPath(providerApiType) };
  }

  transformResponse(bodyStr: string, sourceApiType: string, targetApiType: string): string {
    if (sourceApiType === targetApiType) return bodyStr;

    // 一级
    if (sourceApiType === "openai-responses" && targetApiType === "anthropic") return responsesToAnthropicResponse(bodyStr);
    if (sourceApiType === "anthropic" && targetApiType === "openai-responses") return anthropicToResponsesResponse(bodyStr);

    // 现有
    if (sourceApiType === "openai" && targetApiType === "anthropic") return transformResponseBody(bodyStr, "openai", "anthropic");
    if (sourceApiType === "anthropic" && targetApiType === "openai") return transformResponseBody(bodyStr, "anthropic", "openai");

    // 二级
    if (sourceApiType === "openai-responses" && targetApiType === "openai") return responsesToChatResponse(bodyStr);
    if (sourceApiType === "openai" && targetApiType === "openai-responses") return chatToResponsesResponse(bodyStr);

    return bodyStr;
  }

  transformErrorResponse(bodyStr: string, sourceApiType: string, targetApiType: string): string {
    if (sourceApiType === targetApiType) return bodyStr;
    try {
      // 统一错误转换：解析源格式错误，重新打包为目标格式
      const parsed = JSON.parse(bodyStr);

      if (sourceApiType === "openai-responses" && targetApiType === "anthropic") {
        const err = parsed.error ?? parsed;
        return JSON.stringify({ type: "error", error: { type: "api_error", message: err.message ?? "Unknown error" } });
      }
      if (sourceApiType === "anthropic" && targetApiType === "openai-responses") {
        const err = parsed.error ?? parsed;
        return JSON.stringify({ error: { message: err.message ?? "Unknown error", type: "invalid_request_error", code: "upstream_error" } });
      }
      if (sourceApiType === "openai-responses" && targetApiType === "openai") {
        const err = parsed.error ?? parsed;
        return JSON.stringify({ error: { message: err.message ?? "Unknown error", type: "api_error", code: "upstream_error" } });
      }
      if (sourceApiType === "openai" && targetApiType === "openai-responses") {
        const err = (parsed.error ?? parsed);
        return JSON.stringify({ error: { message: err.message ?? "Unknown error", type: "invalid_request_error", code: "upstream_error" } });
      }
      // 剩余走原有逻辑
      return transformErrorResponse(bodyStr, sourceApiType, targetApiType);
    } catch {
      return bodyStr;
    }
  }

  createFormatTransform(entryApiType: string, providerApiType: string, model: string): Transform | undefined {
    if (entryApiType === providerApiType) return undefined;

    // 一级流式
    if (providerApiType === "anthropic" && entryApiType === "openai-responses") return new ResponsesToAnthropicTransform(model);
    if (providerApiType === "openai-responses" && entryApiType === "anthropic") return new AnthropicToResponsesTransform(model);

    // 现有流式
    if (providerApiType === "openai" && entryApiType === "anthropic") return new OpenAIToAnthropicTransform(model);
    if (providerApiType === "anthropic" && entryApiType === "openai") return new AnthropicToOpenAITransform(model);

    // 二级流式桥接
    if (providerApiType === "openai" && entryApiType === "openai-responses") return new ResponsesToChatBridgeTransform(model);
    if (providerApiType === "openai-responses" && entryApiType === "openai") return new ChatToResponsesBridgeTransform(model);

    return undefined;
  }

  private getUpstreamPath(apiType: string): string {
    switch (apiType) {
      case "openai": return "/v1/chat/completions";
      case "openai-responses": return "/v1/responses";
      case "anthropic": return "/v1/messages";
      default: return "/v1/chat/completions";
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /Users/zhushanwen/Code/llm-simple-router-workspace/feat-openai-response-endpoint && npx vitest run tests/proxy/transform/transform-coordinator-responses.test.ts 2>&1 | tail -20`

- [ ] **Step 5: 运行全部测试确认无回归**

Run: `cd /Users/zhushanwen/Code/llm-simple-router-workspace/feat-openai-response-endpoint && npm test -- --run 2>&1 | tail -30`

- [ ] **Step 6: Commit**

```bash
git add src/proxy/transform/transform-coordinator.ts tests/proxy/transform/transform-coordinator-responses.test.ts
git commit -m "feat(responses): extend TransformCoordinator for 3×3 conversion matrix"
```

---

## Task 10: 扩展 monitor/metrics 系统 — 支持 Responses SSE 解析

**Files:**
- Modify: `src/monitor/stream-extractor.ts`
- Modify: `src/metrics/metrics-extractor.ts`
- Modify: `src/metrics/sse-metrics-transform.ts`
- Modify: `src/proxy/handler/proxy-handler-utils.ts`

> 此 Task 使 monitor 和 metrics 模块能正确解析 Responses API 的 SSE 流。这些模块在 formatTransform 之后的旁路管道中运行，看到的始终是 provider 的原始 SSE 格式。

- [ ] **Step 1: 扩展 stream-extractor.ts — 添加 Responses 格式解析**

在 `extractStreamText` 函数中添加 `openai-responses` 分支：

```typescript
export function extractStreamText(line: string, apiType: "openai" | "openai-responses" | "anthropic"): StreamExtraction {
  // ... 现有 openai 和 anthropic 逻辑 ...

  if (apiType === "openai-responses") {
    // Responses SSE 使用 event: + data: 格式
    // line 格式: "data: {json}"
    const obj = JSON.parse(jsonStr) as Record<string, unknown>;
    const type = obj.type as string;

    if (type === "response.output_text.delta") {
      const text = (obj.delta as string) ?? "";
      return { text, block: text ? { index: obj.output_index as number ?? 0, type: "text", content: text } : null };
    }
    if (type === "response.function_call_arguments.delta") {
      const partialJson = (obj.delta as string) ?? "";
      return { text: "", block: { index: obj.output_index as number ?? 0, type: "tool_use", content: partialJson } };
    }
    if (type === "response.reasoning_summary_text.delta") {
      const thinking = (obj.delta as string) ?? "";
      return { text: "", block: { index: obj.output_index as number ?? 0, type: "thinking", content: thinking } };
    }
    return empty;
  }
```

- [ ] **Step 2: 扩展 metrics-extractor.ts — 添加 Responses 事件处理**

在 `MetricsExtractor.processEvent` 中添加 `openai-responses` 分支：

```typescript
processEvent(event: SSEEvent): void {
  if (!event.data) return;
  if (this.apiType === "anthropic") {
    this.processAnthropicEvent(event);
  } else if (this.apiType === "openai-responses") {
    this.processResponsesEvent(event);
  } else {
    this.processOpenAIEvent(event);
  }
}

private processResponsesEvent(event: SSEEvent): void {
  const obj = JSON.parse(event.data) as Record<string, unknown>;
  const type = obj.type as string;

  if (type === "response.created" || type === "response.in_progress") {
    this.streamStartTime = Date.now();
    const resp = obj.response as Record<string, unknown> | undefined;
    // 从 response.usage 提取初始 input_tokens（如果存在）
  }

  if (type === "response.output_text.delta" || type === "response.function_call_arguments.delta" || type === "response.reasoning_summary_text.delta") {
    const delta = (obj.delta as string) ?? "";
    if (delta && !this.firstContentReceived) {
      this.firstContentReceived = true;
      this.ttftMs = Date.now() - this.requestStartTime;
    }
    this.textContentBuffer += delta;
  }

  if (type === "response.completed") {
    this.streamEndTime = Date.now();
    this.complete = true;
    const resp = obj.response as Record<string, unknown> | undefined;
    const usage = resp?.usage as Record<string, number> | undefined;
    if (usage) {
      this.inputTokens = usage.input_tokens ?? null;
      this.outputTokens = usage.output_tokens ?? null;
    }
    if (resp?.status === "completed") this.stopReason = "end_turn";
    else if (resp?.status === "incomplete") this.stopReason = "max_tokens";
    else this.stopReason = "stop";
  }
}
```

- [ ] **Step 3: 扩展 sse-metrics-transform.ts — extractContentDelta 支持 Responses**

在 `extractContentDelta` 方法中添加 `openai-responses` 分支：

```typescript
private extractContentDelta(data: string): string | undefined {
  // ... 现有逻辑 ...
  if (this.apiType === "openai-responses") {
    const parsed = JSON.parse(data) as Record<string, unknown>;
    const type = parsed.type as string;
    if (type === "response.output_text.delta") return parsed.delta as string;
    if (type === "response.reasoning_summary_text.delta") return parsed.delta as string;
    if (type === "response.function_call_arguments.delta") return parsed.delta as string;
    return undefined;
  }
  // ...
}
```

- [ ] **Step 4: 扩展 proxy-handler-utils.ts — serializeBlocksForStorage**

函数签名已在 Task 2 扩展。Responses 格式的 stream content 通过 `extractStreamText` 的新分支处理，无需额外修改。

- [ ] **Step 5: 运行全部测试**

Run: `cd /Users/zhushanwen/Code/llm-simple-router-workspace/feat-openai-response-endpoint && npm test -- --run 2>&1 | tail -30`

- [ ] **Step 6: Commit**

```bash
git add src/monitor/stream-extractor.ts src/metrics/metrics-extractor.ts src/metrics/sse-metrics-transform.ts
git commit -m "feat(responses): extend monitor/metrics to parse Responses SSE events"
```

---

## Task 11: 扩展 patch/plugin 系统 — 兼容 openai-responses

**Files:**
- Modify: `src/proxy/patch/tool-round-limiter.ts`
- Modify: `src/proxy/loop-prevention/tool-loop-guard.ts`
- Modify: `src/proxy/patch/index.ts`
- Modify: `src/proxy/patch/deepseek/patch-thinking-param.ts`

> patch 系统在 proxy-handler 中的执行位置：**格式转换之后**（所以 patch 看到的 body 已经是 provider 的 api_type 格式）。但如果 patch 逻辑使用入口 apiType（如 tool-round-limiter），需要处理 openai-responses 的情况。

- [ ] **Step 1: 扩展 tool-round-limiter.ts — 支持 Responses 格式的 input**

在 `applyToolRoundLimit` 函数中，当 `apiType === "openai-responses"` 时，需要将 `input` items 转为 messages 格式来计算轮数，或者直接扫描 input items：

```typescript
export function applyToolRoundLimit(
  body: Record<string, unknown>,
  apiType: "openai" | "openai-responses" | "anthropic",
  maxRounds: number = DEFAULT_MAX_ROUNDS,
): { body: Record<string, unknown>; injected: boolean; rounds: number } {
  // Responses 格式：检查 input items 中的 function_call 数量
  if (apiType === "openai-responses") {
    const input = body.input as Array<Record<string, unknown>> | undefined;
    if (!input || !Array.isArray(input)) return { body, injected: false, rounds: 0 };
    const funcCalls = input.filter(i => i.type === "function_call").length;
    if (funcCalls <= maxRounds) return { body, injected: false, rounds: funcCalls };
    // 注入提示词：在最后一条 input item 后追加
    const cloned = { ...body, input: [...input] };
    const inputArr = cloned.input as Array<Record<string, unknown>>;
    inputArr.push({
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: LOOP_WARNING_PROMPT }],
    });
    return { body: cloned, injected: true, rounds: funcCalls };
  }

  // 现有逻辑（openai / anthropic）...
  const messages = (body.messages as Message[]) ?? [];
  // ... 不变
}
```

- [ ] **Step 2: 扩展 tool-loop-guard.ts — injectLoopBreakPrompt 支持 Responses**

在 `injectLoopBreakPrompt` 方法中添加 `openai-responses` 分支：

```typescript
injectLoopBreakPrompt(body: Record<string, unknown>, apiType: "openai" | "openai-responses" | "anthropic", toolName: string): Record<string, unknown> {
  if (apiType === "openai-responses") {
    // Responses 格式：追加 user message 到 input
    const input = body.input;
    const inputArr = Array.isArray(input) ? [...input] : [{ type: "message", role: "user", content }];
    // ... 在 inputArr 末尾追加提示消息
    return { ...body, input: inputArr };
  }
  // 现有 anthropic / openai 逻辑不变
}
```

- [ ] **Step 3: 确认 patch/index.ts 的 developer_role patch 对 Responses 无害**

当前 `patchDeveloperRole` 只处理 `body.messages`，Responses 格式的 body 没有 `messages` 字段，`hasDeveloperRole` 返回 false，安全跳过。无需修改。

- [ ] **Step 4: 确认 deepseek/patch-thinking-param.ts 兼容**

签名已在 Task 2 扩展。函数体内 `if (apiType === "anthropic")` 分支不变，`openai-responses` 走 else 分支（与 openai 相同的逻辑），安全。

- [ ] **Step 5: 确认 plugin-types.ts 兼容**

签名已扩展。现有 plugin 的 `match.apiType` 仍为 `"openai"` 或 `"anthropic"`，不会匹配 `openai-responses` 的 provider。用户后续可自行编写针对 `openai-responses` 的 plugin。

- [ ] **Step 6: 运行全部测试**

Run: `cd /Users/zhushanwen/Code/llm-simple-router-workspace/feat-openai-response-endpoint && npm test -- --run 2>&1 | tail -30`

- [ ] **Step 7: Commit**

```bash
git add src/proxy/patch/tool-round-limiter.ts src/proxy/loop-prevention/tool-loop-guard.ts
git commit -m "feat(responses): extend patch/loop-prevention to handle openai-responses format"
```

---

## Task 12: Responses API 端点路由 + 注册

**Files:**
- Create: `src/proxy/handler/responses.ts`
- Modify: `src/index.ts`
- Modify: `src/proxy/response-transform.ts`

- [ ] **Step 1: 创建 Responses 端点 handler**

创建 `src/proxy/handler/responses.ts`，仿照 `openai.ts`：

```typescript
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "crypto";
import Database from "better-sqlite3";
import fp from "fastify-plugin";
import { insertRequestLog } from "../../db/index.js";
import { createErrorFormatter, type ProxyErrorResponse } from "../proxy-core.js";
import type { ErrorKind } from "../proxy-core.js";
import type { RawHeaders } from "../types.js";
import { handleProxyRequest, type RouteHandlerDeps } from "./proxy-handler.js";
import { createOrchestrator } from "../orchestration/orchestrator.js";
import { ProviderSemaphoreManager } from "../orchestration/semaphore.js";
import type { RequestTracker } from "../../monitor/request-tracker.js";
import type { AdaptiveConcurrencyController } from "../adaptive-controller.js";
import { HTTP_BAD_GATEWAY } from "../../core/constants.js";
import { SERVICE_KEYS } from "../../core/container.js";

export interface ResponsesProxyOptions {
  db: Database.Database;
  container: import("../../core/container.js").ServiceContainer;
}

const RESPONSES_PATH = "/v1/responses";
const RESPONSES_COMPAT_PATH = "/responses";

// 复用 OpenAI 错误格式（Responses API 的错误格式与 OpenAI 一致）
const RESPONSES_ERROR_META: Record<ErrorKind, { type: string; code: string }> = {
  modelNotFound: { type: "invalid_request_error", code: "model_not_found" },
  modelNotAllowed: { type: "invalid_request_error", code: "model_not_allowed" },
  providerUnavailable: { type: "server_error", code: "provider_unavailable" },
  providerTypeMismatch: { type: "server_error", code: "provider_type_mismatch" },
  upstreamConnectionFailed: { type: "upstream_error", code: "upstream_connection_failed" },
  concurrencyQueueFull: { type: "server_error", code: "concurrency_queue_full" },
  concurrencyTimeout: { type: "server_error", code: "concurrency_timeout" },
  promptTooLong: { type: "invalid_request_error", code: "context_window_exceeded" },
};

const responsesErrors = createErrorFormatter(
  (kind, message) => ({ error: { message, ...RESPONSES_ERROR_META[kind] } }),
);

function sendError(reply: FastifyReply, e: ProxyErrorResponse) {
  return reply.code(e.statusCode).send(e.body);
}

const responsesProxyRaw: FastifyPluginCallback<ResponsesProxyOptions> = (app, opts, done) => {
  const { db, container } = opts;

  const orchestrator = createOrchestrator(
    container.resolve<ProviderSemaphoreManager>(SERVICE_KEYS.semaphoreManager),
    container.resolve<RequestTracker>(SERVICE_KEYS.tracker),
    container.resolve<AdaptiveConcurrencyController>(SERVICE_KEYS.adaptiveController),
  );

  const handleResponses = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!orchestrator) {
      const body = request.body as Record<string, unknown> | undefined;
      insertRequestLog(db, {
        id: randomUUID(), api_type: "openai-responses", model: (body?.model as string) || null,
        provider_id: null, status_code: HTTP_BAD_GATEWAY, latency_ms: 0, is_stream: 0,
        error_message: "Orchestrator not available",
        created_at: new Date().toISOString(),
        client_request: JSON.stringify({ headers: request.headers }),
        router_key_id: request.routerKey?.id ?? null,
      });
      return sendError(reply, responsesErrors.providerUnavailable());
    }
    const deps: RouteHandlerDeps = { db, orchestrator, container };
    return handleProxyRequest(request, reply, "openai-responses", RESPONSES_PATH, responsesErrors, deps);
  };

  app.post(RESPONSES_PATH, handleResponses);
  app.post(RESPONSES_COMPAT_PATH, handleResponses);

  done();
};

export const responsesProxy = fp(responsesProxyRaw, { name: "responses-proxy" });
```

- [ ] **Step 2: 在 src/index.ts 中注册 Responses 路由**

在 `buildApp` 函数中，找到 `app.register(openaiProxy, { db, container })` 和 `app.register(anthropicProxy, { db, container })` 的位置，在其后添加：

```typescript
import { responsesProxy } from "./proxy/handler/responses.js";
// ...
app.register(openaiProxy, { db, container });
app.register(anthropicProxy, { db, container });
app.register(responsesProxy, { db, container });
```

- [ ] **Step 3: 扩展 response-transform.ts — maybeInjectModelInfoTag**

`maybeInjectModelInfoTag` 目前只在 Anthropic 格式（`bodyObj.content?.[0]?.text`）中注入。对于 Responses 格式，需要检查 `output[type=message].content[type=output_text].text`：

```typescript
export function maybeInjectModelInfoTag(
  responseBody: string,
  originalModel: string | null,
  effectiveModel: string,
): { body: string; meta: ResponseTransformMeta } {
  if (!originalModel) {
    return { body: responseBody, meta: { model_info_tag_injected: false } };
  }
  try {
    const bodyObj = JSON.parse(responseBody);

    // Anthropic 格式
    if (bodyObj.content?.[0]?.text) {
      bodyObj.content[0].text += `\n\n${buildModelInfoTag(effectiveModel)}`;
      return { body: JSON.stringify(bodyObj), meta: { model_info_tag_injected: true } };
    }

    // Responses 格式：output[type=message].content[type=output_text].text
    if (Array.isArray(bodyObj.output)) {
      for (const item of bodyObj.output) {
        if (item.type === "message" && Array.isArray(item.content)) {
          for (const part of item.content) {
            if (part.type === "output_text" && part.text) {
              part.text += `\n\n${buildModelInfoTag(effectiveModel)}`;
              return { body: JSON.stringify(bodyObj), meta: { model_info_tag_injected: true } };
            }
          }
        }
      }
    }
  } catch { /* non-JSON response, skip injection */ }
  return { body: responseBody, meta: { model_info_tag_injected: false } };
}
```

- [ ] **Step 4: 运行全部测试**

Run: `cd /Users/zhushanwen/Code/llm-simple-router-workspace/feat-openai-response-endpoint && npm test -- --run 2>&1 | tail -30`

- [ ] **Step 5: Commit**

```bash
git add src/proxy/handler/responses.ts src/index.ts src/proxy/response-transform.ts
git commit -m "feat(responses): add /v1/responses endpoint and register route"
```

---

## Task 13: 前端支持 — Provider 管理

**Files:**
- Modify: `frontend/src/views/Providers.vue`

- [ ] **Step 1: 添加 openai-responses 选项**

在 `frontend/src/views/Providers.vue` 中找到 SelectContent 部分（约第 128 行），添加：

```html
<SelectContent>
  <SelectItem value="openai">OpenAI</SelectItem>
  <SelectItem value="openai-responses">OpenAI Responses</SelectItem>
  <SelectItem value="anthropic">Anthropic</SelectItem>
</SelectContent>
```

- [ ] **Step 2: 验证前端构建**

Run: `cd /Users/zhushanwen/Code/llm-simple-router-workspace/feat-openai-response-endpoint/frontend && pnpm build 2>&1 | tail -10`
Expected: 构建成功

- [ ] **Step 3: Commit**

```bash
git add frontend/src/views/Providers.vue
git commit -m "feat(responses): add openai-responses option in provider form"
```

---

## Task 14: 集成测试 + 全量回归验证

**Files:**
- Create: `tests/proxy/transform/integration-responses.test.ts`

- [ ] **Step 1: 编写集成测试**

```typescript
import { describe, it, expect } from "vitest";
import { TransformCoordinator } from "../../../src/proxy/transform/transform-coordinator.js";

const coordinator = new TransformCoordinator();

describe("Responses API integration — full conversion pipeline", () => {
  it("Responses → Anthropic → Responses (round-trip preserves intent)", () => {
    const request = {
      model: "gpt-4o",
      input: [
        { type: "message", role: "user", content: "What's the weather?" },
      ],
      instructions: "You are a weather assistant.",
      tools: [{ type: "function", name: "get_weather", parameters: { type: "object", properties: { city: { type: "string" } } } }],
      max_output_tokens: 2048,
    };

    // Responses → Anthropic
    const { body: antReq } = coordinator.transformRequest(request, "openai-responses", "anthropic", "gpt-4o");
    expect(antReq.system).toBe("You are a weather assistant.");
    expect(antReq.messages).toBeDefined();
    expect(antReq.tools).toBeDefined();

    // Anthropic → Responses (响应方向)
    const antResponse = JSON.stringify({
      id: "msg_1", type: "message", role: "assistant", model: "gpt-4o",
      content: [{ type: "text", text: "The weather is sunny." }],
      stop_reason: "end_turn",
      usage: { input_tokens: 20, output_tokens: 10 },
    });
    const respResponse = coordinator.transformResponse(antResponse, "anthropic", "openai-responses");
    const parsed = JSON.parse(respResponse);
    expect(parsed.object).toBe("response");
    expect(parsed.status).toBe("completed");
  });

  it("Responses → Chat (bridge) → back to Responses (round-trip)", () => {
    const request = {
      model: "gpt-4o",
      input: "Hello",
      instructions: "Be helpful",
      max_output_tokens: 1024,
    };

    // Responses → Chat
    const { body: chatReq } = coordinator.transformRequest(request, "openai-responses", "openai", "gpt-4o");
    expect(chatReq.messages).toBeDefined();
    expect(chatReq.max_completion_tokens).toBe(1024);

    // Chat → Responses
    const { body: respReq } = coordinator.transformRequest(chatReq, "openai", "openai-responses", "gpt-4o");
    expect(respReq.instructions).toBe("Be helpful");
    expect(respReq.max_output_tokens).toBe(1024);
  });

  it("Chat → Responses → Chat (bridge round-trip)", () => {
    const request = {
      model: "gpt-4o",
      messages: [
        { role: "system", content: "Be helpful" },
        { role: "user", content: "Hello" },
      ],
      max_completion_tokens: 1024,
      temperature: 0.7,
    };

    // Chat → Responses
    const { body: respReq } = coordinator.transformRequest(request, "openai", "openai-responses", "gpt-4o");
    expect(respReq.instructions).toBe("Be helpful");
    expect(respReq.max_output_tokens).toBe(1024);

    // Responses → Chat
    const { body: chatReq } = coordinator.transformRequest(respReq, "openai-responses", "openai", "gpt-4o");
    expect(chatReq.messages).toBeDefined();
    expect(chatReq.max_completion_tokens).toBe(1024);
    expect(chatReq.temperature).toBe(0.7);
  });

  it("existing Anthropic ↔ Chat path still works (regression check)", () => {
    const request = {
      model: "claude",
      system: "Be helpful",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 1024,
    };

    const { body: chatReq } = coordinator.transformRequest(request, "anthropic", "openai", "claude");
    expect(chatReq.messages).toBeDefined();

    const { body: antReq } = coordinator.transformRequest(chatReq, "openai", "anthropic", "claude");
    expect(antReq.messages).toBeDefined();
  });
});
```

- [ ] **Step 2: 运行全部测试**

Run: `cd /Users/zhushanwen/Code/llm-simple-router-workspace/feat-openai-response-endpoint && npm test -- --run 2>&1 | tail -40`
Expected: 所有测试 PASS

- [ ] **Step 3: 运行 TypeScript 类型检查**

Run: `cd /Users/zhushanwen/Code/llm-simple-router-workspace/feat-openai-response-endpoint && npx tsc --noEmit 2>&1 | head -30`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add tests/proxy/transform/integration-responses.test.ts
git commit -m "test(responses): add integration tests for full conversion pipeline"
```

---

## 执行顺序与依赖关系

```
Task 1 (类型定义)
  ↓
Task 2 (api_type 全局扩展 — 20+ 文件签名统一)
  ↓
  ├── Task 3 + Task 4 (一级请求/响应转换，可并行)
  ├── Task 5 + Task 6 (桥接请求/响应转换，可并行)
  ├── Task 7 + Task 8 (一级/桥接流式转换，可并行)
  │                    ↓
  │        Task 9 (TransformCoordinator 3×3 矩阵)
  │                ↓
  │        Task 10 (monitor/metrics 扩展)
  │                ↓
  │        Task 11 (patch/plugin 兼容)
  │                ↓
  │        Task 12 (端点路由 + 注册)
  │                ↓
  │        Task 13 (前端支持)
  │                ↓
  │        Task 14 (集成测试)
```

**可并行的任务组：**
- Group A: Task 3 + Task 4（一级转换的请求和响应）
- Group B: Task 5 + Task 6（桥接的请求和响应）
- Group C: Task 7 + Task 8（流式转换的一级和桥接）

**预估工作量：** 14 个 Task，约 12-16 小时。Task 2（全局类型扩展）和 Task 7/8（流式状态机）是最耗时的部分。
