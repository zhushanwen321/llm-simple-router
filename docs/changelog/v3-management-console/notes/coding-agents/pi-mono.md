# Pi Coding Agent API 格式协议调研

## 概述

Pi（即 pi-coding-agent）是一个基于 TypeScript 的通用 AI 编码代理。它使用 `@mariozechner/pi-ai` 包（位于 `packages/ai/`）作为统一的 LLM API 抽象层，支持 **10 种不同的 API 协议**，通过 10 个 provider 实现。

### 架构

```
User -> coding-agent (model-resolver) -> pi-ai (stream.ts) -> api-registry -> provider -> LLM API
```

- `packages/ai/src/stream.ts` 提供统一的 `stream()` / `complete()` / `streamSimple()` / `completeSimple()` 入口
- `packages/ai/src/api-registry.ts` 管理协议注册
- `packages/ai/src/providers/` 包含所有 provider 实现
- `packages/ai/src/types.ts` 定义统一的消息模型和事件流协议
- `packages/coding-agent/src/core/model-resolver.ts` 负责模型选择和解析

### 统一内部消息模型

所有协议在 sent 侧通过 `convertMessages()` / `transformMessages()` 转换为协议格式，在 received 侧通过事件流解析统一为内部 `AssistantMessage` 模型。

---

## 使用的 API 协议

| API ID | 协议名称 | Provider 列表 | 实现文件 |
|---|---|---|---|
| `openai-completions` | OpenAI Chat Completions | openai, deepseek, xai, groq, cerebras, openrouter, vercel-ai-gateway, zai, minimax, huggingface, fireworks, opencode, opencode-go, kimi-coding, cloudflare-workers-ai, github-copilot | `openai-completions.ts` |
| `openai-responses` | OpenAI Responses API | openai (GPT-5.x), github-copilot | `openai-responses.ts` |
| `openai-codex-responses` | OpenAI Codex Responses (ChatGPT 私有协议) | openai-codex | `openai-codex-responses.ts` |
| `azure-openai-responses` | Azure OpenAI Responses | azure-openai-responses | `azure-openai-responses.ts` |
| `anthropic-messages` | Anthropic Messages | anthropic, github-copilot (Anthropic 模型) | `anthropic.ts` |
| `bedrock-converse-stream` | AWS Bedrock Converse Stream | amazon-bedrock | `amazon-bedrock.ts` |
| `google-generative-ai` | Google Generative AI (Gemini API) | google | `google.ts` |
| `google-gemini-cli` | Google Cloud Code Assist (Gemini CLI) | google-gemini-cli, google-antigravity | `google-gemini-cli.ts` |
| `google-vertex` | Google Vertex AI | google-vertex | `google-vertex.ts` |
| `mistral-conversations` | Mistral Chat (La Plateforme) | mistral | `mistral.ts` |

---

## 各协议字段详情

### OpenAI Chat Completions

**使用方式**: 通过 OpenAI Node.js SDK (`openai`) 发送 `client.chat.completions.create(params, requestOptions)`

**请求参数** (`ChatCompletionCreateParamsStreaming`):

| 字段 | 类型 | 含义 | 条件 |
|---|---|---|---|
| `model` | `string` | 模型 ID | 必填 |
| `messages` | `ChatCompletionMessageParam[]` | 对话消息列表 | 必填 |
| `stream` | `true` | 始终为 `true`（只有流式模式） | 必填 |
| `stream_options` | `{ include_usage: true }` | 在流式响应中包含 token 用量 | `compat.supportsUsageInStreaming !== false` |
| `temperature` | `number` | 温度参数 | 可选 |
| `max_completion_tokens` / `max_tokens` | `number` | 最大输出 token 数。由 `compat.maxTokensField` 控制 | 可选 |
| `store` | `false` | 是否存储对话记录。兼容非标准 API 可关闭 | `compat.supportsStore !== false` 时为 `false` |
| `tools` | `ChatCompletionTool[]` | 工具定义列表 | 有 `context.tools` 时 |
| `tool_choice` | `"auto"` / `"none"` / `"required"` / `{type:"function",function:{name}}` | 工具选择策略 | 可选 |
| `tool_stream` | `true` | z.ai 流式 tool call | `compat.zaiToolStream` 为 true 时 |
| `reasoning_effort` | `string` | reasoning 力度 (`minimal`/`low`/`medium`/`high`/`xhigh` + mapped) | `compat.supportsReasoningEffort` 且模型支持 |
| `enable_thinking` | `boolean` | 启用 thinking（z.ai / Qwen 格式） | `compat.thinkingFormat === "zai"` 或 `"qwen"` |
| `chat_template_kwargs` | `{ enable_thinking, preserve_thinking }` | Qwen chat template thinking 配置 | `compat.thinkingFormat === "qwen-chat-template"` |
| `thinking` | `{ type: "enabled"|"disabled" }` | DeepSeek thinking 配置 | `compat.thinkingFormat === "deepseek"` |
| `reasoning` | `{ effort?: string }` | OpenRouter reasoning 配置 | `compat.thinkingFormat === "openrouter"` |
| `provider` | `OpenRouterRouting` | OpenRouter 路由偏好 | `model.compat.openRouterRouting` |
| `providerOptions` | `{ gateway: { only?, order? } }` | Vercel AI Gateway 路由偏好 | `model.compat.vercelGatewayRouting` |
| `prompt_cache_key` | `string` | 会话级缓存 key | sessionId 有效且满足条件 |
| `prompt_cache_retention` | `"24h"` | 长缓存保留时间 | `cacheRetention === "long"` 且模型支持 |

