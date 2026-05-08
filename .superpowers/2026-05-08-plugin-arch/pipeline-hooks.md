# ProxyPipeline + PipelineHook 设计

## 问题

`proxy-handler.ts`（556 行）是全系统最大耦合点。`executeFailoverLoop()` 是一个 250 行的 while 循环，内联了路由、转换、插件、patch、凭证、日志、failover 决策等 9 项职责。

## 核心思路

区分"必要流程"和"可插拔逻辑"：

- **必要流程（管道骨架）**：Route → Transform → Transport。不可跳过、不可重排
- **Hook（统一接口）**：其他所有逻辑都是 hook，包括当前内联代码和未来外部插件

## Hook Phase

管道骨架周围 6 个扩展点：

```
[pre_route] → ROUTE → [post_route] → TRANSFORM → [pre_transport] → TRANSPORT → [post_response]

任何阶段出错 → [on_error]
流式响应期间 → [on_stream_event]
```

## Hook 接口

```typescript
type HookPhase =
  | "pre_route" | "post_route"
  | "pre_transport" | "post_response"
  | "on_error" | "on_stream_event";

interface PipelineHook {
  name: string;
  phase: HookPhase;
  priority: number;
  execute(ctx: PipelineContext): void | Promise<void>;
}
```

同 phase 的 hook 按 priority 升序执行。

## 优先级约定

| 范围 | 使用者 |
|------|--------|
| 0-99 | 内部基础设施（凭证注入、模型校验） |
| 100-199 | 内置功能（overflow、patch） |
| 200-299 | 外部插件（默认 250） |
| 900-999 | 后置观察者（日志、指标） |

## PipelineContext

贯穿管道的上下文对象，替代散落在函数参数中的状态：

```typescript
interface PipelineContext {
  readonly request: FastifyRequest;
  readonly reply: FastifyReply;
  readonly rawBody: Record<string, unknown>;
  readonly clientModel: string;
  readonly apiType: string;
  readonly sessionId: string | undefined;

  body: Record<string, unknown>;
  isStream: boolean;
  resolved: Target | null;
  provider: Provider | null;
  injectedHeaders: Record<string, string>;
  transportResult: TransportResult | null;
  resilienceResult: ResilienceResult | null;
  metadata: Map<string, unknown>;
  logId: string;
  rootLogId: string | null;
  snapshot: PipelineSnapshot;
}
```

`readonly` 字段在管道生命周期内不变；可变字段由各阶段和 hook 改写。`metadata` 供 hook 间传递扩展数据，管道本身不读取。

## 内置 Hook 映射

| 当前代码 | Hook 名称 | Phase | Priority |
|---------|-----------|-------|----------|
| `applyToolRoundLimit` | `tool_round_limit` | pre_route | 110 |
| `ToolLoopGuard` | `tool_loop_guard` | pre_route | 120 |
| `allowedModels` 检查 | `allowed_models` | post_route | 50 |
| `applyOverflowRedirect` | `overflow_redirect` | post_route | 100 |
| `applyProviderPatches` | `provider_patches` | pre_transport | 100 |
| `PluginRegistry.applyBefore/AfterRequest` | `plugin_request` | pre_transport | 250 |
| `insertRequestLog` 等 | `request_logging` | post_response | 900 |
| `collectTransportMetrics` | `metrics_collector` | post_response | 910 |
| `usageWindowTracker.recordRequest` | `usage_tracker` | post_response | 920 |
| `logToolErrors` | `tool_error_logger` | post_response | 930 |
| 错误日志写入 | `error_logging` | on_error | 900 |

## FailoverLoop 与 Pipeline 的关系

Failover 循环包裹 Pipeline，不在 Pipeline 内部。Pipeline 只管单次执行，FailoverLoop 负责捕获 `ProviderSwitchNeeded` 并重试：

```typescript
async function executeFailoverLoop(ctx, pipeline, deps) {
  const excludeTargets: Target[] = [];
  while (true) {
    ctx.resolved = null;
    ctx.provider = null;
    ctx.logId = randomUUID();
    try {
      return await pipeline.execute(ctx, deps);
    } catch (e) {
      if (e instanceof ProviderSwitchNeeded && !ctx.reply.raw.headersSent) {
        excludeTargets.push(ctx.resolved!);
        continue;
      }
      return handleError(e, ctx, deps);
    }
  }
}
```

## 插件位置感知

1. **文档约定**：优先级范围即位置约定，插件开发者按范围选 priority
2. **启动日志**：服务启动时打印完整 hook 链，含 phase、priority、名称
3. **Admin API**：`GET /admin/api/pipeline/hooks` 返回当前已注册 hook 列表

## 重构预期

`proxy-handler.ts` 从 556 行拆为：
- 入口函数 ~50 行：组装 Pipeline、注册 Hooks、调用 FailoverLoop
- ~7 个 hook 文件：各 30-80 行，每个文件一个内置 hook
