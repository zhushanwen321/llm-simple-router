---
review:
  type: plan_review
  round: 1
  timestamp: "2026-05-28T09:00:00"
  target: ".xyz-harness/2026-05-28-fix-modality-overflow-failover-filtering/plan.md"
  verdict: fail
  summary: "计划评审完成，第1轮需重审，2条MUST FIX"

statistics:
  total_issues: 4
  must_fix: 2
  must_fix_resolved: 0
  low: 1
  info: 1

issues:
  - id: 1
    severity: MUST_FIX
    location: "router/src/proxy/proxy-core.ts:20-28 (ProxyErrorFormatter interface)"
    title: "ProxyErrorFormatter 接口缺少 unsupportedModality 方法声明"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 2
    severity: MUST_FIX
    location: "router/src/proxy/handler/create-proxy-handler.ts:158-166"
    title: "create-proxy-handler.ts 的 fallback errorMeta 缺少 unsupportedModality 条目"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 3
    severity: LOW
    location: "plan.md Task 2"
    title: "failover-loop reject 片段中的 ctx.metadata 类型需要确认"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 4
    severity: INFO
    location: "plan.md BG1 Execution Groups"
    title: "Spec 列出 6 个影响文件，Plan 覆盖 8 个（含 2 个测试文件），一致"
    status: open
    raised_in_round: 1
    resolved_in_round: null
---

# 计划评审 v1

## 评审记录
- 评审时间：2026-05-28 09:00
- 评审类型：计划评审
- 评审对象：`.xyz-harness/2026-05-28-fix-modality-overflow-failover-filtering/` 下的 spec.md、plan.md、e2e-test-plan.md、use-cases.md、non-functional-design.md

---

## 1. Spec 完整性

**目标**：明确。将 `computeModalityRedirectTargets()` 从 prepend 改为 constraint filtering，消除 failover 循环中尝试必然失败 targets 的问题。

**范围**：合理。FR-1~FR-4 定义清晰，Out of Scope 明确列出不动的领域（overflow 逻辑、resolveMapping、failover 循环本身、前端 UI）。

**验收标准**：优秀。AC-1~AC-9 全部是 Given/When/Then 格式，可直接写测试验证。行为表（FR-1 的 6 种场景）提供完整的输入→输出映射。

**[待决议] 项**：无。

**结论**：Spec 完整，无需补充。

---

## 2. Plan 可行性

### 2.1 Task 拆分

| Task | 内容 | 步骤数 | Subagent 可独立完成？ |
|------|------|--------|---------------------|
| T1 | 重写 computeModalityRedirectTargets + 单元测试 | 5 步 | 是 |
| T2 | ErrorKind 扩展 + failover-loop 空列表处理 + 集成测试 | 5 步 | 是 (依赖 T1) |
| T3 | 回归验证 | 7 步 | 是 (依赖 T2) |

每个 Task ≤ 10 步，粒度适中。✅

### 2.2 依赖关系

```
T1 (核心逻辑) → T2 (ErrorKind + failover) → T3 (回归验证)
```

正确。T2 需要 modality-redirect 返回空列表后，failover-loop 才能处理；T3 需要全部修改完成后再验证。

### 2.3 工作量估算

8 个文件（6 个代码文件 + 2 个测试文件），影响范围 Low-Medium，3 个 Task 分配合理。

### 2.4 AC 覆盖对照

| AC | 描述 | 覆盖 Task | 状态 |
|----|------|-----------|------|
| AC-1 | 部分支持过滤 | T1 | ✅ |
| AC-2 | 全部不支持+fallback | T1 | ✅ |
| AC-3 | 全部不支持+无 fallback | T1 | ✅ |
| AC-4 | OpenAI 错误格式 | T2 | ✅ |
| AC-5 | Anthropic 错误格式 | T2 | ✅ |
| AC-6 | 无多模态不变 | T1 | ✅ |
| AC-7 | 全部支持不变 | T1 | ✅ |
| AC-8 | Overflow 叠加 | T3 | ✅ |
| AC-9 | promptTooLong 不变 | T3 | ✅ |
| FR-4 | PipelineSnapshot reason | T1 | ✅ |

全部 9 条 AC + FR-4 均有对应 Task。✅

**结论**：Plan 可行性良好，但不完整（见 MUST FIX）。

---

## 3. Spec 与 Plan 一致性

### 3.1 文件覆盖

Spec 列出 6 个代码文件：

| Spec 列出的文件 | Plan 对应 | 状态 |
|-----------------|-----------|------|
| `modality-redirect.ts` | Task 1 modify | ✅ |
| `failover-loop.ts` | Task 2 modify | ✅ |
| `proxy-core.ts` | Task 2 modify | ✅ |
| `format/types.ts` | Task 2 modify | ✅ |
| `shared-error-meta.ts` | Task 2 modify | ✅ |
| `anthropic.ts` | Task 2 modify | ✅ |