**SDK 客户端**:

| 参数 | 说明 |
|---|---|
| `apiKey` | API key |
| `baseURL` | 从 `model.baseUrl` 获取 |
| `defaultHeaders` | 合并 `model.headers` + session 亲和多度 + options.headers |
| `dangerouslyAllowBrowser` | `true` |

**消息转换** (`convertMessages`):

| Role | 协议格式 | 说明 |
|---|---|---|
| `system`/`developer` | `{ role: "system"|"developer", content }` | developer 角色用于 reasoning 模型 |
| `user` | `{ role: "user", content: string|ContentPart[] }` | 图片用 `data:image` URI |
| `assistant` | `{ role: "assistant", content: string|null, tool_calls }` | reasoning 写入 `reasoning_content` 字段; 支持 `reasoning_details` |
| `tool` | `{ role: "tool", content, tool_call_id }` | 工具结果。可选 `name` 字段 |

**缓存控制** (`cacheControlFormat: "anthropic"`):

当 `compat.cacheControlFormat === "anthropic"` 时，在以下位置添加 `cache_control: { type: "ephemeral" }`:
- 最后一条 system/developer 消息
- 最后一个工具的 `cache_control`
- 最后一条 user/assistant 消息的最后一个 text content part

**思考/推理字段**:

| 字段 | 来源 | 说明 |
|---|---|---|
| `choice.delta.reasoning_content` | llama.cpp / DeepSeek / 兼容 API | thinking 内容 |
| `choice.delta.reasoning` | 通用 OpenAI 兼容 API | thinking 别名 |
| `choice.delta.reasoning_text` | Chutes.ai 等 | thinking 别名 |
| `choice.delta.reasoning_details` | OpenAI Responses (通过工具) | 工具调用的加密推理签名 |

**停止原因映射**:

| 上游 `finish_reason` | 内部 `StopReason` |
|---|---|
| `stop`, `end` | `stop` |
| `length` | `length` |
| `function_call`, `tool_calls` | `toolUse` |
| `content_filter` | `error` |
| `network_error` | `error` |
| 其他 | `error` |

---

### Anthropic Messages

**使用方式**: 通过 Anthropic Node.js SDK (`@anthropic-ai/sdk`) 发送 `client.messages.create({...params, stream: true}, requestOptions)`，然后通过自定义 SSE 解析器处理事件流。

也支持自定义 HTTP 客户端直接 SSE 解析（用于 GitHub Copilot）。

**请求参数** (`MessageCreateParamsStreaming`):

| 字段 | 类型 | 含义 | 条件 |
|---|---|---|---|
| `model` | `string` | 模型 ID | 必填 |
| `messages` | `MessageParam[]` | 消息列表 | 必填 |
| `max_tokens` | `number` | 最大输出 token | `options.maxTokens` 或 `model.maxTokens / 3` |
| `stream` | `true` | 始终 true | 必填 |
| `system` | `TextBlock[]` | 系统提示（可包含 cache_control） | 有 `context.systemPrompt` |
| `temperature` | `number` | 温度 | 可选，但与 thinking 互斥 |
| `tools` | `Anthropic.Messages.Tool[]` | 工具定义 | 有 `context.tools` |
| `tool_choice` | `{ type: "auto"|"any"|"none"|"tool", name? }` | 工具选择 | 可选 |
| `thinking` | `{ type: "enabled", budget_tokens }` / `{ type: "disabled" }` / `{ type: "adaptive", display }` | thinking 配置 | 模型支持时 |
| `output_config` | `{ effort: "low"|"medium"|"high"|"xhigh"|"max" }` | 自适应 thinking 力度 | Opus 4.6+/Sonnet 4.6 |
| `metadata` | `{ user_id: string }` | 用户标识 | `options.metadata.user_id` |

**SDK 客户端**:

