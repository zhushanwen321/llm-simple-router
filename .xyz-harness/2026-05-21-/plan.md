---
verdict: pass
---

# Pipeline 全量接管代理请求执行 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use xyz-harness-subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 failover-loop.ts 中内联的 L2 执行逻辑迁移到 pipeline hook，使 pipeline 成为单次 target 执行的真正驱动引擎。

**Architecture:** 三层分离——L1 路由预计算（循环外）→ L2 pipeline emit 序列（循环内）→ L3 循环控制（外壳）。6 个新内置 hook 承担当前内联在 failover-loop 中的核心步骤，4 个已有 hook 从死代码变为实际执行。failover-loop.ts 从 612 行缩减为纯循环控制壳（≤150 行）。

**Tech Stack:** TypeScript, Fastify, ProxyPipeline hook 系统

---

## File Structure

| File | Type | Group | Description |
|------|------|-------|-------------|
| `router/src/proxy/hooks/builtin/route-resolve.ts` | create | BG1 | builtin:route-resolve hook（从候选列表选 target + 查 provider） |
| `router/src/proxy/hooks/builtin/format-transform.ts` | create | BG1 | builtin:format-transform hook（resolveUpstreamPath 逻辑） |
| `router/src/proxy/hooks/builtin/api-key-decrypt.ts` | create | BG1 | builtin:api-key-decrypt hook（API key 解密 + 请求级缓存） |
| `router/src/proxy/hooks/builtin/transport-execute.ts` | create | BG1 | builtin:transport-execute hook（buildTransportFn + orchestrator.handle, priority 300） |
| `router/src/proxy/hooks/builtin/stream-timeout.ts` | create | BG1 | builtin:stream-timeout hook（stream_abort SSE 错误事件） |
| `router/src/proxy/hooks/builtin/usage-record.ts` | create | BG1 | builtin:usage-record hook（usageWindowTracker.recordRequest） |
| `router/src/proxy/pipeline/pipeline.ts` | modify | BG1 | emit() 增加 Hook 异常降级逻辑（Constraint 8） |
| `router/src/proxy/pipeline/register-hooks.ts` | modify | BG1 | 注册 6 个新 hook |
| `router/src/proxy/pipeline/context.ts` | modify | BG2 | 新增 metadata 通道字段（cachedTargets, excludeTargets 等） |
| `router/src/proxy/pipeline/types.ts` | modify | BG1 | PipelineHook 接口新增 core?: boolean 字段 |
| `router/src/proxy/handler/failover-loop.ts` | rewrite | BG2 | L1 预计算 + L3 循环壳，删除所有 L2 内联逻辑 |
| `router/src/proxy/handler/create-proxy-handler.ts` | modify | BG2 | 无结构性改动，仅确认 pre_route emit 正常 |
| `tests/proxy/pipeline-hooks.test.ts` | create | BG1 | 新 hook 单元测试 |
| `tests/proxy/pipeline-emit.test.ts` | create | BG2 | emit 序列集成测试 |
| `tests/proxy/failover-loop-slim.test.ts` | create | BG2 | 缩减后 failover-loop 的循环控制测试 |

---

## Task List

| # | Task | Type | Depends on | Group |
|---|------|------|-----------|-------|
| 1 | Pipeline.emit 异常降级 | backend | — | BG1 |
| 2 | builtin:route-resolve hook | backend | — | BG1 |
| 3 | builtin:format-transform hook | backend | — | BG1 |
| 4 | builtin:api-key-decrypt hook | backend | — | BG1 |
| 5 | builtin:transport-execute hook | backend | 3, 4 | BG1 |
| 6 | builtin:stream-timeout + usage-record hooks | backend | — | BG1 |
| 7 | 注册新 hook 到 register-hooks.ts | backend | 2-6 | BG1 |
| 8 | PipelineContext 扩展 + failover-loop 重写 | backend | 1, 7 | BG2 |
| 9 | 端到端等价性验证 | backend | 8 | BG3 |

---

## Execution Groups

#### BG1: Pipeline 基础设施 + 6 个新 hook

**Description:** 构建 pipeline 的异常降级机制和 6 个内置 hook。这些 hook 是自包含的——每个 hook 接收 PipelineContext，执行特定逻辑，写入 ctx 字段。它们不依赖 failover-loop 的重写。

**Tasks:** Task 1, Task 2, Task 3, Task 4, Task 5, Task 6, Task 7

