# 三格式字段映射文档

基于 OpenAI Chat Completions、OpenAI Responses API、Anthropic Messages API 三种格式的字段映射关系。
参考 litellm 和 octopus 项目的转换逻辑，结合本项目实际实现。

## 转换矩阵

本项目支持 6 条转换路径（请求方向）：

| 路径 | 文件 |
|------|------|
| Responses → Chat | `request-bridge-responses.ts` |
| Chat → Responses | `request-bridge-responses.ts` |
| Responses → Anthropic | `request-transform-responses.ts` |
| Anthropic → Responses | `request-transform-responses.ts` |
| Chat → Anthropic | `request-transform.ts` + `message-mapper.ts` |
| Anthropic → Chat | `request-transform.ts` + `message-mapper.ts` |

对应响应方向（非流式）：
| 路径 | 文件 |
|------|------|
| Chat → Responses | `response-bridge-responses.ts` |
| Responses → Chat | `response-bridge-responses.ts` |
| Anthropic → Responses | `response-transform-responses.ts` |
| Responses → Anthropic | `response-transform-responses.ts` |
| Anthropic → Chat | `response-transform.ts` |
| Chat → Anthropic | `response-transform.ts` |

对应流式方向：
| 路径 | 文件 |
|------|------|
| Anthropic → Chat | `stream-ant2oa.ts` |
| Anthropic → Responses | `stream-ant2resp.ts` |
| Chat → Anthropic | `stream-oa2ant.ts` |
| Responses → Anthropic | `stream-resp2ant.ts` |
| Chat → Responses | `stream-bridge-chat2resp.ts` |
| Responses → Chat | `stream-bridge-resp2chat.ts` |

---

## 1. System Prompt / Instructions

### 字段对应

| Responses API | Chat Completions | Anthropic |
|---|---|---|
| `instructions: string` | `messages[0].role="system"`.content | `system: string \| TextBlock[]` |
| `input[].type="message", role="developer"` | `messages[].role="developer"` | `system` (追加) |
| `input[].type="message", role="system"` | `messages[].role="system"` | `system` (追加) |

### 规则

1. **Responses → Chat**: `instructions` → system message；`developer`/`system` input items → 对应 role 的 message
2. **Chat → Responses**: 所有 `system`/`developer` messages → `instructions` 字符串
3. **Responses → Anthropic**: `instructions` + input 中 `developer`/`system` 消息 → 合并为 `system` 字段；**developer 消息绝不能留在 messages 中**
4. **Chat → Anthropic**: `system`/`developer` messages → 提取为 `system` 字段
5. **Anthropic → Responses**: `system` → `instructions`
6. **Anthropic → Chat**: `system` → `messages[0].role="system"`

### litellm/octopus 参考
- litellm: `transform_instructions_to_system_message()` 创建 ChatCompletionSystemMessage
- octopus: `instructions` 转为 system message，反向时合并为 `instructions` 字符串
- **两者都确认：developer 在发给非 OpenAI provider 时必须转为 system**

---

## 2. Input Messages / Content

### 2.1 普通消息

| Responses API input item | Chat Completions | Anthropic |
|---|---|---|
| `{type:"message", role:"user", content:[{type:"input_text",text:"..."}]}` | `{role:"user", content:"..."}` | `{role:"user", content:[{type:"text",text:"..."}]}` |
| `{type:"message", role:"assistant", content:[{type:"input_text",text:"..."}]}` | `{role:"assistant", content:"..."}` | `{role:"assistant", content:[{type:"text",text:"..."}]}` |
| `{type:"input_text", text:"..."}` | `{role:"user", content:"..."}` | `{role:"user", content:[{type:"text",text:"..."}]}` |
| `input: "string"` | `[{role:"user", content:"string"}]` | `[{role:"user", content:[{type:"text",text:"string"}]}]` |

### 2.2 Image 消息

| Responses API | Chat Completions | Anthropic |
|---|---|---|
| `{type:"input_image", image_url:"..."}` | `{role:"user", content:[{type:"image_url",image_url:{url:"..."}}]}` | `{role:"user", content:[{type:"image",source:{type:"url",url:"..."}}]}` |

### 2.3 Tool 调用

| Responses API | Chat Completions | Anthropic |
|---|---|---|
| `{type:"function_call", call_id, name, arguments}` | `{role:"assistant", tool_calls:[{id:call_id, function:{name,arguments}}]}` | `{role:"assistant", content:[{type:"tool_use", id, name, input}]}` |
| `{type:"function_call_output", call_id, output}` | `{role:"tool", tool_call_id:call_id, content:output}` | `{role:"user", content:[{type:"tool_result", tool_use_id, content}]}` |

