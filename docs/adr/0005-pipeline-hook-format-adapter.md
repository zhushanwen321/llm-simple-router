# ADR 0005: Pipeline Hook 可扩展架构 + FormatAdapter 分离

代理层需要支持多种 API 格式（Chat/Responses/Anthropic）且未来可能新增更多。旧的实现用 18 个 if-else 做格式分发，3 个独立 Handler 入口文件各自维护路由逻辑，扩展新格式成本高且容易遗漏。

选定方案：3 步同步管道骨架（Route → Transform → Transport）+ 6 个 HookPhase 扩展点 + FormatAdapter/FormatConverter 分离 + FormatRegistry 查表。3 个 Handler 入口合并为 1 个 createProxyHandler 工厂，差异由 FormatAdapter 驱动。Failover 循环包裹 Pipeline 外层而非内嵌。SSE 拆为 Layer 0 格式转换 + Layer 1 插件拦截。

## 管道骨架

```
Route → Transform → Transport
  ↑         ↑          ↑
  hooks     hooks      hooks
```

6 个 HookPhase：pre_route, post_route, pre_transform, post_transform, pre_transport, post_transport。

## FormatAdapter / FormatConverter 分离

- **FormatAdapter**（~30 行）：声明 API 差异元数据（端点路径、请求/响应类型标识、SSE 事件名映射）
- **FormatConverter**（~120 行）：方向转换逻辑（request/response 互转）
- **FormatRegistry**：查表替代 18 个 if-else，新增格式只需 1 个 adapter + N-1 个 converter

## 优先级分段

| 范围 | 用途 |
|------|------|
| 0-99 | 基础设施（认证、限流） |
| 100-199 | 内置功能（模态重定向、overflow） |
| 200-299 | 外部插件（用户代码） |
| 900-999 | 后置观察者（日志、指标） |

## Failover 循环位置

FailoverLoop 包裹 Pipeline（不在 Pipeline 内部）。Pipeline 只管单次执行，FailoverLoop 捕获 `ProviderSwitchNeeded` 并重试。如果 Failover 在 Pipeline 内部，pre_route hook 会在每次重试时重复执行，违反幂等预期。

## SSE 双层

- **Layer 0**：FormatTransform（格式转换，如 Anthropic SSE → Chat SSE）
- **Layer 1**：SSEEventTransform（插件事件拦截，收到解析后的结构化 SSEEvent）

## Considered Options

1. **事件驱动/中间件链（Koa 风格）**：灵活但 SSE 流式场景下事件顺序难以保证，调试困难。
2. **责任链模式**：各阶段接口差异大，控制流非线性，过重。
3. **选定方案**：同步管道 + HookPhase 扩展点 + FormatRegistry 查表。

## Consequences

- 新增 API 格式成本固定为 1 个 adapter + N-1 个 converter，无需修改 registry 或已有组件。
- Hook phase 一旦上线所有插件依赖它，增删 phase 是破坏性变更。
- FailoverLoop 在 Pipeline 外层，pipeline hooks 无法感知重试次数（需通过 PipelineContext.metadata 传递）。
- SSE 插件收到的是解析后的结构化 SSEEvent（非原始文本），支持修改/丢弃/注入三种操作。
