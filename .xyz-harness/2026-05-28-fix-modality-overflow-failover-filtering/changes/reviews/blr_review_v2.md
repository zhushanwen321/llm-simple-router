---
verdict: "pass"
must_fix: 0
---

# Business Logic Review v2 — Modality Constraint Filtering

**审查模式**: dev（基于 spec + use-cases + diff 的模拟数据推演）

## 审查范围

7 个源码变更文件 + 3 个测试文件，覆盖 spec FR-1~FR-4 全部功能需求和 UC-1/UC-2 全部业务路径。

## UC-1: 含图片请求避免无效 failover

### UC-1 Main Flow Step 2 → 3: 模态检测 + 过滤

**模拟数据 A（部分过滤 — AC-1）**:
```
请求体: { messages: [{ role: "user", content: [
  { type: "text", text: "描述图片" },
  { type: "image_url", image_url: { url: "https://example.com/img.png" } }
]}]}
targets = [
  { provider_id: "openai", backend_model: "gpt-4" },     // DB: capabilities=["text"]
  { provider_id: "openai", backend_model: "gpt-4o" },    // DB: capabilities=["text","image"]
  { provider_id: "anthropic", backend_model: "claude-sonnet-4" }  // DB: capabilities=["text","image"]
]
```

**推演**:
1. `detectModalities(body)` → `Set{"image"}`（命中 `type: "image_url"` 分支）✓
2. Step 3 遍历：
   - gpt-4: `getProviderById("openai")` → `parseModels()` → capabilities=["text"] → `supportsModality(["text"], "image")` = false → **过滤**
   - gpt-4o: capabilities=["text","image"] → `supportsModality(["text","image"], "image")` = true → **保留**
   - claude-sonnet-4: capabilities=["text","image"] → true → **保留**
3. eligible=[gpt-4o, claude-sonnet-4], length=2, targets.length=3 → 进入 Step 5
4. 返回 [gpt-4o, claude-sonnet-4], reason=`filtered-ineligible-targets` ✓

**failover-loop 消费**:
- `allTargets.length=2 > 0` → 不触发提前报错 ✓
- `expandOverflowTargets([gpt-4o, claude-sonnet-4])` → overflow 正常生效 ✓
- failover 循环只尝试 gpt-4o 和 claude-sonnet-4，gpt-4 永远不会被尝试 ✓

### UC-1 Main Flow Step 5: 全部过滤 → fallback 替换

**模拟数据 B（全部过滤 + fallback — AC-2）**:
```
请求体: 同上（含 image_url）
mapping_group rule: {
  targets: [{ provider_id: "deepseek", backend_model: "deepseek-v3" }],
  multimodal_fallback: { provider_id: "openai", backend_model: "gpt-4o" }
}
targets = [
  { provider_id: "deepseek", backend_model: "deepseek-v3" },  // capabilities=["text"]
  { provider_id: "zhipu", backend_model: "glm-4" }             // capabilities=["text"]
]
```

**推演**:
1. `detectModalities()` → Set{"image"} ✓
2. Step 3: deepseek-v3 过滤, glm-4 过滤 → eligible=[] ✓
3. `eligible.length=0` → 跳过 Step 4/5 → 进入 Step 6 ✓
4. Step 6a: `getMappingGroup(db, "client-model")` → 找到 group ✓
5. Step 6b: `JSON.parse(group.rule)` → 解析成功 ✓
6. Step 6c: `rule.multimodal_fallback` = {provider_id:"openai", backend_model:"gpt-4o"} → 存在且是 object ✓
7. Step 6d: `getProviderById("openai")` → provider 存在, `is_active=1` ✓
8. Step 6e: fbCapabilities=["text","image"], `fbMissing = ["image"].filter(m => !supportsModality(...))` = [] → 通过 ✓
9. Step 6f: 创建 fbTarget = {provider_id:"openai", backend_model:"gpt-4o"}, 返回 [fbTarget], reason=`replaced-with-fallback` ✓

**failover-loop 消费**:
- `allTargets=[gpt-4o], length=1 > 0` → 不触发提前报错 ✓
- failover 循环只尝试 gpt-4o ✓
- gpt-4o 成功 → 200 ✓
- gpt-4o 失败 → 无更多 target → 5xx（不是 400 unsupported_modality）✓

