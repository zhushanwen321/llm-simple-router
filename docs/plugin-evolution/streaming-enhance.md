你的代理增强对流式响应做修改，有可能影响 Claude Code 的正常接收。具体取决于你改了什么、改了多少。以下是系统性的风险点：

1. 流式空闲超时 — 风险：中

Claude Code 内置了 streaming idle watchdog（claude.ts:1868-1927）：

默认空闲超时：90秒 (STREAM_IDLE_TIMEOUT_MS)
警告阈值：45秒

如果你的代理在处理某个 block 时卡住，超过 90 秒没有向下游发送任何 SSE 事件，Claude Code 会主动中断流并抛出错误，触发 non-streaming fallback。

关键：这个超时是"任意两个事件之间的间隔"，不是总超时。只要你能保持定期向下游发送事件（哪怕只是心跳），就不会触发。

2. Stall 检测 — 风险：低

有 30 秒的 stall 检测阈值（STALL_THRESHOLD_MS = 30_000）。事件间隔超过 30 秒会被记录为 stall 并上报遥测，但不会中断流——只是日志警告。多次 stall 会在流结束后汇总报告。

3. message_start 必须存在 — 风险：高

claude.ts:2350 的检测逻辑：

if (!partialMessage || (newMessages.length === 0 && !stopReason)) {
  throw new Error('Stream ended without receiving any events')
}

如果你的代理吞掉了 message_start 事件，或者修改了事件格式导致 SDK 无法解析，流结束后会抛出错误，触发 non-streaming fallback。这是最关键的约束——你的代理必须保证 message_start 事件正确传递。

4. content_block_stop 触发 StreamingToolExecutor — 风险：中

如上一条分析所述，StreamingToolExecutor 依赖每个 content_block_stop 事件立即 yield AssistantMessage 并调用 addTool()。如果你：

- 改变了 content block 的顺序：比如把 tool_use block 的 index 从 0 改成了 1，或者增加了/删除了 block，可能导致 contentBlocks[part.index] 找不到对应 block（claude.ts:2173-2181 会抛 RangeError）
- 改变了 tool_use block 的 id：StreamingToolExecutor 用 block.id 追踪工具状态，如果 id 不匹配会导致 tool_use/tool_result 配对失败
- 改变了 input JSON 格式：toolDefinition.inputSchema.safeParse(block.input) 解析失败时，工具会被标记为非并发安全（isConcurrencySafe = false），不会并行执行，但不影响正确性

5. message_delta 中的 stop_reason 和 usage — 风险：中

claude.ts:2242-2257 中，message_delta 事件负责：
- 写入 stop_reason（回写到已 yield 的最后一条消息上）
- 写入最终的 usage（token 计数、费用计算）
- 检测 max_output_tokens 拒绝

如果你修改了 message_delta 中的 usage 字段（比如把 output_tokens 改小），会影响费用计算和 token 限制检测。如果你删除了 stop_reason，会被判定为"不完整流"而触发 fallback。

6. message_stop 事件 — 风险：低

claude.ts:2295-2296 中，message_stop 事件本身几乎不做事（只有一个 break）。它主要是流结束的信号。

7. StreamingToolExecutor 的 discard 与 fallback — 风险：高

如果你的增强逻辑导致流中途出错（比如 JSON 格式错误、block index 不匹配），会抛异常进入 catch 块（query.ts:893-920），此时 streamingToolExecutor.discard() 被调用——所有正在执行的工具结果被丢弃，然后触发 non-streaming fallback 重新请求。

更糟糕的情况：如果已执行的工具（如 Bash 命令）已经产生了副作用（创建了文件、启动了进程），这些副作用不会被回滚，但对应的结果被丢弃。后续 fallback 请求不知道这些操作已经发生，可能重复执行。

★ Insight ─────────────────────────────────────

Claude Code 流式解析的关键假设（你的代理必须遵守）：

1. 事件格式完全兼容 Anthropic SSE 协议：message_start → content_block_start → content_block_delta → content_block_stop → message_delta → message_stop 的完整序列
2. content_block_start 的 index 与 content_block_delta/content_block_stop 的 index 必须一致，否则 RangeError
3. tool_use block 的 id 必须全局唯一且稳定，跨整个流不能变
4. message_start 和 message_delta（含 stop_reason）缺一不可，否则判定为不完整流
5. 事件间隔不能超过 90 秒，否则 watchdog 主动杀流

─────────────────────────────────────────────────

实操建议

┌────────────────────────────┬──────────┬───────────────────────────────────┐
│        你想做的增强        │  安全性  │             注意事项              │
├────────────────────────────┼──────────┼───────────────────────────────────┤
│ 只修改 text block 的内容   │ 相对安全 │ 不影响 block index 和 id          │
├────────────────────────────┼──────────┼───────────────────────────────────┤
│ 增加/删除 content block    │ 高风险   │ 会破坏 index 映射                 │
├────────────────────────────┼──────────┼───────────────────────────────────┤
│ 修改 tool_use 的 input     │ 中风险   │ schema parse 失败会降级为串行执行 │
├────────────────────────────┼──────────┼───────────────────────────────────┤
│ 增加 tool_use block        │ 高风险   │ 可能执行你注入的工具              │
├────────────────────────────┼──────────┼───────────────────────────────────┤
│ 修改 usage/stop_reason     │ 中风险   │ 影响费用、token 限制判断          │
├────────────────────────────┼──────────┼───────────────────────────────────┤
│ 延迟发送事件（缓冲再转发） │ 低风险   │ 只要任意事件间隔 < 90s            │
├────────────────────────────┼──────────┼───────────────────────────────────┤
│ 完全替换流内容             │ 极高风险 │ 几乎所有假设都可能被违反          │
└────────────────────────────┴──────────┴───────────────────────────────────┘

如果你的增强只是"拦截 → 等原始 LLM 流完成 → 修改后重新发送"，那最大的问题是延迟。90 秒超时是硬限制。而且 StreamingToolExecutor 的"边流边执行"优势完全丧失，回退为串行模式。