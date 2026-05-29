---
verdict: pass
---

# 业务用例 — architecture-deepening

## UC-1: 删除死代码 transport-executor.ts

- **Actor:** 开发者
- **Preconditions:** transport-executor.ts 已在前序重构中创建（224 行，含 TransportExecutor 类），但 transport-execute-impl.ts hook 不再调用它，且该类的所有逻辑已内联到 hook 中或不再使用
- **Main Flow:**
  1. 开发者识别 transport-executor.ts 在当前代码库中无任何 import 引用
  2. 开发者删除 transport-executor.ts 文件
  3. 开发者运行 `npx tsc --noEmit` 验证无因删除产生的编译错误
  4. 开发者运行 `npm test` 验证测试全部通过
- **Alternative Paths:**
  - 如果删除后 tsc 报错 → 检查是否存在未发现的引用，确保在删除前确认零调用者
- **Postconditions:** transport-executor.ts 从版本控制中移除，代码库减少 224 行无效代码，新增开发者不再困惑于此文件的存在意义。git blame 历史可追溯
- **Module Boundaries:** `src/proxy/orchestration/transport-executor.ts`（已删除），不涉及其他模块

## UC-2: buildApp 可读性提升

- **Actor:** 开发者（维护和扩展路由器）
- **Preconditions:** buildApp() 函数 346 行，包含 Fastify 实例创建、hook 注册、容器组装、路由注册、静态文件服务等多项职责，全部在单一函数中线性展开
- **Main Flow:**
  1. 开发者将 `createAppInstance()` 提取为独立函数：负责 Fastify 实例创建和通用配置（body limit、trust proxy、error handler）
  2. 开发者将 `registerAppHooks()` 提取为独立函数：负责 onRequest、preParsing、preSerialization 等 Fastify 生命周期 hook 注册
  3. 开发者将 `composeContainer()` 提取为独立函数：负责 ServiceContainer 初始化、所有服务注册和初始化状态
  4. 开发者将 `registerRoutes()` 提取为独立函数：负责认证、管理路由、代理路由、静态文件服务和健康检查端点注册
  5. `buildApp()` 简化为依次调用四个子函数的有序编排
- **Alternative Paths:**
  - 如果某子函数需要额外的 options 参数 → 通过 `buildApp` 的 `AppOptions` 参数或局部参数对象传递，不破坏纯粹的职责分离
- **Postconditions:** buildApp() 从 346 行缩减至约 50 行，四个子函数各自 ≤80 行。新增功能（如新路由、新 hook）可直接定位到对应函数，无需理解全部 346 行上下文
- **Module Boundaries:** `src/index.ts` 内的函数级拆分，不改变导出接口（`buildApp` 签名不变）

## UC-3: 跨层隔离修复

- **Actor:** 开发者（模块维护者）
- **Preconditions:** Admin 层直接 import proxy 层的 `RawHeaders`、`buildUpstreamHeaders`、`callGet`、`ProxyAgentFactory`；DB 层直接 import proxy 层的 log-detail-policy.ts（反向依赖）
- **Main Flow:**
  1. 开发者识别 admin→proxy 的三处直接依赖：`admin/providers.ts` 中 `callGet` + `buildUpstreamHeaders` 用于 fetch-models；`admin/routes.ts` 中 `proxyPipeline` 用于查询 hook 列表；`admin/providers.ts` 中直接引用 `ProxyAgentFactory`
  2. 开发者创建 `IProviderConnectivityChecker` 接口（core/provider-connectivity.ts），`ProxyConnectivityChecker` 在 proxy 层实现此接口
  3. `admin/providers.ts` 改为接收 `connectivityChecker` 参数，调用 `checker.fetchModels()`，不再 import proxy 层的 HTTP 函数
  4. `admin/routes.ts` 改为通过 `stateRegistry.getRegisteredHooks()` 查询 hook 列表，不再 import `proxyPipeline`
  5. `admin/providers.ts` 将 `ProxyAgentFactory` 引用替换为 `IProxyCacheInvalidator` 接口
  6. 开发者将 `proxy/log-detail-policy.ts` 的 `shouldPreserveDetail()` 提升到 `core/log-detail-policy.ts`，消除 db→proxy 反向依赖