**关键规则：**
- 连续多个 `function_call` 应合并为一个 assistant message 的多个 tool_calls
- Anthropic 的 `tool_result` 必须在 `user` role 消息中
- Chat Completions 的 `tool` 消息 → Anthropic `user` + `tool_result` block

### 2.4 Reasoning (请求方向 input)

| Responses API | Chat Completions | Anthropic |
|---|---|---|
| `{type:"reasoning", summary:[], encrypted_content}` | `{role:"assistant", reasoning_content:summary_text}` | `{role:"assistant", content:[{type:"thinking",thinking:summary_text},{type:"redacted_thinking",data:encrypted_content}]}` |

### 2.5 Tool ID 前缀

| 方向 | 规则 |
|------|------|
| Responses → Anthropic | `call_id` → 加 `toolu_` 前缀 |
| Anthropic → Responses | `tool_use_id` → 去掉 `toolu_` 前缀 |
| Responses → Chat | `call_id` 直接作为 `tool_calls[].id` |

---

## 3. 请求参数

### 3.1 Token 限制

| Responses API | Chat Completions | Anthropic |
|---|---|---|
| `max_output_tokens` | `max_completion_tokens` 或 `max_tokens` | `max_tokens` |
| — | — | 默认值: 4096（无 max_tokens 时） |

**规则：** Anthropic 的 `max_tokens` 必须大于等于 `thinking.budget_tokens`

### 3.2 Reasoning / Thinking

Chat Completions 客户端可能通过三种方式发送 thinking 参数。Router 的转换层按优先级处理：
`reasoning`(obj) > `thinking`(obj) > `reasoning_effort`(str)。

**客户端三种发送方式：**

| 方式 | 触发条件 | 发送的字段 | 示例 |
|------|---------|-----------|------|
| `reasoning` object | DeepSeek 扩展 / OpenAI 原生 | `reasoning: {effort, max_tokens}` | `{reasoning: {effort: "high"}}` |
| `thinking` object | Pi `compat.thinkingFormat: "deepseek"` | `thinking: {type: "enabled"}` | `{thinking: {type: "enabled"}}` |
| `reasoning_effort` string | OpenAI 标准 / Pi 无 compat | `reasoning_effort: "high"` | `{reasoning_effort: "high"}` |

**三种格式的标准字段：**

| Responses API | Chat Completions | Anthropic |
|---|---|---|
| `reasoning: {effort:"low"/"medium"/"high"}` | `reasoning: {effort:"low"/"medium"/"high"}` | `thinking: {type:"enabled", budget_tokens}` |
| `reasoning: {max_tokens: N}` | `reasoning: {max_tokens: N}` | `thinking: {type:"enabled", budget_tokens: N}` |
| — | `thinking: {type:"enabled"}` (DeepSeek compat) | 直传 `thinking: {type:"enabled"}` |
| — | `reasoning_effort: "high"` (OpenAI 标准) | `thinking: {type:"enabled", budget_tokens: 32768}` |

**各转换链路处理逻辑：**

| 链路 | `reasoning`(obj) | `thinking`(obj) | `reasoning_effort`(str) | 结果 |
|------|:-:|:-:|:-:|---|
| Chat → Anthropic | `mapReasoningToThinking()` | 直传 | `mapReasoningToThinking({effort})` | `thinking: {type, budget_tokens}` |
| Anthropic → Chat | — | `mapThinkingToReasoning()` | — | `reasoning: {max_tokens}` |
| Chat → Responses | 直传 | `→ reasoning: {max_tokens}` | `→ reasoning: {effort}` | `reasoning: {effort, max_tokens}` |
| Responses → Chat | 直传 | — | — | `reasoning: {effort, max_tokens}` |
| Responses → Anthropic | `→ thinking` | — | — | `thinking: {type, budget_tokens}` |
| Anthropic → Responses | — | `→ reasoning` | — | `reasoning: {max_tokens}` |

**Effort → Budget 映射：**
| effort | budget_tokens |
|--------|--------------|
| low | 1024 |
| medium | 8192 |
| high | 32768 |
| (默认) | 8192 |

**注意：** litellm 的映射值不同（low=2000, medium=5000, high=10000），octopus 也不同。这是 provider/model 相关的配置，不应硬编码。

