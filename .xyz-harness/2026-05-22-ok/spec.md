---
verdict: pass
---

# Pipeline + Extension 架构深化

## Background

LLM Simple Router 的代理层已通过 ADR-0005/0011 建立了 Pipeline Hook 架构：6 个 HookPhase、15 个内置 hook、FormatAdapter/FormatConverter 分离、FailoverLoop 在 Pipeline 外层。这个方向正确，但实施不完整，留下三个结构性缺陷：

1. **PipelineContext.metadata 是无类型 Map** — failover-loop 注入 20+ 个 `Map<string, unknown>` entry，15 个 hook 用 `as` 断言取出。编译器无法捕获拼写错误或类型不匹配。
2. **控制流分裂** — failover 决策散落在 `ProviderSwitchNeeded` 异常传播 + failover-loop L291 手写返回值检查两个路径。
3. **模块深度不足** — transport-execute hook 150 行内联 6 项职责、FormatRegistry 只做 Map lookup、6 个流式转换器各自实现样板、Admin CRUD 40% 骨架重复。

本 spec 定义 4 个 Phase 的渐进式重构，统一解决这些问题，同时保留所有扩展点（新 hook、新 API 格式、新流式转换器、新 CRUD 端点、新 Plugin）。

## Functional Requirements

### FR-1: PipelineDeps 结构化

将 PipelineContext.metadata 中的固定依赖（db、container、matcher、adapter、orchestrator 等 15+ 个）提取为 `PipelineDeps` 接口，挂在 PipelineContext.deps 上。迭代级状态（excludeTargets、mappingReason、isFailoverIteration、iterationStartTime、lastFailoverTrigger）提升为 PipelineContext 的具名可变字段。

**变更清单：**
- `proxy/pipeline/types.ts`: PipelineContext 接口扩展 deps + 迭代级字段
- `proxy/pipeline/context.ts`: createPipelineContext 更新
- `proxy/handler/failover-loop.ts`: 20+ 个 metadata.set() → ctx.deps 一次性赋值 + 5 个具名字段赋值
- 15 个 builtin hook: metadata.get("xxx") as T → ctx.deps.xxx / ctx.iterationStartTime 等

**保留的 metadata 用途：** 仅限 hook 间动态通信（session_id、client_type、apiKey、needsTransform、cache_read_tokens 等），通过类型安全的 `PipelineMetaMap` 接口声明。

### FR-2: 控制流统一

消除 `ProviderSwitchNeeded` 异常 + 合并双重 failover 判断为单路径返回值。

**变更清单：**
- `proxy/orchestration/resilience.ts`: ResilienceResult 新增 `action: 'complete' | 'switch_provider'`，不再 throw ProviderSwitchNeeded
- `proxy/handler/failover-loop.ts`: 删除 L291 手写 `if (failed)` 检查，改由 `resilienceResult.action` 驱动；删除 ProviderSwitchNeeded catch 分支
- `core/errors.ts`: ProviderSwitchNeeded 类标记 `@deprecated`
- ADR-0005 更新: "FailoverLoop catches ProviderSwitchNeeded" → "FailoverLoop 检查 resilienceResult.action"

### FR-3: TransportExecutor 深模块

将 transport-execute hook 的 150 行内联逻辑提取为独立 `TransportExecutor` 类。Hook 变成单行委托：`await executor.execute(ctx)`。

**变更清单：**
- 新增 `proxy/transport/transport-executor.ts`: TransportExecutor 类
- `proxy/hooks/builtin/transport-execute.ts`: 从 150 行 → ~10 行委托
- TransportExecutor 内部封装: adapter.beforeSendProxy + formatTransform + responseTransform + buildTransportFn + orchestrator.handle + plugin response hooks + error cleanup

**扩展保留：** 外部插件通过 PluginRegistry（已存在）扩展，不通过 TransportExecutor。

### FR-4: Format 子系统清理

#### FR-4a: format/converters/ 合并

6 个文件（72 行，每文件 12 行 `createConverter()` 委托）合并为 1 个 `format/register-converters.ts`。index.ts 从导入 6 个文件改为导入 1 个注册函数。

**变更清单：**
- 新增 `proxy/format/register-converters.ts`
- 删除 `proxy/format/converters/` 目录 (6 文件)
- 删除 `format/types.ts` 中的 `createConverter()` 工厂函数
- `router/src/index.ts`: 导入简化

#### FR-4b: FormatRegistry 深化

新增高阶方法消除调用方 "lookup → check null → call" 三步样板：

- `transformRequestBody(body, source, target, model): { body, upstreamPath }` — 无 converter 时原样返回
- `transformResponseBody(body, source, target): Record<string, unknown>` — 含错误格式化
- `transformErrorBody(body, source, target): string` — 统一错误格式化入口

低阶方法（transformRequest/transformResponse/createStreamTransform）保留。