- **Alternative Paths:**
  - 如果某个 admin 功能必须调用 proxy 层复杂逻辑（非简单 HTTP 调用）→ 通过 StateRegistry 接口扩展，不直接 import proxy 类型
- **Postconditions:** admin 层不再直接 import proxy 层代码，db 层不再直接 import proxy 层代码。新增的管理功能通过 `StateRegistry`、`IProviderConnectivityChecker`、`IProxyCacheInvalidator` 接口与 proxy 层解耦
- **Module Boundaries:** `src/core/`（接口定义）、`src/admin/`（消费者）、`src/proxy/`（实现方）

## UC-4: 可测试的日志记录

- **Actor:** 开发者 / QA 工程师
- **Preconditions:** 代理层的日志记录函数（`insertRequestLog`、`insertMetrics` 等）直接调用 DB 函数，单元测试中必须 mock DB 才能验证日志行为，且无法在 DB-free 环境下测试日志记录链路
- **Main Flow:**
  1. 开发者在 `core/log-sink.ts` 中定义 `ILogSink` 接口，含 `insertRequestLog`、`insertMetrics`、`updateLogStreamContent`、`updateLogClientStatus` 四个方法
  2. 开发者在 `proxy/log-sink/db-log-sink.ts` 中实现 `DbLogSink`，将方法委托给 DB 函数
  3. 开发者在 `proxy/log-sink/in-memory-log-sink.ts` 中实现 `InMemoryLogSink`，将日志存储在内存数组中
  4. `DbLogSink` 注册到 ServiceContainer 的 SKEYS.logSink
  5. 日志调用的地方改为通过 `ctx.deps.setup.logSink` 访问
  6. 测试用例创建 `InMemoryLogSink` 并注入到 setupDeps，验证日志写入预期数据
- **Alternative Paths:**
  - 现有测试只需在 setupDeps 中提供 InMemoryLogSink 即可运行，无需初始化 DB 或 mock
- **Postconditions:** 日志逻辑可脱离 DB 进行单元测试。`InMemoryLogSink` 可以收集所有日志事件并在断言中验证其内容。生产环境 `DbLogSink` 行为不变
- **Module Boundaries:** `src/core/log-sink.ts`（接口）、`src/proxy/log-sink/`（实现）、`src/index.ts`（注册）

## UC-5: 类型安全的 Pipeline 依赖

- **Actor:** 开发者
- **Preconditions:** `PipelineDeps` 接口包含 21 个可选字段，hook 通过 `ctx.deps!.xxx` 断言访问，编译器无法检查字段是否存在或拼写正确。metadata 与 deps 的职责边界模糊
- **Main Flow:**
  1. 开发者将 `PipelineDeps` 重构为两个独立接口：`SetupDeps`（10 个必需字段，应用生命周期级依赖）和 `RequestDeps`（11 个必需字段，请求级依赖）
  2. 所有字段从可选变为必需，确保编译器检查完整性
  3. `PipelineContext.deps` 类型更新为 `PipelineDeps`（`{ setup: SetupDeps; request: RequestDeps }`）
  4. `failover-loop.ts` 中的 deps 赋值改为确定性填充，不再使用可选链
  5. 将 `concurrencyOverride` 从可选 `ConcurrencyOverride | null | undefined` 统一为 `ConcurrencyOverride | null`
- **Alternative Paths:**
  - 如果某个测试需要部分 deps → 提供工厂函数创建带有合理默认值的完整 deps 对象
- **Postconditions:** 所有 15 个 builtin hook 和 failover-loop 中的 deps 访问都是类型安全的。新增 hook 时添加 deps 字段需要同时更新接口定义和所有填充点
- **Module Boundaries:** `src/proxy/pipeline/types.ts`（接口定义）、`src/proxy/handler/failover-loop.ts`（填充点）、15 个 builtin hook（消费者）

