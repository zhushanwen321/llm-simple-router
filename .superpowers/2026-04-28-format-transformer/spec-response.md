# 响应转换规格

## 非流式 OpenAI → Anthropic
- reasoning_content → thinking block（最前）
- content → text block
- tool_calls → tool_use blocks（arguments JSON.parse为input）
- finish_reason→stop_reason: stop→end_turn, length→max_tokens, tool_calls→tool_use
- usage: prompt_tokens→input_tokens, completion_tokens→output_tokens

## 非流式 Anthropic → OpenAI
- thinking blocks → reasoning_content
- text blocks → content（拼接）
- tool_use blocks → tool_calls（input JSON.stringify为arguments）
- stop_reason→finish_reason: end_turn→stop, max_tokens→length, stop_sequence→stop, tool_use→tool_calls
- usage: input+cache→prompt_tokens, output→completion_tokens

## 错误格式互转
- OpenAI: {error:{message,type,code}} ↔ Anthropic: {type:"error",error:{type,message}}

## 流式转换管道
upstream → SSEMetricsTransform(apiType=provider.api_type) → FormatStreamTransform → PassThrough → reply

StreamProxy 构造函数增加 formatTransform?: Transform。无转换时 undefined。

## SSE 解析
复用 SSEParser + 64KB 缓冲上限保护。基类 try/catch 包裹 JSON.parse。

## OA→Ant 状态机
状态: init → text/thinking/tool_use → closing → done

关键设计：
1. 首chunk只发message_start（含model），延迟content_block_start直到知道内容类型
2. finish_reason只关闭block+缓存stop_reason，等usage或[DONE]才发message_delta+message_stop
3. tool_calls[N]首次: content_block_start(tool_use,{id,name,input:{}})
4. 交错tool call: 缓冲+flush补发
5. 同delta多类型: thinking→text→tool_use优先级

## Ant→OA 状态机
- message_start: 记录input_tokens，不输出
- content_block_start(text): 首次输出role chunk
- content_block_delta(text_delta): content chunk
- content_block_start(thinking): 首次输出role chunk
- content_block_delta(thinking_delta): reasoning_content chunk
- content_block_start(tool_use): tool_calls chunk（含id,name）
- content_block_delta(input_json_delta): tool_calls arguments chunk
- message_delta(stop_reason): finish_reason chunk
- message_stop: usage chunk + [DONE]
- error: 错误chunk + [DONE]
- ping: 丢弃

## 边界情况
- TCP切断SSE: SSEParser按\n\n缓冲
- 空delta: 跳过
- 空arguments: 跳过
- 重复finish_reason: 幂等
- 非标准事件: warning+跳过
- 缓冲超限: pushDone
- JSON parse失败: try/catch+warning
- 上游中断: _flush→ensureTerminated
- 流中途错误: 转换错误格式+[DONE]