**Files (预估):** 13 个文件（7 create + 3 modify + 1 test + 2 test-create）

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| Agent | general-purpose → general-purpose → general-purpose |
| Model | 按 taskComplexity 自动选择（executor: high、tdd-coder: medium、reviewer: medium） |
| 注入上下文 | spec FR3（核心步骤 hook 列表）、Constraint 8（Hook 异常降级）、spec FR5（PipelineContext 字段映射） |
| 读取文件 | `router/src/proxy/pipeline/types.ts`, `router/src/proxy/pipeline/pipeline.ts`, `router/src/proxy/pipeline/context.ts`, `router/src/proxy/hooks/builtin/*.ts`（参考已有 hook 模式）, `router/src/proxy/handler/failover-loop.ts`（提取逻辑）, `router/src/proxy/transport/transport-fn.ts`, `router/src/proxy/orchestration/orchestrator.ts` |
| 修改/创建文件 | 见 File Structure 中 Group=BG1 的文件 |

**Execution Flow (BG1 内部):** 串行派遣，每个 Task 走完整 subagent 链后再开始下一个 Task。Task 2/3/4/6 互相独立，但串行更安全（共享 pipeline.ts 修改）。

  Task 1 (pipeline emit 降级):
    1. general-purpose (read xyz-harness-test-driven-development + xyz-harness-backend-dev) → 写失败测试
    2. general-purpose (read xyz-harness-backend-dev) → 修改 pipeline.ts emit()
    3. general-purpose (read xyz-harness-expert-reviewer) → spec 合规检查

  Task 2-6 (各 hook):
    同上模式，每个 hook 一个 TDD 循环

  Task 7 (注册):
    1. general-purpose → 修改 register-hooks.ts，运行 npm test 验证注册

**Dependencies:** 无

**设计细节:**

Task 1 — Pipeline.emit 异常降级（Constraint 8）:

当前 `emit()` 是简单的 for 循环。需要修改为：
- PipelineAbort 异常：直接 throw（短路）
- priority 0-99 的核心 hook 异常：直接 throw（骨架不可降级）
- priority ≥100 的 hook 异常：catch + `request.log.error()` + 继续执行后续 hook

```typescript
async emit(phase: HookPhase, ctx: PipelineContext): Promise<void> {
  const hooks = this.hooksByPhase.get(phase) ?? [];
  for (const hook of hooks) {
    try {
      await hook.execute(ctx);
    } catch (e: unknown) {
      if (e instanceof PipelineAbort) throw e;
      // 核心 hook (priority < 100 或 core === true) 异常直接传播
      if (hook.priority < 100 || (hook as PipelineHook & { core?: boolean }).core === true) throw e;
      // 非核心 hook 异常降级：记录日志但继续执行
      ctx.request.log.error(
        { err: e, hook: hook.name, phase },
        "Pipeline hook error (degraded)"
      );
    }
  }
}
```

PipelineHook 接口新增可选 `core?: boolean` 字段：
```typescript
interface PipelineHook {
  name: string;
  phase: HookPhase;
  priority: number;
  core?: boolean;  // true = 核心骨架 hook，异常不可降级
  execute(ctx: PipelineContext): void | Promise<void>;
}
```

Task 2 — builtin:route-resolve:

从 failover-loop.ts L185-L210 提取。接收 `ctx.metadata.get("cachedTargets")` 和 `ctx.metadata.get("excludeTargets")`，调用 `filterExcluded()` 取第一个 target，`getProviderById()` 查 provider，校验 is_active，写入 ctx.resolved + ctx.provider。

关键依赖：`resolveMapping`（L1 已完成）, `filterExcluded`, `getProviderById`

Task 3 — builtin:format-transform:

从 failover-loop.ts L206-210 + L523-560（resolveUpstreamPath 函数）提取。读取 ctx.resolved（由 route-resolve 设置），执行格式转换，写入 ctx.body + ctx.effectiveApiType + ctx.effectiveUpstreamPath。

关键依赖：FormatRegistry.needsTransform/transformRequest

Task 4 — builtin:api-key-decrypt:

从 failover-loop.ts L228-234 提取。读取 ctx.provider，从 `ctx.metadata.get("encryptionKey")` 获取加密密钥，使用 `ctx.metadata.get("decryptedApiKeys")` 缓存，解密后写入 `ctx.metadata.set("apiKey", apiKey)`。

Task 5 — builtin:transport-execute:

从 failover-loop.ts L241-283 提取。**Priority 300** — 确保在 format-transform(0)、api-key-decrypt(1)、provider-patches(100)、plugin-request(250) 全部完成后，以最终状态的 body 和 headers 构建 transport。

