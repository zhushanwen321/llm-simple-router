---
verdict: fail
must_fix: 2
reviewer: robustness-review-v2
date: 2026-05-29
scope:
  - router/src/proxy/routing/modality-redirect.ts
  - router/src/proxy/handler/failover-loop.ts
  - router/src/proxy/proxy-core.ts
  - router/src/proxy/format/types.ts
  - router/src/proxy/format/adapters/anthropic.ts
  - router/src/proxy/format/adapters/shared-error-meta.ts
  - router/src/proxy/handler/create-proxy-handler.ts
  - router/tests/failover-loop-layered.test.ts
  - router/tests/failover-modality-filter.test.ts
  - router/tests/modality-redirect.test.ts
---

# Robustness Review v2 — Fix Modality Overflow Failover Filtering

## 审查范围

modality-redirect 从 prepend 策略改为 filter+replace 策略，failover-loop 新增空列表 early return，新增 `unsupportedModality` ErrorKind。

## D1: 错误处理

### [MUST-FIX-1] modality-redirect `catch` 块异常时返回原始 targets — 语义矛盾

**文件**: `router/src/proxy/routing/modality-redirect.ts` L274-283  
**问题**: 新策略下，正常路径中多处返回 `[]`（空列表），catch 块却返回 `targets`（原始列表）。这导致异常时行为不一致：

- 正常路径：全部不支持 → 返回 `[]` → failover-loop 报 400 错误
- 异常路径：全部不支持 → 但 catch 返回原始 targets → 继续尝试 → 上游必然失败

异常安全的意义是"不比正常路径更糟"。但现在 catch 返回的是**原始不支持模态的 targets**，代理会把这些请求发给不支持多模态的 provider，导致上游返回错误或静默丢弃内容（图片部分被忽略），比明确报 400 更危险。

**修复方向**: catch 块也应返回 `[]`，让 failover-loop 统一走 `unsupportedModality` 错误路径。如果担心误杀，可以增加 `reason: "internal-error-fallback-to-original"` 日志并降级到返回 `targets`，但这需要明确记录为有意为之的设计决策。

> **严重性评估**: 如果保留当前行为，至少需要在 catch snapshot 的 reason 中记录为 `"internal-error-unsafe-fallback"` 而非 `"internal-error"`，让运维能区分这两种截然不同的语义。同时，考虑到 catch 的触发条件是 DB 错误等不可恢复故障，返回原始 targets 实际上会将不支持模态的请求打到上游 provider——这在生产环境中比 400 更糟。

**判定**: MUST FIX。当前 catch 返回原始 targets 会把多模态请求发给纯文本 provider。

### [INFO-1] failover-loop 空列表 early return 的 RejectParams 构造重复

**文件**: `router/src/proxy/handler/failover-loop.ts` L218-233  
**问题**: `rCtx` 构造与 L198-207（modelNotFound 路径）、L254-267（modelNotAllowed 路径）高度重复。虽然不影响正确性，但三处重复增加了维护负担——如果 `RejectParams` 新增字段，容易遗漏。

**修复方向**: 提取 `buildRejectCtx(...)` 辅助函数，消除三处重复。不阻塞合并。

---

## D2: 异常处理

### [MUST-FIX-2] `create-proxy-handler.ts` 硬编码 fallback errorMeta 与 adapter 系统重复

**文件**: `router/src/proxy/handler/create-proxy-handler.ts` L152-162  
**问题**: `unsupportedModality` 同时在三个地方定义：
1. `shared-error-meta.ts` L16 — OpenAI family
2. `anthropic.ts` L11 — Anthropic adapter
3. `create-proxy-handler.ts` L162 — fallback 硬编码

`create-proxy-handler.ts` 中的 fallback 是 `adapter?.errorMeta ?? { ...硬编码... }`，当 adapter 存在时用 adapter 的 meta，否则用硬编码。但 `unsupportedModality` 的值在三者中完全相同（`{ type: "invalid_request_error", code: "unsupported_modality" }`），所以当前行为正确。

然而，如果未来 Anthropic 调整错误格式（Anthropic 的 error type 通常不是 `invalid_request_error`），硬编码 fallback 会导致错误信息格式不一致。这不是当前 bug，但是健壮性风险。

