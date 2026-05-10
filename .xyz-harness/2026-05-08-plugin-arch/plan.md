# 插件化架构重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 llm-simple-router 的请求处理流程从单体函数重构为插件化管道架构，支持内部模块统一注册和外部插件扩展。

**Architecture:** 三个核心抽象——FormatAdapter/Converter（格式注册表）、ProxyPipeline（管道编排器）、PipelineHook（统一钩子接口）。管道骨架 Route→Transform→Transport，6 个 HookPhase 提供扩展点。FailoverLoop 在管道外层循环。

**Tech Stack:** TypeScript, Fastify, better-sqlite3, Node.js streams, Vitest

**Spec:** `.superpowers/2026-05-08-plugin-arch/spec.md`

**Phase 依赖关系：**
```
Phase 1 (FormatAdapter) ──┐
                           ├──→ Phase 3 (Handler 工厂) → Phase 4 (插件增强) → Phase 5 (清理)
Phase 2 (Pipeline)     ──┘
```
Phase 1 和 2 可并行。Phase 3 依赖两者。4、5 串行。

---

## Phase 1：FormatAdapter + FormatConverter 注册表

### Task 1: 创建 format/types.ts — 接口定义

**Files:**
- Create: `router/src/proxy/format/types.ts`

- [ ] **Step 1: 创建接口文件**

```typescript
// router/src/proxy/format/types.ts
import type { Transform } from "stream";

/** 错误类型标识（与 proxy-core.ts 的 ErrorKind 对齐） */
export type ErrorKind =
  | "modelNotFound"
  | "modelNotAllowed"
  | "providerUnavailable"
  | "providerTypeMismatch"
  | "upstreamConnectionFailed"
  | "concurrencyQueueFull"
  | "concurrencyTimeout"
  | "promptTooLong";

/** 格式元数据 — 描述"这个格式是什么" */
export interface FormatAdapter {
  /** 格式标识，如 "openai" | "anthropic" | "openai-responses" */
  readonly apiType: string;

  /** 该格式的默认上游路径 */
  readonly defaultPath: string;

  /** 错误响应格式定义（供 Handler 工厂创建 errorFormatter） */
  readonly errorMeta: Record<ErrorKind, { type: string; code: string }>;

  /** 可选：请求发送前的 body 钩子（如 OpenAI 注入 stream_options） */
  beforeSendProxy?(body: Record<string, unknown>, isStream: boolean): void;

  /** 将通用错误信息格式化为本格式的错误响应体 */
  formatError(message: string, code?: string): unknown;
}

/** 方向转换器 — 描述"从 A 格式到 B 格式如何转换" */
export interface FormatConverter {
  /** 源格式标识 */
  readonly sourceType: string;

  /** 目标格式标识 */
  readonly targetType: string;

  /** 转换请求体 */
  transformRequest(
    body: Record<string, unknown>,
    model: string,
  ): { body: Record<string, unknown>; upstreamPath: string };

  /** 转换非流式响应体 */
  transformResponse(bodyStr: string): string;

  /** 创建流式 SSE Transform */
  createStreamTransform(model: string): Transform;
}
```

- [ ] **Step 2: 验证编译**

Run: `cd router && npx tsc --noEmit src/proxy/format/types.ts`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add router/src/proxy/format/types.ts
git commit -m "feat(format): add FormatAdapter and FormatConverter interfaces"
```

### Task 2: 创建 format/registry.ts — 注册表

**Files:**
- Create: `router/src/proxy/format/registry.ts`
- Create: `router/tests/proxy/format/registry.test.ts`

- [ ] **Step 1: 写 registry 测试**

```typescript
// router/tests/proxy/format/registry.test.ts
import { describe, it, expect } from "vitest";
import { FormatRegistry } from "../../../src/proxy/format/registry.js";
import type { FormatAdapter, FormatConverter } from "../../../src/proxy/format/types.js";
import { Transform } from "stream";

// --- Test doubles ---

const openaiAdapter: FormatAdapter = {
  apiType: "openai",
  defaultPath: "/v1/chat/completions",
  errorMeta: {
    modelNotFound: { type: "invalid_request_error", code: "model_not_found" },
    providerUnavailable: { type: "server_error", code: "provider_unavailable" },
    upstreamConnectionFailed: { type: "upstream_error", code: "upstream_connection_failed" },
    concurrencyQueueFull: { type: "server_error", code: "concurrency_queue_full" },
    concurrencyTimeout: { type: "server_error", code: "concurrency_timeout" },
    modelNotAllowed: { type: "invalid_request_error", code: "model_not_allowed" },
    providerTypeMismatch: { type: "server_error", code: "provider_type_mismatch" },
    promptTooLong: { type: "invalid_request_error", code: "context_window_exceeded" },
  },
  beforeSendProxy(body, isStream) {
    if (isStream && !body.stream_options) {
      body.stream_options = { include_usage: true };
    }
  },
  formatError(message, code) {
    return { error: { message, type: "invalid_request_error", code: code ?? "upstream_error" } };
  },
};

const anthropicAdapter: FormatAdapter = {
  apiType: "anthropic",
  defaultPath: "/v1/messages",
  errorMeta: {
    modelNotFound: { type: "not_found_error", code: "model_not_found" },
    providerUnavailable: { type: "api_error", code: "provider_unavailable" },
    upstreamConnectionFailed: { type: "upstream_error", code: "upstream_connection_failed" },
    concurrencyQueueFull: { type: "api_error", code: "concurrency_queue_full" },
    concurrencyTimeout: { type: "api_error", code: "concurrency_timeout" },
    modelNotAllowed: { type: "forbidden_error", code: "model_not_allowed" },
    providerTypeMismatch: { type: "api_error", code: "provider_type_mismatch" },
    promptTooLong: { type: "invalid_request_error", code: "context_window_exceeded" },
  },
  formatError(message) {
    return { type: "error", error: { type: "api_error", message } };
  },
};

