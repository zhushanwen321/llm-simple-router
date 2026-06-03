# LLM API 格式转换调研报告

## 一、三大 API 格式对比

### 1.1 OpenAI Chat Completions (`/v1/chat/completions`)

```jsonc
// 请求
{
  "model": "gpt-4o",
  "messages": [
    {"role": "system", "content": "You are helpful."},
    {"role": "user", "content": "Hello"},
    {"role": "assistant", "content": "Hi!", "tool_calls": [
      {"id": "call_xxx", "type": "function", "function": {"name": "get_weather", "arguments": "{\"city\":\"SF\"}"}}
    ]},
    {"role": "tool", "tool_call_id": "call_xxx", "content": "{\"temp\": 72}"}
  ],
  "max_tokens": 4096,
  "temperature": 0.7,
  "tools": [{"type": "function", "function": {"name": "get_weather", "parameters": {...}}}],
  "stream": true
}

// 非流式响应
{
  "id": "chatcmpl-xxx",
  "choices": [{
    "message": {"role": "assistant", "content": "...", "tool_calls": [...]},
    "finish_reason": "stop"
  }],
  "usage": {"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30}
}

// 流式 SSE 事件
data: {"id":"chatcmpl-xxx","choices":[{"delta":{"role":"assistant"},"index":0}]}
data: {"choices":[{"delta":{"content":"Hello"},"index":0}]}
data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_xxx","function":{"name":"get_weather","arguments":""}}]},"index":0}]}
data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"ci"}}]},"index":0}]}
data: {"choices":[{"delta":{},"finish_reason":"stop","index":0}]}
data: [DONE]
```

### 1.2 OpenAI Responses (`/v1/responses`)

```jsonc
// 请求
{
  "model": "gpt-4o",
  "instructions": "You are helpful.",     // ← 替代 system message
  "input": [                               // ← 替代 messages
    {"type": "message", "role": "user", "content": "Hello"},
    {"type": "function_call", "id": "fc_xxx", "call_id": "call_xxx", "name": "get_weather", "arguments": "{\"city\":\"SF\"}"},
    {"type": "function_call_output", "call_id": "call_xxx", "output": "{\"temp\": 72}"}
  ],
  "max_output_tokens": 4096,               // ← 替代 max_tokens
  "temperature": 0.7,
  "tools": [{"type": "function", "name": "get_weather", "parameters": {...}}],  // ← 结构不同
  "stream": true,
  "previous_response_id": "resp_xxx"       // ← 新增：多轮对话
}

// 非流式响应
{
  "id": "resp_xxx",
  "object": "response",
  "model": "gpt-4o",
  "status": "completed",
  "output": [                              // ← 替代 choices
    {"type": "reasoning", "id": "rs_xxx", "summary": [{"type": "summary_text", "text": "..."}]},
    {"type": "message", "id": "msg_xxx", "role": "assistant", "content": [
      {"type": "output_text", "text": "...", "annotations": []}
    ]},
    {"type": "function_call", "id": "fc_xxx", "call_id": "call_xxx", "name": "get_weather", "arguments": "{...}"}
  ],
  "usage": {"input_tokens": 10, "output_tokens": 20, "total_tokens": 30}
}

// 流式 SSE 事件（命名事件，非匿名 data）
event: response.created
data: {"type":"response.created","response":{"id":"resp_xxx","status":"in_progress"}}

event: response.output_item.added
data: {"type":"response.output_item.added","output_index":0,"item":{"type":"message","role":"assistant"}}

event: response.content_part.added
data: {"type":"response.content_part.added","output_index":0,"content_index":0,"part":{"type":"output_text","text":""}}

event: response.output_text.delta
data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":"Hello"}

event: response.output_item.added
data: {"type":"response.output_item.added","output_index":1,"item":{"type":"function_call","name":"get_weather"}}

event: response.function_call_arguments.delta
data: {"type":"response.function_call_arguments.delta","output_index":1,"delta":"{\"city\""}

event: response.output_text.done
data: {"type":"response.output_text.done","output_index":0,"content_index":0,"text":"Hello!"}

event: response.completed
data: {"type":"response.completed","response":{"id":"resp_xxx","status":"completed","usage":{...}}}
```

