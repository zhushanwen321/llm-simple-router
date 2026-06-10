---
verdict: pass
complexity: L1
---

# Pipeline Architecture Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use xyz-harness-subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构 proxy pipeline 架构，拆分 843 行的 failover-loop.ts 和 575 行的 buildApp()，消除双注册反模式，降低单文件复杂度。

**Architecture:** 纯后端重构。按依赖关系由底向上执行：先拆 buildApp（纯提取，零风险），再合并 hook-registry（消除双注册），接着提取 failover-loop 内联逻辑为独立函数，最后按需引入 ILogSink seam。stream-oa2ant 映射表重写作为独立并行任务。

**Tech Stack:** TypeScript, Vitest, Fastify, better-sqlite3

---

## 执行顺序调整说明

原始提议 T4→T5→T6→T7→T8。调整为 T8→T6→T7b→T7a→T5→T4，理由：

| 调整 | 原因 |
|------|------|
| T8 最先 | 纯提取，零风险。拆分后后续 diff 更清晰 |
| T6 第二 | 消除双注册，小改动。为后续 hook 变更铺路 |
| T7b 第三 | stream-oa2ant 独立模块，可和 T6 并行 |
| T7a 第四 | failover-loop 函数提取，依赖 T6 完成 |
| T5 最后 | 强类型化 metadata（如确实需要） |
| T4 删除 | ILogSink 消费者不明确，待日志写入点稳定后再评估 |

---

## File Structure

| File | Type | Group | Description |
|------|------|-------|-------------|
| `router/src/index.ts` | modify | BG1 | 拆分 buildApp 为 4 个函数 |
| `router/src/app/create-app.ts` | create | BG1 | createAppInstance() |
| `router/src/app/register-hooks.ts` | create | BG1 | registerAppHooks() |
| `router/src/app/compose-container.ts` | create | BG1 | composeContainer() |
| `router/src/app/register-routes.ts` | create | BG1 | registerRoutes() |
| `tests/unit/create-app.test.ts` | create | BG1 | buildApp 拆分后集成测试 |
| `router/src/proxy/pipeline/pipeline.ts` | modify | BG2 | 合并 hook-registry + 异常降级 |
| `router/src/proxy/pipeline/hook-registry.ts` | delete | BG2 | 合并进 pipeline.ts |
| `router/src/proxy/pipeline/register-hooks.ts` | modify | BG2 | 改为只注册到 proxyPipeline |
| `router/src/admin/routes.ts` | modify | BG2 | hookRegistry → proxyPipeline.getAllHooks() |
| `tests/unit/pipeline-emit-error-handling.test.ts` | create | BG2 | emit 异常降级测试 |
| `router/src/proxy/transform/stream-oa2ant.ts` | modify | BG3 | 映射表重写 |
| `tests/unit/stream-oa2ant.test.ts` | create | BG3 | 流式转换行为表测试 |
| `router/src/proxy/handler/failover-loop.ts` | modify | BG4 | 函数提取 |
| `router/src/proxy/handler/iteration-setup.ts` | create | BG4 | buildIterationSetup 提取为独立模块 |
| `router/src/proxy/handler/resilience-processor.ts` | create | BG4 | processResilienceResult 提取 |
| `router/src/proxy/handler/reject-helpers.ts` | create | BG4 | rejectAndReply + buildRejectCtx 提取 |
| `tests/unit/failover-loop-precompute.test.ts` | create | BG4 | 预计算纯函数测试 |
| `tests/unit/failover-loop-reject.test.ts` | create | BG4 | reject 辅助函数测试 |

---

## Interface Contracts

### Module: app (BG1)

#### Function: createAppInstance

| Method | Signature | Returns | Edge Cases | Spec Ref |
|--------|-----------|---------|------------|----------|
| createAppInstance | (config: Config) => FastifyInstance | FastifyInstance | — | N/A |

#### Function: composeContainer

| Method | Signature | Returns | Edge Cases | Spec Ref |
|--------|-----------|---------|------------|----------|
| composeContainer | (db: Database, config: Config, app: FastifyInstance) => ServiceContainer | ServiceContainer | :memory: 模式 logFileWriter=null | N/A |

