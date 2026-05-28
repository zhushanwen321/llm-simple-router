---
review:
  type: spec_review
  round: 1
  timestamp: "2026-05-28T11:00:00"
  target: ".xyz-harness/2026-05-28-fix-modality-overflow-failover-filtering/spec.md"
  verdict: fail
  summary: "Spec 评审完成，第1轮，1条 MUST FIX 需修改后重审"

statistics:
  total_issues: 3
  must_fix: 1
  must_fix_resolved: 0
  low: 1
  info: 1

issues:
  - id: 1
    severity: MUST_FIX
    location: "spec.md 背景 + FR-2 + FR-3"
    title: "FR-2 Anthropic 错误格式与 FR-3 createErrorFormatter 机制矛盾"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 2
    severity: LOW
    location: "spec.md Complexity Assessment"
    title: "受影响文件数估算偏低（3 个 vs 实际 5-6 个）"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 3
    severity: INFO
    location: "spec.md 全篇"
    title: "AC 覆盖完整，Given/When/Then 规范，数据消费者无遗漏"
    status: open
    raised_in_round: 1
    resolved_in_round: null
---

# 计划评审 v1

## 评审记录

- 评审时间：2026-05-28 11:00
- 评审类型：计划评审（spec 完整性）
- 评审对象：`.xyz-harness/2026-05-28-fix-modality-overflow-failover-filtering/spec.md`
- 项目架构参考：`CLAUDE.md` + `router/src/proxy/proxy-core.ts` + `router/src/proxy/format/types.ts` + `router/src/proxy/format/adapters/*.ts` + `router/src/proxy/routing/modality-redirect.ts` + `router/src/proxy/handler/failover-loop.ts`

---

## 1. Spec 完整性检查

| 要素 | 状态 | 说明 |
|------|------|------|
| 目标明确 | ✅ | Background 清晰地描述了当前问题（prepend 策略保留不支持模态的 targets 导致无效 failover） |
| 范围合理 | ✅ | Constraints 和 Out of Scope 明确划定了边界 |
| 验收标准可量化 | ✅ | 全部 9 条 AC 均采用 Given/When/Then 格式，可直接编写测试 |
| [待决议] 项 | ✅ 无 | 无待决议项，风险低 |
| 功能需求定义 | ✅ | FR-1~FR-4 覆盖完整逻辑 |
| 行为表 | ✅ | FR-1 的 6 种输入→输出映射清晰 |

**评价**：spec 完整性良好，主体结构完整，边界清晰。

---

## 2. AC 可测试性检查

所有 9 条 AC 均使用 Given/When/Then 格式，输入条件明确，输出结果可验证。

| AC | 场景 | Given/When/Then | 可测试 |
|----|------|-----------------|--------|
| AC-1 | 部分支持 + 过滤 | ✅ | ✅ 纯函数单元测试 |
| AC-2 | 全部不支持 + fallback | ✅ | ✅ 纯函数单元测试 |
| AC-3 | 全部不支持 + 无 fallback | ✅ | ✅ 纯函数单元测试 |
| AC-4 | 空列表 + OpenAI 格式错误 | ✅ | ✅ 组件集成测试（app.inject） |
| AC-5 | 空列表 + Anthropic 格式错误 | ✅ | ✅ 组件集成测试（app.inject） |
| AC-6 | 无多模态 | ✅ | ✅ 纯函数单元测试 |
| AC-7 | 全部支持 | ✅ | ✅ 纯函数单元测试 |
| AC-8 | Overflow 叠加 | ✅ | ✅ 纯函数单元测试 |
| AC-9 | promptTooLong 不变 | ✅ | ✅ 组件集成测试或回归测试 |

**潜在风险**：AC-9 的"行为不变"需要现有测试通过来验证——需确认是否有现有的 promptTooLong 测试覆盖作为回归基准。

---

## 3. 架构一致性检查

### 3.1 四层代理架构

改动集中在 **Routing 层**（`modality-redirect.ts`）和 **Handler 层**（`failover-loop.ts` 空列表处理），符合分层职责。✅