### 1.3 Anthropic Messages (`/v1/messages`)

```jsonc
// 请求
{
  "model": "claude-sonnet-4-20250514",
  "system": "You are helpful.",             // ← 独立顶层字段
  "messages": [
    {"role": "user", "content": "Hello"},
    {"role": "assistant", "content": [
      {"type": "text", "text": "Hi!"},
      {"type": "tool_use", "id": "toolu_xxx", "name": "get_weather", "input": {"city": "SF"}}
    ]},
    {"role": "user", "content": [           // ← tool_result 嵌入 user 消息
      {"type": "tool_result", "tool_use_id": "toolu_xxx", "content": "{\"temp\": 72}"}
    ]}
  ],
  "max_tokens": 4096,
  "temperature": 0.7,
  "tools": [{"name": "get_weather", "input_schema": {...}}],  // ← input_schema 非 parameters
  "thinking": {"type": "enabled", "budget_tokens": 10000},    // ← thinking 参数
  "stream": true
}

// 非流式响应
{
  "id": "msg_xxx",
  "type": "message",
  "role": "assistant",
  "content": [
    {"type": "thinking", "thinking": "Let me think...", "signature": "..."},
    {"type": "text", "text": "Hello!"},
    {"type": "tool_use", "id": "toolu_xxx", "name": "get_weather", "input": {"city": "SF"}}
  ],
  "stop_reason": "end_turn",
  "usage": {"input_tokens": 10, "output_tokens": 20, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 0}
}

// 流式 SSE 事件
event: message_start
data: {"type":"message_start","message":{"id":"msg_xxx","role":"assistant","usage":{"input_tokens":10}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Let me..."}}

event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Hello!"}}

event: content_block_start
data: {"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"toolu_xxx","name":"get_weather"}}

event: content_block_delta
data: {"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\"city\""}

event: content_block_stop
data: {"type":"content_block_stop","index":2}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":20}}

event: message_stop
data: {"type":"message_stop"}
```

## 二、三格式转换核心映射

### 2.1 请求转换映射表

| 概念 | Chat Completions | Responses API | Anthropic Messages |
|------|-----------------|---------------|-------------------|
| **系统提示** | `messages[role=system]` | `instructions` | `system` (顶层) |
| **用户输入** | `messages[role=user]` | `input` (string/array) | `messages[role=user]` |
| **模型回复** | `messages[role=assistant].content` | `output[type=message]` | `messages[role=assistant].content[type=text]` |
| **工具调用** | `assistant.tool_calls[]` | `input/output[type=function_call]` | `assistant.content[type=tool_use]` |
| **工具结果** | `messages[role=tool]` | `input[type=function_call_output]` | `user.content[type=tool_result]` |
| **推理** | `reasoning_content` | `output[type=reasoning]` | `content[type=thinking]` |
| **最大 token** | `max_tokens` / `max_completion_tokens` | `max_output_tokens` | `max_tokens` |
| **工具定义** | `tools[].function.parameters` | `tools[].parameters` | `tools[].input_schema` |
| **工具选择** | `tool_choice: "auto"/"required"/{function}` | `tool_choice: "auto"/"required"/{function}` | `tool_choice: {"type":"auto"/"any"/"tool"}` |
| **停止原因** | `stop` / `length` / `tool_calls` | `completed` / `incomplete` / `failed` | `end_turn` / `max_tokens` / `tool_use` |
| **多轮对话** | 传递完整 messages | `previous_response_id` | 传递完整 messages |
| **多轮索引** | `tool_call_id` | `call_id` | `tool_use_id` |

### 2.2 响应转换映射表

