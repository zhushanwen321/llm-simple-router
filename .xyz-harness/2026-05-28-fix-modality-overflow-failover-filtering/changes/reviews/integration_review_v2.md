---
verdict: "pass"
must_fix: 0
---

# Integration Review v2 — Modality Constraint Filtering

**审查方法**: 四维度边界分析（D1 数据格式转换 / D2 错误传播 / D3 接口契约一致性 / D4 上下游对齐）
**数据来源**: BLR v2 模拟数据推演 + git diff 源码逐行验证

## 审查范围

7 个源码变更文件，聚焦 4 个跨模块边界：

| # | 边界 | 生产侧 | 消费侧 | 传递数据 |
|---|------|--------|--------|---------|
| B1 | MRL → failover-loop | `modality-redirect.ts` | `failover-loop.ts` L218 | `Target[]` 返回值 |
| B2 | failover-loop → error-path | `failover-loop.ts` L223-234 | `create-proxy-handler.ts` L146-155 | `ErrorKind` + `errorMeta` |
| B3 | error-path → format adapters | `create-proxy-handler.ts` L146 | `shared-error-meta.ts` / `anthropic.ts` | `Record<ErrorKind, {...}>` |
| B4 | failover-loop → logging | `failover-loop.ts` L231 | `log-helpers.ts` L35/75 | `pipelineSnapshot` 字符串 |

## D1: 数据格式转换

### B1: modality-redirect.ts → failover-loop.ts (Target[] 返回值)

**验证路径**: `computeModalityRedirectTargets()` 返回 `Target[]` → `allTargets` 赋值 → `expandOverflowTargets()` 消费

| 场景 | 返回值 | 消费侧处理 | 验证结果 |
|------|--------|-----------|---------|
| 无多模态 | 原始 `targets` | 直传 OF 层 | ✓ 无转换 |
| 全部支持 | 原始 `targets` | 直传 OF 层 | ✓ 无转换 |
| 部分过滤 | `eligible: Target[]`（子集） | OF 层接收子集 | ✓ 数组元素类型一致 |
| fallback 替换 | `[fbTarget]`（新建 Target） | OF 层接收单元素数组 | ✓ Target 结构 `{provider_id, backend_model}` 一致 |
| 无 eligible + 无 fallback | `[]`（空数组） | L223 `allTargets.length === 0` 提前报错 | ✓ 不进入 OF 层 |
| 异常 | 原始 `targets`（catch 兜底） | 直传 OF 层 | ✓ 退化为旧行为 |

**关键验证点**:
- `fbTarget` 构造（modality-redirect.ts L248-251）只有 `provider_id` + `backend_model` 两个字段，与 `Target` 接口完全匹配 ✓
- `eligible` 数组元素直接从 `targets` 参数 push，类型不变 ✓
- 空 `targets` 入参（L101 `targets.length === 0`）直接返回，不触发后续逻辑 ✓

**无问题。**

### B4: failover-loop → logging (pipelineSnapshot)

**验证路径**: `precomputeSnapshot.toJSON()` → `RejectParams.pipelineSnapshot` → `insertRejectedLog()` → DB `request_logs.pipeline_snapshot`

| 场景 | snapshot 内容 | 日志写入 | 验证 |
|------|-------------|---------|------|
| 空列表提前报错 | `[{stage:"modality-redirect", triggered:false, reason:"no-eligible-targets", ...}]` | `rejectAndReply` L231 → `insertRejectedLog` | ✓ |
| 部分过滤后继续 | `[{stage:"modality-redirect", triggered:true, reason:"filtered-ineligible-targets", detected_modalities:["image"]}, ...]` | 正常请求日志 | ✓ |

**关键验证点**:
- L231 使用 `precomputeSnapshot.toJSON()`（非 `rejectSnapshot`），记录了 modality-redirect 阶段的完整 snapshot ✓
- `rejectSnapshot`（L197）仅用于 `resolveMapping` 返回 null 的场景（L208），与 modality 路径无关 ✓
- `PipelineSnapshot.add()` 接受 `StageRecord` 类型，`detected_modalities` 是可选字段（pipeline-snapshot.ts L7），不传不会报错 ✓

