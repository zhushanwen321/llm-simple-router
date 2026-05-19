# Codex CLI API 格式协议调研

- **项目**: OpenAI Codex CLI (Rust 实现，位于 `codex-rs/`)
- **调研日期**: 2026-05-18
- **核心文件**:
  - `codex-api/src/common.rs` — `ResponsesApiRequest` / `ResponseCreateWsRequest`
  - `codex-api/src/endpoint/responses.rs` — HTTP Responses API 客户端
  - `codex-api/src/endpoint/responses_websocket.rs` — WebSocket Responses API 客户端
  - `codex-api/src/endpoint/realtime_websocket/` — Realtime WebSocket 协议
  - `codex-api/src/endpoint/compact.rs` — `/responses/compact` 端点
  - `codex-api/src/sse/responses.rs` — SSE 事件流解析
  - `codex-api/src/requests/headers.rs` — 请求头构造
  - `codex-api/src/provider.rs` — Provider 配置
  - `tools/src/responses_api.rs` — Responses API Tool 类型
  - `tools/src/tool_spec.rs` — `ToolSpec` 枚举（工具格式定义）
  - `core/src/client.rs` — 实际构建 `ResponsesApiRequest` 的地方
  - `protocol/src/models.rs` — `ResponseItem` / `ContentItem` / `ResponseInputItem`
  - `protocol/src/openai_models.rs` — `ReasoningEffort` / `ModelInfo`
  - `model-provider-info/src/lib.rs` — `WireApi` 枚举（仅支持 `Responses`）
  - `responses-api-proxy/src/lib.rs` — Responses API 代理

---

## 概述

Codex CLI **只使用 OpenAI Responses API** 一种协议格式。所有 API 通信均基于 Responses API 协议，没有使用 Anthropic Messages API、OpenAI Chat Completions API 或其他格式。

> 历史记录：早期版本曾支持 `WireApi::Chat`（OpenAI Chat Completions），但已在本次调研版本中彻底移除。尝试使用 `wire_api = "chat"` 会抛出清晰的弃用错误。

### 三种传输方式

1. **HTTP SSE** (POST `/v1/responses`, `Accept: text/event-stream`)
2. **WebSocket** (`wss://.../v1/responses`, OpenAI 自定义 Responses WebSocket 协议)
3. **Realtime WebSocket** (独立的 OpenAI Realtime API，用于语音对话)

支持的非 OpenAI 提供商（Ollama、LM Studio）也使用 Responses API 格式。

---

## 使用的 API 协议

| 协议 | 端点 | 传输 | 使用场景 |
|------|------|------|----------|
| OpenAI Responses API | `POST /v1/responses` | HTTP SSE | 主要编码对话（模型交互） |
| OpenAI Responses API | `wss://.../v1/responses` | WebSocket | 可选的高效流式传输 |
| OpenAI Responses API | `POST /v1/responses/compact` | HTTP JSON | 对话压缩 |
| OpenAI Responses API | `POST /v1/memories/trace_summarize` | HTTP JSON | 记忆总结 |
| OpenAI Realtime API | `wss://.../v1/realtime` | WebSocket | 语音对话模式 |

---

## OpenAI Responses API — 请求字段详情

### 核心请求 `ResponsesApiRequest`

定义在 `codex-api/src/common.rs`，字段映射到 OpenAI Responses API 的 `POST /v1/responses` 请求体。