#### Function: registerAppHooks

| Method | Signature | Returns | Edge Cases | Spec Ref |
|--------|-----------|---------|------------|----------|
| registerAppHooks | (app: FastifyInstance, container: ServiceContainer, stateRegistry: StateRegistry) => void | void | — | N/A |

#### Function: registerRoutes

| Method | Signature | Returns | Edge Cases | Spec Ref |
|--------|-----------|---------|------------|----------|
| registerRoutes | (app: FastifyInstance, opts: RouteOpts) => void | void | — | N/A |

### Module: pipeline (BG2)

#### Class: ProxyPipeline

| Method | Signature | Returns | Edge Cases | Spec Ref |
|--------|-----------|---------|------------|----------|
| register | (hook: PipelineHook) => void | void | 同名幂等跳过 | AC-2 |
| getAllHooks | () => Record<HookPhase, HookSummary[]> | 所有阶段的 hook 列表 | 空阶段返回 [] | AC-3 |
| emit | (phase: HookPhase, ctx: PipelineContext) => Promise<void> | void | core hook 异常传播；非 core hook catch+log | AC-1 |
| getByPhase | (phase: HookPhase) => HookSummary[] | 该阶段 hook 列表 | — | AC-3 |

#### PipelineHook interface 变更

| Field | Type | Description |
|-------|------|-------------|
| core | boolean? | 标记核心 hook（异常时传播而非捕获） |

### Module: stream-oa2ant (BG3)

#### Class: OpenAIToAnthropicTransform

行为不变，内部实现改为映射表驱动。公开接口不变。

### Module: failover-loop (BG4)

#### Function: precomputeFailoverTargets

| Method | Signature | Returns | Edge Cases | Spec Ref |
|--------|-----------|---------|------------|----------|
| precomputeFailoverTargets | (input) => PrecomputeResult | ok:true 或 ok:false | 无映射→no_mapping；不支持的模态→unsupported_modality | AC-4 |

#### Function: buildIterationSetup（提取为独立模块导出）

| Method | Signature | Returns | Edge Cases | Spec Ref |
|--------|-----------|---------|------------|----------|
| buildIterationSetup | (params) => IterationSetupResult | ok:true 或 ok:false | encryptionKey 缺失→reject | AC-5 |

#### Function: processResilienceResult（提取为独立模块导出）

| Method | Signature | Returns | Edge Cases | Spec Ref |
|--------|-----------|---------|------------|----------|
| processResilienceResult | (params) => Promise<ResilienceResultAction> | continue 或 reply | PipelineAbort→reply；ProviderSwitchNeeded→continue | AC-6 |

---

## Spec Coverage Matrix

| Spec AC | Interface Method | Data Flow | Task |
|---------|-----------------|-----------|------|
| AC-1 emit 异常降级 | ProxyPipeline.emit | emit→hook.execute→try-catch | Task 2 |
| AC-2 hook 幂等注册 | ProxyPipeline.register | register→检查重名→push | Task 2 |
| AC-3 getAllHooks 替代 hookRegistry | ProxyPipeline.getAllHooks | getAllHooks→Admin API | Task 2 |
| AC-4 预计算逻辑不变 | precomputeFailoverTargets | 纯函数输入输出不变 | Task 4 |
| AC-5 iteration setup 不变 | buildIterationSetup | 提取后签名不变 | Task 4 |
| AC-6 resilience 处理不变 | processResilienceResult | 提取后签名不变 | Task 4 |
| AC-7 stream 转换行为不变 | OpenAIToAnthropicTransform | 映射表驱动，输出等价 | Task 3 |
| AC-8 buildApp 行为不变 | createAppInstance+compose+register | 拆分后集成行为不变 | Task 1 |

---

## Spec Metrics Traceability