Plan 额外补充 2 个测试文件（合理扩展）：
- `tests/modality-redirect.test.ts` (modify) ✅
- `tests/failover-modality-filter.test.ts` (create) ✅

**但 Plan 遗漏了 1 个需要修改的文件（详见 MUST FIX 2）。**

### 3.2 Spec 中明确列出的架构约束，Plan 是否遵循？

| Spec 约束 | Plan 执行情况 | 状态 |
|-----------|--------------|------|
| 不改 overflow 逻辑 | Task 3 回归验证，不修改 overflow.ts | ✅ |
| 不改 resolveMapping | 未提及修改该文件 | ✅ |
| 不改 failover 循环逻辑，只新增空列表分支 | Task 2 只在 modality 返回后新增分支 | ✅ |
| 新增 unsupportedModality 必须同时支持 OpenAI 和 Anthropic | Task 2 覆盖 shared-error-meta (openai+responses)、anthropic | ✅ |
| 不改函数签名 | Interface Contracts 确认签名不变 | ✅ |
| 异常安全返回原始 targets | Task 1 伪代码保持 try-catch | ✅ |

全部遵循。✅

### 3.3 Interface Contracts 与代码一致性

**computeModalityRedirectTargets 签名**（plan.md Interface Contracts）：

```
(db: Database.Database, targets: Target[], clientModel: string, body: Record<string, unknown>, snapshot: PipelineSnapshot) → Target[]
```

代码实际签名（`modality-redirect.ts:L47`）：
```typescript
export function computeModalityRedirectTargets(
  db: Database.Database,
  targets: Target[],
  clientModel: string,
  body: Record<string, unknown>,
  snapshot: PipelineSnapshot,
): Target[]
```

**完全一致**。✅

**failover-loop.ts 中集成点**（L212 附近）：
```
allTargets = computeModalityRedirectTargets(db, allTargets, clientModel, ctx.body, precomputeSnapshot);
```
Plan 描述正确。✅

**executorFailoverLoop 签名** — `errors: ProxyErrorFormatter`，即 `errors` 的类型。Plan 代码片段中的 `errors.unsupportedModality()` 需要 `ProxyErrorFormatter` 接口中存在该方法——**当前接口不存在**（见 MUST FIX 1）。

---

## 4. Execution Groups 合理性

**BG1（唯一 Group）**：

| 检查项 | 结论 |
|--------|------|
| 文件数 ≤ 10 | 8 个文件 ✅ |
| Task 功能关联度 | 全部与 modality filtering 相关 ✅ |
| 类型划分 | 纯后端，无需前后端分组 ✅ |
| 依赖关系 | T1→T2→T3 串行 ✅ |
| Wave 编排 | Wave 1 = BG1 唯一 ✅ |
| Subagent 配置 | Agent、Model、注入上下文都指定 ✅ |
| 上下文充分性 | "spec.md FR-1~FR-4 + AC 全部 + 源码" 充分 ✅ |
| 文件数标注 | 1 create + 7 modify，合理 ✅ |

Execution Groups 配置可执行。✅

---

## 5. 后端设计充分性

**设计说明**：Plan 的 Task 1 提供了完整伪代码，解释了从 prepend 改为 filter + replace 的"为什么"。✅

**存储变更**：无 DB schema 变更。✅

**API 端点**：无新增端点。✅

**边界条件**：
- 空列表输入 → 空列表输出 ✅
- provider 不存在时不过滤 ✅
- fallback provider inactive → 返回空列表 ✅
- fallback 不支持缺失模态 → 返回空列表 ✅
- 异常 → 原始 targets ✅

**非功能性要求**：non-functional-design.md 已覆盖稳定性、数据一致性、性能、安全，且有对应的 AC 验证。✅

---

## 6. 发现的问题

### MUST FIX

#### #1 (MUST FIX) — ProxyErrorFormatter 接口缺少 unsupportedModality 方法声明

**位置**：`router/src/proxy/proxy-core.ts:20-28`，`ProxyErrorFormatter` 接口定义

**描述**：Plan 的 Task 2 描述中，只提到在 `createErrorFormatter()` 实现中添加 `unsupportedModality` 方法：
```
2. proxy-core.ts createErrorFormatter：新增 `unsupportedModality: () => ...`
```

但 `createErrorFormatter` 的返回类型是 `ProxyErrorFormatter`，在 `create-proxy-handler.ts` 中其返回值赋值给 `apiTypeErrors`，再作为 `errors` 参数传入 `executeFailoverLoop`。`ProxyErrorFormatter` 接口需要声明 `unsupportedModality()` 方法，否则：
1. TypeScript 编译报错：`createErrorFormatter` 返回值包含接口未声明的属性
2. `failover-loop.ts` 中调用 `errors.unsupportedModality()` 时 TypeScript 报错：类型 `ProxyErrorFormatter` 上不存在该方法