| 认证方式 | 实现 |
|---|---|
| API Key | `new Anthropic({ apiKey, baseURL, defaultHeaders })` |
| OAuth Token (`sk-ant-oat`) | `new Anthropic({ authToken: apiKey, baseURL, defaultHeaders })` + Claude Code 身份 header |
| GitHub Copilot | `new Anthropic({ authToken: apiKey, baseURL, defaultHeaders })` |

**Beta Headers**:

| Header | 值 | 条件 |
|---|---|---|
| `anthropic-beta` | `fine-grained-tool-streaming-2025-05-14` | 有 tool 且 `supportsEagerToolInputStreaming === false` |
| `anthropic-beta` | `interleaved-thinking-2025-05-14` | interleaved thinking 启用（非自适应模型） |
| `anthropic-beta` | `claude-code-20250219,oauth-2025-04-20` | OAuth 认证时 |

**消息转换** (`convertMessages`):

| Role | 协议格式 | 说明 |
|---|---|---|
| `user` | `{ role: "user", content: string|ContentBlockParam[] }` | 文本或文本+图片 |
| `assistant` | `{ role: "assistant", content: ContentBlockParam[] }` | 含 `text`, `thinking`, `redacted_thinking`, `tool_use` 块 |
| `user` (带 tool results) | `{ role: "user", content: [{ type: "tool_result", ... }] }` | 所有 tool results 合并到一条 user 消息 |

**工具转换** (`convertTools`):

| 字段 | 值 |
|---|---|
| `name` | OAuth 模式使用 Claude Code 规范命名 |
| `description` | 工具描述 |
| `eager_input_streaming` | `true`（如果支持） |
| `input_schema` | JSON Schema (`{ type: "object", properties, required }`) |
| `cache_control` | 最后一个工具可添加 |

**Thinking 配置**:

| 模型 | 配置方式 |
|---|---|
| Opus 4.6 / Sonnet 4.6（自适应） | `{ type: "adaptive", display }` + `output_config.effort` |
| 旧模型 | `{ type: "enabled", budget_tokens: n, display }` |
| 禁用 | `{ type: "disabled" }` |

**Effort 映射**:

| pi `ThinkingLevel` | Opus 4.6 | Opus 4.7 | 其他 |
|---|---|---|---|
| `minimal`/`low` | `low` | `low` | - |
| `medium` | `medium` | `medium` | - |
| `high` | `high` | `high` | - |
| `xhigh` | `max` | `xhigh` | `high` |

**停止原因映射**:

| 上游 `stop_reason` | 内部 `StopReason` |
|---|---|
| `end_turn` | `stop` |
| `max_tokens` | `length` |
| `tool_use` | `toolUse` |
| `refusal` | `error` |
| `pause_turn` | `stop` |
| `stop_sequence` | `stop` |
| `sensitive` | `error` |
| 其他 | 抛出异常 |

---

### OpenAI Responses API

**使用方式**: 通过 OpenAI Node.js SDK (`openai`) 发送 `client.responses.create(params, requestOptions)`

**请求参数** (`ResponseCreateParamsStreaming`):

| 字段 | 类型 | 含义 | 条件 |
|---|---|---|---|
| `model` | `string` | 模型 ID | 必填 |
| `input` | `ResponseInput` | 输入（消息序列，支持 developer/system/user/assistant/tool） | 必填 |
| `stream` | `true` | 始终 true | 必填 |
| `temperature` | `number` | 温度 | 可选 |
| `max_output_tokens` | `number` | 最大输出 token | 可选 |
| `store` | `false` | 是否存储 | 固定 |
| `tools` | `OpenAITool[]` | 工具定义 | 有 `context.tools` |
| `reasoning` | `{ effort, summary }` | reasoning 配置 | 模型支持 |
| `include` | `["reasoning.encrypted_content"]` | 包含推理加密内容 | reasoning 启用时 |
| `service_tier` | `"auto"|"default"|"flex"|"priority"` | 服务层 | 可选 |
| `prompt_cache_key` | `string` | 缓存 key | sessionId 有效 |
| `prompt_cache_retention` | `"24h"` | 长缓存 | `cacheRetention === "long"` |

**Reasoning 参数**:

```typescript
params.reasoning = {
  effort: "none"|"minimal"|"low"|"medium"|"high"|"xhigh",
  summary: "auto"|"detailed"|"concise"
}
```

**消息转换** (`convertResponsesMessages`):

| 上游角色 | 协议格式 | 说明 |
|---|---|---|
| `system`/`developer` | `{ role, content }` | developer 用于 reasoning 模型 |
| `user` | `{ role: "user", content: [{ type: "input_text"|"input_image" }] }` | 文本/图片 |
| `assistant` | `{ type: "message", role: "assistant", content: [{ type: "output_text" }] }` + `reasoning` items + `function_call` items | 支持多块 |
| `toolResult` | `{ type: "function_call_output", call_id, output }` | 工具结果 |