#### FR-4c: BaseSSETransform 双模式扩展

深化 BaseSSETransform 基类，支持两种扩展模式：
- **简单模式（事件映射表）**: 子类传入 `{ source, target, transform }[]` 映射表，基类驱动 SSE 解析和输出
- **复杂模式（processEvent 覆写）**: 当前 6 个转换器属于这种，基类提供 SSE 解析 + 输出格式化 + done 检测

**变更清单：**
- `proxy/transform/stream-transform-base.ts`: 扩展基类支持映射表模式
- 6 个 stream-*.ts: 逐步验证是否可简化为映射表模式（Chat↔Responses 等异构转换保留 processEvent）

### FR-5: Admin 层工具函数

提取 4 个共享工具函数到 `admin/utils.ts`，消除 CRUD 骨架重复：

| 函数 | 用途 |
|------|------|
| `partialBody(createSchema)` | 从 CreateSchema 自动生成 UpdateSchema（所有字段 Optional） |
| `extractDefinedFields(body, allowedKeys)` | 提取非 undefined 字段（白名单过滤） |
| `notFound(reply, entity, id)` | 标准 404 响应 |
| `conflict(reply, entity, name)` | 标准 409 响应 |

**同时删除** `admin/constants.ts`（纯透传 core/constants.ts 的 10 个 HTTP 状态码），所有 admin 文件改为直接从 `../core/constants.js` 导入。

**扩展保留：** 新增 CRUD 端点用工具函数消除样板，复杂副作用（级联、并发同步、加密）仍自由编写。不提取声明式工厂。

### FR-6: 双注册表合并

删除 `proxy/pipeline/hook-registry.ts`（45 行），Admin API 改为查询 `proxyPipeline.getHookChain(phase)`。register-hooks.ts 不再需要"注册两次"。

**变更清单：**
- `proxy/pipeline/pipeline.ts`: getHookChain() 返回 `HookChainEntry[]`，每个条目包含 `{ name: string; priority: number; phase: HookPhase; core?: boolean }`
- `proxy/pipeline/register-hooks.ts`: 删除 hookRegistry.register 调用
- `proxy/pipeline/hook-registry.ts`: 删除
- `admin/monitor.ts`: 改为查询 proxyPipeline，返回数据结构与删除前完全一致（字段名和类型不变）

## Acceptance Criteria

### AC-1: PipelineDeps（FR-1）
- [ ] PipelineContext.deps 字段存在且类型为 PipelineDeps
- [ ] PipelineContext 包含以下迭代级具名字段：excludeTargets、mappingReason、isFailoverIteration、iterationStartTime、lastFailoverTrigger
- [ ] failover-loop.ts 中无 metadata.set 调用（固定依赖 + 迭代级状态全部迁移）
- [ ] 15 个 builtin hook 中无 `metadata.get("db")` / `metadata.get("container")` / `metadata.get("matcher")` 等固定依赖的 as 断言
- [ ] PipelineMetaMap 接口定义了所有 hook 间通信键的类型
- [ ] 所有现有测试通过

### AC-2: 控制流统一（FR-2）
- [ ] core/errors.ts 中 ProviderSwitchNeeded 类标记 @deprecated，注释注明"迁移到 ResilienceResult.action"
- [ ] ResilienceResult 包含 action 字段
- [ ] resilience.ts 中无 ProviderSwitchNeeded throw
- [ ] failover-loop.ts 中无 ProviderSwitchNeeded catch 分支
- [ ] failover-loop.ts 中无手写 `if (failed)` failover 判断
- [ ] Failover 行为不变（集成测试验证重试 + failover 切换）
- [ ] Plugin API 兼容性：external plugin 使用 ProviderSwitchNeeded 时行为说明（见 Constraints #7）
- [ ] 所有现有测试通过

### AC-3: TransportExecutor（FR-3）
- [ ] TransportExecutor 类存在，execute(ctx) 方法可被 hook 单行委托调用
- [ ] transport-execute hook 不超过 20 行
- [ ] TransportExecutor 独立可测试（mock orchestrator）
- [ ] 所有现有测试通过

### AC-4a: Format converters 合并（FR-4a）
- [ ] format/converters/ 目录不存在
- [ ] format/types.ts 中无 createConverter 函数
- [ ] register-converters.ts 存在且包含所有 6 对转换注册
- [ ] 所有现有测试通过

### AC-4b: FormatRegistry 深化（FR-4b）
- [ ] FormatRegistry 包含 transformRequestBody / transformResponseBody / transformErrorBody 三个高阶方法
- [ ] 低阶方法仍存在且行为不变
- [ ] 高阶方法在无 converter 时返回原始数据
- [ ] 所有现有测试通过