function createMockConverter(source: string, target: string): FormatConverter {
  return {
    sourceType: source,
    targetType: target,
    transformRequest(body, _model) {
      return { body: { ...body, _converted: `${source}->${target}` }, upstreamPath: `/v1/${target}` };
    },
    transformResponse(bodyStr) {
      const parsed = JSON.parse(bodyStr);
      return JSON.stringify({ ...parsed, _converted: `${source}->${target}` });
    },
    createStreamTransform(_model) {
      return new Transform({ transform(chunk, _, cb) { cb(null, chunk); } });
    },
  };
}

describe("FormatRegistry", () => {
  it("needsTransform returns false for same type", () => {
    const registry = new FormatRegistry();
    expect(registry.needsTransform("openai", "openai")).toBe(false);
  });

  it("needsTransform returns true for different types", () => {
    const registry = new FormatRegistry();
    expect(registry.needsTransform("openai", "anthropic")).toBe(true);
  });

  it("getAdapter returns registered adapter", () => {
    const registry = new FormatRegistry();
    registry.registerAdapter(openaiAdapter);
    expect(registry.getAdapter("openai")).toBe(openaiAdapter);
  });

  it("getAdapter returns undefined for unknown type", () => {
    const registry = new FormatRegistry();
    expect(registry.getAdapter("gemini")).toBeUndefined();
  });

  it("transformRequest delegates to converter", () => {
    const registry = new FormatRegistry();
    registry.registerAdapter(openaiAdapter);
    registry.registerAdapter(anthropicAdapter);
    registry.registerConverter(createMockConverter("openai", "anthropic"));

    const result = registry.transformRequest({ messages: [] }, "openai", "anthropic", "gpt-4");
    expect(result.body._converted).toBe("openai->anthropic");
    expect(result.upstreamPath).toBe("/v1/anthropic");
  });

  it("transformRequest returns original body when no converter", () => {
    const registry = new FormatRegistry();
    const body = { messages: [] };
    const result = registry.transformRequest(body, "openai", "gemini", "gpt-4");
    expect(result.body).toBe(body);
  });

  it("transformResponse delegates to converter", () => {
    const registry = new FormatRegistry();
    registry.registerConverter(createMockConverter("openai", "anthropic"));

    const result = registry.transformResponse('{"choices":[]}', "openai", "anthropic");
    const parsed = JSON.parse(result);
    expect(parsed._converted).toBe("openai->anthropic");
  });

  it("transformResponse returns original when no converter", () => {
    const registry = new FormatRegistry();
    expect(registry.transformResponse('{"ok":true}', "openai", "gemini")).toBe('{"ok":true}');
  });

  it("transformError extracts message and formats with target adapter", () => {
    const registry = new FormatRegistry();
    registry.registerAdapter(openaiAdapter);
    registry.registerAdapter(anthropicAdapter);

    const result = registry.transformError(
      '{"error":{"message":"model not found"}}',
      "openai",
      "anthropic",
    );
    const parsed = JSON.parse(result);
    expect(parsed.type).toBe("error");
    expect(parsed.error.message).toBe("model not found");
  });

  it("transformError returns original when source===target", () => {
    const registry = new FormatRegistry();
    const body = '{"error":{"message":"fail"}}';
    expect(registry.transformError(body, "openai", "openai")).toBe(body);
  });

  it("createStreamTransform returns undefined when no converter", () => {
    const registry = new FormatRegistry();
    expect(registry.createStreamTransform("openai", "gemini", "gpt-4")).toBeUndefined();
  });

  it("createStreamTransform returns Transform when converter exists", () => {
    const registry = new FormatRegistry();
    registry.registerConverter(createMockConverter("openai", "anthropic"));
    expect(registry.createStreamTransform("openai", "anthropic", "gpt-4")).toBeDefined();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd router && npx vitest run tests/proxy/format/registry.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 FormatRegistry**

```typescript
// router/src/proxy/format/registry.ts
import type { Transform } from "stream";
import type { FormatAdapter, FormatConverter } from "./types.js";

export class FormatRegistry {
  private adapters = new Map<string, FormatAdapter>();
  private converters = new Map<string, FormatConverter>();

  registerAdapter(adapter: FormatAdapter): void {
    this.adapters.set(adapter.apiType, adapter);
  }

  registerConverter(converter: FormatConverter): void {
    this.converters.set(`${converter.sourceType}→${converter.targetType}`, converter);
  }

  getAdapter(apiType: string): FormatAdapter | undefined {
    return this.adapters.get(apiType);
  }

  needsTransform(source: string, target: string): boolean {
    return source !== target;
  }

  transformRequest(
    body: Record<string, unknown>,
    source: string,
    target: string,
    model: string,
  ): { body: Record<string, unknown>; upstreamPath: string } {
    const converter = this.converters.get(`${source}→${target}`);
    if (!converter) {
      const targetAdapter = this.adapters.get(target);
      return { body, upstreamPath: targetAdapter?.defaultPath ?? "/v1/chat/completions" };
    }
    return converter.transformRequest(body, model);
  }

  transformResponse(bodyStr: string, source: string, target: string): string {
    const converter = this.converters.get(`${source}→${target}`);
    if (!converter) return bodyStr;
    return converter.transformResponse(bodyStr);
  }

  transformError(bodyStr: string, source: string, target: string): string {
    if (source === target) return bodyStr;
    try {
      const parsed = JSON.parse(bodyStr);
      const message =
        parsed.error?.message ?? parsed.message ?? String(parsed);
      const targetAdapter = this.adapters.get(target);
      if (!targetAdapter) return bodyStr;
      return JSON.stringify(targetAdapter.formatError(String(message)));
    } catch {
      return bodyStr;
    }
  }

  createStreamTransform(source: string, target: string, model: string): Transform | undefined {
    const converter = this.converters.get(`${source}→${target}`);
    return converter?.createStreamTransform(model);
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd router && npx vitest run tests/proxy/format/registry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add router/src/proxy/format/registry.ts router/tests/proxy/format/registry.test.ts
git commit -m "feat(format): add FormatRegistry with tests"
```

### Task 3: 创建 3 个 FormatAdapter

**Files:**
- Create: `router/src/proxy/format/adapters/openai.ts`
- Create: `router/src/proxy/format/adapters/anthropic.ts`
- Create: `router/src/proxy/format/adapters/responses.ts`

- [ ] **Step 1: 创建 OpenAI adapter**

从当前 `router/src/proxy/handler/openai.ts` 的 `OPENAI_ERROR_META` 常量和 `beforeSendProxy` 逻辑提取。

```typescript
// router/src/proxy/format/adapters/openai.ts
import type { FormatAdapter } from "../types.js";

const OPENAI_ERROR_META = {
  modelNotFound: { type: "invalid_request_error", code: "model_not_found" },
  modelNotAllowed: { type: "invalid_request_error", code: "model_not_allowed" },
  providerUnavailable: { type: "server_error", code: "provider_unavailable" },
  providerTypeMismatch: { type: "server_error", code: "provider_type_mismatch" },
  upstreamConnectionFailed: { type: "upstream_error", code: "upstream_connection_failed" },
  concurrencyQueueFull: { type: "server_error", code: "concurrency_queue_full" },
  concurrencyTimeout: { type: "server_error", code: "concurrency_timeout" },
  promptTooLong: { type: "invalid_request_error", code: "context_window_exceeded" },
};

export const openaiAdapter: FormatAdapter = {
  apiType: "openai",
  defaultPath: "/v1/chat/completions",
  errorMeta: OPENAI_ERROR_META,

  beforeSendProxy(body, isStream) {
    if (isStream && !body.stream_options) {
      body.stream_options = { include_usage: true };
    }
  },

  formatError(message, code) {
    return { error: { message, type: "upstream_error", code: code ?? "upstream_error" } };
  },
};
```

- [ ] **Step 2: 创建 Anthropic adapter**

```typescript
// router/src/proxy/format/adapters/anthropic.ts
import type { FormatAdapter } from "../types.js";

const ANTHROPIC_ERROR_META = {
  modelNotFound: { type: "not_found_error", code: "model_not_found" },
  modelNotAllowed: { type: "forbidden_error", code: "model_not_allowed" },
  providerUnavailable: { type: "api_error", code: "provider_unavailable" },
  providerTypeMismatch: { type: "api_error", code: "provider_type_mismatch" },
  upstreamConnectionFailed: { type: "upstream_error", code: "upstream_connection_failed" },
  concurrencyQueueFull: { type: "api_error", code: "concurrency_queue_full" },
  concurrencyTimeout: { type: "api_error", code: "concurrency_timeout" },
  promptTooLong: { type: "invalid_request_error", code: "context_window_exceeded" },
};

export const anthropicAdapter: FormatAdapter = {
  apiType: "anthropic",
  defaultPath: "/v1/messages",
  errorMeta: ANTHROPIC_ERROR_META,

  formatError(message) {
    return { type: "error", error: { type: "api_error", message } };
  },
};
```

- [ ] **Step 3: 创建 Responses adapter**

```typescript
// router/src/proxy/format/adapters/responses.ts
import type { FormatAdapter } from "../types.js";

const RESPONSES_ERROR_META = {
  modelNotFound: { type: "invalid_request_error", code: "model_not_found" },
  modelNotAllowed: { type: "invalid_request_error", code: "model_not_allowed" },
  providerUnavailable: { type: "server_error", code: "provider_unavailable" },
  providerTypeMismatch: { type: "server_error", code: "provider_type_mismatch" },
  upstreamConnectionFailed: { type: "upstream_error", code: "upstream_connection_failed" },
  concurrencyQueueFull: { type: "server_error", code: "concurrency_queue_full" },
  concurrencyTimeout: { type: "server_error", code: "concurrency_timeout" },
  promptTooLong: { type: "invalid_request_error", code: "context_window_exceeded" },
};

export const responsesAdapter: FormatAdapter = {
  apiType: "openai-responses",
  defaultPath: "/v1/responses",
  errorMeta: RESPONSES_ERROR_META,

  formatError(message, code) {
    return { error: { message, type: "invalid_request_error", code: code ?? "upstream_error" } };
  },
};
```

- [ ] **Step 4: 验证编译**

Run: `cd router && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 5: Commit**

```bash
git add router/src/proxy/format/adapters/
git commit -m "feat(format): add OpenAI, Anthropic, Responses adapters"
```

### Task 4: 创建 6 个 FormatConverter

每个 converter 封装现有 transform 函数和流式 Transform 类。**不改现有 transform 逻辑，只做包装。**

**Files:**
- Create: `router/src/proxy/format/converters/openai-anthropic.ts`
- Create: `router/src/proxy/format/converters/anthropic-openai.ts`
- Create: `router/src/proxy/format/converters/openai-responses.ts`
- Create: `router/src/proxy/format/converters/responses-openai.ts`
- Create: `router/src/proxy/format/converters/responses-anthropic.ts`
- Create: `router/src/proxy/format/converters/anthropic-responses.ts`

- [ ] **Step 1: openai→anthropic converter**

包装 `request-transform.ts` 的 `openaiToAnthropicRequest` + `response-transform.ts` 的 `openaiResponseToAnthropic` + `stream-oa2ant.ts` 的 `OpenAIToAnthropicTransform`。

```typescript
// router/src/proxy/format/converters/openai-anthropic.ts
import type { FormatConverter } from "../types.js";
import { openaiToAnthropicRequest } from "../../transform/request-transform.js";
import { openaiResponseToAnthropic } from "../../transform/response-transform.js";
import { OpenAIToAnthropicTransform } from "../../transform/stream-oa2ant.js";

export const openaiToAnthropicConverter: FormatConverter = {
  sourceType: "openai",
  targetType: "anthropic",

  transformRequest(body, _model) {
    return {
      body: openaiToAnthropicRequest(body),
      upstreamPath: "/v1/messages",
    };
  },

  transformResponse(bodyStr) {
    return openaiResponseToAnthropic(bodyStr);
  },

  createStreamTransform(model) {
    return new OpenAIToAnthropicTransform(model);
  },
};
```

- [ ] **Step 2: anthropic→openai converter**

```typescript
// router/src/proxy/format/converters/anthropic-openai.ts
import type { FormatConverter } from "../types.js";
import { anthropicToOpenAIRequest } from "../../transform/request-transform.js";
import { anthropicResponseToOpenAI } from "../../transform/response-transform.js";
import { AnthropicToOpenAITransform } from "../../transform/stream-ant2oa.js";

export const anthropicToOpenAIConverter: FormatConverter = {
  sourceType: "anthropic",
  targetType: "openai",

  transformRequest(body, _model) {
    return {
      body: anthropicToOpenAIRequest(body),
      upstreamPath: "/v1/chat/completions",
    };
  },

  transformResponse(bodyStr) {
    return anthropicResponseToOpenAI(bodyStr);
  },

  createStreamTransform(model) {
    return new AnthropicToOpenAITransform(model);
  },
};
```

- [ ] **Step 3: openai→responses converter**

包装 `request-bridge-responses.ts` 的 `chatToResponsesRequest` + `response-bridge-responses.ts` 的 `chatToResponsesResponse` + `stream-bridge-chat2resp.ts` 的 `ChatToResponsesBridgeTransform`。

```typescript
// router/src/proxy/format/converters/openai-responses.ts
import type { FormatConverter } from "../types.js";
import { chatToResponsesRequest } from "../../transform/request-bridge-responses.js";
import { chatToResponsesResponse } from "../../transform/response-bridge-responses.js";
import { ChatToResponsesBridgeTransform } from "../../transform/stream-bridge-chat2resp.js";

export const openaiToResponsesConverter: FormatConverter = {
  sourceType: "openai",
  targetType: "openai-responses",

  transformRequest(body, _model) {
    return {
      body: chatToResponsesRequest(body),
      upstreamPath: "/v1/responses",
    };
  },

  transformResponse(bodyStr) {
    return chatToResponsesResponse(bodyStr);
  },

  createStreamTransform(model) {
    return new ChatToResponsesBridgeTransform(model);
  },
};
```

- [ ] **Step 4: responses→openai converter**

```typescript
// router/src/proxy/format/converters/responses-openai.ts
import type { FormatConverter } from "../types.js";
import { responsesToChatRequest } from "../../transform/request-bridge-responses.js";
import { responsesToChatResponse } from "../../transform/response-bridge-responses.js";
import { ResponsesToChatBridgeTransform } from "../../transform/stream-bridge-resp2chat.js";

export const responsesToOpenAIConverter: FormatConverter = {
  sourceType: "openai-responses",
  targetType: "openai",

  transformRequest(body, _model) {
    return {
      body: responsesToChatRequest(body),
      upstreamPath: "/v1/chat/completions",
    };
  },

  transformResponse(bodyStr) {
    return responsesToChatResponse(bodyStr);
  },

  createStreamTransform(model) {
    return new ResponsesToChatBridgeTransform(model);
  },
};
```

- [ ] **Step 5: responses→anthropic converter**

```typescript
// router/src/proxy/format/converters/responses-anthropic.ts
import type { FormatConverter } from "../types.js";
import { responsesToAnthropicRequest } from "../../transform/request-transform-responses.js";
import { responsesToAnthropicResponse } from "../../transform/response-transform-responses.js";
import { ResponsesToAnthropicTransform } from "../../transform/stream-resp2ant.js";

export const responsesToAnthropicConverter: FormatConverter = {
  sourceType: "openai-responses",
  targetType: "anthropic",

  transformRequest(body, _model) {
    return {
      body: responsesToAnthropicRequest(body),
      upstreamPath: "/v1/messages",
    };
  },

  transformResponse(bodyStr) {
    return responsesToAnthropicResponse(bodyStr);
  },

  createStreamTransform(model) {
    return new ResponsesToAnthropicTransform(model);
  },
};
```

- [ ] **Step 6: anthropic→responses converter**

```typescript
// router/src/proxy/format/converters/anthropic-responses.ts
import type { FormatConverter } from "../types.js";
import { anthropicToResponsesRequest } from "../../transform/request-transform-responses.js";
import { anthropicToResponsesResponse } from "../../transform/response-transform-responses.js";
import { AnthropicToResponsesTransform } from "../../transform/stream-ant2resp.js";

export const anthropicToResponsesConverter: FormatConverter = {
  sourceType: "anthropic",
  targetType: "openai-responses",

  transformRequest(body, _model) {
    return {
      body: anthropicToResponsesRequest(body),
      upstreamPath: "/v1/responses",
    };
  },

  transformResponse(bodyStr) {
    return anthropicToResponsesResponse(bodyStr);
  },

  createStreamTransform(model) {
    return new AnthropicToResponsesTransform(model);
  },
};
```

- [ ] **Step 7: 验证编译 + 现有测试通过**

Run: `cd router && npx tsc --noEmit && npx vitest run`
Expected: 编译无错误，所有测试通过

- [ ] **Step 8: Commit**

```bash
git add router/src/proxy/format/converters/
git commit -m "feat(format): add 6 FormatConverters wrapping existing transform functions"
```

### Task 5: 在 buildApp() 中注册 FormatRegistry，替换 TransformCoordinator

**Files:**
- Modify: `router/src/index.ts` — 注册 FormatRegistry
- Modify: `router/src/proxy/handler/proxy-handler.ts` — 用 FormatRegistry 替换 TransformCoordinator
- Modify: `router/src/core/container.ts` — 添加 formatRegistry service key

- [ ] **Step 1: 添加 SERVICE_KEYS.formatRegistry**

在 `router/src/core/container.ts` 的 `SERVICE_KEYS` 对象中添加：
```typescript
formatRegistry: "formatRegistry",
```

- [ ] **Step 2: 在 buildApp() 中注册 FormatRegistry**

在 `router/src/index.ts` 中，在 `container.register(SERVICE_KEYS.pluginRegistry, ...)` 之后添加：

```typescript
import { FormatRegistry } from "./proxy/format/registry.js";
import { openaiAdapter } from "./proxy/format/adapters/openai.js";
import { anthropicAdapter } from "./proxy/format/adapters/anthropic.js";
import { responsesAdapter } from "./proxy/format/adapters/responses.js";
import { openaiToAnthropicConverter } from "./proxy/format/converters/openai-anthropic.js";
import { anthropicToOpenAIConverter } from "./proxy/format/converters/anthropic-openai.js";
import { openaiToResponsesConverter } from "./proxy/format/converters/openai-responses.js";
import { responsesToOpenAIConverter } from "./proxy/format/converters/responses-openai.js";
import { responsesToAnthropicConverter } from "./proxy/format/converters/responses-anthropic.js";
import { anthropicToResponsesConverter } from "./proxy/format/converters/anthropic-responses.js";

// 注册 FormatRegistry
const formatRegistry = new FormatRegistry();
formatRegistry.registerAdapter(openaiAdapter);
formatRegistry.registerAdapter(anthropicAdapter);
formatRegistry.registerAdapter(responsesAdapter);
formatRegistry.registerConverter(openaiToAnthropicConverter);
formatRegistry.registerConverter(anthropicToOpenAIConverter);
formatRegistry.registerConverter(openaiToResponsesConverter);
formatRegistry.registerConverter(responsesToOpenAIConverter);
formatRegistry.registerConverter(responsesToAnthropicConverter);
formatRegistry.registerConverter(anthropicToResponsesConverter);
container.register(SERVICE_KEYS.formatRegistry, () => formatRegistry);
```

- [ ] **Step 3: 替换 proxy-handler.ts 中的 TransformCoordinator 调用**

在 `router/src/proxy/handler/proxy-handler.ts` 中：

1. 删除 `import { TransformCoordinator }` 
2. 添加 `import { SERVICE_KEYS } from "../../core/container.js";`（如未导入）
3. 添加 `import type { FormatRegistry } from "../format/registry.js";`

在 `executeFailoverLoop` 函数中：

**替换前：**
```typescript
const coordinator = new TransformCoordinator();
// ...
const needsTransform = coordinator.needsTransform(apiType, provider.api_type);
// ...
const transformed = coordinator.transformRequest(currentBody, apiType, provider.api_type, resolved.backend_model);
// ...
const formatTransform = needsTransform ? coordinator.createFormatTransform(apiType, provider.api_type, resolved.backend_model) : undefined;
// ...
return coordinator.transformErrorResponse(bodyStr, provider.api_type, apiType);
// ...
let transformed = coordinator.transformResponse(bodyStr, provider.api_type, apiType);
```

**替换后：**
```typescript
const formatRegistry = deps.container.resolve<FormatRegistry>(SERVICE_KEYS.formatRegistry);
// ...
const needsTransform = formatRegistry.needsTransform(apiType, provider.api_type);
// ...
const transformResult = formatRegistry.transformRequest(currentBody, apiType, provider.api_type, resolved.backend_model);
currentBody = transformResult.body;
effectiveUpstreamPath = transformResult.upstreamPath;
effectiveApiType = provider.api_type;
// ...
const formatTransform = needsTransform ? formatRegistry.createStreamTransform(apiType, provider.api_type, resolved.backend_model) : undefined;
// ...
return formatRegistry.transformError(bodyStr, provider.api_type, apiType);
// ...
let transformed = formatRegistry.transformResponse(bodyStr, provider.api_type, apiType);
```

- [ ] **Step 4: 验证编译 + 全量测试通过**

Run: `cd router && npx tsc --noEmit && npx vitest run`
Expected: 编译无错误，所有测试通过

- [ ] **Step 5: Commit**

```bash
git add router/src/index.ts router/src/proxy/handler/proxy-handler.ts router/src/core/container.ts
git commit -m "refactor(format): replace TransformCoordinator with FormatRegistry

- Register 3 adapters + 6 converters in buildApp()
- Replace all TransformCoordinator calls in proxy-handler.ts
- All existing tests pass unchanged"
```

### Task 6: 删除 TransformCoordinator

**Files:**
- Delete: `router/src/proxy/transform/transform-coordinator.ts`

- [ ] **Step 1: 确认无其他引用**

Run: `cd router && grep -r "transform-coordinator" src/ --include="*.ts"`
Expected: 无结果（已在 Task 5 中移除所有引用）

- [ ] **Step 2: 删除文件 + 验证**

Run: `rm router/src/proxy/transform/transform-coordinator.ts && cd router && npx tsc --noEmit && npx vitest run`
Expected: 编译无错误，所有测试通过

- [ ] **Step 3: Commit**

```bash
git add -u router/src/proxy/transform/transform-coordinator.ts
git commit -m "chore(format): delete TransformCoordinator (replaced by FormatRegistry)"
```

---

## Phase 2：Pipeline + Hooks 基础设施

### Task 7: 创建 pipeline/types.ts + pipeline/context.ts

**Files:**
- Create: `router/src/proxy/pipeline/types.ts`
- Create: `router/src/proxy/pipeline/context.ts`

- [ ] **Step 1: 创建 types.ts**

```typescript
// router/src/proxy/pipeline/types.ts
import type { FastifyReply, FastifyRequest } from "fastify";
import type { PipelineSnapshot } from "../pipeline-snapshot.js";
import type { Target } from "../../core/types.js";
import type { TransportResult, ResilienceResult } from "../types.js";

/** Hook 挂载阶段 */
export type HookPhase =
  | "pre_route"
  | "post_route"
  | "pre_transport"
  | "post_response"
  | "on_error"
  | "on_stream_event";

/** Pipeline 钩子 — 内置 hook 和外部插件共用此接口 */
export interface PipelineHook {
  /** 全局唯一名称 */
  name: string;
  /** 挂载阶段 */
  phase: HookPhase;
  /** 优先级（0-99 基础设施, 100-199 内置功能, 200-299 外部插件, 900-999 观察者） */
  priority: number;
  /** 钩子逻辑 */
  execute(ctx: PipelineContext): void | Promise<void>;
}

/** 管道中止信号 */
export class PipelineAbort extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly body: unknown,
  ) {
    super("Pipeline aborted");
  }
}

/** Provider 信息（简化，避免直接耦合 DB 行类型） */
export interface ProviderInfo {
  id: string;
  name: string;
  base_url: string;
  api_type: string;
  is_active: number;
  api_key: string;
  models: string;
  upstream_path: string | null;
  max_concurrency: number;
  queue_timeout_ms: number;
  max_queue_size: number;
  adaptive_enabled: boolean;
  created_at: string;
}

/** 贯穿管道的上下文 */
export interface PipelineContext {
  // 不可变
  readonly request: FastifyRequest;
  readonly reply: FastifyReply;
  readonly rawBody: Record<string, unknown>;
  readonly clientModel: string;
  readonly apiType: string;
  readonly sessionId: string | undefined;

  // 可变
  body: Record<string, unknown>;
  isStream: boolean;
  resolved: Target | null;
  provider: ProviderInfo | null;
  effectiveUpstreamPath: string;
  effectiveApiType: string;
  injectedHeaders: Record<string, string>;
  transportResult: TransportResult | null;
  resilienceResult: ResilienceResult | null;
  metadata: Map<string, unknown>;
  logId: string;
  rootLogId: string | null;
  clientRequest: string;
  upstreamRequest: string;
  snapshot: PipelineSnapshot;
}
```

- [ ] **Step 2: 创建 context.ts（工厂函数）**

```typescript
// router/src/proxy/pipeline/context.ts
import type { FastifyReply, FastifyRequest } from "fastify";
import type { PipelineContext } from "./types.js";
import { PipelineSnapshot } from "../pipeline-snapshot.js";

export function createPipelineContext(
  request: FastifyRequest,
  reply: FastifyReply,
  apiType: string,
): PipelineContext {
  const body = request.body as Record<string, unknown>;
  const clientModel = (body.model as string) || "unknown";
  const sessionId = (request.headers as Record<string, string>)["x-claude-code-session-id"];
  const rawBody = body ? JSON.parse(JSON.stringify(body)) : {};

  return {
    request,
    reply,
    rawBody,
    clientModel,
    apiType,
    sessionId,
    body,
    isStream: body.stream === true,
    resolved: null,
    provider: null,
    effectiveUpstreamPath: "",
    effectiveApiType: apiType,
    injectedHeaders: {},
    transportResult: null,
    resilienceResult: null,
    metadata: new Map(),
    logId: "",
    rootLogId: null,
    clientRequest: "",
    upstreamRequest: "",
    snapshot: new PipelineSnapshot(),
  };
}
```

- [ ] **Step 3: 验证编译**

Run: `cd router && npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: Commit**

```bash
git add router/src/proxy/pipeline/types.ts router/src/proxy/pipeline/context.ts
git commit -m "feat(pipeline): add PipelineContext, PipelineHook, and HookPhase types"
```

### Task 8: 创建 pipeline/pipeline.ts + 测试

**Files:**
- Create: `router/src/proxy/pipeline/pipeline.ts`
- Create: `router/tests/proxy/pipeline/pipeline.test.ts`

- [ ] **Step 1: 写 pipeline 测试**

```typescript
// router/tests/proxy/pipeline/pipeline.test.ts
import { describe, it, expect, vi } from "vitest";
import { ProxyPipeline } from "../../../src/proxy/pipeline/pipeline.js";
import type { PipelineHook, PipelineContext, HookPhase } from "../../../src/proxy/pipeline/types.js";

function createMockContext(): PipelineContext {
  return {
    request: {} as any,
    reply: {} as any,
    rawBody: {},
    clientModel: "gpt-4",
    apiType: "openai",
    sessionId: undefined,
    body: {},
    isStream: false,
    resolved: null,
    provider: null,
    effectiveUpstreamPath: "",
    effectiveApiType: "openai",
    injectedHeaders: {},
    transportResult: null,
    resilienceResult: null,
    metadata: new Map(),
    logId: "test",
    rootLogId: null,
    clientRequest: "",
    upstreamRequest: "",
    snapshot: { toJSON: () => "{}" } as any,
  };
}

describe("ProxyPipeline", () => {
  it("executes hooks in priority order within a phase", async () => {
    const order: string[] = [];
    const pipeline = new ProxyPipeline();

    pipeline.register({
      name: "late",
      phase: "pre_route",
      priority: 200,
      execute: () => { order.push("late"); },
    });
    pipeline.register({
      name: "early",
      phase: "pre_route",
      priority: 100,
      execute: () => { order.push("early"); },
    });
    pipeline.register({
      name: "mid",
      phase: "pre_route",
      priority: 150,
      execute: () => { order.push("mid"); },
    });

    await pipeline["emit"]("pre_route", createMockContext());
    expect(order).toEqual(["early", "mid", "late"]);
  });

  it("does not mix hooks from different phases", async () => {
    const order: string[] = [];
    const pipeline = new ProxyPipeline();

    pipeline.register({ name: "a", phase: "pre_route", priority: 100, execute: () => { order.push("a"); } });
    pipeline.register({ name: "b", phase: "post_route", priority: 100, execute: () => { order.push("b"); } });

    await pipeline["emit"]("pre_route", createMockContext());
    expect(order).toEqual(["a"]);
  });

  it("getHookChain returns registered hooks for a phase", () => {
    const pipeline = new ProxyPipeline();
    pipeline.register({ name: "hook1", phase: "pre_route", priority: 100, execute: () => {} });
    pipeline.register({ name: "hook2", phase: "pre_route", priority: 200, execute: () => {} });

    const chain = pipeline.getHookChain("pre_route");
    expect(chain).toEqual([
      { name: "hook1", priority: 100 },
      { name: "hook2", priority: 200 },
    ]);
  });

  it("getHookChain returns empty array for unregistered phase", () => {
    const pipeline = new ProxyPipeline();
    expect(pipeline.getHookChain("on_error")).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd router && npx vitest run tests/proxy/pipeline/pipeline.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 ProxyPipeline**

```typescript
// router/src/proxy/pipeline/pipeline.ts
import type { PipelineContext, HookPhase, PipelineHook } from "./types.js";

export class ProxyPipeline {
  private hooksByPhase = new Map<HookPhase, PipelineHook[]>();

  /** 注册钩子 */
  register(hook: PipelineHook): void {
    const list = this.hooksByPhase.get(hook.phase) ?? [];
    list.push(hook);
    list.sort((a, b) => a.priority - b.priority);
    this.hooksByPhase.set(hook.phase, list);
  }

  /** 获取某阶段的钩子链（调试用） */
  getHookChain(phase: HookPhase): ReadonlyArray<{ name: string; priority: number }> {
    return (this.hooksByPhase.get(phase) ?? []).map((h) => ({
      name: h.name,
      priority: h.priority,
    }));
  }

  /** 触发指定阶段的所有钩子 */
  async emit(phase: HookPhase, ctx: PipelineContext): Promise<void> {
    const hooks = this.hooksByPhase.get(phase) ?? [];
    for (const hook of hooks) {
      await hook.execute(ctx);
    }
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd router && npx vitest run tests/proxy/pipeline/pipeline.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add router/src/proxy/pipeline/pipeline.ts router/tests/proxy/pipeline/pipeline.test.ts
git commit -m "feat(pipeline): add ProxyPipeline with priority-based hook execution"
```

### Task 9-13: 创建内置 Hooks

每个 hook 是一个独立文件，从 proxy-handler.ts 提取逻辑。按 phase 分组：

- Task 9: pre_route hooks (`enhancement-preprocess.ts`)
- Task 10: post_route hooks (`allowed-models.ts`, `overflow-redirect.ts`)
- Task 11: pre_transport hooks (`provider-patches.ts`, `plugin-request.ts`)
- Task 12: post_response hooks (`logging.ts`, `metrics.ts`, `usage-tracker.ts`, `tool-error-logger.ts`)
- Task 13: on_error hooks (`error-logging.ts`)

由于这些 hook 的逻辑已存在于 proxy-handler.ts 中，每个 Task 的模式相同：

1. 从 proxy-handler.ts 提取相关代码到 hook 文件
2. 包装为 `PipelineHook` 对象
3. 验证编译 + 全量测试通过
4. Commit

每个 hook 文件结构：

```typescript
// router/src/proxy/hooks/builtin/<name>.ts
import type { PipelineHook } from "../../pipeline/types.js";

export const <name>Hook: PipelineHook = {
  name: "<name>",
  phase: "<phase>",
  priority: <n>,
  async execute(ctx) {
    // 从 proxy-handler.ts 提取的逻辑
  },
};
```

**这些 Task 在 Phase 3 之前不需要连接到 pipeline**——先创建独立的 hook 文件，Phase 3 时统一注册。以下是每个 hook 的核心逻辑来源和关键依赖：

| Hook | 来源（proxy-handler.ts 行号） | 关键依赖 |
|------|------|------|
| `tool_round_limit` (pre_route, 110) | 第 173-185 行 | `applyToolRoundLimit` from `patch/tool-round-limiter.ts` |
| `tool_loop_guard` (pre_route, 120) | 第 188-220 行 | `ToolLoopGuard` from `@llm-router/core/loop-prevention`, `SessionTracker` |
| `allowed_models` (post_route, 50) | 第 285-296 行 | `request.routerKey.allowed_models` |
| `overflow_redirect` (post_route, 100) | 第 309-318 行 | `applyOverflowRedirect` from `routing/overflow.ts` |
| `provider_patches` (pre_transport, 100) | 第 352-356 行 | `applyProviderPatches` from `patch/index.ts` |
| `plugin_request` (pre_transport, 250) | 第 327-345 行 | `PluginRegistry.applyBeforeRequest/applyAfterRequest` |
| `request_logging` (post_response, 900) | 第 392-440 行 | `insertRequestLog`, `logResilienceResult`, `collectTransportMetrics` |
| `metrics_collector` (post_response, 910) | 第 440 行附近 | `collectTransportMetrics` |
| `usage_tracker` (post_response, 920) | 第 448 行 | `usageWindowTracker.recordRequest` |
| `tool_error_logger` (post_response, 930) | 第 304-308 行 | `logToolErrors` from `tool-error-logger.ts` |
| `error_logging` (on_error, 900) | catch 块 | `insertRejectedLog` |

每个 Task 的通用步骤模板：

```
- [ ] Step 1: 创建 hook 文件（从 proxy-handler.ts 对应行提取逻辑）
- [ ] Step 2: 验证编译 (cd router && npx tsc --noEmit)
- [ ] Step 3: Commit
```

> **注意：** 这里不展开每个 hook 的完整代码（约 30-80 行/个），因为逻辑已存在于 proxy-handler.ts 中，提取是机械操作。实施时需要逐个提取并确保依赖正确。

---

## Phase 3：统一 Handler 工厂 + 切换 Pipeline

### Task 14: 创建 handler/failover-loop.ts

**Files:**
- Create: `router/src/proxy/handler/failover-loop.ts`

从 proxy-handler.ts 的 `executeFailoverLoop` 函数提取，接口不变但使用 PipelineContext：

```typescript
// router/src/proxy/handler/failover-loop.ts
export async function executeFailoverLoop(
  ctx: PipelineContext,
  pipeline: ProxyPipeline,
  deps: FailoverDeps,
): Promise<FastifyReply> {
  const excludeTargets: Target[] = [];
  while (true) {
    ctx.resolved = null;
    ctx.provider = null;
    ctx.logId = randomUUID();
    // ... 与现有逻辑相同，但通过 pipeline.execute() 执行
  }
}
```

验证 + Commit。

### Task 15: 创建 handler/create-proxy-handler.ts

**Files:**
- Create: `router/src/proxy/handler/create-proxy-handler.ts`

工厂函数，从当前 3 个 handler 文件的共同逻辑提取：

```typescript
// router/src/proxy/handler/create-proxy-handler.ts
export function createProxyHandler(config: ProxyHandlerConfig): FastifyPluginCallback { ... }
```

验证 + Commit。

### Task 16: 更新 buildApp() + 删除旧文件

**Files:**
- Modify: `router/src/index.ts` — 用 createProxyHandler 替换 3 个旧注册
- Delete: `router/src/proxy/handler/openai.ts`
- Delete: `router/src/proxy/handler/anthropic.ts`
- Delete: `router/src/proxy/handler/responses.ts`
- Rewrite: `router/src/proxy/handler/proxy-handler.ts` — 精简为入口函数

这是风险最高的 Task。必须：
1. 先确保 Phase 1 的 FormatRegistry 替换已完成
2. 确保所有内置 hook 已创建
3. 全量测试通过后才能 commit

Run: `cd router && npx tsc --noEmit && npx vitest run`

---

## Phase 4：插件 API 增强

### Task 17: 更新 plugin-types.ts + 创建 plugin-bridge.ts

**Files:**
- Modify: `router/src/proxy/transform/plugin-types.ts` — 添加 onStreamEvent, onError
- Create: `router/src/proxy/hooks/plugin-bridge.ts` — TransformPlugin → PipelineHook 适配

### Task 18: 创建 SSEEventTransform + Admin API

**Files:**
- Create: `router/src/proxy/hooks/sse-event-transform.ts`
- Modify: `router/src/admin/routes.ts` — 添加 `GET /admin/api/pipeline/hooks` 端点

---

## Phase 5：清理

### Task 19: 删除旧文件 + 简化

**Files:**
- Delete: `router/src/proxy/transform/stream-*.ts`（6 个文件，逻辑已在 converter 中引用，但此阶段考虑是否物理删除还是保留引用）
- Simplify: `router/src/proxy/transport/transport-fn.ts` — 参数简化
- Update: `CLAUDE.md` — 更新架构描述

> **注意：** Phase 5 的 stream-*.ts 删除需要谨慎。Task 4 的 converter 通过 import 引用这些文件。如果物理删除，需要将流式 Transform 类内联到 converter 文件中。建议此 Task 改为"将 stream-*.ts 的类迁移到对应 converter 文件中"，而非直接删除。

Run: `cd router && npx tsc --noEmit && npx vitest run && npm run lint`
Expected: 全部通过