### UC-1 Main Flow Step 6: 全部过滤 + 无 fallback

**模拟数据 C（全部过滤 + 无 fallback — AC-3）**:
```
请求体: 同上
mapping_group rule: { targets: [{ provider_id: "deepseek", backend_model: "deepseek-v3" }] }
// 无 multimodal_fallback 字段
targets = [{ provider_id: "deepseek", backend_model: "deepseek-v3" }]  // capabilities=["text"]
```

**推演**:
1. `detectModalities()` → Set{"image"} ✓
2. Step 3: deepseek-v3 过滤 → eligible=[] ✓
3. Step 6: `getMappingGroup()` → 找到 ✓
4. Step 6c: `rule.multimodal_fallback` = undefined → `fallback == null` ✓
5. 返回 [], reason=`no-eligible-targets` ✓

**failover-loop 提前报错**:
1. `allTargets.length === 0` → 进入空列表分支 ✓
2. `rejectAndReply(reply, rCtx, errors.unsupportedModality(), ...)` ✓
3. `createErrorFormatter` → statusCode=400, body={error:{message, type:"invalid_request_error", code:"unsupported_modality"}} ✓
4. `insertRejectedLog` 写入日志（含 pipelineSnapshot）✓
5. 返回 HTTP 400 给客户端 ✓

### UC-1 Alt Path 4a: 路由到的 target 失败 → failover 到下一个支持的

**模拟数据 D（部分过滤后多 target failover）**:
```
targets = [
  { provider_id: "openai", backend_model: "gpt-4o" },     // 支持 image, 上游返回 500
  { provider_id: "anthropic", backend_model: "claude-sonnet-4" }  // 支持 image, 上游返回 200
]
请求含 image
```

**推演**:
1. Step 3: 两个都支持 image → eligible=[gpt-4o, claude-sonnet-4] ✓
2. `eligible.length === targets.length` → Step 4 → 返回原始 targets 不变, reason=`all-targets-support-modalities` ✓
3. failover 循环: 尝试 gpt-4o → 500 → exclude → 尝试 claude-sonnet-4 → 200 ✓
4. 不涉及 modality 过滤的 failover 行为，与现有逻辑一致 ✓

### UC-1 Alt Path 5a: fallback 失败 → 不尝试原始 targets

**模拟数据 E（fallback 失败）**:
```
targets = [{ provider_id: "deepseek", backend_model: "deepseek-v3" }]  // text-only
multimodal_fallback = { provider_id: "openai", backend_model: "gpt-4o" }  // 上游返回 500
请求含 image
```

**推演**:
1. Modality 过滤 → deepseek-v3 被过滤 → eligible=[] ✓
2. Step 6f: 替换为 [gpt-4o] ✓
3. failover 循环: 尝试 gpt-4o → 500 → exclude → 无更多 target → 循环结束 ✓
4. deepseek-v3 **不被尝试**（已被 modality 过滤排除）✓
5. 测试 AC19 验证: `textOnlyCalls === 0, imageCapableCalls === 1` ✓

### UC-1 Alt Path 6a: 客户端收到明确错误

**模拟数据 F（OpenAI 格式错误响应 — AC-4）**:
```
apiType = "openai", allTargets = []
```

**推演响应**:
```json
{
  "statusCode": 400,
  "body": {
    "error": {
      "message": "Request contains multimodal content but no available model supports the required modality.",
      "type": "invalid_request_error",
      "code": "unsupported_modality"
    }
  }
}
```
- 来源: `createErrorFormatter` → `formatBody("unsupportedModality", message)` → `{ error: { message, ...OPENAI_FAMILY_ERROR_META["unsupportedModality"] }}`
- OPENAI_FAMILY_ERROR_META.unsupportedModality = `{ type: "invalid_request_error", code: "unsupported_modality" }` ✓
- 测试 AC-4 验证完整断言链 ✓

**模拟数据 G（Anthropic 格式错误响应 — AC-5）**:
```
apiType = "anthropic", allTargets = []
```