**无问题。**

## D2: 错误传播

### B2+B3: failover-loop → create-proxy-handler → format adapters

**验证路径**: `errors.unsupportedModality()` → `createErrorFormatter()` → `formatBody("unsupportedModality", message)` → `errorMeta["unsupportedModality"]` → adapter 的 `errorMeta` Record

**逐层验证**:

| 层级 | 文件 | 位置 | `unsupportedModality` 定义 | 验证 |
|------|------|------|---------------------------|------|
| ProxyErrorFormatter 接口 | `proxy-core.ts` | L22 | `unsupportedModality(): ProxyErrorResponse` | ✓ 签名与 promptTooLong 一致 |
| ErrorKind 联合类型 | `proxy-core.ts` | L27-30 | `\| "unsupportedModality"` | ✓ |
| ErrorKind 联合类型 | `format/types.ts` | L3-11 | `\| "unsupportedModality"` | ✓ 与 proxy-core 同步 |
| 工厂函数实现 | `proxy-core.ts` | L74-77 | `{statusCode: 400, body: formatBody(...)}` | ✓ statusCode=400 |
| OpenAI adapter | `shared-error-meta.ts` | L16 | `{type:"invalid_request_error", code:"unsupported_modality"}` | ✓ |
| Responses adapter | `shared-error-meta.ts` | L16（共用 OPENAI_FAMILY） | 同 OpenAI | ✓ |
| Anthropic adapter | `anthropic.ts` | L11 | `{type:"invalid_request_error", code:"unsupported_modality"}` | ✓ |
| Fallback（adapter=null） | `create-proxy-handler.ts` | L154 | `{type:"invalid_request_error", code:"unsupported_modality"}` | ✓ |

**关键验证点**:
- `createErrorFormatter` 内部使用 `formatBody("unsupportedModality", message)` 作为 kind 参数，而 `errorMeta` 是 `Record<ErrorKind, ...>`，TypeScript 编译器保证 kind 必须是 ErrorKind 的成员。新增 `"unsupportedModality"` 后，所有 `Record<ErrorKind, ...>` 都必须包含此 key，否则编译错误。已验证 3 个 adapter + 1 个 fallback 均已包含 ✓
- Anthropic adapter 中 `unsupportedModality` 的 `type` 使用 `"invalid_request_error"` 而非 Anthropic 原生的 `"not_found_error"` 等错误类型。这与 `promptTooLong` 的模式一致（同样使用 `"invalid_request_error"`），保持了跨 API 错误类型的一致性 ✓

**调用链追踪**:

```
failover-loop L234: errors.unsupportedModality()
  ↓ (errors = apiTypeErrors from create-proxy-handler L157)
createErrorFormatter → formatBody("unsupportedModality", message)
  ↓ (formatBody = (kind, msg) => ({error: {message: msg, ...errorMeta[kind]}}))
  ↓ (errorMeta from adapter?.errorMeta or fallback)
  → errorMeta["unsupportedModality"] → {type, code}
  ↓
result: {statusCode: 400, body: {error: {message, type, code}}}
  ↓
rejectAndReply → reply.code(400).send(body)
  ↓
客户端收到 HTTP 400 + {error: {message, type, code}}
```

**无问题。**

## D3: 接口契约一致性

### ErrorKind 双重声明同步

**现状**: `ErrorKind` 在两个文件中独立声明：
1. `proxy-core.ts` L27-30（handler 层使用）
2. `format/types.ts` L3-11（format 层使用）

**验证**: 两处均已包含 `"unsupportedModality"` ✓

**风险评估**: 两处独立声明需要手动同步。新增 ErrorKind 成员时遗漏任一处会导致编译错误（因为 `Record<ErrorKind, ...>` 会缺少 key），TypeScript 的结构化类型系统提供了编译时保障。**编译器会捕获同步遗漏，不构成运行时风险。**

