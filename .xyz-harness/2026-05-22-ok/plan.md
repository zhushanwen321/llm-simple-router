---
verdict: pass
---

# Pipeline + Extension 架构深化 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use xyz-harness-subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 渐进式重构 Pipeline Hook 架构，解决 metadata 无类型、控制流分裂、模块深度不足 3 个结构性缺陷。

**Architecture:** 4 Phase 渐进迁移：Phase 1（基础 deps 结构化 + 双注册表合并）→ Phase 2（控制流统一 + TransportExecutor 提取）→ Phase 3（Format 子系统清理）→ Phase 4（Admin 工具函数）。纯后端，无前端改动。

**Tech Stack:** TypeScript, Fastify, better-sqlite3, Vitest

---

## File Structure

| File | Type | Group | Description |
|------|------|-------|-------------|
| `proxy/pipeline/types.ts` | modify | BG1a | PipelineContext + PipelineDeps + PipelineMetaMap 接口 |
| `proxy/pipeline/context.ts` | modify | BG1a | createPipelineContext 工厂更新 |
| `proxy/handler/failover-loop.ts` | modify | BG1a, BG2 | metadata.set → ctx.deps + 迭代级字段；控制流统一 |
| `core/errors.ts` | modify | BG2 | ProviderSwitchNeeded 标记 @deprecated |
| `proxy/orchestration/resilience.ts` | modify | BG2 | ResilienceResult.action + 消除 throw |
| `proxy/transport/transport-executor.ts` | create | BG2 | TransportExecutor 深模块 |
| `proxy/hooks/builtin/transport-execute.ts` | modify | BG1b, BG2 | metadata.get → ctx.deps/ctx.field；简化为委托 |
| `proxy/format/register-converters.ts` | create | BG3 | 6 对 converter 注册 |
| `proxy/format/types.ts` | modify | BG3 | 删除 createConverter 工厂 |
| `proxy/format/registry.ts` | modify | BG3 | 新增 3 个高阶方法 |
| `proxy/transform/stream-transform-base.ts` | modify | BG3 | 映射表模式支持 |
| `proxy/transform/stream-oa2ant.ts` | modify | BG3 | 迁移为映射表模式 |
| `admin/utils.ts` | create | BG4 | 4 个 CRUD 工具函数 |
| `admin/constants.ts` | delete | BG4 | 纯透传层删除 |
| `admin/providers.ts` | modify | BG4 | 使用工具函数 |
| `admin/retry-rules.ts` | modify | BG4 | 使用工具函数 |
| `admin/groups.ts` | modify | BG4 | 使用工具函数 |
| `admin/router-keys.ts` | modify | BG4 | 使用工具函数 |
| `admin/schedules.ts` | modify | BG4 | 使用工具函数 |
| `admin/monitor.ts` | modify | BG1a | 查询来源改为 proxyPipeline |
| `proxy/pipeline/pipeline.ts` | modify | BG1a | getHookChain() 增强 |
| `proxy/pipeline/register-hooks.ts` | modify | BG1a | 删除 hookRegistry.register 调用 |
| `proxy/pipeline/hook-registry.ts` | delete | BG1a | 双注册表之一删除 |
| `router/src/index.ts` | modify | BG3 | 导入简化 |
| `proxy/hooks/builtin/allowed-models.ts` | modify | BG1b | metadata.get → ctx.deps/ctx.field |
| `proxy/hooks/builtin/api-key-decrypt.ts` | modify | BG1b | metadata.get → ctx.deps/ctx.field |
| `proxy/hooks/builtin/cache-estimation.ts` | modify | BG1b | metadata.get → ctx.deps/ctx.field |
| `proxy/hooks/builtin/client-detection.ts` | modify | BG1b | metadata.get → ctx.deps/ctx.field |
| `proxy/hooks/builtin/enhancement-preprocess.ts` | modify | BG1b | metadata.get → ctx.deps/ctx.field |
| `proxy/hooks/builtin/error-logging.ts` | modify | BG1b | metadata.get → ctx.deps/ctx.field |
| `proxy/hooks/builtin/format-transform.ts` | modify | BG1b | metadata.get → ctx.deps/ctx.field |
| `proxy/hooks/builtin/overflow-redirect.ts` | modify | BG1b | metadata.get → ctx.deps/ctx.field |
| `proxy/hooks/builtin/plugin-request.ts` | modify | BG1b | metadata.get → ctx.deps/ctx.field |
| `proxy/hooks/builtin/provider-patches.ts` | modify | BG1b | metadata.get → ctx.deps/ctx.field |
| `proxy/hooks/builtin/request-logging.ts` | modify | BG1b | metadata.get → ctx.deps/ctx.field |
| `proxy/hooks/builtin/route-resolve.ts` | modify | BG1b | metadata.get → ctx.deps/ctx.field |
| `proxy/hooks/builtin/stream-timeout.ts` | modify | BG1b | metadata.get → ctx.deps/ctx.field |
| `proxy/hooks/builtin/usage-record.ts` | modify | BG1b | metadata.get → ctx.deps/ctx.field |

