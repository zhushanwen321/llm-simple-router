# ADR 0003: 代理层四层架构 Handler → Orchestrator → Routing → Transport

代理层从一个 500+ 行的 `handleProxyPost()` 函数重构为四层架构：Handler（路由回调，映射解析+header构建）→ Orchestrator（信号量/追踪器/resilience 协调，驱动重试循环）→ Routing（映射解析、模型状态、溢出检测）→ Transport（HTTP 调用、SSE 流式代理）。核心权衡是：旧的单函数结构在重试逻辑和 failover 循环交织后已无法安全修改，四层分离让每层职责清晰、可独立测试。

## Considered Options

1. **保持单函数 + 提取子函数**：风险低但子函数间通过共享状态通信，重试/failover 的嵌套循环仍然耦合。
2. **事件驱动/中间件链**：每层通过事件串联。灵活但 SSE 流式场景下事件顺序难以保证，调试困难。
3. **选定方案**：同步四层调用链。Handler 调 Orchestrator，Orchestrator 内部循环调 Transport，每层通过返回值通信。简单直接，调用栈可见。

## Consequences

- Resilience 层（重试/failover）成为 Orchestrator 的内部循环，而非独立中间件。这意味着重试逻辑和并发控制紧耦合——信号量 acquire/release 必须包裹整个 resilience 循环。
- Handler 层仍然较重（映射解析 + 增强 + header 构建 + 日志），但已从"所有逻辑"缩减为"协调逻辑"。
- 四层间通过 `TransportResult` 联合类型通信，该类型有 6 种变体，新增场景需评估是否需要新变体。