| # | 字段 | 类型 | 必填 | 含义与用途 |
|---|------|------|------|-----------|
| 1 | `model` | `String` | 是 | 模型标识（如 `"gpt-5"`, `"o4-mini"`）。来自 `ModelInfo.slug` |
| 2 | `instructions` | `String` | 是 | 系统级指令（对应 Responses API 的 `instructions` 字段）。内容由 `BaseInstructions` + `DeveloperInstructions`（权限策略、沙箱策略等）拼接而成 |
| 3 | `input` | `Vec<ResponseItem>` | 是 | 对话输入。包含消息历史（user/assistant/developer）、工具调用输出等。按 `ResponseInputItem` 格式构造 |
| 4 | `tools` | `Vec<serde_json::Value>` | 是 | 可用工具列表。通过 `create_tools_json_for_responses_api()` 将 `ToolSpec` 枚举序列化为 Responses API 格式 |
| 5 | `tool_choice` | `String` | 是 | 始终为 `"auto"`。让模型自主选择是否调用工具 |
| 6 | `parallel_tool_calls` | `bool` | 是 | 是否允许模型并行调用多个工具。来自 `ModelInfo.supports_parallel_tool_calls` 和 prompt 设置 |
| 7 | `reasoning` | `Option<Reasoning>` | 否 | 推理配置。仅在模型 `supports_reasoning_summaries` 时设置 |
| 8 | `store` | `bool` | 是 | 是否在 OpenAI 服务端存储响应。仅在 Azure Responses 端点为 `true` |
| 9 | `stream` | `bool` | 是 | **始终为 `true`**。所有模型请求均使用流式 |
| 10 | `include` | `Vec<String>` | 是 | 请求在 SSE 事件中额外包含的数据。当启用推理时包含 `["reasoning.encrypted_content"]` |
| 11 | `service_tier` | `Option<String>` | 否 | 服务层级。`"priority"`（对应 `ServiceTier::Fast`）或其他序列化值 |
| 12 | `prompt_cache_key` | `Option<String>` | 否 | 提示缓存键。值为 `conversation_id.to_string()`（即 ThreadId） |
| 13 | `text` | `Option<TextControls>` | 否 | 文本输出控制。包含 verbosity 和 output_schema 选项 |
| 14 | `client_metadata` | `Option<HashMap<String, String>>` | 否 | 客户端元数据。包含 `x-codex-installation-id` 和 W3C 追踪上下文（`ws_request_header_traceparent`, `ws_request_header_tracestate`） |

### 推理配置 `Reasoning`

| 字段 | 类型 | 含义 |
|------|------|------|
| `effort` | `Option<ReasoningEffortConfig>` | 推理力度：`none` / `minimal` / `low` / `medium` / `high` / `x_high` |
| `summary` | `Option<ReasoningSummaryConfig>` | 推理摘要模式：`auto` / `detailed` / `concise` / `none` |

`ReasoningEffort` 定义在 `protocol/src/openai_models.rs`：
```rust
pub enum ReasoningEffort {
    None, Minimal, Low, Medium, High, XHigh,
}
```

### 文本控制 `TextControls`

| 字段 | 类型 | 含义 |
|------|------|------|
| `verbosity` | `Option<OpenAiVerbosity>` | 控制模型输出冗长度：`low` / `medium` / `high` |
| `format` | `Option<TextFormat>` | 结构化输出格式（JSON Schema） |

```rust
pub struct TextFormat {
    pub r#type: TextFormatType,     // 仅支持 `json_schema`
    pub strict: bool,               // 始终为 true
    pub schema: Value,              // JSON Schema 定义
    pub name: String,               // 始终为 "codex_output_schema"
}
```

### 工具定义

工具通过 `ToolSpec` 枚举序列化为 Responses API 格式，所有工具都有 `"type"` 标记：

| 工具类型 | `type` 值 | 说明 |
|----------|-----------|------|
| 函数调用 | `"function"` | 标准 JSON Schema 定义的函数工具。`name`, `description`, `strict`, `parameters`, `defer_loading` |
| 本地 Shell | `"local_shell"` | 内置 shell 执行工具（无需额外参数） |
| Web 搜索 | `"web_search"` | 内置 web 搜索。可选字段：`external_web_access`, `filters`, `user_location`, `search_context_size`, `search_content_types` |
| 工具搜索 | `"tool_search"` | 搜索已注册工具的元工具 |
| 图片生成 | `"image_generation"` | 内置 DALL·E 图片生成。可选字段：`output_format` |
| Freeform | `"custom"` | 自由格式工具（名称、描述、格式定义） |