**工具转换** (`convertResponsesTools`):

```typescript
{
  type: "function",
  name: string,
  description: string,
  parameters: JSON Schema,
  strict: false
}
```

---

### OpenAI Codex Responses（ChatGPT 私有协议）

**使用方式**: 自定义 HTTP 请求到 `chatgpt.com/backend-api/codex/responses`，支持 SSE 和 WebSocket 两种传输。

**传输协议**:
- **SSE** (默认): HTTP POST 到 `.../codex/responses`，解析 `data:` 行
- **WebSocket**: 可选，连接到 `wss://.../codex/responses`，发送 JSON 消息，解析响应

**请求体字段**（比标准 OpenAI Responses 更多）:

| 字段 | 类型 | 含义 |
|---|---|---|
| `model` | `string` | 模型 ID |
| `store` | `false` | 不存储 |
| `stream` | `true` | 流式 |
| `instructions` | `string` | 系统提示（代替 system role） |
| `input` | `ResponseInput` | 对话输入 |
| `tools` | `OpenAITool[]` | 工具 |
| `tool_choice` | `"auto"` | 强制 auto |
| `parallel_tool_calls` | `true` | 并行工具调用 |
| `temperature` | `number` | 温度 |
| `reasoning` | `{ effort, summary }` | reasoning |
| `service_tier` | `"flex"|"auto"|"priority"` | 服务层 |
| `text` | `{ verbosity: "low"|"medium"|"high" }` | 文本详细度 |
| `include` | `["reasoning.encrypted_content"]` | 推理内容 |
| `prompt_cache_key` | `string` | 缓存 |

**认证**: JWT token 解析 → `chatgpt-account-id` header + `Authorization: Bearer`

**Headers**:

| Header | 值 |
|---|---|
| `Authorization` | `Bearer <token>` |
| `chatgpt-account-id` | JWT 中提取 |
| `originator` | `"pi"` |
| `User-Agent` | `"pi (<platform> <release>; <arch>)"` |
| `OpenAI-Beta` | `"responses=experimental"` (SSE) 或 `"responses_websockets=2026-02-06"` (WebSocket) |
| `session_id` | 可选 |
| `x-client-request-id` | 可选 |

**WebSocket** 支持会话级连接复用（缓存 5 分钟），同时只允许一个请求活跃。

**重试逻辑**: 最多 3 次，指数退避（1s, 2s, 4s），429/500/502/503/504 + 网络错误可重试。

---

### Azure OpenAI Responses

**使用方式**: 通过 `AzureOpenAI` SDK (`openai` 包) 发送 `client.responses.create(params, requestOptions)`

**与标准 OpenAI Responses API 的区别**:

| 特性 | 差异 |
|---|---|
| `model` | 使用 deployment name（可配置映射） |
| `baseURL` | Azure OpenAI 格式 `https://<resource>.openai.azure.com/openai/v1` |
| `apiVersion` | 可配置（默认 `"v1"`） |
| `prompt_cache_key` | 支持 |
| 无 `store: false` | 不发送 |
| 无 `prompt_cache_retention` | 不发送 |

**工具调用 providers**: `openai`, `openai-codex`, `opencode`, `azure-openai-responses`

---

### AWS Bedrock Converse Stream

**使用方式**: 通过 AWS SDK `@aws-sdk/client-bedrock-runtime` 发送 `ConverseStreamCommand`

**请求参数** (`ConverseStreamCommandInput`):

| 字段 | 类型 | 含义 |
|---|---|---|
| `modelId` | `string` | 模型 ID（或 ARN） |
| `messages` | `Message[]` | 消息列表 |
| `system` | `SystemContentBlock[]` | 系统提示（有缓存点） |
| `inferenceConfig` | `{ maxTokens, temperature }` | 推理配置 |
| `toolConfig` | `ToolConfiguration` | 工具配置 |
| `additionalModelRequestFields` | `Record<string, any>` | 扩展字段（thinking 等） |
| `requestMetadata` | `Record<string, string>` | 成本标签 |

**认证**:

| 方式 | 说明 |
|---|---|
| SigV4 credentials | SDK 默认 credential chain |
| Bearer token | `AWS_BEARER_TOKEN_BEDROCK`，绕过 SigV4 |
| Proxy support | HTTP_PROXY + ProxyAgent |

**Thinking 字段**（通过 `additionalModelRequestFields`）:

**Claude 4.x（自适应）**:
```json
{
  "thinking": { "type": "adaptive", "display": "summarized"|"omitted" },
  "output_config": { "effort": "low"|"medium"|"high"|"xhigh"|"max" }
}
```