### 3.3 Tools

| Responses API | Chat Completions | Anthropic |
|---|---|---|
| `{type:"function", name, description, parameters}` | `{type:"function", function:{name, description, parameters}}` | `{name, description, input_schema: parameters}` |
| `{type:"web_search_preview"}` | (无直接对应) | (无对应) |
| `{type:"file_search"}` | (无直接对应) | (无对应) |

**规则：** 只有 `type:"function"` 的 tools 才转发给 Anthropic

### 3.4 Tool Choice

| Responses API | Chat Completions | Anthropic |
|---|---|---|
| `"auto"` | `"auto"` | `{type:"auto"}` |
| `"none"` | `"none"` | (不发送 tools) |
| `"required"` | `"required"` | `{type:"any"}` |
| `{type:"function", name:"x"}` | `{type:"function", function:{name:"x"}}` | `{type:"tool", name:"x"}` |

### 3.5 Parallel Tool Calls

| Responses API | Chat Completions | Anthropic |
|---|---|---|
| `parallel_tool_calls: false` | `parallel_tool_calls: false` | `tool_choice: {..., disable_parallel_tool_use: true}` |

### 3.6 Response Format

| Responses API | Chat Completions | Anthropic |
|---|---|---|
| `text.format` | `response_format` | (不支持，丢弃) |

### 3.7 其他参数

| 参数 | Responses | Chat | Anthropic | 处理 |
|------|-----------|------|-----------|------|
| `temperature` | 直传 | 直传 | 直传 | — |
| `top_p` | 直传 | 直传 | 直传 | — |
| `stream` | 直传 | 直传 | 直传 | — |
| `stream_options` | 直传 | 直传 | 保留于 payload（不透传给 Anthropic） | Anthropic 无此字段，Router 保留用于内部处理 |
| `stop` | — | `stop` | `stop_sequences` | Chat: string或string[]; Ant: array |
| `n` | — | `n` | — | Anthropic 只支持 n=1 |
| `store` | — | `store: false` | — | Pi 客户端发送此字段以禁用对话存储；Router OA_KNOWN_FIELDS 保留但不映射 |
| `metadata.user_id` | `metadata` | `user` | `metadata.user_id` | Chat 用 `user` 字段 |
| `previous_response_id` | 支持 | — | — | 历史对话加载 |

---

## 4. 响应字段

### 4.1 Stop Reason

| Chat Completions | Responses API (status) | Anthropic |
|---|---|---|
| `stop` | `completed` | `end_turn` |
| `tool_calls` | `completed` | `tool_use` |
| `length` | `incomplete` | `max_tokens` |
| `content_filter` | `incomplete` | — |

### 4.2 Usage

| Chat Completions | Responses API | Anthropic |
|---|---|---|
| `prompt_tokens` | `input_tokens` | `input_tokens` |
| `completion_tokens` | `output_tokens` | `output_tokens` |
| `total_tokens` | `total_tokens` | (计算: input + output + cache_read + cache_creation) |
| `prompt_tokens_details.cached_tokens` | `input_tokens_details.cached_tokens` | `cache_read_input_tokens` |
| — | — | `cache_creation_input_tokens` |
| `completion_tokens_details.reasoning_tokens` | `output_tokens_details.reasoning_tokens` | — |

**注意：** Anthropic 的 `input_tokens` **不含** cache tokens；Chat/Responses 的 `prompt_tokens`/`input_tokens` 含 cache tokens。转换时需加减。

### 4.3 Response Content

| Chat Completions | Responses API | Anthropic |
|---|---|---|
| `choices[0].message.content` | `output[].type="message", content:[{type:"output_text"}]` | `content[].type="text"` |
| `choices[0].message.tool_calls` | `output[].type="function_call"` | `content[].type="tool_use"` |
| `choices[0].message.reasoning_content` | `output[].type="reasoning"` | `content[].type="thinking"` |
| — | — | `content[].type="redacted_thinking"` |

### 4.4 Error

| Chat Completions | Responses API | Anthropic |
|---|---|---|
| `{error: {message, code, type}}` | `{error: {code, message}}` | 顶层 HTTP 错误或 `{type:"error", error:{type, message}}` |

---

## 5. 流式事件映射

### 5.1 Anthropic → Chat (stream-ant2oa.ts / stream-oa2ant.ts)