### 3.2 ErrorKind 机制 → **MUST FIX**

FR-3 描述了正确的目标（新增 `unsupportedModality` 到 `ErrorKind`，配置 `statusCode = 400`，在各 adapter 的 `errorMeta` 中注册）。但审查代码后发现**关键不一致**：

**问题**：FR-2 要求 Anthropic 格式为 `{ "type": "error", "error": { "type": "invalid_request_error", "message": "..." } }`，但 FR-3 要求通过 `createErrorFormatter` 实现，而 `createErrorFormatter` 的 `formatBody` 回调始终产生 `{ error: { message, type, code } }` 结构，**对所有 API 类型输出相同的 body 结构**，无法区分 OpenAI/Anthropic 格式。

具体代码路径：
- `proxy-core.ts:27-34` — `createErrorFormatter` 的 `formatBody` 签名：`(kind: ErrorKind, message: string) => Record<string, unknown>`
- `create-proxy-handler.ts:158` — 传入的 `formatBody` 回调：`(kind, message) => ({ error: { message, ...errorMeta[kind] } })`
- 该回调对所有 API 类型使用同一结构，不会根据 `apiType` 切换 body 格式

FR-2 和 FR-3 存在**设计级矛盾**，实现者无法同时满足两条要求。

**建议修改方向（二选一）**：
1. **方案 A（推荐）**：更正 FR-2 的 Anthropic 格式描述，使其与 `createErrorFormatter` 的实际输出一致（即 `{ error: { message, type, code } }`）。如果现有代码中所有通过 `createErrorFormatter` 产生的错误（如 `promptTooLong`）都已用此格式正常工作，说明 Anthropic 客户端兼容此格式。
2. **方案 B**：保留 FR-2 的 Anthropic 格式，但 FR-3 增加新的实现机制——例如让 `createErrorFormatter` 接受 `apiType` 参数，或让 `unsupportedModality` 错误走 `adapter.formatError()` 路径而非 `createErrorFormatter` 路径。

### 3.3 FormatAdapter 模式

`ErrorKind` 类型在代码库中存在**两处独立声明**：

| 位置 | 用途 |
|------|------|
| `router/src/proxy/proxy-core.ts:L14-L18` | `createErrorFormatter` 使用 |
| `router/src/proxy/format/types.ts:L3-L11` | `FormatAdapter.errorMeta` 签名使用 |

两处必须同步更新。FR-3 只提到了 "在 ErrorKind 联合类型中新增 unsupportedModality" 而没有指出具体文件。如果只更新 `proxy-core.ts` 而遗漏 `format/types.ts`，TypeScript 编译会报错（`adapter?.errorMeta` 类型兼容性问题），这是编译期防护——但仍建议在 spec 中明确标注两处。

另外，需要更新的 `errorMeta` 分布在以下文件：

| 文件 | 内容 |
|------|------|
| `format/adapters/shared-error-meta.ts` | `OPENAI_FAMILY_ERROR_META`（给 openai + responses 用） |
| `format/adapters/anthropic.ts` | `ANTHROPIC_ERROR_META`（给 anthropic 用） |

### 3.4 数据消费者检查

本次改动不涉及新增 DB 字段、SSE 事件、Admin API 路由或前端展示，因此数据消费者覆盖检查不触发。✅

`PipelineSnapshot.reason` 字段新增 6 个值（FR-4），这些值仅在日志和 `request_logs.pipeline_snapshot` JSON 中出现，已有的消费者（日志查看页面）通过 JSON 反序列化展示，无需修改。

---

## 4. 假设与约束冲突检查

### 约束自查