**Claude 旧模型（budget）**:
```json
{
  "thinking": { "type": "enabled", "budget_tokens": 1024, "display": "summarized" },
  "anthropic_beta": ["interleaved-thinking-2025-05-14"]
}
```

**缓存**:

支持 `cachePoint` 在系统提示和最后一条 user 消息中添加。支持 `CachePointType.DEFAULT` 和 `CacheTTL.ONE_HOUR`（长缓存）。

**停止原因映射**:

| 上游 `stopReason` | 内部 `StopReason` |
|---|---|
| `END_TURN`, `STOP_SEQUENCE` | `stop` |
| `MAX_TOKENS`, `MODEL_CONTEXT_WINDOW_EXCEEDED` | `length` |
| `TOOL_USE` | `toolUse` |
| 其他 | `error` |

---

### Google Generative AI (Gemini API)

**使用方式**: 通过 `@google/genai` SDK 发送 `client.models.generateContentStream(params)`

**请求参数** (`GenerateContentParameters`):

| 字段 | 类型 | 含义 |
|---|---|---|
| `model` | `string` | 模型 ID |
| `contents` | `Content[]` | 对话内容 |
| `config.systemInstruction` | `string` | 系统提示 |
| `config.temperature` | `number` | 温度 |
| `config.maxOutputTokens` | `number` | 最大输出 |
| `config.tools` | `FunctionDeclaration[]` | 工具定义 |
| `config.toolConfig` | `{ functionCallingConfig: { mode } }` | 工具选择策略 |
| `config.thinkingConfig` | `ThinkingConfig` | thinking 配置 |
| `config.abortSignal` | `AbortSignal` | 中止信号 |

**Thinking 配置** (`config.thinkingConfig`):

```typescript
// 启用 thinking
{
  includeThoughts: true,
  // Gemini 3 使用 level
  thinkingLevel: "MINIMAL"|"LOW"|"MEDIUM"|"HIGH",
  // Gemini 2.x 使用 budget
  thinkingBudget: number  // -1 = dynamic
}

// 禁用 thinking（Gemini 2.x）
{ thinkingBudget: 0 }

// 禁用 thinking（Gemini 3 Pro — 强制最低 level）
{ thinkingLevel: "LOW" }  // 不含 includeThoughts

// 禁用 thinking（Gemini 3 Flash）
{ thinkingLevel: "MINIMAL" }  // 不含 includeThoughts
```

**消息转换** (`convertMessages` → `Content[]`):

| 角色 | 协议格式 |
|---|---|
| `user` | `{ role: "user", parts: [{text}] 或 [{inlineData}] }` |
| `assistant` | `{ role: "model", parts: [{text, thought?}] + [{functionCall}] }` |
| `toolResult` | `{ role: "user", parts: [{functionResponse}] }` |

**Thinking Level 映射** (Gemini 3 Pro):

| pi `ThinkingLevel` | 协议值 |
|---|---|
| `minimal`/`low` | `LOW` |
| `medium`/`high` | `HIGH` |

**Thinking Level 映射** (Gemini 3 Flash):

| pi `ThinkingLevel` | 协议值 |
|---|---|
| `minimal` | `MINIMAL` |
| `low` | `LOW` |
| `medium` | `MEDIUM` |
| `high` | `HIGH` |

---

### Google Cloud Code Assist (Gemini CLI / Antigravity)

**使用方式**: 自定义 HTTP POST 到 `cloudcode-pa.googleapis.com/v1internal:streamGenerateContent`，SSE 流式解析。

**认证**: OAuth 2.0 Bearer token `{ token, projectId }`（JSON 编码的 apiKey）

**涉及端点**:

| 模式 | 端点 |
|---|---|
| Production | `https://cloudcode-pa.googleapis.com` |
| Antigravity Daily | `https://daily-cloudcode-pa.sandbox.googleapis.com` |
| Antigravity Autopush | `https://autopush-cloudcode-pa.sandbox.googleapis.com` |

**请求体** (`CloudCodeAssistRequest`):

| 字段 | 类型 | 说明 |
|---|---|---|
| `project` | `string` | GCP 项目 ID |
| `model` | `string` | 模型 ID |
| `request.contents` | `Content[]` | 对话（Gemini 格式） |
| `request.sessionId` | `string` | 会话 ID |
| `request.systemInstruction` | `{ parts: [{ text }] }` | 系统提示 |
| `request.generationConfig` | `{ maxOutputTokens, temperature, thinkingConfig }` | 生成配置 |
| `request.tools` | `FunctionDeclaration[]` | 工具 |
| `request.toolConfig` | `{ functionCallingConfig }` | 工具选择 |
| `requestType` | `"agent"` | Antigravity 专用 |
| `userAgent` | `"pi-coding-agent"` / `"antigravity"` | 标识 |
| `requestId` | `string` | 请求 ID |