**当前接口**（proxy-core.ts L20-L28）：
```typescript
export interface ProxyErrorFormatter {
  modelNotFound(model: string): ProxyErrorResponse;
  modelNotAllowed(model: string): ProxyErrorResponse;
  providerUnavailable(): ProxyErrorResponse;
  providerTypeMismatch(): ProxyErrorResponse;
  upstreamConnectionFailed(): ProxyErrorResponse;
  concurrencyQueueFull(providerId: string): ProxyErrorResponse;
  concurrencyTimeout(providerId: string, timeoutMs: number): ProxyErrorResponse;
  promptTooLong(): ProxyErrorResponse;
}
```

**修改方向**：在 `ProxyErrorFormatter` 接口中新增 `unsupportedModality(): ProxyErrorResponse`。

#### #2 (MUST FIX) — create-proxy-handler.ts 的 fallback errorMeta 缺少 unsupportedModality 条目

**位置**：`router/src/proxy/handler/create-proxy-handler.ts:158-166`

**描述**：Plan 的 Task 2 将 `ErrorKind` 联合类型扩展为包含 `"unsupportedModality"` 后，`create-proxy-handler.ts` 中的 fallback `errorMeta` 对象字面量因缺少该键会触发 TypeScript 编译错误。

该处代码：
```typescript
const errorMeta: Record<ErrorKind, { type: string; code: string }> = adapter?.errorMeta ?? {
  modelNotFound: { type: "invalid_request_error", code: "model_not_found" },
  modelNotAllowed: { type: "invalid_request_error", code: "model_not_allowed" },
  // ... 8 个条目 ...
  promptTooLong: { type: "invalid_request_error", code: "context_window_exceeded" },
};
```

当 `ErrorKind` 新增 `"unsupportedModality"` 后，`Record<ErrorKind, { type: string; code: string }>` 要求对象字面量包含全部 9 个键。缺少 `unsupportedModality` 条目将导致编译失败（TypeScript mapped type 的 excess/missing property checking）。

**注意**：该 fallback 仅在 `adapter?.errorMeta` 为 undefined 时使用（生产环境不会触发，但 TypeScript 类型检查仍然执行）。

**修改方向**：在 fallback 对象中添加：
```
unsupportedModality: { type: "invalid_request_error", code: "unsupported_modality" }
```

**影响范围补充**：Spec 列出"6 个影响文件"，Plan 覆盖 6 个代码文件 + 2 个测试文件。此问题表明实际需要修改的代码文件是 **7 个**（新增 `create-proxy-handler.ts`）。需更新 spec 和 plan 中的文件列表。

---

### LOW

#### #3 (LOW) — failover-loop reject 片段中 ctx.metadata 的类型需确认

**位置**：`plan.md` Task 2 的 failover-loop 代码片段

**描述**：Plan 中展示的 `rejectAndReply` 调用片段包含：
```typescript
sessionId: ctx.metadata.get("session_id") as string | undefined,
```
由于 Plan 片段中的 `ctx` 变量类型未显式标注，`ctx.metadata` 的 API 依赖于 `PipelineContext` 的具体类型定义。建议在 Plan 中明确标注 `ctx: PipelineContext` 以便执行者理解上下文来源。

**影响**：不阻塞执行，执行者在编码阶段会自然接触 `PipelineContext` 类型。但明确标注可减少认知负担。

---

### INFO

#### #4 (INFO) — Spec 列出 6 个影响文件，Plan 覆盖 8 个（含 2 个测试文件），一致

**位置**：`spec.md` Complexity Assessment 与 `plan.md` File Structure

**描述**：Spec 列出 6 个影响文件（均为代码文件），Plan 补充 2 个测试文件（modify modality-redirect.test.ts + create failover-modality-filter.test.ts），共 8 个文件。这是合理扩展，测试文件不属于 spec "影响范围" 的代码文件定义。但第 7 个代码文件 `create-proxy-handler.ts` 被遗漏（见 MUST FIX 2）。

---

## 7. 结论

**必须修复 2 条 MUST FIX** 后方可通过：

1. **MUST FIX #1**：`ProxyErrorFormatter` 接口新增 `unsupportedModality()` 方法声明
2. **MUST FIX #2**：`create-proxy-handler.ts` fallback errorMeta 新增 `unsupportedModality` 条目；更新 spec/plan 中的文件列表为 7 个代码文件

两条 MUST FIX 均为 TypeScript 类型完整性错误，如果在编码阶段被忽略将导致编译失败。但由于 Plan 未声明这些变更，执行者可能在编码阶段才发现并自行修复。

**修改 plan.md 的建议**：
1. 在 Task 2 中补充：更新 `ProxyErrorFormatter` 接口 + `create-proxy-handler.ts` fallback errorMeta
2. 更新 File Structure 表格（从 8 个文件变为 9 个：新增 `create-proxy-handler.ts`）
3. 更新 Spec Coverage Matrix（补充 AC-4/AC-5 的 new file引用）

### Summary

计划评审完成，第1轮需重审，2条MUST FIX，0条已修复。