这是最复杂的 hook：
- 读取 ctx.resolved, ctx.provider, ctx.effectiveApiType, ctx.effectiveUpstreamPath
- 从 metadata 获取 apiKey
- 执行 adapter.beforeSendProxy()
- 创建 stream transform（formatRegistry.createStreamTransform）
- 创建 response transform（非流式格式转换）
- buildTransportFn()
- orchestrator.handle()
- 写入 ctx.transportResult + ctx.resilienceResult + ctx.clientRequest + ctx.upstreamRequest

此 hook 需要 access 很多 deps，通过 `ctx.metadata` 传入：orchestrator, tracker, formatRegistry, adapter, enhancementConfig, proxyAgentFactory 等。

**重要：注册时必须设置 `core: true`（参见 Constraint 8）**，因为 transport-execute 是系统骨架 hook 但 priority 300 超出 0-99 阈值。`core: true` 确保 emit() 中其非 PipelineAbort 异常正确传播而非被降级。

Task 6 — builtin:stream-timeout + usage-record:

两个简单 hook，各自 < 20 行。
- stream-timeout：从 failover-loop.ts L398-410 提取。检查 ctx.resilienceResult.result.kind === "stream_abort"，写入 SSE 错误事件。
- usage-record：从 failover-loop.ts L416 提取。调用 usageWindowTracker.recordRequest()。

Task 7 — 注册到 register-hooks.ts:

将 6 个新 hook 加入 ALL_HOOKS 数组。transport-execute 必须以 `core: true` 标记注册。同时在 `create-proxy-handler.ts` 的 L1 预计算阶段，将 cachedTargets/excludeTargets 等注入 ctx.metadata。

---

#### BG2: Failover-loop 重写 + PipelineContext 扩展

**Description:** 扩展 PipelineContext 以支持 L1→L2 的数据传递，然后将 failover-loop.ts 从 612 行的 god function 重写为 L1 预计算 + L3 循环控制壳。循环体内的 L2 逻辑完全由 pipeline emit 替代。

**Tasks:** Task 8

**Files (预估):** 4 个文件（2 modify + 2 test-create）

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| Agent | general-purpose → general-purpose → general-purpose |
| Model | 按 taskComplexity 自动选择（executor: high） |
| 注入上下文 | spec FR1（三层架构）、FR2（pipeline 驱动 L2）、FR4（消除内联重复）、FR5（ctx 字段填充）、FR6（on_error 接入）、AC2（≤250 行）、AC5（10 种场景等价） |
| 读取文件 | `router/src/proxy/handler/failover-loop.ts`（全部）, `router/src/proxy/handler/create-proxy-handler.ts`（全部）, `router/src/proxy/pipeline/types.ts`, `router/src/proxy/pipeline/context.ts`, BG1 产出的所有新 hook 文件 |
| 修改/创建文件 | `failover-loop.ts`（rewrite）, `context.ts`（modify）, `types.ts`（modify if needed） |

**Execution Flow (BG2 内部):**

  Task 8:
    1. general-purpose (read xyz-harness-backend-dev) → 重写 failover-loop.ts
    2. general-purpose → 运行 npm test，修复所有回归
    3. general-purpose (read xyz-harness-expert-reviewer) → spec 合规检查

**Dependencies:** BG1（所有 6 个 hook + pipeline.ts 修改完成）

**设计细节:**

Task 8 — 重写 failover-loop.ts:

目标结构（≤150 行）：

```
executeFailoverLoop(ctx, errors, deps, upstreamPath, adapter)
  // L1 预计算（循环前，~60 行）
  resolveMapping → computeModalityRedirect → expandOverflow → allowed_models 过滤
  注入 cachedTargets/overflowIndices 到 ctx.metadata
  工具错误提取

  // while(true) 循环壳（L3，~80 行）
  while (true) {
    reply.raw.destroyed 检查
    迭代上限检查
    logId/rootLogId 管理
    注入 excludeTargets/iterationSnapshot 到 ctx.metadata

    try {
      await proxyPipeline.emit("post_route", ctx)
      await proxyPipeline.emit("pre_transport", ctx)
      // transport-execute hook 内部调用 orchestrator
      await proxyPipeline.emit("post_response", ctx)

      // L3: 检查结果，决定 continue 或 return
      // 流式内容日志、failover 判断、响应发送
    } catch (ProviderSwitchNeeded) {
      excludeTargets.push(ctx.resolved)
      continue
    } catch (PipelineAbort) {
      return reply.code(e.statusCode).send(e.body)
    } catch (SemaphoreQueueFullError / SemaphoreTimeoutError) {
      await proxyPipeline.emit("on_error", ctx)
      return rejectAndReply(...)
    } catch (AbortError) {
      return reply
    } catch (unknown) {
      await proxyPipeline.emit("on_error", ctx)
      return reply.code(502).send(...)
    }
  }
```