函数工具 (`ResponsesApiTool`) 的字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | `String` | 工具名称 |
| `description` | `String` | 工具描述 |
| `strict` | `bool` | 是否严格模式（TODO：当 strict 为 true 时要求必含 `required`, `additionalProperties`） |
| `defer_loading` | `Option<bool>` | 是否延迟加载（MCP 工具使用） |
| `parameters` | `JsonSchema` | JSON Schema 参数定义 |
| `output_schema` | `Option<Value>` | 工具输出 JSON Schema（仅在 Rust 内使用，不序列化到请求中） |

### 事件流 `ResponseItem`

定义在 `protocol/src/models.rs`。作为 `input` 的 item 类型：

| Item 类型 | `type` 值 | 说明 |
|-----------|-----------|------|
| Message | `"message"` | 消息。包含 `role`（user / assistant / developer / system）和 `content`（`ContentItem[]`） |
| FunctionCallOutput | `"function_call_output"` | 函数调用结果。`call_id` + `output`（字符串或内容项数组） |
| CustomToolCallOutput | `"custom_tool_call_output"` | 自定义工具调用结果。`call_id` + `name` + `output` |
| ToolSearchOutput | `"tool_search_output"` | 工具搜索结果。`call_id` + `status` + `execution` + `tools[]` |
| McpToolCallOutput | `"mcp_tool_call_output"` | MCP 工具调用结果（内部使用，转为 `function_call_output` 发送） |

`ContentItem` 内容块类型：

| 类型 | `type` 值 | 说明 |
|------|-----------|------|
| InputText | `"input_text"` | 输入文本 |
| InputImage | `"input_image"` | 输入图片（data URL 格式） |
| OutputText | `"output_text"` | 输出文本 |

---

## 响应事件 `ResponseEvent`

定义在 `codex-api/src/common.rs`。SSE 事件流解析后生成：

| 事件 | 触发时机 | 说明 |
|------|----------|------|
| `Created` | 响应创建 | SSE 事件 `response.created` |
| `OutputItemDone` | 输出项完成 | SSE 事件 `response.output_item.done`，携带 `ResponseItem` |
| `OutputItemAdded` | 输出项添加 | SSE 事件 `response.output_item.added` |
| `OutputTextDelta` | 文本流式 | SSE 事件 `response.output_text.delta` |
| `ReasoningSummaryDelta` | 推理摘要流式 | SSE 事件 `reasoning_summary.delta`，`summary_index` 标记段落 |
| `ReasoningContentDelta` | 推理内容流式 | SSE 事件 `reasoning.content.delta` |
| `ReasoningSummaryPartAdded` | 推理摘要段完成 | SSE 事件 `reasoning_summary.started` 对应逻辑 |
| `ServerModel` | 响应头 | 从 `OpenAI-Model` HTTP 头获取，可能与请求模型不同（后端安全路由） |
| `ServerReasoningIncluded` | 响应头 | 从 `X-Reasoning-Included` HTTP 头获取，服务端已计算推理 token |
| `Completed` | 响应完成 | SSE 事件 `response.completed`，携带 `response_id` 和 `TokenUsage` |
| `RateLimits` | 响应头 | 从响应头的速率限制信息解析 |
| `ModelsEtag` | 响应头 | 从 `X-Models-Etag` HTTP 头获取 |

**Token 使用情况** (`TokenUsage`) 字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `input_tokens` | `i64` | 输入 token 数 |
| `cached_input_tokens` | `i64` | 缓存命中 token 数 |
| `output_tokens` | `i64` | 输出 token 数 |
| `reasoning_output_tokens` | `i64` | 推理 token 数 |
| `total_tokens` | `i64` | 总 token 数 |

---

## WebSocket 请求 `ResponseCreateWsRequest`

与 HTTP 版本的 `ResponsesApiRequest` 基本一致，额外包含：

| 字段 | 类型 | 说明 |
|------|------|------|
| `previous_response_id` | `Option<String>` | 上一次响应的 ID。用于增量请求：后续请求只发送新增的 input items，基于上次 response 进行扩展 |
| `generate` | `Option<bool>` | 预连接模式。为 `Some(false)` 时不生成响应，用于 WebSocket 预热（prewarm） |