| Spec 指标 | 采纳状态 | 对应 Task |
|-----------|---------|----------|
| failover-loop.ts ≤ 500 行 | adopted | Task 4 |
| buildApp() 拆分为 4 个函数 | adopted | Task 1 |
| 消除 hook 双注册 | adopted | Task 2 |
| stream-oa2ant 映射表重写 | adopted | Task 3 |
| 全部现有测试通过 | adopted | 所有 Task |
| ILogSink seam | postponed | 日志写入点稳定后评估 |

---

## Task List

| # | Task | Type | Depends on | Group |
|---|------|------|-----------|-------|
| 1 | 拆分 buildApp() 为 4 个函数 | backend | — | BG1 |
| 2 | 合并 hook-registry 到 pipeline.ts + emit 异常降级 | backend | — | BG2 |
| 3 | stream-oa2ant 映射表重写 | backend | — | BG3 |
| 4 | failover-loop 函数提取 | backend | Task 2 | BG4 |

---

## Execution Groups

### BG1: buildApp 拆分

**Description:** 纯函数提取，将 575 行的 buildApp 拆为 4 个职责明确的函数。零行为变更。

**Tasks:** Task 1

**Files (预估):** 6 个文件（4 create + 1 modify + 1 test）

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| Agent | general-purpose → general-purpose → general-purpose |
| Model | medium |
| 注入上下文 | Task 描述 + CLAUDE.md 编码规范 |
| 读取文件 | `router/src/index.ts`, `router/src/core/container.ts`, `router/src/core/registry.ts` |
| 修改/创建文件 | `router/src/app/create-app.ts`, `router/src/app/compose-container.ts`, `router/src/app/register-hooks.ts`, `router/src/app/register-routes.ts`, `router/src/index.ts`, `tests/unit/create-app.test.ts` |

**Execution Flow (BG1 内部):**

  Task 1:
    1. general-purpose (read xyz-harness-test-driven-development + xyz-harness-backend-dev) → 写失败测试（验证 buildApp 返回值结构不变）
    2. general-purpose (read xyz-harness-backend-dev) → 提取 4 个函数，buildApp 改为调用组合
    3. general-purpose (read xyz-harness-expert-reviewer) → 验证行为等价性

**Dependencies:** 无

**设计细节:**

拆分方案（纯提取，不改变行为）：

1. `createAppInstance(config)` — 创建 Fastify 实例 + 配置 bodyLimit/logger/schemaErrorFormatter + onRequest hook（EPIPE 防护）+ errorHandler + onSend hook
2. `composeContainer(db, config, app)` — ServiceContainer 注册所有服务工厂（db、matcher、semaphoreManager、tracker、usageWindowTracker、sessionTracker、logFileWriter、adaptiveController、pluginRegistry、formatRegistry、proxyAgentFactory）。返回 container 和解析后的服务实例
3. `registerAppHooks(app, container, stateRegistry)` — registerBuiltinHooks + proxy handlers 注册 + stateRegistry 构建
4. `registerRoutes(app, opts)` — adminRoutes + fastifyStatic + SPA fallback + /health + 定时任务（logCleanup、metricsAggregator、dbSizeMonitor）+ close 函数组装

`buildApp()` 变为编排函数：调 createAppInstance → composeContainer → initializeProviderState → registerAppHooks → registerRoutes → return。

### BG2: 合并 hook-registry + emit 异常降级

**Description:** 删除 hook-registry.ts，将 getAllHooks() 合入 pipeline.ts。在 emit() 中增加 core hook 传播、非 core hook catch+log 的异常隔离。

**Tasks:** Task 2

**Files (预估):** 5 个文件（1 delete + 3 modify + 1 test）

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| Agent | general-purpose → general-purpose → general-purpose |
| Model | medium |
| 注入上下文 | Task 描述 + 异常降级行为规格 |
| 读取文件 | `router/src/proxy/pipeline/pipeline.ts`, `router/src/proxy/pipeline/hook-registry.ts`, `router/src/proxy/pipeline/register-hooks.ts`, `router/src/proxy/pipeline/types.ts`, `router/src/admin/routes.ts` |
| 修改/创建文件 | `router/src/proxy/pipeline/pipeline.ts`, `router/src/proxy/pipeline/register-hooks.ts`, `router/src/admin/routes.ts`, `tests/unit/pipeline-emit-error-handling.test.ts` |

