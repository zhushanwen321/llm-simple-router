---
verdict: pass
---

# AI 生成重试规则补齐 provider 维度

## Background

PR #165 为重试规则系统增加了 provider 隔离（`provider_id` 字段）和 JSON body matchers。后端 DB schema、matcher 缓存、resilience 层、RetryRules 手动编辑页面的 provider 选择器均已实现。

但 **AI 生成规则路径（请求详情 → "AI 生成"按钮）缺少 provider 维度**：
- 后端 `/admin/api/retry-rules/ai-generate` 返回的 `rule` 对象没有 `provider_id`
- 前端 `AiRulePreviewDialog` 弹窗没有 provider 下拉选择器
- AI 生成的规则永远创建为通用规则（`provider_id: null`），即使日志明确属于某个 provider

用户默认创建通用规则，但需要能在预览弹窗中手动选择绑定到特定 provider。

## Functional Requirements

### FR1: 后端返回 provider_id

`/admin/api/retry-rules/ai-generate` 返回的 `rule` 对象增加 `provider_id` 字段，值取自请求日志的 `log.provider_id`（可能为 `null`）。

- 后端不改 AI prompt（AI 不负责决定 provider 维度）
- `buildUserPrompt()` 已有 `log.provider_id` 和 `log.provider_name`，不需要额外查询

### FR2: 前端类型定义更新

`frontend/src/api/client.ts` 的 `AiRetryGenerateResult.rule` 增加 `provider_id?: string | null`。

### FR3: AiRulePreviewDialog 增加 provider 下拉选择器

在 AI 规则预览弹窗的表单中增加 provider 选择器：

- 位置：name 字段之后、匹配条件区域之前
- 选项："通用（所有供应商）"（默认） + 所有已配置的 provider
- 初始值：后端返回的 `provider_id`（但用户需求是默认通用，见 FR4）
- 组件：复用 `Select` + `SelectItem`，与 RetryRules.vue 中手动编辑的 provider 选择器一致
- 需要在弹窗挂载时加载 providers 列表（`api.getProviders()`）
- **降级**：如果 `api.getProviders()` 失败，provider 选择器仍显示（只有"通用"选项），同时 toast 提示加载失败。不影响保存（通用规则不需要 provider 列表）

### FR4: 默认值语义

无论后端返回的 `provider_id` 是什么，弹窗中 provider 选择器**默认选中"通用（所有供应商）"**（即 `provider_id: null`）。

理由：用户明确要求默认不绑定 provider。

### FR5: 提交时传递 provider_id

`AiRulePreviewDialog.handleSave()` 调用 `api.createRetryRule()` 时，将用户选择的 `provider_id` 传入请求体。选"通用"时传 `null`。

## Acceptance Criteria

| AC | 验证方式 |
|----|----------|
| AC1 | 后端 `/admin/api/retry-rules/ai-generate` 返回的 `rule` 对象包含 `provider_id` 字段（值 = 日志的 `provider_id`） |
| AC2 | 前端 `AiRetryGenerateResult.rule` 类型包含 `provider_id?: string \| null` |
| AC3 | AI 预览弹窗显示 provider 下拉选择器，选项包含"通用"和所有已配置 provider |
| AC4 | 弹窗打开时 provider 默认选中"通用（所有供应商）"，不管后端返回什么 |
| AC5 | 用户选择某个 provider 后保存，创建的规则 `provider_id` 为该 provider 的 id |
| AC6 | 用户保持"通用"后保存，创建的规则 `provider_id` 为 null |
| AC7 | 保存后 RetryRules 页面表格 Provider 列正确显示"通用"徽章或 provider 名称 |
| AC8 | `api.getProviders()` 失败时，弹窗仍可正常打开并保存通用规则（选择器只有"通用"选项 + toast 错误提示） |

## Constraints

- 复用 `RetryRules.vue` 中的 provider 选择器模式（`Select` + `SelectItem`，占位值 `"__all__"` → 提交时映射为 `null`）
- `AiRulePreviewDialog` 是编辑→保存模式（用户点"保存"才提交），符合现有交互模式
- 不改 AI system prompt 的内容
- 不改 RetryRules 页面的手动添加/编辑功能（已正常工作）
- 不改后端 matcher/resilience 层（已支持 provider 隔离）
- **已验证**：`CreateRetryRuleSchema`（`admin/retry-rules.ts` L115）已接受 `provider_id: Type.Optional(Type.Union([Type.String(), Type.Null()]))`，AI 生成路径调用的同一个 create API，无需额外 schema 改动

## Complexity Assessment

**Low。** 4 个文件改动，每处 5-15 行：
1. 后端返回值加 1 个字段
2. 前端类型加 1 个字段
3. 弹窗组件加 provider 选择器 + 加载 providers
4. 调用方传递 provider_id

无新 DB schema、无新 API、无复杂状态管理。
