# Handler 工厂

## 现状

3 个 Handler 入口（openai.ts 93行、anthropic.ts 49行、responses.ts 62行），逻辑 90% 重复：从 ServiceContainer 解析 semaphore/tracker/adaptive → 创建 Orchestrator → 组装 errorFormatter → 构建 RouteHandlerDeps → 调用 handleProxyRequest。

差异仅有 4 点：

| 维度 | OpenAI | Anthropic | Responses |
|------|--------|-----------|-----------|
| apiType | `"openai"` | `"anthropic"` | `"openai-responses"` |
| 路径 | `/v1/chat/completions` + compat | `/v1/messages` | `/v1/responses` + compat |
| 错误格式 | `{ error: { message, type, code } }` | `{ type: "error", error: { type, message } }` | 同 OpenAI |
| beforeSendProxy | 注入 `stream_options` | 无 | 无 |

## 设计

用一个工厂函数消除三个文件的重复代码：

```typescript
interface ProxyHandlerConfig {
  apiType: "openai" | "anthropic" | "openai-responses";
  paths: string[];
}

function createProxyHandler(config: ProxyHandlerConfig, formatRegistry: FormatRegistry): FastifyPluginCallback
```

工厂内部从 `FormatRegistry` 获取 adapter，adapter 提供 `errorMeta` 和 `beforeSendProxy`。工厂代码零差异，所有分歧由 adapter 驱动。

### buildApp() 注册

```typescript
app.register(createProxyHandler({ apiType: "openai", paths: ["/v1/chat/completions", "/chat/completions"] }, formatRegistry), { db, container });
app.register(createProxyHandler({ apiType: "anthropic", paths: ["/v1/messages"] }, formatRegistry), { db, container });
app.register(createProxyHandler({ apiType: "openai-responses", paths: ["/v1/responses", "/responses"] }, formatRegistry), { db, container });
```

### /v1/models 端点

保留在工厂内，仅 `apiType === "openai"` 时注册 GET handler。不单独拆为 admin route，避免破坏现有行为。

## 文件变化

| 文件 | 操作 | 说明 |
|------|------|------|
| `handler/openai.ts` | 删除 | 93 行 |
| `handler/anthropic.ts` | 删除 | 49 行 |
| `handler/responses.ts` | 删除 | 62 行 |
| `handler/create-proxy-handler.ts` | 新建 ~80 行 | 工厂 + 路由注册 |
| `handler/proxy-handler.ts` | 重写 ~50 行 | 入口：组装 pipeline + hooks |
| `handler/failover-loop.ts` | 新建 ~80 行 | 重试/failover 循环 |

净减约 44 行，核心收益是消除三份几乎相同的初始化代码。

## buildTransportFn 简化

当前 `TransportFnParams` 有 17 个字段。有了 `PipelineContext` 后，大部分参数已在 ctx 中，签名简化为：

```typescript
function buildTransportFn(
  ctx: PipelineContext,
  apiKey: string,
  deps: TransportDeps,
): (target: Target) => Promise<TransportResult>
```

`TransportDeps` 仅保留 transport 层自身需要的依赖（http Agent、超时配置等），不重复传递 ctx 中已有的字段。
