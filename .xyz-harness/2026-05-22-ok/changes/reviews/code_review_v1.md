---
review:
  type: code_review
  round: 1
  timestamp: "2026-05-22T15:00:00"
  target: "router/src/ (pipeline + extension architecture deepening diff, 49 files)"
  verdict: fail
  summary: "编码评审完成，第1轮，2条MUST FIX，需修改后重审"

statistics:
  total_issues: 12
  must_fix: 2
  must_fix_resolved: 0
  low: 7
  info: 3

issues:
  - id: 1
    severity: MUST_FIX
    location: "router/src/proxy/orchestration/resilience.ts:299"
    title: "resilience.ts 仍主动 throw ProviderSwitchNeeded，未迁移到 action 返回值"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 2
    severity: MUST_FIX
    location: "router/src/proxy/handler/failover-loop.ts:309"
    title: "failover-loop.ts 仍保留 ProviderSwitchNeeded catch 分支"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 3
    severity: LOW
    location: "router/src/core/errors.ts:35"
    title: "ProviderSwitchNeeded 类缺少 @deprecated 标记"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 4
    severity: LOW
    location: "router/src/admin/utils.ts"
    title: "AC-5 的 4 个工具函数 (partialBody/extractDefinedFields/notFound/conflict) 未实现"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 5
    severity: LOW
    location: "router/src/proxy/hooks/builtin/ (api-key-decrypt.ts, cache-estimation.ts, client-detection.ts, format-transform.ts, route-resolve.ts, usage-record.ts)"
    title: "6 个 hook 保留 metadata.get() 回退 + as 断言作为固定依赖兜底"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 6
    severity: LOW
    location: "router/src/proxy/handler/failover-loop.ts:278"
    title: "failover-loop.ts 失败处理中的 rr.action === 'failover'/'retry' 分支是死代码"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 7
    severity: LOW
    location: "router/src/proxy/format/converters/"
    title: "FR-4a converter 合并不完整：仅合并 2/6 文件，未创建 register-converters.ts"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 8
    severity: LOW
    location: "router/src/proxy/transport/transport-executor.ts (不存在)"
    title: "FR-3 TransportExecutor 类未实现，transport-execute hook 仍为内联逻辑"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 9
    severity: LOW
    location: "router/src/proxy/transform/stream-oa2ant.ts + stream-transform-base.ts"
    title: "FR-4c BaseSSETransform 映射表模式未实现，stream-oa2ant 未迁移"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 10
    severity: INFO
    location: "router/src/proxy/transform/stream-oa2ant.ts"
    title: "done=true 修复：stream-oa2ant 正确设置完成标记，防止流挂起"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 11
    severity: INFO
    location: "router/src/proxy/transform/stream-transform-base.ts + stream-ant2resp.ts + stream-bridge-chat2resp.ts"
    title: "pushResponsesSSE → pushAnthropicSSE 合并：安全去重（两者实现完全一致）"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 12
    severity: INFO
    location: "plan.md vs diff scope"
    title: "实现范围与 plan 的 4-Phase 范围不匹配：主要覆盖 Phase 1 + 部分 Phase 2/3/4"
    status: open
    raised_in_round: 1
    resolved_in_round: null
---

# 编码评审 v1

## 评审记录
- 评审时间：2026-05-22 15:00
- 评审类型：编码评审
- 评审对象：router/src/ (pipeline + extension architecture deepening diff, 49 files, +475/-477)
- 评审依据：spec.md (Pipeline + Extension 架构深化) + plan.md (4-Phase 实现计划)

---

## 检查维度摘要

### 1. Spec 合规（最高优先级）

| AC | 状态 | 说明 |
|----|------|------|
| AC-1 (PipelineDeps) | ⚠️ 部分通过 | deps+迭代字段已实现，但 6 个 hook 保留 metadata.get 回退 |
| AC-2 (控制流统一) | ❌ 不通过 | ProviderSwitchNeeded 仍为主动 failover 机制，throw+catch 链未移除 |
| AC-3 (TransportExecutor) | ❌ 未实现 | TransportExecutor 类不存在，hook 未简化 |
| AC-4a (converters合并) | ⚠️ 部分 | 2/6 文件合并，无 register-converters.ts |
| AC-4b (Registry深化) | ✅ 通过 | ConverterRegistry 类 + 高阶方法已实现 |
| AC-4c (BaseSSETransform) | ❌ 未实现 | 映射表模式未实现，stream-oa2ant 未迁移 |
| AC-5 (Admin工具函数) | ❌ 不通过 | 4 个工具函数部分未实现，admin CRUD 未重构 |
| AC-6 (双注册表合并) | ✅ 通过 | hook-registry.ts 已删除，pipeline.ts getAllHooks() 已实现 |

### 2. 代码质量
可读性好，命名清晰，错误处理覆盖基本路径。仅 `format-transform.ts` 的 `container!` 非空断言较脆弱（依赖 metadata 回退保证存在）。