**Execution Flow (BG2 内部):**

  Task 2:
    1. general-purpose (read xyz-harness-test-driven-development + xyz-harness-backend-dev) → 写失败测试（core hook 异常传播 + 非 core hook catch+log + getAllHooks 返回正确）
    2. general-purpose (read xyz-harness-backend-dev) → 合并 hook-registry 到 pipeline.ts + 实现 emit 异常降级 + 更新所有引用
    3. general-purpose (read xyz-harness-expert-reviewer) → spec 合规检查

**Dependencies:** 无（与 BG1 可并行）

**设计细节:**

PipelineHook interface 新增 `core?: boolean`（默认 false）：
```typescript
export interface PipelineHook {
  name: string;
  phase: HookPhase;
  priority: number;
  core?: boolean;       // 新增：true = 异常时传播而非捕获
  execute(ctx: PipelineContext): void | Promise<void>;
}
```

ProxyPipeline.emit 异常降级逻辑：
```
for each hook in phase:
  if hook.core === true:
    await hook.execute(ctx)    // 异常直接传播
  else:
    try { await hook.execute(ctx) }
    catch(e) { ctx.request.log.warn({ hook: hook.name, err: e }, "non-core hook error") }
```

hook-registry.ts 删除后：
- `proxyPipeline.getAllHooks()` 替代 `hookRegistry.getAll()`
- `registerBuiltinHooks()` 只注册到 `proxyPipeline`（不再双注册）
- admin routes 中 `stateRegistry.getPipelineHooks` 改为调 `proxyPipeline.getAllHooks()`

### BG3: stream-oa2ant 映射表重写

**Description:** 将 stream-oa2ant.ts 的 if-else 状态转换逻辑重构为映射表驱动，消除重复的 pushAnthropicSSE 调用。

**Tasks:** Task 3

**Files (预估):** 2 个文件（1 modify + 1 test）

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| Agent | general-purpose → general-purpose → general-purpose |
| Model | medium |
| 注入上下文 | Task 描述 + 行为表 + 转换规格 |
| 读取文件 | `router/src/proxy/transform/stream-oa2ant.ts`, `router/src/proxy/transform/stream-transform-base.ts` |
| 修改/创建文件 | `router/src/proxy/transform/stream-oa2ant.ts`, `tests/unit/stream-oa2ant.test.ts` |

**Execution Flow (BG3 内部):**

  Task 3:
    1. general-purpose (read xyz-harness-test-driven-development + xyz-harness-backend-dev) → 写行为表测试（text、thinking、tool_use、finish_reason、usage 等场景）
    2. general-purpose (read xyz-harness-backend-dev) → 映射表重写实现
    3. general-purpose (read xyz-harness-expert-reviewer) → 验证转换等价性

**Dependencies:** 无（与 BG1/BG2 可并行）

**设计细节:**

映射表模式：将 `(state, eventType)` → `(newState, outputAction)` 的转换抽取为声明式映射。

关键行为表（测试基准）：

| 输入事件 | 当前状态 | 期望输出 | 新状态 |
|----------|---------|---------|--------|
| delta.content="hi" | init | message_start + content_block_start(text) + content_block_delta(text) | text |
| delta.content="!" | text | content_block_delta(text) | text |
| delta.reasoning="think" | text | content_block_stop + content_block_start(thinking) + content_block_delta(thinking) | thinking |
| delta.tool_calls[{id,name}] | text | content_block_stop + content_block_start(tool_use) + content_block_delta(input_json) | tool_use |
| delta.tool_calls[{args}] | tool_use | content_block_delta(input_json) | tool_use |
| finish_reason="stop" | text | content_block_stop + (pending stop) | closing |
| usage-only chunk | closing | message_delta + message_stop | closing |
| [DONE] | any | (skip) | any |

### BG4: failover-loop 函数提取

**Description:** 将 failover-loop.ts（843 行）的内联逻辑提取为独立模块。目标是将主循环降到 ~400 行。**注意：这不是 hook 抽象，而是函数提取**。executeFailoverLoop 保持为编排函数。