删除的 import：applyProviderPatches, logResilienceResult, collectTransportMetrics, buildTransportFn, applyPluginAdjustments, resolveUpstreamPath 相关的，以及 plugin-bridge/transform 直接依赖。

保留的 import：resolveMapping, filterExcluded, computeModalityRedirectTargets, expandOverflowTargets, ProviderSwitchNeeded, PipelineAbort, randomUUID, getProviderById（L1 用）等。

PipelineContext 扩展（context.ts 或 types.ts）:
- 无需新增 ctx 字段——当前 PipelineContext 已有 resolved, provider, effectiveUpstreamPath, effectiveApiType, transportResult, resilienceResult, clientRequest, upstreamRequest, injectedHeaders 等所有必要字段
- L1→L2 的数据传递通过 ctx.metadata 完成：
  - `"cachedTargets"`: Target[]
  - `"excludeTargets"`: Target[]
  - `"overflowIndices"`: Set<number>
  - `"resolveResult"`: resolveMapping 的返回值
  - `"precomputeSnapshot"`: PipelineSnapshot
  - `"decryptedApiKeys"`: Map<string, string>
  - `"encryptionKey"`: string
  - `"enhancementConfig"`: EnhancementConfig
  - `"errors"`: ProxyErrorFormatter
  - `"deps"`: FailoverLoopDeps
  - `"concurrencyOverride"`: ConcurrencyOverride | undefined
  - `"effectiveMappingReason"`: MappingReason

---

#### BG3: 端到端等价性验证

**Description:** 运行完整的测试套件，确保所有 AC5 中的 10 种请求场景行为等价。修复回归。

**Tasks:** Task 9

**Files (预估):** 0-2 个文件（仅修复）

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| Agent | general-purpose |
| Model | 按 taskComplexity 自动选择（medium） |
| 注入上下文 | spec AC1-AC8 全部验收标准 |
| 读取文件 | 所有 BG1/BG2 产出文件 |
| 修改/创建文件 | 仅修复 |

**Execution Flow (BG3 内部):**

  Task 9:
    1. general-purpose → npm test + npm run build，修复所有回归
    2. general-purpose (read xyz-harness-expert-reviewer) → 最终 spec 合规检查

**Dependencies:** BG2

---

## Dependency Graph & Wave Schedule

```
BG1 (hooks + pipeline) ──→ BG2 (failover-loop rewrite) ──→ BG3 (e2e verification)
```

| Wave | Groups | 说明 |
|------|--------|------|
| Wave 1 | BG1 | Pipeline 基础设施 + 6 个新 hook，无依赖 |
| Wave 2 | BG2 | Failover-loop 重写，依赖 BG1 的 hook 和 pipeline.ts 修改 |
| Wave 3 | BG3 | 端到端验证，依赖 BG2 的完整集成 |

---

## Self-Review

**1. Spec coverage:**

| Spec Section | Task |
|-------------|------|
| FR1 三层架构 | Task 8 (L1+L3 in failover-loop, L2 via pipeline) |
| FR2 Pipeline 驱动 L2 | Task 8 (emit 序列) |
| FR3 核心步骤 hook | Task 2-6 |
| FR4 消除内联重复 | Task 8 |
| FR5 PipelineContext 字段 | Task 2-6 (写入), Task 8 (传递) |
| FR6 on_error 接入 | Task 8 |
| FR7 on_stream_event 就绪 | 不需要 task（已就绪） |
| AC1 pipeline 全量接管 | Task 8 |
| AC2 failover-loop ≤150行 | Task 8 |
| AC3 已有 hook 激活 | Task 8 (emit 触发) |
| AC4 核心 hook 可执行 | Task 2-5 |
| AC5 功能等价 10 场景 | Task 9 |
| AC6 日志指标等价 | Task 9 |
| AC7 现有测试通过 | Task 9 |
| AC8 pipeline 扩展 | Task 8 (priority 排序) |
| Constraint 8 Hook 异常降级 | Task 1 |

**2. Placeholder scan:** 无 TBD/TODO。

**3. Type consistency:** PipelineContext 字段名与 types.ts 定义一致。ctx.metadata key 使用字符串常量。

---

## ADR Evaluation

Phase 1 已创建 ADR 0011（核心步骤作为 Pipeline Hook）。Plan 中无新增满足三条件的决策。
