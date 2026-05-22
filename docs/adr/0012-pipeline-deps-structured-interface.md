# ADR 0012: PipelineContext 结构化 deps 替代无类型 Map

PipelineContext.metadata 原为 `Map<string, unknown>`，failover-loop 注入 20+ 个固定依赖，15 个 hook 用 `as` 断言取出。改为 `PipelineDeps` 接口挂在 ctx.deps 上，迭代级状态提升为具名字段。选择显式注入而非 container.resolve，理由：让每个 hook 的依赖可见（从 ctx.deps.xxx 读取），编译期检查拼写和类型。

# ADR 0013: Failover 控制流从异常改为返回值

ProviderSwitchNeeded 异常从 resilience.ts throw，穿透 orchestrator.ts 和 transport-execute hook，在 failover-loop.ts catch。改为 ResilienceResult.action 返回值，failover-loop 通过 action === 'switch_provider' 做决策。理由：返回值链让控制流在代码中可见，消除跨 3 层文件的异常追踪。

# ADR 0014: Admin 层工具函数策略替代声明式 CRUD 工厂

Admin CRUD 路由（providers.ts 等）有 40% 骨架重复（Schema + 字段提取 + 404 检查）。选择提取工具函数（partialBody、extractDefinedFields、notFound、conflict）而非声明式工厂。理由：providers.ts 的级联停用、并发同步、模型覆盖等复杂副作用无法被工厂抽象覆盖；工具函数消除样板同时保留自由度。未来纯 CRUD 实体可渐进迁移到声明式，不阻塞。