---

## Task List

| # | Task | Type | Depends on | Group |
|---|------|------|-----------|-------|
| 1 | PipelineDeps + PipelineMetaMap 接口定义 | backend | — | BG1a |
| 2 | createPipelineContext 工厂更新 | backend | 1 | BG1a |
| 3 | failover-loop metadata 迁移 + 迭代级字段 | backend | 1, 2 | BG1a |
| 5 | 双注册表合并 | backend | — | BG1a |
| 4 | 15 个 builtin hook metadata 迁移 | backend | 1, 2, 5 | BG1b |
| 6 | ResilienceResult.action + 消除 throw | backend | — | BG2 |
| 7 | failover-loop 控制流统一 | backend | 3, 6 | BG2 |
| 8 | TransportExecutor 类提取 | backend | 4 | BG2 |
| 9 | transport-execute hook 简化为委托 | backend | 8 | BG2 |
| 17 | ADR-0005 + ADR-0013 更新 | docs | 7 | BG2 |
| 10 | format/converters/ 合并为 register-converters.ts | backend | — | BG3 |
| 11 | FormatRegistry 高阶方法 | backend | — | BG3 |
| 12 | BaseSSETransform 映射表模式 | backend | — | BG3 |
| 13 | stream-oa2ant.ts 迁移为映射表模式 | backend | 12 | BG3 |
| 14 | admin/utils.ts 工具函数 | backend | — | BG4 |
| 15 | Admin CRUD 文件应用工具函数 | backend | 14 | BG4 |
| 16 | admin/constants.ts 删除 + 导入修复 | backend | 15 | BG4 |

---

## Execution Groups

#### BG1a: PipelineContext 核心架构 + 双注册表合并

**Description:** FR-1 核心架构变更（PipelineContext 接口 + context 工厂 + failover-loop 迁移）和 FR-6（双注册表合并）。不含 15 个 hook 的批量迁移（在 BG1b）。

**Tasks:** 1, 2, 3, 5

**Files (预估):** 7 个文件（0 create + 7 modify）

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| Agent | general-purpose → general-purpose → general-purpose |
| Model | 按 taskComplexity 自动选择 |
| 注入上下文 | spec FR-1 + FR-6，metadata 依赖清单（infrastructure-scan.md §3） |
| 读取文件 | proxy/pipeline/types.ts, proxy/pipeline/context.ts, proxy/pipeline/pipeline.ts, proxy/pipeline/register-hooks.ts, proxy/pipeline/hook-registry.ts, proxy/handler/failover-loop.ts, admin/monitor.ts |
| 修改/创建文件 | proxy/pipeline/types.ts, proxy/pipeline/context.ts, proxy/handler/failover-loop.ts, proxy/pipeline/pipeline.ts, proxy/pipeline/register-hooks.ts, admin/monitor.ts, proxy/pipeline/hook-registry.ts (delete) |

**Execution Flow (BG1a 内部):**

Task 1 (接口定义):
1. TDD coder: 写类型测试（验证 PipelineContext.deps 和 PipelineMetaMap 类型约束）
2. Executor: 实现 PipelineDeps + PipelineMetaMap 接口，修改 PipelineContext
3. Reviewer: spec 合规检查

Task 2 (context 工厂):
1. TDD coder: 写 createPipelineContext 测试
2. Executor: 更新 createPipelineContext 初始化逻辑
3. Reviewer: spec 合规检查

Task 3 (failover-loop):
1. TDD coder: 写 failover-loop 集成测试（验证 deps 注入 + 迭代级字段）
2. Executor: 迁移 metadata.set → ctx.deps + 迭代级字段赋值
3. Reviewer: spec 合规检查

Task 5 (双注册表):
1. TDD coder: 写 monitor API 测试
2. Executor: 删除 hook-registry.ts，修改 pipeline.ts getHookChain()，更新 register-hooks.ts 和 monitor.ts
3. Reviewer: spec 合规检查

**Dependencies:** 无

---

#### BG1b: 15 个 builtin hook metadata 迁移

