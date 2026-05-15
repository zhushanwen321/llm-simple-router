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

| Responses API | Chat Completions | Anthropic |
|---|---|---|
| `reasoning: {effort:"low"/"medium"/"high"}` | `reasoning: {effort:"low"/"medium"/"high"}` | `thinking: {type:"enabled", budget_tokens}` |
| `reasoning: {max_tokens: N}` | `reasoning: {max_tokens: N}` | `thinking: {type:"enabled", budget_tokens: N}` |

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
| `stream_options` | 直传 | 直传 | — | Anthropic 无此字段 |
| `stop` | — | `stop` | `stop_sequences` | Chat: string或string[]; Ant: array |
| `n` | — | `n` | — | Anthropic 只支持 n=1 |
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

## 6. 检查清单

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
- [ ] reasoning.effort → thinking.budget_tokens 映射
- [ ] tools 格式转换（function 类型）
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
