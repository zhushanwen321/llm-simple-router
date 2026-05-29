---
verdict: fail
must_fix: 2
reviewer: taste-review v2 (manual)
date: 2026-05-29
scope:
  - router/src/proxy/format/adapters/anthropic.ts
  - router/src/proxy/format/adapters/shared-error-meta.ts
  - router/src/proxy/format/types.ts
  - router/src/proxy/handler/create-proxy-handler.ts
  - router/src/proxy/handler/failover-loop.ts
  - router/src/proxy/proxy-core.ts
  - router/src/proxy/routing/modality-redirect.ts
---

# 代码品味审查报告 v2

## 审查对象

| 文件 | 变更行 | 职责 |
|------|--------|------|
| `format/types.ts` | +2 | ErrorKind 类型定义 |
| `format/adapters/shared-error-meta.ts` | +1 | OpenAI 错误元数据 |
| `format/adapters/anthropic.ts` | +1 | Anthropic 错误元数据 |
| `proxy-core.ts` | +7 | ErrorKind + unsupportedModality 工厂 |
| `handler/create-proxy-handler.ts` | +1 | fallback errorMeta 新增条目 |
| `handler/failover-loop.ts` | +18 | modality-redirect 空列表提前报错 |
| `routing/modality-redirect.ts` | +83/-61 | prepend → filter+replace 策略重写 |

核心变更：`modality-redirect` 从 prepend fallback target 改为 filter 不支持模态的 targets + 必要时用 fallback 替换。

---

## MUST FIX

### M1. `ErrorKind` 跨文件重复定义 — 违反"消除一切重复"

**文件**: `router/src/proxy/format/types.ts:3-9` + `router/src/proxy/proxy-core.ts:27-30`

`ErrorKind` 类型在两个文件中各自独立定义，内容完全相同（9 个 union member），本次变更还同步新增了 `"unsupportedModality"`——两个文件各加一行。

```
format/types.ts:  "unsupportedModality"
proxy-core.ts:    "unsupportedModality"
```

`create-proxy-handler.ts:17` 从 `proxy-core` 导入 `ErrorKind`，而 `shared-error-meta.ts:1` 从 `format/types` 导入 `ErrorKind`。两处消费同一个概念却依赖两个不同源，后续新增 ErrorKind 时只改一处就会编译通过但运行时行为不一致。

**品味原则**: 消除一切重复——包括跨文件重复的类型定义（essence.md 原则二 / ts/taste.md "消除一切重复"）。

**修复方向**: 保留一处定义（建议 `format/types.ts`，因为它是类型源头），`proxy-core.ts` 改为 `import type { ErrorKind } from "./format/types.js"`。`format/types.ts` 中的 `ErrorKind` 已有 4 个消费者（`FormatAdapter.errorMeta`、`shared-error-meta.ts`、`anthropic.ts`、`openai.ts`），是自然的归属。

---

### M2. `RejectParams` 构造重复 4 次 — 违反"一个关注点一条路径"

**文件**: `router/src/proxy/handler/failover-loop.ts:225-238`（本次新增的第 3 处）

`rCtx: RejectParams` 的构造在文件中出现 4 次（L203、L225、L263、L311），属性结构几乎相同（仅 `pipelineSnapshot` 来源和 `isFailover` 略有差异）。本次变更在 L225 新增了第 3 处完整构造，加剧了重复。

```typescript
// L225-238 — 本次新增
const rCtx: RejectParams = {
  db, logId, apiType: ctx.apiType, model: clientModel,
  startTime, isStream, routerKeyId: request.routerKey?.id ?? null,
  originalBody: rawBody, clientHeaders: cliHdrs,
  isFailover: false, originalRequestId: null,
  sessionId: ctx.metadata.get("session_id") as string | undefined,
  pipelineSnapshot: precomputeSnapshot.toJSON(),
  matcher, logFileWriter,
};
```

与 L203 的区别仅 `pipelineSnapshot: precomputeSnapshot.toJSON()` vs `rejectSnapshot.toJSON()`。提取一个工厂函数即可消除 3 处重复。

**品味原则**: 一个关注点一条路径（essence.md 原则二）。

**修复方向**: 提取辅助函数 `buildRejectParams(db, ctx, rawBody, cliHdrs, snapshot, matcher, logFileWriter): RejectParams`，4 处调用改为传 snapshot 参数。

---

## LOW

### L1. `snapshot.add()` 模板大量重复 — 11 处几乎相同的对象字面量

**文件**: `router/src/proxy/routing/modality-redirect.ts` 全文 11 处 `snapshot.add()`

11 处 `snapshot.add()` 中有 7 处是 `triggered: false, redirect_to: "", redirect_provider: ""` 的固定结构，仅 `reason` 和 `original_model` 不同。其中 4 处 `reason` 完全相同（`"no-eligible-targets"`），连 `redirect_to`/`redirect_provider` 都一样。