WebSocket 消息类型 `ResponsesWsRequest`：
```rust
enum ResponsesWsRequest {
    ResponseCreate(ResponseCreateWsRequest),  // {"type": "response.create", ...}
}
```

---

## Realtime WebSocket API

用于语音/实时对话场景。

### Session 更新请求 `session.update`

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | `String` | `"realtime"` 或 `"transcription"` |
| `model` | `Option<String>` | 模型 ID |
| `instructions` | `Option<String>` | 系统指令 |
| `voice` | `RealtimeVoice` | 语音类型（`alloy`, `arbor`, `ash`, `ballad`, ... 共 19 种） |
| `output_modalities` | `Option<Vec<String>>` | v2: `["audio"]` |
| `input_audio_format` | — | 固定 `audio/pcm`, 24000 Hz |
| `turn_detection` | `Option<SessionTurnDetection>` | VAD 语音活动检测配置 |
| `tools` | `Option<Vec<SessionFunctionTool>>` | 工具列表（v2: background_agent 工具） |
| `tool_choice` | `Option<String>` | `"auto"` |

### 客户端事件 `RealtimeOutboundMessage`

| 消息类型 | 用法 |
|----------|------|
| `input_audio_buffer.append` | 发送音频数据 |
| `conversation.item.create` | 创建对话项（用户文本/函数调用输出） |
| `response.create` | 触发模型响应 |
| `session.update` | 更新会话配置 |

### 服务端事件 `RealtimeEvent`

| 事件 | 说明 |
|------|------|
| `SessionUpdated` | 会话更新确认 |
| `InputAudioSpeechStarted` | 用户语音开始 |
| `InputTranscriptDelta` | 语音转文字流式 |
| `OutputTranscriptDelta` | 模型语音输出文字 |
| `AudioOut` | 模型生成的音频帧 |
| `ResponseCreated` | 响应创建 |
| `ResponseCancelled` | 响应取消 |
| `ResponseDone` | 响应完成 |
| `ConversationItemAdded` | 对话项添加 |
| `ConversationItemDone` | 对话项完成 |
| `HandoffRequested` | 后台 Agent 转交请求 |
| `Error` | 错误事件 |

---

## 特殊字段 / 扩展字段说明

### 1. `include` 字段

请求中包含 `["reasoning.encrypted_content"]` 时，服务器会在 SSE 流中额外发送 `reasoning_summary.*` 和 `reasoning.content.*` 事件。否则推理内容不返回。

### 2. `client_metadata` 字段

用于传递 OpenTelemetry 分布式追踪上下文和客户端标识：
- `x-codex-installation-id` — 安装标识符
- `ws_request_header_traceparent` — W3C TraceContext traceparent
- `ws_request_header_tracestate` — W3C TraceContext tracestate

### 3. 自定义 HTTP 请求头

| 请求头 | 用途 |
|--------|------|
| `Authorization: Bearer <token>` | API 认证 |
| `session_id` | 客户端生成的会话/线程 ID |
| `x-openai-subagent` | 子 Agent 类型：`review`, `compact`, `memory_consolidation`, `collab_spawn` |
| `x-client-request-id` | 客户端请求 ID（等于 conversation_id） |
| `x-codex-turn-state` | 粘性路由状态 token |
| `x-codex-turn-metadata` | 轮次元数据（JSON，包含模型名、轮次索引、effort 等） |
| `x-codex-installation-id` | 安装 ID |
| `x-codex-parent-thread-id` | 父线程 ID |
| `x-codex-window-id` | 窗口 ID |
| `x-responsesapi-include-timing-metrics` | 包含时序指标 |
| `OpenAI-Beta` | Beta 功能头（WebSocket v2: `responses_websockets=2026-02-06`） |

### 4. `service_tier` 字段

非标准映射。Codex 用 `Some("priority")` 表示 `ServiceTier::Fast`，其他 tier 直接序列化为小写字符串。

