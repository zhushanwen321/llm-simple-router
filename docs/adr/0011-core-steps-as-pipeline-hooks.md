# ADR 0011: 核心执行步骤作为 Pipeline Hook

**上下文**：Pipeline 全量接管代理请求执行（迁移 failover-loop 内联逻辑到 pipeline）。格式转换（resolveUpstreamPath）和 transport 执行（buildTransportFn + orchestrator.handle）是系统骨架——它们可以被设计为 pipeline 硬编码的核心步骤，也可以设计为高优先级内置 hook。

**决策**：核心执行步骤实现为 `pre_transport` phase 的内置 hook（`builtin:format-transform` priority 0，`builtin:transport-execute` priority 50），而非硬编码在 pipeline 执行器中。

**原因**：核心步骤作为 hook 保持架构一致性——所有请求修改和执行逻辑都通过同一个 hook 接口，外部插件可以通过 Admin API 查看完整的 hook 链（包括核心步骤），也可以在核心步骤前后注入自定义行为（priority 200-299 区间）。代价是核心步骤理论上可被 PipelineAbort 短路，但这与系统其他 hook 的行为一致，是预期行为。