**推演响应**:
```json
{
  "statusCode": 400,
  "body": {
    "error": {
      "message": "Request contains multimodal content but no available model supports the required modality.",
      "type": "invalid_request_error",
      "code": "unsupported_modality"
    }
  }
}
```
- 来源: `ANTHROPIC_ERROR_META.unsupportedModality` = `{ type: "invalid_request_error", code: "unsupported_modality" }` ✓
- 与 `promptTooLong` 的 Anthropic 错误格式一致 ✓
- 测试 AC-5 验证完整断言链 ✓

**模拟数据 H（Responses API adapter）**:
- Responses adapter 使用 `OPENAI_FAMILY_ERROR_META`（shared-error-meta.ts），已包含 `unsupportedModality` ✓
- 错误格式与 OpenAI adapter 完全一致 ✓

## UC-2: 管理员排查无效重试

### UC-2 Main Flow Step 4: snapshot reason 清晰记录

**模拟数据 I（filtered-ineligible-targets — UC-2 Alt 4a）**:
```
pipeline_snapshot = [
  { stage: "modality-redirect", triggered: true, reason: "filtered-ineligible-targets",
    original_model: "deepseek-v3", detected_modalities: ["image"],
    redirect_to: "", redirect_provider: "" },
  { stage: "overflow", triggered: false },
  { stage: "routing", strategy: "failover", provider_id: "openai", backend_model: "gpt-4o" }
]
```
- reason 明确说明"过滤了不合格的 targets" ✓
- `detected_modalities: ["image"]` 记录了检测到的模态 ✓
- 管理员可清晰判断 modality 过滤已生效 ✓

**模拟数据 J（replaced-with-fallback — UC-2 Alt 4b）**:
```
pipeline_snapshot = [
  { stage: "modality-redirect", triggered: true, reason: "replaced-with-fallback",
    original_model: "deepseek-v3", redirect_to: "gpt-4o", redirect_provider: "openai",
    detected_modalities: ["image"] },
]
```
- `redirect_to` 和 `redirect_provider` 记录了 fallback 的具体 provider ✓

**模拟数据 K（no-eligible-targets — UC-2 Alt 4c）**:
```
pipeline_snapshot = [
  { stage: "modality-redirect", triggered: false, reason: "no-eligible-targets",
    original_model: "deepseek-v3" },
]
```
- `triggered: false` 说明没有成功重定向 → 管理员看到 0 次上游请求 ✓
- 与 HTTP 400 + `unsupported_modality` 错误码配合，管理员可快速定位问题 ✓

### UC-2 Postcondition: 不再出现诡异链路

**Before (prepend 策略)**:
```
请求日志:
  1. B(fallback) → 500 (upstream error)
  2. A(original text-only) → 400 (image not supported) ← 必然失败的无效尝试
```

**After (filter+replace 策略)**:
```
请求日志（模拟数据 B — fallback 成功）:
  1. gpt-4o(fallback) → 200 ← 只有一次尝试

请求日志（模拟数据 E — fallback 失败）:
  1. gpt-4o(fallback) → 500 ← 只有 fallback 一次尝试，无无效回退

请求日志（模拟数据 C — 无 fallback）:
  0. 无上游请求，直接 HTTP 400 ← 零次无效尝试
```
- 三种场景都不存在"必然失败的 target"被尝试的情况 ✓

## FR-1 行为表逐行验证

| # | 输入条件 | 预期输出 | 代码路径 | 验证 |
|---|---------|---------|---------|------|
| 1 | 无多模态 | 原始 targets | Step 2: `modalities.size === 0` → return targets | ✓ 测试覆盖 |
| 2 | 有多模态 + 全支持 | 原始 targets | Step 4: `eligible.length === targets.length` → return targets | ✓ 测试覆盖 |
| 3 | 有多模态 + 部分支持 | 仅支持的 | Step 5: `eligible.length > 0` → return eligible | ✓ AC-1 测试 |
| 4 | 有多模态 + 全不支持 + fallback 支持 | [fallback] | Step 6f: 创建 fbTarget, return [fbTarget] | ✓ AC-2 测试 |
| 5 | 有多模态 + 全不支持 + fallback 不覆盖 | [] | Step 6e: `fbMissing.length > 0` → return [] | ✓ 测试覆盖 |
| 6 | 有多模态 + 全不支持 + 无 fallback | [] | Step 6c: `fallback == null` → return [] | ✓ AC-3 测试 |

