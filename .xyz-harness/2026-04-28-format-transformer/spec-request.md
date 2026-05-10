# 请求转换规格

## 路径切换
- OpenAI → Anthropic: /v1/chat/completions → /v1/messages
- Anthropic → OpenAI: /v1/messages → /v1/chat/completions

## Header 转换
- buildUpstreamHeaders 使用 provider.api_type 而非入口 apiType
- 跨格式到 Anthropic 时注入 anthropic-version: 2023-06-01
- stream_options: Anthropic→OpenAI 且 stream:true 时注入 {include_usage: true}

## OpenAI → Anthropic 字段映射

| OpenAI | Anthropic | 说明 |
|---|---|---|
| messages[].role:"system" | system（顶层） | 多条拼接为 content blocks |
| content (string) | content (blocks数组) | 归一化 |
| tool_calls | content:[{type:"tool_use"}] | arguments JSON.parse |
| role:"tool" | role:"user"+tool_result | 连续tool合并到同一user |
| max_completion_tokens | max_tokens | **必填，默认4096** |
| stop (string/string[]) | stop_sequences (array) | 字符串包装为数组 |
| tools[].function.{name,params} | tools[].{name,input_schema} | 扁平化 |
| tool_choice:"auto" | {type:"auto"} | |
| tool_choice:"required" | {type:"any"} | |
| tool_choice:"none" | 不发tools | Anthropic无none |
| parallel_tool_calls:false | disable_parallel_tool_use:true | 合并到tool_choice |
| reasoning:{effort,max_tokens} | thinking:{type:"enabled",budget_tokens} | 有损，确保max>=budget |
| user | metadata.user_id | |

消息交替：合并同role（拼接content数组），不插入空消息。首条必须user。

## Anthropic → OpenAI 字段映射

| Anthropic | OpenAI | 说明 |
|---|---|---|
| system | messages.unshift({role:"system"}) | |
| content (blocks) | content (string) | text拼接 |
| tool_use blocks | tool_calls | input JSON.stringify |
| tool_result in user | role:"tool"消息 | 每条独立 |
| thinking blocks | 忽略 | 请求方向不转换 |
| max_tokens | max_completion_tokens | |
| stop_sequences | stop | |
| tools[].{name,input_schema} | {type:"function",function:{name,parameters}} | 嵌套 |
| tool_choice:{type:"auto"} | "auto" | |
| tool_choice:{type:"any"} | "required" | |
| tool_choice:{type:"tool",name} | {type:"function",function:{name}} | |
| disable_parallel_tool_use | parallel_tool_calls:false | |
| thinking:{budget_tokens} | reasoning:{max_tokens} | 有损 |
| metadata.user_id | user | |

## 未知字段
丢弃并 logDroppedFields。n>1 忽略并 warning。