**修复方向**: 考虑将 fallback 硬编码提取为常量或直接从 adapter 获取。不阻塞合并，标记为 LOW 优先级。

> **降级为 INFO**: 审查后发现三个定义值完全一致，且 fallback 只在 adapter 不存在时生效（理论上不会发生），实际风险极低。

**判定**: MUST FIX（原始评估）。重新评估后：**降级为 INFO**，因为三处定义一致，且 fallback 路径理论上不触发。

**最终判定**: ~~MUST FIX~~ → INFO。但 MUST-FIX-1 仍然成立，must_fix = 2 中的第二个来源见下方。

### [MUST-FIX-2 修正] `computeModalityRedirectTargets` 返回空列表后，failover-loop 的 `precomputeSnapshot` 缺少 modality-redirect 阶段的 reason 记录

**文件**: `router/src/proxy/handler/failover-loop.ts` L229-234  
**问题**: 空列表 early return 路径调用 `rejectAndReply` 时传入的 `pipelineSnapshot` 是 `precomputeSnapshot.toJSON()`。但 `precomputeSnapshot` 是在调用 `computeModalityRedirectTargets` 时传入的，该函数内部已通过 `snapshot.add()` 记录了 reason（如 `"no-eligible-targets"`、`"no-mapping-group"` 等），所以 snapshot 中已包含 modality-redirect 阶段信息。

但 **`computeModalityRedirectTargets` 内部的多个 return [] 路径使用了 `firstOriginalModel`**（L160），这是在第 6 步（全部过滤完后）才定义的变量。如果 targets 为空列表（第 1 步返回），snapshot 不会被添加任何记录，failover-loop 的 early return 也不会触发（因为第 1 步返回的是空列表 `[]`，不会进入 failover-loop 的空列表检查）。

实际执行路径：`targets.length === 0` 在 modality-redirect 第 1 步返回 `[]` → failover-loop L224 检查 `allTargets.length === 0` → 调用 `rejectAndReply`。此时 snapshot 中**没有 modality-redirect 阶段记录**。

这意味着 DB 日志中的 `pipeline_snapshot` 字段缺失 modality-redirect 诊断信息，运维排查时会看到空白的 modality-redirect 阶段。

**修复方向**: 在 `modality-redirect.ts` 第 100 行 `if (targets.length === 0) return targets;` 之前添加 snapshot 记录：

```typescript
if (targets.length === 0) {
  snapshot.add({
    stage: "modality-redirect",
    triggered: false,
    original_model: "",
    redirect_to: "",
    redirect_provider: "",
    reason: "empty-targets-input",
  } satisfies StageRecord);
  return targets;
}
```

**判定**: MUST FIX。运维排查"为什么请求被 400 拒绝"时，pipeline_snapshot 缺失 modality-redirect 阶段会严重阻碍定位。

---

## D3: 日志

### [LOW-1] snapshot reason 语义合并导致信息丢失

**文件**: `router/src/proxy/routing/modality-redirect.ts` L178, L188, L204, L219  
**问题**: 旧版代码为每种失败场景使用不同的 reason（`"no-multimodal-fallback-configured"`、`"invalid-fallback-config"`、`"fallback-provider-unavailable"`、`"fallback-missing-modality"`），新版全部合并为 `"no-eligible-targets"`。

这导致运维从 pipeline_snapshot 无法区分"没配 fallback"和"配了但 provider 不活跃"和"配了但不支持该模态"。这三种场景的修复动作完全不同：
- 没配 fallback → 配置 multimodal_fallback
- provider 不活跃 → 激活 provider
- 不支持该模态 → 换一个支持该模态的 fallback

**修复方向**: 恢复区分性 reason，至少保留 `no-fallback-configured`、`fallback-provider-inactive`、`fallback-missing-modality` 三种。不阻塞合并，但建议尽快修复。

---

## D4: Fail-fast

### [INFO-2] filter 循环中对每个 target 调用 `getProviderById` 和 `parseModels` 可能的 N+1 查询

**文件**: `router/src/proxy/routing/modality-redirect.ts` L113-125  
**问题**: 新增的 for 循环对每个 target 调用 `getProviderById(db, target.provider_id)`。如果 targets 较多（failover 策略下可能有 10+ targets），每次都是一次 SQLite 查询。虽然 `getProviderById` 可能内部有 prepared statement 缓存，但高频场景下仍有性能隐患。