| Anthropic 事件 | Chat Completions 事件 |
|---|---|
| `message_start` | 初始 chunk (id, model) |
| `content_block_start` (text) | `delta: {role:"assistant"}` |
| `content_block_delta` (text_delta) | `delta: {content:"..."}` |
| `content_block_start` (tool_use) | `delta: {tool_calls:[{index, id, type, function:{name}}]}` |
| `content_block_delta` (input_json_delta) | `delta: {tool_calls:[{index, function:{arguments}}]}` |
| `content_block_start` (thinking) | `delta: {reasoning_content:""}` (或首个 chunk) |
| `content_block_delta` (thinking_delta) | `delta: {reasoning_content:"..."}` |
| `message_delta` (stop_reason) | `finish_reason` |
| `message_delta` (usage) | `usage` chunk |

### 5.2 Responses API → Anthropic (stream-resp2ant.ts)

| Responses 事件 | Anthropic 事件 |
|---|---|
| `response.created` | `message_start` |
| `response.output_text.delta` | `content_block_delta` (text_delta) |
| `response.output_item.added` (function_call) | `content_block_start` (tool_use) |
| `response.function_call_arguments.delta` | `content_block_delta` (input_json_delta) |
| `response.reasoning_summary_text.delta` | `content_block_delta` (thinking_delta) |
| `response.completed` | `message_delta` (stop_reason) + `message_stop` |

### 5.3 Chat → Responses (stream-bridge-chat2resp.ts)

| Chat Completions chunk | Responses API 事件 |
|---|---|
| 初始 chunk | `response.created` + `response.in_progress` |
| `delta.content` | `response.output_text.delta` |
| `delta.tool_calls[]` (初始化) | `response.output_item.added` (function_call) |
| `delta.tool_calls[].function.arguments` | `response.function_call_arguments.delta` |
| `delta.reasoning_content` | `response.reasoning_summary_text.delta` |
| `finish_reason` | `response.completed` |
| `usage` | usage in `response.completed` |

---

## 6. 参考实现对比

### 6.1 litellm 关键模式

**架构**：Responses→Chat（通用桥）→ Provider adapter（如 Anthropic）
- 文件：`litellm/responses/litellm_completion_transformation/transformation.py`
- 核心类：`LiteLLMCompletionResponsesConfig`

**关键差异**：
| 模式 | litellm | 本项目 |
|------|---------|--------|
| `input_image`→Chat | 转为 `image_url` content part | 跳过（lossy bridge） |
| `reasoning`→Chat | 跳过（request 方向无对应） | 同 litellm |
| Chat `reasoning_content`→Responses reasoning | 反向时提取 | 跳过（lossy bridge） |
| tool_choice `{type:"tool"}` | → `"required"` | **未处理** |
| `content_filter` finish_reason | → `"incomplete"` | 需确认 |
| `text.format`→`response_format` | 完整转换（含 json_schema） | 直传（部分支持） |
| tool result 顺序 | 大量工具确保 tool_result 有对应 tool_call | `reorderMessagesAroundToolCalls` |

**effort→budget 映射差异**：
| effort | litellm（Anthropic adapter） | 本项目 |
|--------|---------------------------|--------|
| high | ≥10000 | 32768 |
| medium | ≥5000 | 8192 |
| low | ≥2000 | 1024 |
| minimal | <2000 | N/A |

> 本项目使用固定值映射（兼容 OpenAI 默认），litellm 使用阈值范围。

### 6.2 octopus 关键模式

**架构**：Inbound (API format) → Internal Model (Chat-based) → Outbound (target format)
- 文件：`internal/transformer/model/model.go`
- 内部模型基于 Chat Completions + 辅助字段（`ReasoningContent`, `ReasoningSignature`, `CacheControl`）

**关键差异**：
| 模式 | octopus | 本项目 |
|------|---------|--------|
| system→Anthropic | `messages[0].role="system"` → Anthropic `system` | 同 octopus |
| tool call ID 自动填充 | `fillMissingToolCallIDsFromToolMessages()` | 不填充 |
| `CacheControl` | 内部模型显式支持 | 通过 `provider_meta` |
| `ReasoningSignature` | 内部模型显式字段 | 通过 `provider_meta` |
| default max_tokens | 8192（内部） | 4096（Anthropic 默认） |
| message 角色交替 | 合并连续同角色消息 | 同 octopus |

### 6.3 本项目与参考实现的差异总结