**Description:** FR-1 的批量机械替换部分。15 个 hook 文件统一将 metadata.get("xxx") as T 迁移为 ctx.deps.xxx / ctx.field。纯机械替换，风险低但文件数多。

**Tasks:** 4

**Files (预估):** 15 个文件（全部 modify）

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| Agent | general-purpose → general-purpose → general-purpose |
| Model | 按 taskComplexity 自动选择（low，纯机械替换） |
| 注入上下文 | spec FR-1，metadata 依赖清单，PipelineDeps 接口定义 |
| 读取文件 | proxy/pipeline/types.ts（已更新的 PipelineContext 接口） |
| 修改/创建文件 | proxy/hooks/builtin/allowed-models.ts, api-key-decrypt.ts, cache-estimation.ts, client-detection.ts, enhancement-preprocess.ts, error-logging.ts, format-transform.ts, overflow-redirect.ts, plugin-request.ts, provider-patches.ts, request-logging.ts, route-resolve.ts, stream-timeout.ts, transport-execute.ts, usage-record.ts |

**Execution Flow (BG1b 内部):**

Task 4 (15 hooks):
1. TDD coder: 批量测试（验证每个 hook 不再使用 metadata.get("db") 等固定依赖）
2. Executor: 逐 hook 迁移 metadata.get → ctx.deps/ctx.field
3. Reviewer: spec 合规检查

**Dependencies:** BG1a（需要 PipelineDeps 接口已定义）

---

#### BG2: 控制流统一 + TransportExecutor

**Description:** FR-2 和 FR-3。依赖 FR-1 的 PipelineDeps 结构。控制流从异常改为返回值，transport-execute hook 提取为 TransportExecutor 深模块。

**Tasks:** 6, 7, 8, 9

**Files (预估):** 8 个文件（1 create + 7 modify）

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| Agent | general-purpose → general-purpose → general-purpose |
| Model | 按 taskComplexity 自动选择 |
| 注入上下文 | spec FR-2 + FR-3 |
| 读取文件 | proxy/orchestration/resilience.ts, proxy/handler/failover-loop.ts, proxy/hooks/builtin/transport-execute.ts, core/errors.ts, docs/adr/0005-pipeline-hook-format-adapter.md, docs/adr/0013-failover-control-flow-return-value.md |
| 修改/创建文件 | proxy/orchestration/resilience.ts, proxy/handler/failover-loop.ts, core/errors.ts, proxy/transport/transport-executor.ts, proxy/hooks/builtin/transport-execute.ts, docs/adr/0005-pipeline-hook-format-adapter.md, docs/adr/0013-failover-control-flow-return-value.md |

**Execution Flow (BG2 内部):**

Task 6 (ResilienceResult):
1. TDD coder: 写 resilience 测试（验证 action 字段 + 无 throw）
2. Executor: 修改 ResilienceResult 接口，更新 resilience.ts 逻辑
3. Reviewer: spec 合规检查

Task 7 (failover-loop 控制流):
1. TDD coder: 写 failover 集成测试（验证 ProviderSwitchNeeded catch 删除 + action 驱动）
2. Executor: 删除 ProviderSwitchNeeded catch，改由 resilienceResult.action 驱动
3. Reviewer: spec 合规检查

Task 8 (TransportExecutor):
1. TDD coder: 写 TransportExecutor 单元测试（mock orchestrator）
2. Executor: 从 transport-execute.ts 提取 TransportExecutor 类
3. Reviewer: spec 合规检查

Task 9 (hook 简化):
1. TDD coder: 写 hook 委托测试
2. Executor: 将 transport-execute hook 简化为 ~10 行委托
3. Reviewer: spec 合规检查

Task 17 (ADR 更新):
1. Executor: 更新 ADR-0005（控制流描述改为 "FailoverLoop 检查 resilienceResult.action"）
2. Executor: 更新 ADR-0013（ProviderSwitchNeeded 兼容降级说明）
3. Reviewer: 文档一致性检查

**Dependencies:** BG1a（需要 PipelineDeps 结构）

---

#### BG3: Format 子系统清理

**Description:** FR-4a/b/c。相对独立，不依赖 BG1/BG2。converters 合并、Registry 深化、BaseSSETransform 双模式。

**Tasks:** 10, 11, 12, 13