## FR-3 ErrorKind 扩展验证

| 文件 | 新增内容 | 与现有模式一致 |
|------|---------|-------------|
| `format/types.ts` | `\| "unsupportedModality"` | ✓ 联合类型扩展 |
| `proxy-core.ts` ErrorKind | `\| "unsupportedModality"` | ✓ 独立声明，与 types.ts 同步 |
| `proxy-core.ts` interface | `unsupportedModality(): ProxyErrorResponse` | ✓ 签名模式与 promptTooLong 一致 |
| `proxy-core.ts` factory | statusCode=400, static message | ✓ 与 promptTooLong(400) 模式一致 |
| `shared-error-meta.ts` | `{ type: "invalid_request_error", code: "unsupported_modality" }` | ✓ openai + responses adapter |
| `anthropic.ts` | `{ type: "invalid_request_error", code: "unsupported_modality" }` | ✓ anthropic adapter |
| `create-proxy-handler.ts` fallback | `{ type: "invalid_request_error", code: "unsupported_modality" }` | ✓ adapter 获取失败时的 fallback |

注意: `ErrorKind` 在 `proxy-core.ts` 和 `format/types.ts` 两处独立声明，均已同步更新 ✓

## FR-4 PipelineSnapshot Reason 覆盖

| Spec 定义 reason | 代码触发位置 | 触发条件 | 测试覆盖 |
|-----------------|------------|---------|---------|
| `no-multimodal-detected` | Step 2 | modalities.size=0 | ✓ |
| `all-targets-support-modalities` | Step 4 | eligible.length=targets.length | ✓ |
| `filtered-ineligible-targets` | Step 5 | 0 < eligible.length < targets.length | ✓ AC-1 |
| `replaced-with-fallback` | Step 6f | fallback 覆盖所有模态 | ✓ AC-2 |
| `no-eligible-targets` | Step 6c/6d/6e | 无 fallback / fb inactive / fb 不覆盖 | ✓ AC-3 |
| `internal-error` | catch | 异常 | ✓ |

**额外 reason（不在 spec 表中，增强诊断能力）**:

| Reason | 位置 | 说明 |
|--------|------|------|
| `no-mapping-group` | Step 6a | getMappingGroup 返回 null |
| `rule-parse-error` | Step 6b | JSON.parse 失败 |

这些额外 reason 均返回空列表（与 `no-eligible-targets` 行为一致），不影响业务正确性 ✓

## AC 覆盖矩阵

| AC | 测试文件 | 测试名 | 状态 |
|----|---------|--------|------|
| AC-1 | modality-redirect.test.ts | `AC-1: filters out targets lacking modality, keeps eligible ones` | ✓ |
| AC-2 | modality-redirect.test.ts | `AC-2: replaces all targets with fallback when all filtered out` | ✓ |
| AC-3 | modality-redirect.test.ts | `AC-3: returns empty array when all targets filtered and no fallback` | ✓ |
| AC-4 | failover-modality-filter.test.ts | `AC-4: returns HTTP 400 with unsupported_modality code (OpenAI)` | ✓ |
| AC-5 | failover-modality-filter.test.ts | `AC-5: returns HTTP 400 with unsupported_modality code (Anthropic)` | ✓ |
| AC-6 | modality-redirect.test.ts | `records reason 'no-multimodal-detected' when body has no multimodal content` | ✓ |
| AC-7 | modality-redirect.test.ts | `records reason 'all-targets-support-modalities'` | ✓ |
| AC-8 | 代码路径验证（overflow 接收过滤后列表） | 无专门集成测试 | ⚠ LOW |
| AC-9 | 代码路径验证（promptTooLong 不受影响） | 无回归测试 | ⚠ LOW |

## 发现问题

### LOW-1: AC-8 缺少 modality-filtered + overflow 的专门集成测试

**位置**: `tests/failover-loop-layered.test.ts`

**说明**: AC-8 验证"modality 过滤后的列表仍然正常触发 overflow"。当前代码路径正确（`expandOverflowTargets` 直接接收 `allTargets`），且 AC18 测试覆盖了 IR+OF 交互，但 AC18 走的是 `replaced-with-fallback` 路径（全部替换），而非 `filtered-ineligible-targets`（部分过滤）路径。