**建议（非阻塞）**: 考虑将 `ErrorKind` 统一到单一声明位置（如 `core/types.ts`），避免双重维护。但这是既有架构问题（9 种 ErrorKind 均为双重声明），不是本次变更引入的。

### ProxyErrorFormatter 接口

**验证**: `unsupportedModality()` 签名 `() => ProxyErrorResponse` 与 `promptTooLong()` 完全对称 ✓

### FormatAdapter.errorMeta 契约

**验证**: `FormatAdapter.errorMeta` 类型为 `Record<ErrorKind, {type: string; code: string}>`（format/types.ts L17）。所有 3 个 adapter + fallback 均已包含完整的 10 个 key（9 个已有 + 1 个新增 `unsupportedModality`）✓

**无问题。**

## D4: 上下游对齐

### modality-redirect.ts 返回值语义变化

**Before（prepend 策略）**:
- 部分不支持 → prepend fallback → `[fallback, ...originals]`
- 全部不支持 → prepend fallback → `[fallback, ...originals]`
- 无 fallback → 返回原始 targets

**After（filter+replace 策略）**:
- 部分不支持 → filter → `[eligible_subset]`
- 全部不支持 + fallback → replace → `[fallback]`
- 全部不支持 + 无 fallback → `[]`

**对下游的影响分析**:

| 下游消费者 | Before 行为 | After 行为 | 影响 |
|-----------|-----------|-----------|------|
| `expandOverflowTargets` (OF 层) | 接收含 fallback 的完整列表 | 接收过滤后子集或单元素 | ✓ OF 层只遍历 targets，不假设列表长度 |
| failover 循环 | 尝试 fallback → 失败 → 尝试 originals | 只尝试过滤/替换后的 targets | ✓ 循环逻辑不变，只是 targets 数量减少 |
| `allowed_models` 过滤 (L250-270) | 对完整列表过滤 | 对子集过滤 | ✓ 过滤逻辑与列表长度无关 |
| `iterationSnapshot` (L309) | 基于 precomputeSnapshot 的 stages | 同上 | ✓ precomputeSnapshot 已包含 modality-redirect 阶段 |
| `rejectAndReply`（空列表路径） | 不存在 | L223-234 新增 | ✓ 新路径，不影响现有路径 |
| 空列表时后续代码 | N/A（不触发） | `allTargets.length === 0` 提前 return | ✓ 不执行 OF/循环 |

**验证点**: failover-loop L240 `const ofResult = expandOverflowTargets(allTargets, db, ctx.body)` — 此时 `allTargets` 保证非空（L223 已检查 `length === 0` 并 return），OF 层不会收到空数组 ✓

### 测试层面的上下游对齐

**failover-loop-layered.test.ts 变更**:
- AC19 测试从 "IR_F excluded after failure" 改为 "IR_F replaced — only fallback target attempted" ✓
- 断言从 `textOnlyCalls === 1` 改为 `textOnlyCalls === 0` ✓（text-only target 被过滤，不应被调用）
- 预期状态码从 200 改为 `>= 500` ✓（fallback 失败后无更多 target）

**failover-modality-filter.test.ts 新增**:
- AC-4: OpenAI apiType 空列表 → HTTP 400 + `unsupported_modality` ✓
- AC-5: Anthropic apiType 空列表 → HTTP 400 + `unsupported_modality` ✓
- 正常请求不被影响 ✓

**modality-redirect.test.ts 变更**:
- AC1: 从 `toHaveLength(2)` 改为 `toHaveLength(1)` ✓
- AC3: 从 `toEqual(targets)` 改为 `toEqual([])` ✓
- AC7/AC8: 从 `toEqual(targets)` 改为 `toEqual([])` ✓
- reason 验证：所有 reason 字符串已同步更新 ✓
- 新增 AC-1/AC-2/AC-3 测试覆盖 filter+replace 新行为 ✓

**无问题。**

## 发现问题

### LOW-1: ErrorKind 双重声明维护成本

**位置**: `proxy-core.ts` L27-30 vs `format/types.ts` L3-11