### 5. `function_call_output.output` 序列化

`FunctionCallOutputPayload` 支持两种响应格式：
- **纯文本**: 直接序列化为字符串
- **结构化内容**: 序列化为 `FunctionCallOutputContentItem[]` 数组（支持 `input_text` 和 `input_image` 类型）

### 6. Azure Responses 端点适配

当检测到 Azure 端点时（通过 URL 包含 `openai.azure.` / `cognitiveservices.azure.` 等）：
- `store: true`
- 自动为 input items 附加 `id` 字段

### 7. 增量请求（WebSocket 优化）

WebSocket 模式下支持增量请求：当 `input` 是之前请求的超集且非 input 字段不变时，复用 `previous_response_id` 只发送新增的 input items，避免重传整个对话历史。

### 8. `request_compression` 请求压缩

支持 `zstd` 压缩（仅 HTTP SSE 模式）。通过 `ResponsesOptions.compression` 配置，默认 `None`。

### 9. 开放源码（OSS）提供商

Ollama 和 LM Studio 使用相同的 Responses API 格式（`wire_api = "responses"`），通过 API 代理服务（`responses-api-proxy`）实现兼容。Ollama 要求版本 ≥ 0.13.4 才能支持 Responses API。

---

## 对路由器的兼容性影响

### 1. 单一协议约束

Codex CLI **只支持 OpenAI Responses API**。路由器（如 llm-simple-router）要代理 Codex CLI 流量，必须实现/模拟 Responses API 协议。不能使用 Anthropic Messages API 或 OpenAI Chat Completions 格式。

### 2. 必须实现的端点

| 端点 | 方法 | 功能 | 要求 |
|------|------|------|------|
| `/v1/responses` | POST | 核心对话 | 必须支持 SSE 流式响应 |
| `/v1/responses/compact` | POST | 对话压缩 | 必须支持 JSON 返回 |
| `/v1/realtime` | WebSocket | 语音对话 | 仅语音场景需要 |
| `/v1/models` | GET | 模型列表 | 必须支持，返回 `ModelInfo[]` |

### 3. 必须支持的 Responses API 特性

- **SSE 流式事件**: `response.created`, `response.output_item.added`, `response.output_item.done`, `response.output_text.delta`, `reasoning_summary.delta`, `reasoning.content.delta`, `response.completed`
- **推理支持**: `reasoning` 字段（effort + summary），`include: ["reasoning.encrypted_content"]`
- **工具系统**: `type: "function"`, `type: "local_shell"`, `type: "web_search"`, `type: "image_generation"`
- **内容格式**: `input_text`, `input_image`（data URL），`output_text`
- **函数调用输出**: 纯文本和结构化内容项两种格式
- **ResponseItem 类型**: `message`, `function_call_output`, `function_call`

### 4. 必须保留的自定义头

- `x-openai-subagent` — 子 Agent 分类
- `x-codex-turn-state` — 粘性路由
- `x-codex-installation-id` — 安装标识

### 5. 特殊注意事项

- **推理字段**: `reasoning.effort` 使用非标准值 `x_high`，路由器需要支持
- **工具调用 ID**: `call_id`（字符串）用于关联函数调用和结果，必须保持一致性
- **图片处理**: 图片以 data URL 形式传递（`data:image/png;base64,...`），路由器不能截断
- **压缩**: 支持 Zstd 请求体压缩（Content-Encoding: zstd）
- **text.verbosity**: 不是所有模型支持此字段，路由器需要根据模型信息适当地忽略或处理
- **include 字段**: 必须解析并按要求返回对应事件；如果返回 `reasoning.encrypted_content`，客户端期望收到 `reasoning_summary.*` 和 `reasoning.content.*` 流式事件
- **`X-Reasoning-Included` 响应头**: 当服务端已包含推理内容时需要设置此头，避免客户端重复计算
- **`OpenAI-Model` 响应头**: 允许服务端返回与请求不同的模型名（用于后端安全路由切换模型）