## UC-6: Failover 循环清晰化

- **Actor:** 开发者
- **Preconditions:** `executeFailoverLoop()` 函数约 150 行，路由预计算（L1 阶段：模型映射 → 多模态重定向 → 溢出重定向 → allowed_models 过滤 → 工具错误提取）和循环控制（L2 阶段）混合在同一个函数体中
- **Main Flow:**
  1. 开发者提取 `precomputeRoutes()` 纯函数，参数为 `(ctx, errors, db, cliHdrs, matcher, logFileWriter)`，返回 `PrecomputeResult` 结构体
  2. `precomputeRoutes()` 封装所有 L1 路由预计算逻辑：resolveMapping → computeModalityRedirectTargets → applyOverflowRedirect → applyAllowedModelsFilter → extractFailedToolResults
  3. 路由预计算失败时（model_not_found、unsupported_modality、model_not_allowed），`precomputeRoutes()` 在结果中携带 rejectReply 而非直接发送响应
  4. `executeFailoverLoop()` 先调用 `precomputeRoutes()`，检查 rejectReply，然后进入 while(true) 循环控制
  5. `excludeTargets` 数组和 `mutablePendingToolErrors` 作为迭代级状态在循环中维护
- **Alternative Paths:**
  - 如果预计算成功但循环中所有 target 都失败 → 返回最后一次迭代的失败响应（行为与重构前一致）
- **Postconditions:** `precomputeRoutes()` 是无副作用的纯函数，入参明确，返回结构完整。`executeFailoverLoop()` 职责缩减为循环控制：检查 reject → 填充 deps → while(true) failover 循环。新增一种映射策略或过滤条件时，预处理逻辑集中在 `precomputeRoutes()`，不影响循环控制
- **Module Boundaries:** `src/proxy/handler/failover-loop.ts` 内的函数级拆分，不改变导出接口（`executeFailoverLoop` 签名不变）

## UC-7: 架构决策记录

- **Actor:** 架构师
- **Preconditions:** proxy/format/ 下存在 10 个 converter 文件，每个 12-38 行，均为单次 `createConverter()` 调用，架构评审建议合并为 barrel 文件
- **Main Flow:**
  1. 架构师评估合并方案的技术收益和导航价值损失
  2. 架构师确认：删除任一 converter 文件后把 `createConverter()` 移到 index.ts 可正常工作，这些文件不隐藏逻辑
  3. 架构师决定保持文件独立（每个文件对应一个命名的格式转换路径）
  4. 架构师编写 ADR-0014，记录 "Shallow Format Adapters — No Refactor" 决策
- **Alternative Paths:**
  - 如果未来 converter 数量超过 20 个 → 重新评估是否需要按 API family 分目录组织（ADR 中已注明此条件）
- **Postconditions:** ADR 0014 存在于 `docs/adr/0014-shallow-format-adapters-no-refactor.md`，后续开发者和 AI 在考虑合并 converter 时可以查阅此决策及其理由
- **Module Boundaries:** `docs/adr/`（决策记录），不涉及代码变更。未来新增 converter 继续创建独立文件（如 `foo-to-bar.ts`）

## UC 覆盖映射

| UC | 覆盖的 Spec AC | 对应 Candidate |
|----|---------------|----------------|
| UC-1 | 删除 transport-executor.ts 后 tsc 零错误 + 测试全部通过 | C1 |
| UC-2 | buildApp() 返回结构不变 + 四个子函数存在且职责清晰 | C6 |
| UC-3 | admin 层无 direct proxy import + db 层无 proxy import | C4 |
| UC-4 | ILogSink 接口存在 + DbLogSink/InMemoryLogSink 实现正确 | C5 |
| UC-5 | PipelineDeps 含 SetupDeps(10 req) + RequestDeps(11 req) 必需字段 | C3 |
| UC-6 | precomputeRoutes() 纯函数 + executeFailoverLoop() 循环控制分离 | C2 |
| UC-7 | ADR 0014 存在于 docs/adr/ | C7 |