**说明**: `ErrorKind` 在两个文件中独立声明，需要手动保持同步。本次变更已在两处均添加 `"unsupportedModality"`，但未来新增 ErrorKind 时存在遗漏风险。

**风险**: 低。TypeScript 编译器会在 `Record<ErrorKind, ...>` 缺少 key 时报错，提供编译时保障。

**建议**: 将 `ErrorKind` 统一到 `core/types.ts` 或 `format/types.ts`，另一处通过 import 引用。这是既有架构问题，不阻塞本次合并。

### LOW-2: 空 catch 块（modality-redirect.ts L137）

**位置**: `modality-redirect.ts` L137 `} catch {`

**说明**: Step 6b 的 `JSON.parse(group.rule)` 的 catch 块没有绑定异常变量。虽然 catch 内部已做了有意义的工作（记录 snapshot + 返回 `[]`），但丢失了异常信息，无法排查 rule 解析失败的具体原因。

**对比**: 外层 catch（L268）有 `catch (err: unknown)` 并 `console.error(..., err)` 记录完整异常。

**建议**: 将 L137 改为 `} catch (parseErr: unknown) {` 并添加 `console.error('computeModalityRedirectTargets: rule parse error', parseErr)` — 与外层 catch 模式一致。

**风险**: 低。snapshot 已记录 `reason: "rule-parse-error"`，管理员可通过日志定位。但缺少具体 parse 错误信息会增加排查成本。

### INFO-1: create-proxy-handler.ts fallback errorMeta 与 adapter errorMeta 值重复

**位置**: `create-proxy-handler.ts` L146-155

**说明**: 当 `adapter?.errorMeta` 存在时使用 adapter 的值，不存在时使用手写 fallback。`unsupportedModality` 的 fallback 值 `{type: "invalid_request_error", code: "unsupported_modality"}` 与 OpenAI adapter 的值完全相同，但 Anthropic adapter 的 `modelNotFound` 使用 `"not_found_error"` 而非 fallback 的 `"invalid_request_error"`。

**影响**: 仅当 adapter 注册失败（formatRegistry 未配置对应 apiType）时 fallback 才生效。正常流程中所有 apiType 都有对应 adapter，fallback 不会触发。

**不需要修改。** 这是既有模式，且 TypeScript 的 `Record<ErrorKind, ...>` 类型保证 fallback 必须包含所有 key。

### INFO-2: modality-redirect catch 兜底返回原始 targets（语义变化后的安全考量）

**位置**: `modality-redirect.ts` L268-277

**说明**: 异常兜底返回原始 `targets`。在旧 prepend 策略下，这意味着"异常时不做 redirect，尝试原始 targets"。在新 filter+replace 策略下，这意味着"异常时跳过过滤，让不支持 image 的 targets 也被尝试"。

**影响**: 不支持 image 的 target 会被尝试，上游返回错误后 failover 到下一个 target 或最终 5xx。这比"返回空列表导致立即 400 unsupported_modality"更宽容，符合异常安全原则（不因内部错误拒绝请求）。

**不需要修改。** 保守策略合理，BLR INFO-2 已分析。

## 总结

| 维度 | 问题数 | 结论 |
|------|--------|------|
| D1 数据格式转换 | 0 | ✓ 所有 Target[] 返回值类型一致，filter/replace 不改变元素结构 |
| D2 错误传播 | 0 | ✓ 4 层错误格式化链路完整，7 处 unsupportedModality 注册一致 |
| D3 接口契约一致性 | 0 | ✓ ErrorKind 双重声明已同步，TypeScript 编译时保障 |
| D4 上下游对齐 | 0 | ✓ 返回值语义变化已完整传递到所有下游消费者，测试断言已同步更新 |
| **MUST FIX** | **0** | |
| LOW | 2 | ErrorKind 双重声明 / JSON.parse catch 缺少异常变量 |
| INFO | 2 | fallback errorMeta 重复 / catch 兜底返回原始 targets 语义 |

**Verdict: PASS** — 四个模块边界的跨模块数据传递、错误传播、接口契约、上下游对齐全部验证通过。
