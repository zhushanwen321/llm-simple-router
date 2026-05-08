# TransformPlugin 接口增强

## 问题

当前 `TransformPlugin` 只有 4 个钩子（before/after × request/response），缺少：
- **流式响应拦截**：无法处理 SSE 事件
- **错误处理**：无法感知和处理上游异常
- **优先级**：插件间执行顺序不可控

## 增强后的接口

```typescript
interface TransformPlugin {
  name: string;
  match: PluginMatch;

  // 请求方向
  beforeRequest?(ctx: RequestPluginContext): void | Promise<void>;
  afterRequest?(ctx: RequestPluginContext): void | Promise<void>;

  // 非流式响应
  beforeResponse?(ctx: ResponsePluginContext): void | Promise<void>;
  afterResponse?(ctx: ResponsePluginContext): void | Promise<void>;

  // 流式响应（Layer 1：逐 SSE 事件）
  onStreamEvent?(event: SSEEvent, ctx: StreamPluginContext): SSEEvent | null;

  // 错误
  onError?(ctx: ErrorPluginContext): void | Promise<void>;
}
```

### SSE Layer 1 事件模型

```typescript
interface SSEEvent {
  event?: string;                     // SSE event type
  data: Record<string, unknown>;      // 解析后的 JSON
}
```

插件收到解析后的结构化事件，而非原始文本行。支持三种操作：
- **修改**：改写 `data` 字段后返回
- **丢弃**：返回 `null`
- **注入**：构造新事件返回

## plugin-bridge 适配层

`plugin-bridge.ts` 将 `TransformPlugin` 拆分注册为多个 `PipelineHook`：

| TransformPlugin 方法 | PipelineHook phase | Priority |
|---------------------|-------------------|----------|
| beforeRequest / afterRequest | pre_transport | 250 |
| beforeResponse / afterResponse | post_response | 250 |
| onStreamEvent | on_stream_event | 250 |
| onError | on_error | 250 |

优先级 250 落在外部插件范围（200-299），位于内置功能之后、观察者之前。

## on_stream_event 实现机制

当 `ctx.isStream` 时，收集所有 `on_stream_event` hooks，将 `SSEEventTransform` 插入流式管道：

```
FormatTransform → SSEEventTransform(插件事件拦截) → client
```

`SSEEventTransform` 内部流程：
1. 从 `FormatTransform` 接收 Layer 0 原始 SSE 行
2. 解析为 `SSEEvent`（Layer 1）
3. 逐事件传给 hooks，收集返回值
4. 将结果序列化回 SSE 行输出

这保证了格式转换（Layer 0）与插件逻辑（Layer 1）的清晰分层。

## 旧版兼容

旧版字段名自动映射为新接口：

| 旧版 | 新版 |
|------|------|
| `beforeRequestTransform` | `beforeRequest` |
| `afterRequestTransform` | `afterRequest` |
| `beforeResponseTransform` | `beforeResponse` |
| `afterResponseTransform` | `afterResponse` |

bridge 层检测旧字段名，透明适配，旧插件无需修改。
