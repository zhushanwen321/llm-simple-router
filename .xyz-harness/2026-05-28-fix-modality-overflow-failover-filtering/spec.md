---
verdict: pass
---

# Modality Constraint Filtering in Pre-compute Pipeline

## Background

当映射组同时配置了 Scheduled、Modality Fallback、Overflow 三种路由机制时，当前 `computeModalityRedirectTargets()` 采用 prepend 策略——将 fallback target 插入列表头部，但**保留所有不支持当前模态的原始 targets**。这导致 failover 循环会尝试已知必然失败的 targets（不支持图片的模型处理含图片的请求），浪费上游 API 调用、占用并发信号量、增加延迟。

用户反馈日志展示了这个问题：multimodal_fallback target 失败后，rollback 到不支持模态的原始模型再次失败（必然失败），"看着有点诡异，是不是中间 fail 之后就可以停了"。

## Functional Requirements

### FR-1: Modality 约束过滤

`computeModalityRedirectTargets()` 检测到请求包含多模态内容（image/audio）时，**过滤掉**不支持当前模态的 targets，而不仅仅是 prepend fallback。

具体行为表：

| # | 输入条件 | 输出 |
|---|---------|------|
| 1 | 无多模态内容 | 原始 targets 不变 |
| 2 | 有多模态 + 所有 targets 支持 | 原始 targets 不变 |
| 3 | 有多模态 + 部分 targets 支持 | 仅保留支持的 targets |
| 4 | 有多模态 + 全部不支持 + 有 multimodal_fallback 配置且 fallback 支持缺失模态 | `[fallback]`（仅 fallback target） |
| 5 | 有多模态 + 全部不支持 + fallback 不覆盖缺失模态 | 空列表 → 提前报错 |
| 6 | 有多模态 + 全部不支持 + 无 fallback 配置 | 空列表 → 提前报错 |

### FR-2: 空列表提前报错

当 `computeModalityRedirectTargets()` 返回空列表时，`failover-loop.ts` 应立即返回错误响应，不进入 failover 循环。

错误格式通过 `createErrorFormatter` 机制生成（与 `promptTooLong` 等现有错误一致），对 OpenAI 和 Anthropic API 类型输出统一的 `{ error: { message, type, code } }` 结构：

- **HTTP Status**: `400 Bad Request`
- **Body**: `{ "error": { "message": "...", "type": "invalid_request_error", "code": "unsupported_modality" } }`
- **OpenAI errorMeta**: `{ type: "invalid_request_error", code: "unsupported_modality" }`
- **Anthropic errorMeta**: `{ type: "invalid_request_error", code: "unsupported_modality" }`

message 示例：`Request contains image content but no available model supports this modality. Mapping: 'gpt-4o', detected modalities: image`

### FR-3: ErrorKind 扩展

在 `ErrorKind` 联合类型中新增 `unsupportedModality`，在 `createErrorFormatter` 中注册 statusCode = 400，在各 adapter 的 `errorMeta` 中配置对应的 type 和 code。

### FR-4: PipelineSnapshot 记录

`computeModalityRedirectTargets()` 中的 snapshot 记录需更新 reason 字段，区分以下场景：

| reason | 含义 |
|--------|------|
| `no-multimodal-detected` | 无多模态内容，未触发 |
| `all-targets-support-modalities` | 所有 targets 支持检测到的模态 |
| `filtered-ineligible-targets` | 过滤了部分不支持模态的 targets |
| `replaced-with-fallback` | 全部不支持，替换为 fallback |
| `no-eligible-targets` | 全部不支持且无有效 fallback，返回空列表 |
| `internal-error` | 异常安全回退 |

## Acceptance Criteria

### AC-1: Modality 过滤 — 部分支持
- **Given**: 映射组 targets = [A(不支持image), B(支持image), C(支持image)]，请求含 image
- **When**: `computeModalityRedirectTargets()` 执行
- **Then**: 返回 [B, C]，snapshot reason = `filtered-ineligible-targets`

### AC-2: Modality 过滤 — 全部不支持 + fallback
- **Given**: 映射组 targets = [A(不支持image), B(不支持image)]，配置 multimodal_fallback = C(支持image)
- **When**: `computeModalityRedirectTargets()` 执行
- **Then**: 返回 [C]，snapshot reason = `replaced-with-fallback`

### AC-3: Modality 过滤 — 全部不支持 + 无 fallback
- **Given**: 映射组 targets = [A(不支持image)]，无 multimodal_fallback 配置
- **When**: `computeModalityRedirectTargets()` 执行
- **Then**: 返回空列表，snapshot reason = `no-eligible-targets`

### AC-4: 提前报错 — OpenAI 格式
- **Given**: AC-3 场景，apiType = openai
- **When**: failover-loop 处理空列表
- **Then**: 返回 HTTP 400，body 包含 `{ "error": { "message": "...", "type": "invalid_request_error", "code": "unsupported_modality" } }`