| 声明约束 | 评估 |
|---------|------|
| 不改 overflow 逻辑 | ✅ — `expandOverflowTargets` prepend 行为不变 |
| 不改 resolveMapping | ✅ — 只改 modality 层 |
| 不改 failover 循环逻辑 | ⚠️ 需要澄清：FR-2 "空列表提前报错"虽不是改循环结构，但新增了一条提前返回路径，严格说是循环前的新条件分支。规范建议加上 "只新增空列表提前返回分支" 的精确表述，当前描述 "只新增空列表提前报错分支，循环本身不变" 已接近，可以接受 |
| API 错误规范兼容 | ❌ 见上面 MUST FIX #1 |
| 向后兼容 — 函数签名不变 | ✅ — `computeModalityRedirectTargets` 入参和返回类型不变 |
| 异常安全 | ✅ — `try-catch` 保持 |

### 假设检查

| 假设 | 隐含风险 | 评估 |
|------|---------|------|
| `expandOverflowTargets` 能处理空数组 | 如果传空数组，`overflow.ts` 的 `targetsBeforeOF` 为 0，`ofResult.targets` 返回空数组。但需要验证 `expandOverflowTargets` 内部是否有空数组断言 | 需在 plan 确认 |
| `filterExcluded([])` 能正确处理 | `failover-loop.ts` 的 `filtered.length === 0` 分支可正常处理 | ✅ 已有代码 |
| `detectModalities` 已覆盖所有 API 格式 | 当前覆盖 OpenAI / Anthropic / Responses 三种 | ✅ spec 中已说明 |

---

## 发现的问题

| # | 优先级 | 位置 | 描述 | 修改建议 |
|---|--------|------|------|---------|
| **1** | **MUST FIX** | spec.md FR-2 + FR-3 | **FR-2 的 Anthropic 错误格式与 FR-3 的 createErrorFormatter 机制矛盾**。FR-2 要求 Anthropic 输出 `{ type: "error", error: { type, message } }` 格式，但 FR-3 要求通过 `createErrorFormatter` 实现，而 `createErrorFormatter` 的 `formatBody` 对所有 API 类型输出相同的 `{ error: { message, type, code } }` 结构。实现者无法同时满足这两条。 | 方案 A（推荐）：修正 FR-2 的 Anthropic 格式为 `{ error: { message, type, code } }`（与 `createErrorFormatter` 实际输出一致），并验证现有 Anthropic 客户端的兼容性；<br>方案 B：保留 FR-2 格式，FR-3 改走 `adapter.formatError()` 路径或使 `createErrorFormatter` 感知 `apiType`。 |
| **2** | **LOW** | spec.md Complexity Assessment — 受影响文件数 | Complexity Assessment 称"3 个文件"，但实际需要改动的文件至少 5-6 个：(1) `modality-redirect.ts`, (2) `failover-loop.ts`, (3) `proxy-core.ts`, (4) `format/types.ts` (ErrorKind 重复声明), (5) `shared-error-meta.ts`, (6) `anthropic.ts`。此外 `responses.ts`（使用 OPENAI_FAMILY_ERROR_META）也需确认。偏差可能导致 plan 阶段任务拆分遗漏。 | 将 Complexity Assessment 中的文件数改为 5-6 个，并列出具体文件名。 |
| **3** | **INFO** | spec.md 全篇 | AC 覆盖完整（9 条 AC 对应 6 个行为表场景 + 2 种 API 格式错误 + overflow 叠加 + 回归），Given/When/Then 格式规范。数据消费者无新增，Out of Scope 合理。Constraints 和异常安全要求到位。 | — |

> 优先级定义：
> - **MUST FIX**：不修复则评审不通过，会阻塞流程
> - **LOW**：建议修复，但不阻塞流程
> - **INFO**：观察记录，无需操作

---

## 结论

**需修改后重审**（1 条 MUST FIX）。

核心问题是 FR-2 与 FR-3 之间的设计矛盾——Anthropic 错误格式要求与 `createErrorFormatter` 的单格式机制不兼容。必须解决此矛盾后才能进入实现阶段。

---

## Summary

Spec 评审完成，第 1 轮，1 条 MUST FIX，需修改后重审。整体 spec 结构完整、AC 规范、边界清晰，但有两处架构一致性问题：FR-2 Anthropic 格式与 FR-3 createErrorFormatter 机制矛盾（MUST FIX），以及受影响的 ErrorKind/errorMeta 文件数低估（LOW）。