### 3. 架构合规
总体符合 Pipeline Hook 架构方向。但控制流设计偏离 spec：spec 要求 action 返回值驱动，实现仍以 ProviderSwitchNeeded 异常为主。

### 4. 安全和性能
无明显安全问题。上游 header 脱敏逻辑保留。

### 5. 集成验证

#### Hook 注册验证
- ✅ `hook-registry.ts` 已删除，所有 hooks 只注册到 `proxyPipeline`
- ✅ `register-hooks.ts` 不再调用 `hookRegistry.register(hook)`
- ✅ `monitor.ts` 通过 `proxyPipeline.getAllHooks()` 查询

#### 数据流验证
- ✅ L1→L2 deps 通道：`failover-loop.ts` 一次性写入 `ctx.deps!`，15 hooks 通过 `ctx.deps?.xxx` 读取
- ✅ 迭代级字段：`ctx.excludeTargets` / `ctx.mappingReason` / `ctx.iterationStartTime` 等每次迭代重置
- ❌ 控制流分裂未完全解决：异常路径（ProviderSwitchNeeded throw/catch）+ 返回值路径（action）并存

#### PipelineDeps 字段对照
| deps 字段 | failover-loop 写入 | Hook 读取 | 状态 |
|-----------|-------------------|-----------|------|
| db | ctx.deps!.db = db | 15 hooks | ✅ |
| container | ctx.deps!.container = container | 多 hooks | ✅ |
| cachedTargets | ctx.deps!.cachedTargets = allTargets | route-resolve + transport-execute | ✅ |
| orchestrator | ctx.deps!.orchestrator = orchestrator | transport-execute | ✅ |
| matcher | ctx.deps!.matcher = matcher | error-logging, request-logging, transport-execute | ✅ |
| tracker | ctx.deps!.tracker = tracker | transport-execute | ✅ |

---

### 发现的问题

| # | 优先级 | 文件/位置 | 描述 | 修改建议 |
|---|--------|----------|------|---------|
| 1 | **MUST FIX** | `router/src/proxy/orchestration/resilience.ts:299` | **resilience.ts 仍主动 throw ProviderSwitchNeeded。** spec AC-2 明确要求 "resilience.ts 中无 ProviderSwitchNeeded throw"，但 `case "failover"` 处理分支在跨 provider 切换时仍抛出 `new ProviderSwitchNeeded(...)`。这意味着异常仍是主动的 failover 机制，而非废弃的遗留代码。 | 跨 provider failover 也应通过 ResilienceResult.action 返回值驱动，而非异常。当前 switch 的 `case "failover"` 分支应改为返回 `{ result: transportResult, action: "failover", ... }`，由 failover-loop 的 action 检查处理。 |
| 2 | **MUST FIX** | `router/src/proxy/handler/failover-loop.ts:309` | **failover-loop.ts 仍保留完整的 ProviderSwitchNeeded catch 分支。** spec AC-2 要求 "failover-loop.ts 中无 ProviderSwitchNeeded catch 分支"，且 Constraint #7 明确指出外部 plugin 的 ProviderSwitchNeeded 应传播到顶层。当前 catch 分支继续处理 failover，会静默消费外部 plugin 的异常。 | 删除 ProviderSwitchNeeded 的 catch 分支，将其 failover 逻辑迁移到 action-based 处理（上方已有 `failover/retry` 和 `stop+more targets` 两个 action 分支）。 |
| 3 | LOW | `router/src/core/errors.ts:35` | **ProviderSwitchNeeded 类缺少 @deprecated 标记。** AC-2 要求标记 `@deprecated` 并注明"迁移到 ResilienceResult.action"。 | 添加 JSDoc `@deprecated` 标记。 |
| 4 | LOW | `router/src/admin/utils.ts` | **AC-5 的 4 个工具函数未实现。** Spec FR-5 定义 `partialBody(createSchema)`、`extractDefinedFields(body, allowedKeys)`、`notFound(reply, entity, id)`、`conflict(reply, entity, name)` 应为 `admin/utils.ts` 提供。当前文件只包含 HTTP 状态码重导出、校验工具和 `formatApiKeyPreview`。 | 实现 4 个工具函数，并更新 `admin/providers.ts`、`retry-rules.ts`、`groups.ts`、`router-keys.ts`、`schedules.ts` 中的对应模板代码。 |
| 5 | LOW | `api-key-decrypt.ts`、`cache-estimation.ts`、`client-detection.ts`、`format-transform.ts`、`route-resolve.ts`、`usage-record.ts` | **6 个 hook 保留 `metadata.get("db"/"container"/"cachedTargets") as Type` 回退。** AC-1 要求 "无 metadata.get 等固定依赖的 as 断言"。当前代码形如 `ctx.deps?.db ?? ctx.metadata.get("db") as Database.Database` 仍包含 as 断言。虽然 `ctx.deps?.xxx` 优先，但回退路径未彻底清理。 | 在 failover-loop 的 deps 注入确认稳定后，删除回退分支，只保留 `ctx.deps?.xxx`。 |
| 6 | LOW | `router/src/proxy/handler/failover-loop.ts:278` | **`rr.action === 'failover'` 和 `rr.action === 'retry'` 分支是死代码。** resilience.ts 的 ResilienceResult.action 只返回 `'continue'` 或 `'stop'`，从不返回 `'failover'` 或 `'retry'`。这两段条件判断从不触发。 | 与 MUST FIX #1 关联修复：如果 resilience.ts 改为通过 action 返回 failover 决策，这两段代码将成为活代码。 |
| 7 | LOW | `router/src/proxy/format/converters/` | **FR-4a converter 合并不完整。** Spec 要求 6 个 `createConverter()` 文件合并为 1 个 `register-converters.ts`，目录删除。实际仅将 `responses-openai.ts` 和 `responses-anthropic.ts` 合并入 `openai-responses.ts`，剩余 4 个文件保留，无 `register-converters.ts`。 | 下轮迭代完成合并，或更新 spec 缩小范围。 |
| 8 | LOW | `router/src/proxy/transport/transport-executor.ts` (不存在) | **FR-3 TransportExecutor 类未实现。** Spec 要求从 transport-execute hook 提取 `TransportExecutor` 类，hook 简化为 10 行委托。当前 transport-execute.ts 仍有 50+ 行内联逻辑。 | 下轮迭代实现，或更新 spec 缩小范围。 |
| 9 | LOW | `stream-transform-base.ts` + `stream-oa2ant.ts` | **FR-4c BaseSSETransform 映射表模式未实现。** Spec 要求基类支持映射表模式，stream-oa2ant.ts 迁移为映射表模式（代码量减少 ≥ 40%）。当前仅有 `pushResponsesSSE → pushAnthropicSSE` 方法重命名，无架构改动。 | 下轮迭代实现，或更新 spec 缩小范围。 |
| 10 | INFO | `stream-oa2ant.ts` | **`done = true` 修复。** OpenAI→Anthropic 流式转换的 `ensureTerminated()` 后未设置 `this.done = true`，可能导致 stream 继续处理后续 chunk。本次修复防止流挂起。 | 无操作需求。这是正确的 bugfix。 |
| 11 | INFO | `stream-transform-base.ts` + `stream-ant2resp.ts` + `stream-bridge-chat2resp.ts` | **`pushResponsesSSE → pushAnthropicSSE` 合并。** 两个方法实现完全一致（`event: ...\ndata: ...\n\n`），删除冗余方法安全。所有 3 个消费者已更新。 | 无操作需求。正确的去重。 |
| 12 | INFO | `plan.md` vs diff scope | **实现范围与 Plan 的 4-Phase 范围不匹配。** Plan 定义 4 个 Phase 独立 PR，但当前 diff 混合了 Phase 1（完整）、Phase 2（部分）、Phase 3（部分）、Phase 4（部分）的工作。此差异本身不影响代码质量，但需确认是否为有意为之。 | 如为渐进式单 PR，建议在 spec/plan 中明确说明范围缩小。 |