### AC-4c: BaseSSETransform（FR-4c）
- [ ] BaseSSETransform 支持映射表模式构造（通过构造函数第二个参数传入 EventMapping[]）
- [ ] stream-oa2ant.ts（OpenAI→Anthropic，同构转换，当前 223 行）迁移为映射表模式，代码量减少 ≥ 40%（目标 ≤ 130 行）
- [ ] stream-ant2oa.ts（Anthropic→OpenAI）作为候选验证映射表模式
- [ ] Chat↔Responses 异构转换器（stream-bridge-chat2resp.ts、stream-bridge-resp2chat.ts）保留 processEvent 覆写模式
- [ ] 所有 6 个转换器功能不变（流式集成测试验证）
- [ ] 所有现有测试通过

### AC-5: Admin 工具函数（FR-5）
- [ ] admin/utils.ts 存在且包含 4 个工具函数
- [ ] admin/constants.ts 不存在
- [ ] 以下 admin 文件使用工具函数（允许合理例外但需说明原因）：
  - providers.ts（必用 partialBody + extractDefinedFields + notFound + conflict）
  - retry-rules.ts（必用 partialBody + extractDefinedFields + notFound）
  - groups.ts（必用 partialBody + extractDefinedFields + notFound）
  - router-keys.ts（必用 notFound）
  - schedules.ts（必用 partialBody + extractDefinedFields + notFound）
- [ ] 使用工具函数的文件行数减少
- [ ] 所有现有测试通过

### AC-6: 双注册表合并（FR-6）
- [ ] hook-registry.ts 不存在
- [ ] Admin API monitor 端点返回的 hook 信息来源为 proxyPipeline
- [ ] Admin API 返回的 hook 数据结构字段名和类型与删除前一致（name: string; priority: number; phase: HookPhase; core?: boolean）
- [ ] register-hooks.ts 中每个 hook 只注册一次（到 proxyPipeline）
- [ ] 所有现有测试通过

## Constraints

1. **渐进式迁移**：每个 FR 可独立 PR，不要求一次全做。Phase 1（FR-1 + FR-6）是其他 FR 的前置。
2. **不改变外部行为**：所有重构不改变 Router 对客户端的 API 契约（请求/响应格式、错误码、超时行为等）。
3. **扩展点保留**：新 hook、新 API 格式、新流式转换器、新 CRUD 端点、新 Plugin 的注册和使用方式不变或变好。
4. **测试覆盖**：每个 FR 对应的测试文件必须更新并通过。新增模块（TransportExecutor、admin/utils）需要新测试。
5. **ADR-0005/0011 不推翻**：Pipeline Hook 架构方向不变，仅深化实施。ADR-0005 需小幅更新控制流描述。
6. **ADR-0006 遵循**：body 不可变原则不变，pipeline_snapshot 仍随管线自动累积。
7. **ProviderSwitchNeeded 兼容降级**：外部 plugin 若仍依赖 ProviderSwitchNeeded 异常做控制流，该异常不再被 failover-loop catch，会直接穿透到顶层并被记录为 unhandled error。在 ADR-0013 中说明："ProviderSwitchNeeded 仅用于内部 failover 控制，external plugin 不应使用它。建议 plugin 通过设置 ctx.metadata 状态标记和返回控制。"
8. **性能无退化**：重构后代理请求的启动时间、首 token 延迟（TTFT）在 ±5% 范围内与 baseline 对比。实施阶段通过集成测试确认，不新增性能测试用例。

## Complexity Assessment

**总体复杂度：中高**

| FR | 复杂度 | 风险点 | 测试策略 |
|----|--------|--------|---------|
| FR-1 (PipelineDeps) | 中 | 15 个 hook 的 metadata 迁移需逐一验证 | 逐 hook 改 + 跑全量测试 |
| FR-2 (控制流) | 中 | failover 行为回归 | 集成测试验证重试 + failover 切换路径 |
| FR-3 (TransportExecutor) | 低 | 从 hook 提取到类，逻辑不变 | TransportExecutor 单元测试 + 集成测试 |
| FR-4a (converters) | 低 | 纯删除 + 合并 | 全量测试 |
| FR-4b (Registry 深化) | 低 | 新增方法，不改旧行为 | 新方法单元测试 + 旧测试不 break |
| FR-4c (BaseSSETransform) | 中 | 6 个转换器逐个验证 | 流式集成测试 |
| FR-5 (Admin utils) | 低 | 样板提取，不改业务逻辑 | Admin CRUD 测试 |
| FR-6 (双注册表) | 低 | 查询来源切换 | Admin API 测试 |

**迁移顺序：**
1. Phase 1: FR-1 + FR-6（前置条件）
2. Phase 2: FR-3 + FR-2（管道深化，依赖 FR-1）
3. Phase 3: FR-4a → FR-4b → FR-4c（格式子系统，相对独立）
4. Phase 4: FR-5（Admin 层，完全独立）