**Files (预估):** 7 个文件（1 create + 4 modify + 2 delete）

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| Agent | general-purpose → general-purpose → general-purpose |
| Model | 按 taskComplexity 自动选择 |
| 注入上下文 | spec FR-4 |
| 读取文件 | proxy/format/converters/*.ts, proxy/format/registry.ts, proxy/format/types.ts, proxy/transform/stream-transform-base.ts, proxy/transform/stream-oa2ant.ts, router/src/index.ts |
| 修改/创建文件 | proxy/format/register-converters.ts, proxy/format/types.ts, proxy/format/registry.ts, proxy/transform/stream-transform-base.ts, proxy/transform/stream-oa2ant.ts, router/src/index.ts, proxy/format/converters/ (delete) |

**Execution Flow (BG3 内部):**

Task 10 (converters 合并):
1. TDD coder: 写 converter 注册测试
2. Executor: 创建 register-converters.ts，删除 converters/ 目录，更新 index.ts 导入
3. Reviewer: spec 合规检查

Task 11 (Registry 深化):
1. TDD coder: 写高阶方法测试
2. Executor: 新增 transformRequestBody/transformResponseBody/transformErrorBody
3. Reviewer: spec 合规检查

Task 12 (BaseSSETransform):
1. TDD coder: 写映射表模式测试
2. Executor: 扩展基类支持映射表构造
3. Reviewer: spec 合规检查

Task 13 (stream-oa2ant):
1. TDD coder: 写流式转换功能测试
2. Executor: 将 stream-oa2ant.ts 迁移为映射表模式
3. Reviewer: spec 合规检查

**Dependencies:** 无（相对独立）

---

#### BG4: Admin 工具函数

**Description:** FR-5。完全独立，不依赖其他 Group。提取工具函数并应用到 5 个 CRUD 文件。

**Tasks:** 14, 15, 16

**Files (预估):** 8 个文件（1 create + 6 modify + 1 delete）

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| Agent | general-purpose → general-purpose → general-purpose |
| Model | 按 taskComplexity 自动选择 |
| 注入上下文 | spec FR-5 |
| 读取文件 | admin/providers.ts, admin/retry-rules.ts, admin/groups.ts, admin/router-keys.ts, admin/schedules.ts, admin/constants.ts |
| 修改/创建文件 | admin/utils.ts, admin/providers.ts, admin/retry-rules.ts, admin/groups.ts, admin/router-keys.ts, admin/schedules.ts, admin/constants.ts (delete) |

**Execution Flow (BG4 内部):**

Task 14 (utils):
1. TDD coder: 写工具函数测试
2. Executor: 创建 admin/utils.ts
3. Reviewer: spec 合规检查

Task 15 (应用 utils):
1. TDD coder: 写 CRUD 集成测试
2. Executor: 逐文件应用工具函数
3. Reviewer: spec 合规检查

Task 16 (删除 constants):
1. TDD coder: 写导入修复验证
2. Executor: 删除 constants.ts，修复所有导入
3. Reviewer: spec 合规检查

**Dependencies:** 无（完全独立）

---

## Dependency Graph & Wave Schedule

```
  BG1a (core arch) ──→ BG1b (15 hooks)
         │
         ├──→ BG2 (control flow+executor+ADR)
         │
         ├──→ BG3 (format cleanup)      [独立]
         │
         └──→ BG4 (admin utils)         [独立]
```

| Wave | Groups | 说明 |
|------|--------|------|
| Wave 1 | BG1a | 核心架构变更，无依赖 |
| Wave 2 | BG1b | 依赖 BG1a（需要接口定义） |
| Wave 3 | BG2, BG3, BG4 | BG2 依赖 BG1a；BG3/BG4 独立可并行 |

**并行约束:**
- Wave 1: 单 Group（BG1a），串行执行 4 个 Task
- Wave 2: 单 Group（BG1b），串行执行 1 个 Task（15 个 hook 批量迁移）
- Wave 3: BG2 必须等 BG1a 完成（BG1b 与 BG2 无依赖关系但建议串行避免文件冲突）；BG3 和 BG4 可与 BG2 并行（受 3 并发限制）
- 同一文件不允许多个 subagent 同时修改

---

## 测试策略

### 单元测试（每个 Task）
- PipelineDeps 类型约束测试
- createPipelineContext 初始化测试
- TransportExecutor mock 测试
- FormatRegistry 高阶方法测试
- admin/utils 工具函数测试

### 集成测试（每个 Phase 完成后）
- 代理请求完整链路（OpenAI + Anthropic 格式）
- Failover 重试 + 切换路径
- 流式响应转换（6 个转换器）
- Admin CRUD API

### 回归测试
- 全量测试：`npm test`
- lint: `npm run lint`
- 类型检查: `npx tsc --noEmit`