**Antigravity 特有**:
- 硬编码的 `ANTIGRAVITY_SYSTEM_INSTRUCTION` 附加到系统提示
- 支持 Claude 模型（通过 `anthropic-beta: interleaved-thinking-2025-05-14` header）
- 工具使用 `parameters` 字段而不是 `parametersJsonSchema`（兼容 Anthropic）

**重试逻辑**: 最多 3 次，支持服务器驱动延迟和端点回退（403/404 立即切换端点）。

---

### Google Vertex AI

**使用方式**: 通过 `@google/genai` SDK（Vertex AI 模式）发送 `client.models.generateContentStream(params)`

**认证**:

| 方式 | 配置 |
|---|---|
| Application Default Credentials (ADC) | `project` + `location` |
| API Key | `GOOGLE_CLOUD_API_KEY` |

**参数与 Google Generative AI 基本相同**，额外字段：

| 字段 | 说明 |
|---|---|
| `vertexai: true` | 启用 Vertex AI 模式 |
| `project` | GCP 项目 ID |
| `location` | GCP 区域 |
| `apiVersion` | `"v1"` |

支持自定义 baseURL（例如通过代理访问 Vertex AI）。

---

### Mistral Conversations

**使用方式**: 通过 `@mistralai/mistralai` SDK 发送 `mistral.chat.stream(payload)`

**请求参数** (`ChatCompletionStreamRequest`):

| 字段 | 类型 | 含义 |
|---|---|---|
| `model` | `string` | 模型 ID |
| `stream` | `true` | 始终 true |
| `messages` | `ChatCompletionStreamRequestMessage[]` | 消息 |
| `temperature` | `number` | 温度 |
| `maxTokens` | `number` | 最大 token |
| `tools` | `FunctionTool[]` | 工具 |
| `toolChoice` | `"auto"`/`"none"`/`"any"`/`"required"` | 工具选择 |
| `promptMode` | `"reasoning"` | 启用 reasoning |
| `reasoningEffort` | `"none"`/`"high"` | reasoning 力度 |

**思考/推理**：Mistral 有两种 reasoning 模式：
1. **`promptMode: "reasoning"`** — 用于 mistral 新模型（如 devstral）
2. **`reasoningEffort: "high"`** — 用于 `mistral-small-2603`

**消息转换** (`toChatMessages`):

| 角色 | 协议格式 | 说明 |
|---|---|---|
| `system` | `{ role: "system", content }` | 系统提示 |
| `user` | `{ role: "user", content: string|ContentChunk[] }` | 文本或文本+图片 |
| `assistant` | `{ role: "assistant", content, toolCalls }` | thinking 用 `{ type: "thinking", thinking: [...] }` |
| `tool` | `{ role: "tool", toolCallId, name, content }` | 工具结果 |

**缓存**: 通过 `x-affinity` header 发送 session ID 实现 KV-cache 亲和。

---

## 特殊字段 / 扩展字段说明

### 1. `compat.thinkingFormat` — 多格式 thinking 适配

pi 支持 6 种不同的 thinking 参数格式，通过 `OpenAICompletionsCompat.thinkingFormat` 配置：

| 格式值 | 协议字段 | 使用场景 |
|---|---|---|
| `"openai"` | `reasoning_effort: string` | OpenAI / 多数兼容 API |
| `"openrouter"` | `reasoning: { effort }` | OpenRouter 规范化接口 |
| `"deepseek"` | `thinking: { type }` + `reasoning_effort` | DeepSeek |
| `"zai"` | `enable_thinking: boolean` | 智谱 AI (z.ai) |
| `"qwen"` | `enable_thinking: boolean` | Qwen 模型 |
| `"qwen-chat-template"` | `chat_template_kwargs: { enable_thinking, preserve_thinking }` | Qwen 通过 chat template |

### 2. `compat.reasoningEffortMap` — reasoning 力度映射

```typescript
// DeepSeek 示例
{
  minimal: "high",
  low: "high",
  medium: "high",
  high: "high",
  xhigh: "max"
}
```

将 pi 的统一 `ThinkingLevel`（minimal/low/medium/high/xhigh）映射到 provider 具体值。

### 3. `compat.supportsReasoningContentOnAssistantMessages`

DeepSeek 要求所有回放的 assistant 消息在 reasoning 启用时包含空的 `reasoning_content: ""` 字段。默认 `false`，DeepSeek provider 自动设为 `true`。

### 4. `compat.requiresThinkingAsText`

某些 provider 不支持 `thinking` content block，需要将 thinking 内容转为纯文本（`<thinking>...</thinking>` 格式）。默认自动检测。

### 5. `compat.zaiToolStream`