**已对齐**：
- system/developer→system 提取
- function_call 连续合并
- tool_use↔function_call 映射（含 toolu_ 前缀）
- thinking↔reasoning 映射
- stop_reason↔finish_reason 映射
- Usage cache token 处理
- message 角色交替

**待优化**：
1. `redacted_thinking` 在 Anthropic↔Responses 方向未完全处理
2. `{type:"tool"}` tool_choice 格式（Cursor IDE）已处理（`request-bridge-responses.ts:72` → `"required"`）
3. Anthropic↔Responses error 转换缺失
4. `input_image` 在 Responses→Chat 桥中被跳过（lossy bridge）

## 7. 检查清单

用以下清单逐字段验证转换实现：

### 请求方向
- [ ] system/instructions 映射（含 developer 处理）
- [ ] input → messages 转换（string/array/message/function_call/image）
- [ ] function_call 合并（连续多个 → 单个 assistant）
- [ ] function_call_output → tool message
- [ ] reasoning input → thinking/redacted_thinking blocks
- [ ] tool_calls/tool_result 消息重排（developer 不插在中间）
- [ ] tool ID 前缀处理（toolu_）
- [ ] max_output_tokens/max_tokens/max_completion_tokens 映射
- [ ] reasoning/thinking/reasoning_effort 三源 → thinking 映射（按优先级处理）
- [ ] reasoning.effort → thinking.budget_tokens 映射
- [ ] tools 格式转换（function 类型）
- [ ] store 字段保留（OA_KNOWN_FIELDS 白名单）
- [ ] tool_choice 映射（auto/none/required/named）
- [ ] parallel_tool_calls → disable_parallel_tool_use
- [ ] response_format / text.format
- [ ] stop / stop_sequences
- [ ] metadata.user_id / user
- [ ] temperature / top_p / stream 直传

### 响应方向
- [ ] stop_reason / finish_reason / status 映射
- [ ] usage 字段映射（input_tokens/prompt_tokens/cache tokens）
- [ ] response content 格式转换
- [ ] error 格式转换
- [ ] thinking/reasoning_content 映射
- [ ] tool_use/tool_calls 映射

### 流式方向
- [ ] 各事件类型映射完整性
- [ ] 流式 usage 采集
- [ ] 流式 tool_calls 拼接
- [ ] 流式 thinking 内容

---

## 8. OA_KNOWN_FIELDS 白名单与专有字段

### 8.1 白名单机制

`request-transform.ts` 中的 `OA_KNOWN_FIELDS` 是一个字段白名单。Chat Completions 请求中**不在白名单内的字段会被丢弃并输出警告日志**。当前白名单：

```
model, messages, max_completion_tokens, max_tokens, stop, temperature, top_p,
stream, tools, tool_choice, parallel_tool_calls, reasoning, reasoning_effort,
thinking, user, n, stream_options, response_format, provider_meta, store
```

### 8.2 专有字段（correctly dropped）

以下字段由 Pi 客户端的特定 provider 发送，但不适用于 Anthropic/Router，丢弃是正确的：

| 字段 | 来源 provider | 说明 |
|------|-------------|------|
| `enable_thinking` | z.ai / Qwen | z.ai 和 Qwen 的 thinking 控制方式，不同于 Anthropic |
| `chat_template_kwargs` | Qwen | Qwen 专用的 chat template thinking 配置 |
| `tool_stream` | z.ai | z.ai 流式 tool call 控制 |
| `provider` | OpenRouter | OpenRouter 路由偏好参数 |
| `providerOptions` | Vercel AI Gateway | Vercel Gateway 路由偏好参数 |
| `prompt_cache_key` | OpenRouter/Vercel | 提供商级别的 prompt 缓存 key |
| `prompt_cache_retention` | OpenRouter/Vercel | 提供商级别的缓存保留时间 |

### 8.3 Pi 客户端 thinking 参数配置

Pi 客户端通过 `models.json` 的 `compat` 配置决定 how 发送 thinking 参数：

```jsonc
// 方案 1：DeepSeek 格式（推荐）
{ "compat": { "thinkingFormat": "deepseek" } }
// Pi 发送 → thinking: { type: "enabled" }

// 方案 2：OpenRouter 格式
{ "compat": { "thinkingFormat": "openrouter" } }
// Pi 发送 → reasoning: { effort: "high" }

// 方案 3：OpenAI 标准格式（无 compat 时默认）
{ "reasoning": true }
// Pi 发送 → reasoning_effort: "high"
```

Router 的 `openaiToAnthropicRequest()` 统一按优先级处理三种格式：