**缺少的场景**:
```
targets = [
  A(text-only, 有 overflow 配置),   // 被 modality 过滤
  B(支持 image, 8k 窗口)           // 保留
]
请求: 含 image + token 超阈值
预期: 过滤后=[B], overflow 扩展后=[B_overflow, B]
```

**风险**: 低。代码路径是直通的（过滤 → overflow），不涉及条件分支。但如果未来在 modality filter 和 overflow 之间插入新逻辑，缺少回归保护。

**建议**: 添加一个集成测试覆盖 `filtered-ineligible-targets` + `expandOverflowTargets` 的交互。

### LOW-2: AC-9 缺少 promptTooLong 回归测试

**位置**: 无

**说明**: Spec AC-9 要求"promptTooLong 错误行为不变"。当前实现只新增了 `unsupportedModality` 到 `ErrorKind` 和各 adapter 的 `errorMeta`，不修改任何现有字段。`createErrorFormatter` 中 `promptTooLong` 的 statusCode=400 和 message 不变。

**风险**: 极低。改动是纯增量（新增联合类型成员 + 新增 Record 条目），TypeScript 编译器保证穷尽匹配。

### INFO-1: 错误消息缺少动态信息

**位置**: `proxy-core.ts` L75

**说明**: Spec 的 message 示例包含映射名和检测到的模态:
> `Request contains image content but no available model supports this modality. Mapping: 'gpt-4o', detected modalities: image`

实际实现使用静态消息:
> `Request contains multimodal content but no available model supports the required modality.`

这与其他错误（如 `promptTooLong`）的静态消息模式一致。动态信息（模态类型、映射名）通过 `pipeline_snapshot` 保留在日志中，管理员可通过日志获取。

**影响**: 客户端收到的错误消息不够具体，但足以判断问题类型。`pipeline_snapshot` 中保留了完整诊断信息。

### INFO-2: provider 不存在时 target 被保留（保守策略）

**位置**: `modality-redirect.ts` L119-122

**说明**: 当 `getProviderById()` 返回 null（provider 被删除或数据库异常）时，target 被保留而非过滤。这意味着如果所有 provider 都查不到，过滤不生效。

**测试覆盖**: `modality-redirect.test.ts` 中有测试 `"keeps target when provider does not exist in DB"` 验证此行为 ✓

**影响**: 保守策略避免了因临时 DB 问题误过滤 target 的风险。被保留的 target 会在后续 transport 层因 provider 不存在而自然失败，不会导致错误的路由决策。

## 约束遵守验证

| Spec 约束 | 验证 |
|-----------|------|
| 不改 overflow 逻辑 | ✓ `expandOverflowTargets` 函数体零改动 |
| 不改 resolveMapping | ✓ `resolveMapping` 未被触碰 |
| 不改 failover 循环逻辑 | ✓ 仅新增空列表提前报错分支（L220-239），循环体零改动 |
| API 错误规范：同时支持 OpenAI/Anthropic | ✓ 3 个 adapter + fallback 均已注册 |
| 向后兼容：函数签名不变 | ✓ `computeModalityRedirectTargets` 签名未改 |
| 异常安全 | ✓ try-catch 包裹，返回原始 targets + `internal-error` reason |

## 总结

| 维度 | 结论 |
|------|------|
| UC-1 主流程 (6 步) | 全部覆盖 ✓ |
| UC-1 异常路径 (4a/5a/6a) | 全部覆盖 ✓ |
| UC-2 主流程 (5 步) | 全部覆盖 ✓ |
| UC-2 异常路径 (4a/4b/4c) | 全部覆盖 ✓ |
| FR-1 行为表 (6 行) | 全部验证 ✓ |
| FR-3 ErrorKind | 全部 6 处注册 ✓ |
| FR-4 Reason | 全部 6+2 种 ✓ |
| AC 覆盖 | 9/9 覆盖（AC-8/AC-9 为代码路径验证，无专门集成测试） |
| MUST FIX | 0 |
| LOW | 2（缺少两个集成测试） |
| INFO | 2（静态消息、保守策略） |

**Verdict: PASS** — 实现完整覆盖所有业务用例，模拟数据推演验证所有执行路径正确。