智谱 z.ai 支持 `tool_stream: true` 在流式响应中发送 tool call delta。默认 `false`。

### 6. `compat.cacheControlFormat: "anthropic"`

当设为 `"anthropic"` 时，在 OpenAI Chat Completions 请求中对 system prompt、最后一个工具、最后一条消息添加 `cache_control: { type: "ephemeral" }`。用于 OpenRouter 上桥接 Anthropic 模型。

### 7. `compat.sendSessionAffinityHeaders`

用于 OpenAI Chat Completions 提供商，发送 `session_id`、`x-client-request-id`、`x-session-affinity` header 实现会话亲和路由。

### 8. `compat.supportsEagerToolInputStreaming`

Anthropic Messages 兼容性：控制是否发送 `eager_input_streaming: true` 到每个工具定义。Web 端不支持，需使用 `fine-grained-tool-streaming-2025-05-14` beta header。

### 9. `text.verbosity`（OpenAI Codex）

控制响应的详细程度：`"low"`（默认）、`"medium"`、`"high"`。Codex 专用。

### 10. `OpenRouterRouting` / `VercelGatewayRouting`

OpenRouter 和 Vercel AI Gateway 的提供路由选择，在请求体中发送 `provider` / `providerOptions` 字段控制上游提供商的优先级、分片策略、价格上限、吞吐量等。

### 11. `service_tier`

OpenAI Responses / Codex 的服务层选择：
- `"auto"` — 自动选择
- `"default"` — 默认
- `"flex"` — 50% 价格（延迟更大）
- `"priority"` — 2x-2.5x 价格（GPT-5.5 为 2.5x）

### 12. `reasoningSummary`（OpenAI Responses）

推理摘要模式：`"auto"`、`"detailed"`、`"concise"`、`"off"`、`"on"`。控制返回的 reasoning 内容详细度。

---

## compat 配置机制

### 设计原理

`compat` 配置用于适配非标准或自建的 OpenAI 兼容 API。它定义在 `Model.compat` 字段（可选），通过两种方式解析：

1. **自动检测** (`detectCompat`)：根据 `model.provider` 和 `model.baseUrl` 自动推断兼容设置
2. **显式覆盖**：用户可以在模型定义中设置 `model.compat` 显式覆盖自动检测值

### 检测优先级

```typescript
function getCompat(model: Model<"openai-completions">) {
  const detected = detectCompat(model);  // 自动检测
  if (!model.compat) return detected;
  
  // 显式覆盖：非 undefined 的 compat 字段覆盖检测值
  return {
    supportsStore: model.compat.supportsStore ?? detected.supportsStore,
    ...
  };
}
```

### `OpenAICompletionsCompat` 完整字段

```typescript
interface OpenAICompletionsCompat {
  supportsStore?: boolean;                    // 是否支持 store 字段
  supportsDeveloperRole?: boolean;            // 是否支持 developer role
  supportsReasoningEffort?: boolean;          // 是否支持 reasoning_effort
  reasoningEffortMap?: Partial<Record<ThinkingLevel, string>>;  // reasoning 力度映射
  supportsUsageInStreaming?: boolean;         // 流式 token 用量
  maxTokensField?: "max_completion_tokens" | "max_tokens";  // max tokens 字段名
  requiresToolResultName?: boolean;           // tool result 需要 name 字段
  requiresAssistantAfterToolResult?: boolean;  // tool result 后需要 assistant 消息
  requiresThinkingAsText?: boolean;           // thinking 转为纯文本
  requiresReasoningContentOnAssistantMessages?: boolean;  // assistant 消息需要空 reasoning_content
  thinkingFormat?: "openai"|"openrouter"|"deepseek"|"zai"|"qwen"|"qwen-chat-template";
  openRouterRouting?: OpenRouterRouting;
  vercelGatewayRouting?: VercelGatewayRouting;
  zaiToolStream?: boolean;                    // z.ai tool_stream
  supportsStrictMode?: boolean;               // 工具 strict 字段
  cacheControlFormat?: "anthropic";           // Anthropic 风格 cache_control
  sendSessionAffinityHeaders?: boolean;       // 会话亲和 header
  supportsLongCacheRetention?: boolean;       // 长缓存保留
}
```

### `OpenAIResponsesCompat` 字段

```typescript
interface OpenAIResponsesCompat {
  sendSessionIdHeader?: boolean;       // 发送 session_id header
  supportsLongCacheRetention?: boolean;  // 24h 长缓存
}
```

### `AnthropicMessagesCompat` 字段

```typescript
interface AnthropicMessagesCompat {
  supportsEagerToolInputStreaming?: boolean;  // 工具 eager input streaming
  supportsLongCacheRetention?: boolean;       // 长缓存 (cache_control.ttl: "1h")
}
```