---

### 代码质量备注

**PipelineContext deps 的 null-safety 考量：**
- `createPipelineContext` 默认 `deps: deps ?? {}` — ✅ ctx.deps 始终为对象
- failover-loop.ts 使用 `ctx.deps!` 写入 — ✅ 安全（因 `{}` 默认值）
- transport-execute.ts 使用 `ctx.deps!.container!` 等非空断言 — ⚠️ 脆弱但合理（运行时必定有值）
- 6 个 hook 使用 `ctx.deps?.xxx ?? metadata.get("xxx")` 回退 — ⚠️ 保守但应清理

**控制流分裂风险（MUST FIX #1 和 #2 的核心）：**

控制流目前分裂为两个独立路径：

```
路径 A（异常爆发）： 
  resilience.ts case "failover" → throw ProviderSwitchNeeded → failover-loop.ts catch → continue

路径 B（返回值驱动）：
  resilience.ts case "abort" → return action: "stop" → failover-loop.ts action === "stop" + more targets → continue
```

路径 A 是实际 failover 的主要路径（跨 provider 切换由它驱动）。路径 B 处理 resilience 内部 retry 完全耗尽的情况。两条路径并存增加了排查难度（错误日志要看两个方向的处理结果）。

---

### 结论

**需修改后重审。**

diff 实现质量较高——主要架构变更（PipelineDeps、双注册表合并、FormatRegistry 深化）正确且测试通过。但存在 2 条 MUST FIX 问题，均与 AC-2 控制流统一相关：resilience.ts 仍主动 throw ProviderSwitchNeeded（line 299），且 failover-loop.ts 保留对应 catch（line 309）。spec 明确要求消除异常驱动的 failover 路径。

其余 7 条 LOW 问题为 scope 偏差或防御性代码残留，不阻塞流程但建议清理。

### Summary

编码评审完成，第1轮，2条 MUST FIX，需修改后重审。