| 概念 | Chat Completions | Responses API | Anthropic Messages |
|------|-----------------|---------------|-------------------|
| **文本内容** | `choices[0].message.content` | `output[type=message].content[type=output_text].text` | `content[type=text].text` |
| **工具调用** | `choices[0].message.tool_calls[]` | `output[type=function_call]` | `content[type=tool_use]` |
| **推理内容** | `choices[0].message.reasoning_content` | `output[type=reasoning].summary` | `content[type=thinking].thinking` |
| **推理签名** | N/A | N/A | `content[type=thinking].signature` |
| **Token 用量** | `usage.prompt_tokens / completion_tokens` | `usage.input_tokens / output_tokens` | `usage.input_tokens / output_tokens` |
| **缓存用量** | `usage.prompt_tokens_details.cached_tokens` | N/A | `usage.cache_read_input_tokens` |
| **完成原因** | `finish_reason: stop/length/tool_calls` | `status: completed/incomplete` | `stop_reason: end_turn/max_tokens/tool_use` |

### 2.3 流式 SSE 事件映射

#### Chat Completions ↔ Anthropic Messages

| Chat Completions delta | Anthropic SSE 事件 |
|----------------------|-------------------|
| `delta: {role: "assistant"}` | `message_start` |
| `delta: {content: "..."}` | `content_block_start[text]` + `content_block_delta[text_delta]` |
| `delta: {tool_calls: [{id, name}]}` | `content_block_start[tool_use]` |
| `delta: {tool_calls: [{arguments: "..."}]}` | `content_block_delta[input_json_delta]` |
| `delta: {reasoning_content: "..."}` | `content_block_start[thinking]` + `content_block_delta[thinking_delta]` |
| `finish_reason: "stop"` | `content_block_stop` + `message_delta{stop_reason: "end_turn"}` + `message_stop` |
| `usage: {...}` | `message_start` 和 `message_delta` 中的 usage |

#### Chat Completions ↔ Responses API

| Chat Completions delta | Responses SSE 事件 |
|----------------------|-------------------|
| `delta: {role: "assistant"}` | `response.created` + `response.in_progress` |
| `delta: {content: "..."}` | `response.output_item.added[message]` + `response.content_part.added[output_text]` + `response.output_text.delta` |
| `delta: {tool_calls: [{id, name}]}` | `response.output_item.added[function_call]` |
| `delta: {tool_calls: [{arguments: "..."}]}` | `response.function_call_arguments.delta` |
| `delta: {reasoning_content: "..."}` | `response.output_item.added[reasoning]` + `response.reasoning_summary_text.delta` |
| `finish_reason: "stop"` | `response.output_text.done` + `response.completed` |
| `data: [DONE]` | `response.completed` (最后一个事件) |

## 三、OpenAI Chat Completions 与 Responses API 的关系

### 3.1 官方定位

- **Chat Completions**：2023年发布，成熟稳定，广泛兼容
- **Responses API**：2025年3月发布，**OpenAI 的未来方向**，官方推荐新项目使用
- 两者**并行维护**，OpenAI 暂未宣布废弃 Chat Completions
- OpenAI SDK v2+ 同时支持两种 API

### 3.2 核心差异

| 维度 | Chat Completions | Responses API |
|------|-----------------|---------------|
| **设计哲学** | 无状态，每次传完整历史 | 有状态，支持 `previous_response_id` |
| **输入结构** | 扁平 messages 数组 | 扁平化 items 数组（混合 message/function_call/reasoning） |
| **输出结构** | `choices` 数组 | `output` 混合类型数组 |
| **内置工具** | 无（需自行实现 function calling） | `web_search_preview`、`file_search`、`code_interpreter`、`computer_use_preview` |
| **流式事件** | 匿名 `data:` 行 | 命名 `event: xxx\ndata:` 行 |
| **多轮对话** | 客户端维护完整消息列表 | 服务端存储，`previous_response_id` 引用 |
| **后台执行** | 不支持 | `background: true` |
| **MCP 集成** | 不支持 | `tools[type=mcp]` |