### 已知 Provider 自动检测规则

| Provider | 关键检测结果 |
|---|---|
| OpenAI | 标准 OpenAI Chat Completions |
| DeepSeek | `thinkingFormat: "deepseek"`、`requiresReasoningContentOnAssistantMessages: true`、`reasoningEffortMap: {xhigh: "max"}` |
| z.ai | `thinkingFormat: "zai"`、`supportsReasoningEffort: false`、`useMaxTokens: false` |
| x.ai (Grok) | `supportsReasoningEffort: false` |
| OpenRouter | `thinkingFormat: "openrouter"`，对 Anthropic 模型使用 `cacheControlFormat: "anthropic"` |
| Cerebras | 非标准（`supportsStore: false`, `supportsDeveloperRole: false`） |
| Chutes.ai | 非标准，使用 `maxTokensField: "max_tokens"` |
| Cloudflare Workers AI | 非标准 |

---

## 对路由器的兼容性影响

### 1. 协议多样性

pi 支持 10 种不同协议，路由器需要支持至少这些协议的子集。最重要的是：

- **OpenAI Chat Completions**（最广泛）：几乎所有非 OpenAI 的 API 都兼容此协议
- **OpenAI Responses API**：OpenAI GPT-5.x 系列专用
- **Anthropic Messages**：Claude 模型专用

### 2. Thinking 字段的复杂性

pi 使用 6 种不同的 `thinkingFormat`，将 5 级统一的 `ThinkingLevel`（minimal/low/medium/high/xhigh）映射到不同协议的格式。路由器如果统一使用 `OpenAICompletionsCompat` 配置，可以复用 pi 的检测机制。

关键差异：
- `"deepseek"` 需要 `thinking.type + reasoning_effort`，且 `reasoningEffortMap` 必须将 pi level 映射
- `"openrouter"` 使用嵌套 `reasoning: { effort }` 对象
- `"zai"` / `"qwen"` 使用 `enable_thinking: boolean`（是/否，无力度）
- Anthropic 需要 `thinking.type + budget_tokens` 或 `thinking.type + output_config.effort`

### 3. 工具调用差异

| 协议 | tool call id 格式 | tool result 格式 |
|---|---|---|
| OpenAI Chat Completions | `string`（<40 chars） | `{ role: "tool", content, tool_call_id }` |
| OpenAI Responses | `{call_id}\|{item_id}`（pipe 分隔） | `{ type: "function_call_output", call_id, output }` |
| Anthropic Messages | `string`（<64 chars, alphanumeric+_） | `{ type: "tool_result", tool_use_id, content }` |
| Google Gemini | `functionCall` 包含 id | `{ functionResponse }` |
| Bedrock | `toolUseId`（<64 chars） | `{ toolResult, toolUseId, content }` |
| Mistral | `string`（9 chars, `shortHash`） | `{ role: "tool", toolCallId, name, content }` |

### 4. 缓存差异

- **OpenAI Chat Completions**: `prompt_cache_key` + `prompt_cache_retention: "24h"` + Anthropic 风格 `cache_control`
- **OpenAI Responses**: `prompt_cache_key` + `prompt_cache_retention: "24h"` + `session_id` header
- **Anthropic Messages**: `cache_control: { type: "ephemeral", ttl? }` 在 system/message/tool 级别
- **Bedrock**: `cachePoint: { type: "DEFAULT", ttl?: "ONE_HOUR" }`
- **Google**: `cachedContentTokenCount` 在响应中

### 5. 认证模式

| 模式 | 协议 |
|---|---|
| API Key (Bearer) | OpenAI Chat Completions, OpenAI Responses, Anthropic, Mistral, Google Gemini |
| OAuth 2.0 Bearer | Google Cloud Code Assist, Anthropic OAuth |
| AWS SigV4 | Bedrock |
| JWT + custom headers | OpenAI Codex |

### 6. 传输方式

| 方式 | 协议 |
|---|---|
| SSE (HTTP/1.x) | OpenAI Chat Completions, Anthropic (SDK), Google Gemini (SDK), Mistral (SDK), Bedrock (SDK), Codex SSE |
| WebSocket | OpenAI Codex（可选，支持会话复用） |

### 7. 路由器的建议适配策略

1. **优先支持 OpenAI Chat Completions** — 覆盖 90%+ 的提供商
2. **对 thinking 使用 `OpenAICompletionsCompat`** — 复用 pi 的检测和映射逻辑
3. **对 Anthropic 支持使用 Anthropic Messages 协议** — 如果路由器定位是编码代理
4. **注意 tool call ID 的跨协议转换** — `transformMessages()` 提供了很好的参考
5. **缓存策略统一采用 `CacheRetention: "none"|"short"|"long"`** — pi 的三级策略可作参考