**修复方向**: 可以在循环前批量获取 provider 信息，或依赖 getProviderById 的内部缓存。不阻塞合并，记录为优化点。

---

## D5: 测试友好

### [INFO-3] 测试覆盖充分

测试文件覆盖了核心场景：
- `modality-redirect.test.ts`: 纯函数测试，覆盖 filter+replace 各种分支（AC1-AC3, audio 过滤, provider 不存在等）
- `failover-modality-filter.test.ts`: 集成测试，覆盖空列表 → HTTP 400 的端到端路径（OpenAI + Anthropic 格式）
- `failover-loop-layered.test.ts`: 更新了 AC19 的预期行为（filter+replace 替代 prepend）

**正面评价**:
- 新增 `failover-modality-filter.test.ts` 覆盖了端到端的空列表 → 400 路径
- 测试 AC4/AC5 分别验证 OpenAI 和 Anthropic 格式的错误响应结构
- `normal image request` 测试确保回归保护

### [LOW-2] 缺少流式请求的空列表测试

**文件**: `router/tests/failover-modality-filter.test.ts`  
**问题**: 现有测试只覆盖非流式请求。failover-loop early return 路径中 `isStream` 的取值影响日志记录和 `RejectParams` 构造，流式场景未被测试。

**修复方向**: 添加一个 `stream: true` 的测试用例验证流式请求也正确返回 400。不阻塞合并。

---

## D6: 调试友好

### [LOW-3] `unsupportedModality` 错误消息缺少具体模态信息

**文件**: `router/src/proxy/proxy-core.ts` L77  
**问题**: 错误消息为固定字符串 `"Request contains multimodal content but no available model supports the required modality."`，不包含具体是哪个模态（image/audio）不被支持。运维需要查 pipeline_snapshot 才能获取 detected_modalities。

**修复方向**: 将检测到的模态信息传入错误消息，例如 `"No available model supports the required modalities: image"`。需要修改 `unsupportedModality()` 接受可选参数。不阻塞合并。

### [LOW-4] failover-loop early return 错误消息与 rejectAndReply 的 errorMessage 不够具体

**文件**: `router/src/proxy/handler/failover-loop.ts` L235  
**问题**: `errorMessage` 为 `"No eligible target: request modalities not supported by any available model"`，缺少 client_model 和具体模态信息。这个 errorMessage 会被写入 request_logs 表。

**修复方向**: 丰富 errorMessage，包含 clientModel 和模态列表。不阻塞合并。

---

## 汇总

| 编号 | 维度 | 级别 | 文件 | 行号 | 问题摘要 |
|------|------|------|------|------|----------|
| MUST-FIX-1 | D1 错误处理 | MUST FIX | modality-redirect.ts | L274-283 | catch 块返回原始 targets 导致异常时多模态请求打到不支持的上游 |
| MUST-FIX-2 | D2 异常处理 | MUST FIX | modality-redirect.ts | L100 | targets 空列表时 snapshot 无记录，阻碍排查 |
| LOW-1 | D3 日志 | LOW | modality-redirect.ts | L178-219 | reason 合并为 "no-eligible-targets" 丢失区分性 |
| INFO-1 | D1 错误处理 | INFO | failover-loop.ts | L218-233 | RejectParams 构造三处重复 |
| INFO-2 | D4 Fail-fast | INFO | modality-redirect.ts | L113-125 | filter 循环 N+1 查询 |
| INFO-3 | D5 测试友好 | INFO | 全部测试 | — | 测试覆盖充分（正面） |
| LOW-2 | D5 测试友好 | LOW | failover-modality-filter.test.ts | — | 缺少流式请求测试 |
| LOW-3 | D6 调试友好 | LOW | proxy-core.ts | L77 | 错误消息缺少具体模态 |
| LOW-4 | D6 调试友好 | LOW | failover-loop.ts | L235 | errorMessage 缺少 model 和模态信息 |
| INFO-4 | D2 异常处理 | INFO | create-proxy-handler.ts | L152-162 | 硬编码 fallback errorMeta 与 adapter 系统重复 |

**MUST FIX: 2 项** → verdict: **fail**