```typescript
// L198、L212、L226、L242 — 4 处完全相同的 reason
snapshot.add({
  stage: "modality-redirect",
  triggered: false,
  original_model: firstOriginalModel,
  redirect_to: "",       // 或 fbBackendModel
  redirect_provider: "", // 或 fbProviderId
  reason: "no-eligible-targets",
} satisfies StageRecord);
```

**品味原则**: 消除重复（essence.md 原则二）。

**修复方向**: 提取 `addSnapshot(snapshot, { reason, originalModel, redirectTo?, redirectProvider?, detectedModalities? })` 辅助函数，`stage`/`triggered` 等固定字段在辅助函数内填充。

### L2. 不同失败原因映射到相同的 reason — 损失诊断信息

**文件**: `router/src/proxy/routing/modality-redirect.ts:198, 212, 226, 242`

旧代码中不同失败路径有各自的 reason（`no-multimodal-fallback-configured`、`invalid-fallback-config`、`fallback-provider-unavailable`、`fallback-missing-modality`），新代码将它们全部合并为 `"no-eligible-targets"`。这让运维排查时无法区分"没有配置 fallback"vs "fallback 配置格式错误" vs "fallback provider 下线"。

**品味原则**: 显式优于隐式（essence.md 原则一）。

**修复方向**: 保留每个失败路径的独立 reason（如 `no-fallback-configured`、`invalid-fallback-format`、`fallback-provider-inactive`、`fallback-missing-modality`）。如果确实想简化，至少保留 2 类：`no-fallback-configured`（配置问题）和 `fallback-unavailable`（运行时问题）。

### L3. `provider 不存在 → 保留` 的安全行为值得注释说明

**文件**: `router/src/proxy/routing/modality-redirect.ts:120-122`

```typescript
if (!provider) {
  // provider 不存在 → 保留（安全行为）
  eligible.push(target);
  continue;
}
```

注释说明了"安全行为"但没解释为什么。如果 provider 在 DB 中不存在，说明数据不一致，这时保留该 target 会导致后续 failover 循环中 `getProviderById` 再次返回 null 并触发 `provider_unavailable` 错误。这个"安全"判断需要更明确的理由。

**修复方向**: 补充注释说明设计意图（如"provider 不存在可能是 DB 暂时不一致，保留给后续 failover 循环处理"），或者改为过滤掉并记录 reason。

### L4. `computeModalityRedirectTargets` 函数接近品味上限

**文件**: `router/src/proxy/routing/modality-redirect.ts:97-284`

函数体（L97-284）约 187 行，接近 ts/taste.md 的 300 行上限。函数包含 6 个主要步骤（空列表检查 → 模态检测 → 过滤 → 部分过滤 → 全部过滤+fallback 查找 → fallback 验证），认知负荷较高。

**品味原则**: 结构先于一切（ts/taste.md "结构先于一切"）。

**修复方向**: 将步骤 6（fallback 查找+验证）提取为独立函数 `resolveModalityFallback(db, clientModel, modalities, firstOriginalModel, snapshot): Target[] | null`，主函数调用后根据 null/非 null 决定返回。

---

## INFO

### I1. 新增的 `unsupportedModality` 错误码选择合理

`format/types.ts`、`shared-error-meta.ts`、`anthropic.ts`、`proxy-core.ts`、`create-proxy-handler.ts` 五个文件同步新增 `unsupportedModality` 错误种类的模式完全一致，遵循了既有 ErrorKind 的扩展路径。这是正确的做法——统一模式让新增 ErrorKind 变成机械操作。

### I2. `failover-loop.ts` L225-238 的提前返回设计

新增的空列表检查放在 modality-redirect 和 overflow 之间（步骤 2a），逻辑位置正确。如果放在 overflow 之后，会被 allowed_models 过滤的空列表处理逻辑混淆。

### I3. filter+replace 策略的语义改进

旧 prepend 策略将 fallback target 放在列表头部但不移除不支持的首 target，语义上是"优先尝试 fallback"。新策略先过滤再替换，语义更清晰——不支持模态的 target 不会被尝试。

---

## 总结

| 级别 | 数量 | 要点 |
|------|------|------|
| MUST FIX | 2 | ErrorKind 重复定义（M1）、RejectParams 构造重复（M2） |
| LOW | 4 | snapshot 模板重复（L1）、reason 合并损失诊断（L2）、provider 不存在注释（L3）、函数行数（L4） |
| INFO | 3 | 错误码扩展合理（I1）、提前返回位置正确（I2）、策略语义改进（I3） |

M1 是类型层面的事实性重复——两个同名的 union type 在不同文件中定义，维护时必须同步修改。M2 是本次变更引入的重复（第 3 处 rCtx 构造），属于"一个关注点一条路径"的直接违反。