**Tasks:** Task 4

**Files (预估):** 6 个文件（3 create + 1 modify + 2 test）

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| Agent | general-purpose → general-purpose → general-purpose |
| Model | high（逻辑复杂度高） |
| 注入上下文 | Task 描述 + failover-loop 完整调用链 |
| 读取文件 | `router/src/proxy/handler/failover-loop.ts`, `router/src/proxy/handler/proxy-handler.ts`, `router/src/proxy/handler/create-proxy-handler.ts` |
| 修改/创建文件 | `router/src/proxy/handler/iteration-setup.ts`, `router/src/proxy/handler/resilience-processor.ts`, `router/src/proxy/handler/reject-helpers.ts`, `router/src/proxy/handler/failover-loop.ts`, `tests/unit/failover-loop-precompute.test.ts`, `tests/unit/failover-loop-reject.test.ts` |

**Execution Flow (BG4 内部):**

  Task 4:
    1. general-purpose (read xyz-harness-test-driven-development + xyz-harness-backend-dev) → 写纯函数测试（precomputeFailoverTargets 的各种 errorCode + rejectAndReply 的响应构造）
    2. general-purpose (read xyz-harness-backend-dev) → 提取 3 个模块，failover-loop.ts 改为 import + 调用
    3. general-purpose (read xyz-harness-expert-reviewer) → 验证提取后行为等价

**Dependencies:** BG2（依赖 hook-registry 合并完成，避免合并冲突）

**设计细节:**

提取方案（纯函数提取，不改行为）：

1. **`reject-helpers.ts`** — `RejectParams` interface + `rejectAndReply()` + `buildRejectCtx()` + `applyPluginAdjustments()`
   - 从 failover-loop.ts 提取 ~100 行辅助函数
   - 多处调用的 reject 逻辑集中管理

2. **`iteration-setup.ts`** — `buildIterationSetup()` + `IterationSetupResult` + `resolveUpstreamPath()`
   - 当前已在 failover-loop.ts 中作为导出函数，仅文件搬迁
   - resolveUpstreamPath() 一并迁入

3. **`resilience-processor.ts`** — `processResilienceResult()` + `ResilienceResultAction`
   - 当前已在 failover-loop.ts 中作为导出函数，仅文件搬迁

4. **`failover-loop.ts` 保留内容** — `precomputeFailoverTargets()` + `executeFailoverLoop()` + 类型导出
   - 从 843 行降到 ~400 行（两个核心函数 + 循环控制逻辑）

---

## Dependency Graph & Wave Schedule

```
BG1 (buildApp拆分) ─┐
                     ├──→ BG4 (failover提取)
BG2 (hook合并) ──────┘
                     
BG3 (stream映射表) ← 独立，与 BG1/BG2 并行

| Wave | Groups | 说明 |
|------|--------|------|
| Wave 1 | BG1, BG2, BG3 | 三组独立，全部可并行 |
| Wave 2 | BG4 | 依赖 BG2（hook-registry 合并避免冲突） |
```

**并行约束:**
- Wave 1 最多 3 个 subagent 并行
- BG4 必须等 BG2 完成（都改 register-hooks.ts 和 pipeline 相关文件）

---

## 验证策略

### 每个 Task 完成后必须通过

```bash
cd router && npx vitest run          # 全部测试通过
cd router && npm run build           # 编译通过
cd router && npm run lint            # lint 零警告
```

### 提交前回归

```bash
npm run test                         # 根目录全量测试
cd router && npm run build           # 编译产物正确
```

---

## Risk Assessment

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| buildApp 拆分引入循环依赖 | 低 | 中 | app/ 目录不 import proxy/ 内部模块，通过 container 解耦 |
| stream-oa2ant 映射表丢失边界 case | 中 | 高 | 行为表测试覆盖所有状态转换 |
| failover-loop 提取后导入路径变更导致运行时错误 | 低 | 高 | 提取后立即跑全量测试 |
| hook-registry 合并影响 Admin API | 低 | 中 | getAllHooks() 接口与旧 hookRegistry.getAll() 签名一致 |