### AC-5: 提前报错 — Anthropic apiType
- **Given**: AC-3 场景，apiType = anthropic
- **When**: failover-loop 处理空列表
- **Then**: 返回 HTTP 400，body 包含 `{ "error": { "message": "...", "type": "invalid_request_error", "code": "unsupported_modality" } }`（通过 `createErrorFormatter` + `ANTHROPIC_ERROR_META` 生成，格式与现有 `promptTooLong` 等错误一致）

### AC-6: 无多模态 — 不变
- **Given**: 映射组 targets = [A, B]，请求无图片/音频
- **When**: `computeModalityRedirectTargets()` 执行
- **Then**: 返回 [A, B] 不变，snapshot reason = `no-multimodal-detected`

### AC-7: 全部支持 — 不变
- **Given**: 映射组 targets = [A(支持image), B(支持image)]，请求含 image
- **When**: `computeModalityRedirectTargets()` 执行
- **Then**: 返回 [A, B] 不变，snapshot reason = `all-targets-support-modalities`

### AC-8: Overflow 对过滤后列表仍生效
- **Given**: Modality 过滤后 targets = [B(支持image, 8k窗口)]，请求含 image 且 token 超阈值，B 配置了 overflow_model
- **When**: `expandOverflowTargets()` 执行
- **Then**: 返回 [B'(overflow), B]，overflow 正常生效

### AC-9: 不影响现有 promptTooLong 错误
- **Given**: 请求 token 超过上下文窗口，无模态问题
- **When**: 正常 failover 流程
- **Then**: promptTooLong 错误行为不变

## Constraints

- **不改 overflow 逻辑**：`expandOverflowTargets()` 保持 prepend 行为（窗口估算是近似值，原始 target 有合理成功概率，不是硬约束）
- **不改 resolveMapping**：scheduled 策略逻辑不变
- **不改 failover 循环逻辑**：只新增空列表提前报错分支，循环本身不变
- **API 错误规范**：新增的 `unsupportedModality` 错误必须同时支持 OpenAI 和 Anthropic 两种格式，由 `FormatAdapter.errorMeta` 配置
- **向后兼容**：不改变 `computeModalityRedirectTargets` 的函数签名（输入参数和返回类型不变）
- **异常安全**：`computeModalityRedirectTargets()` 内部错误仍返回原始 targets（已有的 try-catch 保持）

## Out of Scope

- 重构为约束管道架构（当前 prepend 模式足够，只改 modality 层）
- overflow 层的约束过滤（窗口估算是软约束，不过滤）
- 前端 UI 变更（配置接口不变，只改执行行为）
- 日志/监控界面的新增展示字段

## 业务用例

### UC-1: 含图片请求避免无效 failover
- **Actor**: LLM 客户端（如 Cursor、Continue）
- **场景**: 客户端向映射组发送含图片的请求，映射组的首选模型不支持图片，配置了 multimodal_fallback
- **预期结果**: 请求直接路由到支持图片的 fallback 模型；fallback 失败时立即返回错误，不浪费请求去尝试不支持图片的其他模型

### UC-2: 管理员排查无效重试
- **Actor**: 系统管理员
- **场景**: 查看请求日志，发现含图片请求不再出现"multimodal fallback 失败 → 原始模型失败"的无效链路
- **预期结果**: 日志中只出现一次尝试（fallback target）或零次（提前报错），mapping_reason 字段清晰记录过滤原因

## Complexity Assessment

- **影响范围**: 6 个文件：
  1. `router/src/proxy/routing/modality-redirect.ts` — 核心逻辑（prepend → filter + replace）
  2. `router/src/proxy/handler/failover-loop.ts` — 空列表提前报错分支
  3. `router/src/proxy/proxy-core.ts` — `ErrorKind` 新增 `unsupportedModality` + `createErrorFormatter` 注册
  4. `router/src/proxy/format/types.ts` — `ErrorKind` 类型同步更新（与 proxy-core.ts 两处独立声明）
  5. `router/src/proxy/format/adapters/shared-error-meta.ts` — `OPENAI_FAMILY_ERROR_META` 新增条目（openai + responses adapter 共用）
  6. `router/src/proxy/format/adapters/anthropic.ts` — `ANTHROPIC_ERROR_META` 新增条目
- **复杂度**: Low-Medium。核心改动在 `computeModalityRedirectTargets` 内部，从 prepend 改为 filter + replace，函数签名不变。新增 ErrorKind 和 errorMeta 是机械性扩展（6 个文件中有 4 个是单行新增）。
- **风险点**: 需确保 Modality 检测逻辑（`detectModalities`）覆盖所有 API 格式，否则可能误过滤。当前已覆盖 OpenAI / Anthropic / Responses 三种格式。
- **测试**: 需新增 modality 过滤的单元测试（6 个行为表场景 + 2 种 API 格式的错误响应测试）