### 3.3 互转可行性

**Chat → Responses**（较简单）：
- `messages[system]` → `instructions`
- `messages[user/assistant/tool]` → `input` items（message / function_call / function_call_output）
- `max_tokens` → `max_output_tokens`
- `tools[].function` → `tools[]`（去掉嵌套 function 层）

**Responses → Chat**（需要处理信息丢失）：
- `instructions` → `messages[system]`
- `input` items → `messages`（function_call → assistant.tool_calls, function_call_output → tool message）
- `output` items → `choices[0].message`（message → content, function_call → tool_calls, reasoning → reasoning_content）
- `previous_response_id` → 无法映射（需要服务端存储多轮状态）
- 内置工具（web_search 等）→ 无法映射到 Chat Completions

## 四、主流项目转换方案对比

### 4.1 架构模式

| 项目 | 语言 | 架构模式 | 中间模型 |
|------|------|---------|---------|
| **LiteLLM** | Python | Direct Transform（每对格式独立转换） | 无（基于 OpenAI Chat Completions ModelResponse 作为公共格式） |
| **Octopus** | Go | Hub-and-Spoke（统一中间模型） | `InternalLLMRequest/Response`（基于 OpenAI Chat 扩展） |
| **cc-switch** | Rust | Adapter Pattern（Provider 适配器） | 无（Anthropic 为中心，其他格式围绕 Anthropic 转换） |
| **One Hub** | Go | OpenAI-Centric Hub | 无（以 OpenAI Chat 为中心，Claude/Gemini 各自独立转换） |

### 4.2 Responses API 支持情况

| 项目 | Responses API 支持 | 实现方式 |
|------|-------------------|---------|
| **LiteLLM** | ✅ 完整支持 | 原生支持 OpenAI/Azure/xAI 等；Anthropic 等通过 Chat 桥接转换 |
| **Octopus** | ✅ 完整支持 | Hub-and-Spoke 中间模型，Inbound/Outbound 双向转换 |
| **cc-switch** | ✅ 完整支持 | Anthropic 为中心，直接实现 anthropic↔responses 双向转换 |
| **One Hub** | ✅ 完整支持 | 原生支持 OpenAI Provider；其他 Provider 自动降级到 Chat 桥接 |

### 4.3 转换策略对比

#### LiteLLM：桥接模式
```
Responses API request
  → 转为 Chat Completions request
  → 走标准 completion() 流程
  → 将 Chat Completions response 转为 Responses API response
```
- **优点**：复用已有的 Chat Completions 转换逻辑，实现成本低
- **缺点**：增加一层转换开销；Responses 独有特性（previous_response_id、内置工具）会丢失

#### Octopus：中间模型模式
```
任何 Inbound → InternalLLMRequest → 任何 Outbound
任何 Inbound ← InternalLLMResponse ← 任何 Outbound
```
- **优点**：M+N 而非 M×N；Internal Model 基于 OpenAI Chat 扩展，表达力强
- **缺点**：Internal Model 需要覆盖所有格式的所有特性；新增格式需修改中间模型

#### cc-switch：Anthropic 中心模式
```
Anthropic Messages 为中心
  → openai_chat: anthropic_to_openai() / openai_to_anthropic()
  → openai_responses: anthropic_to_responses() / responses_to_anthropic()
  → gemini_native: anthropic_to_gemini() / gemini_to_anthropic()
```
- **优点**：直接针对 Claude Code 场景优化；流式转换状态机精细
- **缺点**：所有转换围绕 Anthropic，如果需要 Chat↔Responses 直接转换效率低

#### One Hub：OpenAI 中心 + 自动降级/升级
```
OpenAI Chat Completions 为中心
  /v1/chat/completions → Chat Provider（直接转发或格式转换）
  /v1/responses → Responses Provider（原生）或 Chat Provider（自动降级）
  特殊模型 Chat 请求 → 自动升级为 Responses API
```
- **优点**：以 OpenAI 为标准，覆盖面广（35+ Provider）；自动降级/升级智能
- **缺点**：Claude/Gemini 原生格式直通模式与 OpenAI 模式存在代码重复

### 4.4 Thinking/Reasoning 处理对比

| 项目 | Anthropic thinking → OpenAI | OpenAI reasoning → Anthropic |
|------|---------------------------|------------------------------|
| **LiteLLM** | `thinking` → `reasoning_content` + `thinking_blocks[]`；`reasoning_effort` → `thinking.budget_tokens` 映射表 | `reasoning_content` → `thinking` block；`budget_tokens` → `reasoning_effort` |
| **Octopus** | `thinking` content block → `ReasoningContent` 字段 + `ReasoningSignature` | `ReasoningContent` → `thinking` block + `signature` |
| **cc-switch** | `thinking` → `reasoning_content`；`output_config.effort` 优先于 `thinking.budget_tokens` | `reasoning_content` → `thinking`；自适应映射 effort level |
| **One Hub** | `thinking` → `reasoning_content`；budget → effort 映射 | `reasoning_content` → `thinking`；使用 budget_tokens |

### 4.5 流式状态机对比

| 项目 | 状态管理 | 复杂度 | 特殊处理 |
|------|---------|--------|---------|
| **LiteLLM** | `CustomStreamWrapper` 全局状态 | 中 | JSON mode 特殊处理（tool call → content） |
| **Octopus** | Inbound/Outbound 各自的状态机（`hasStarted`, `hasTextContentStarted` 等） | 高 | Responses Inbound 维护 `outputIndex/contentIndex/sequenceNumber` + `toolCalls` map |
| **cc-switch** | 独立的状态机 per 转换方向 | 高 | Copilot 无限空白 bug 检测；UTF-8 跨 chunk 安全拼接 |
| **One Hub** | `ClaudeStreamHandler` + `OpenAIResponsesStreamConverter` | 中 | 自动升级/降级时的流式格式转换 |

## 五、对 llm-simple-router 的建议

### 5.1 推荐架构：Hub-and-Spoke（类似 Octopus）

当前项目已有 `TransformCoordinator` 处理 OpenAI Chat ↔ Anthropic 双向转换。建议扩展为统一的中间模型：

```
客户端请求 (Chat Completions / Responses / Anthropic Messages)
  ↓
Inbound 转换 → InternalModel (统一的请求/响应模型)
  ↓
Outbound 转换 → 目标 Provider 格式
  ↓
上游响应
  ↓
Outbound 转换 → InternalModel
  ↓
Inbound 转换 → 客户端原始格式
```

### 5.2 实现优先级

1. **Phase 1**：Responses API 入站 + Chat Completions 出站（桥接模式，类似 LiteLLM）
   - 客户端发 Responses → 转 Chat → 转发到上游
   - 上游 Chat 响应 → 转 Responses → 返回客户端
   
2. **Phase 2**：Responses API 出站（原生支持）
   - 上游如果支持 Responses（如 OpenAI），直接转发
   
3. **Phase 3**：完善流式状态机
   - Responses SSE ↔ Chat SSE ↔ Anthropic SSE 双向转换

### 5.3 关键技术挑战

1. **Responses API 有状态特性**：`previous_response_id` 需要服务端存储多轮对话，Router 作为无状态代理需要考虑如何处理
2. **内置工具**：`web_search_preview`、`file_search` 等内置工具在其他 Provider 不存在，需要降级或跳过
3. **流式状态机复杂度**：Responses API 的命名事件比 Chat Completions 的匿名 delta 复杂得多
4. **reasoning/thinking 转换**：三方的 reasoning/thinking 格式各不相同，需要精细映射
