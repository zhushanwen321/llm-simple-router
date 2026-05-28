---
verdict: pass
---

# Thinking Level Display & Model Filter Fix

## Background

### Thinking Level Display

代理路由器支持 OpenAI、Anthropic、Responses API 三种 API 类型，每种类型表达"模型思考深度"的参数不同：

| API 类型 | 参数 | 值 |
|---------|------|---|
| OpenAI | `reasoning_effort` | `"low"` / `"medium"` / `"high"` |
| Anthropic | `thinking.type` | `"enabled"` / `"disabled"` |
| Responses API | `reasoning.effort` | `"low"` / `"medium"` / `"high"` |

后端已有 `thinking-resolver.ts` 和 `thinking-mapper.ts` 处理参数转换，但 **未将解析结果传递到前端**。前端在实时监控、请求日志、请求详情中没有任何 thinking level 的展示。

### Model Filter Bug

日志页面当前只有一个"模型"过滤下拉框，存在两个 bug：

1. **下拉选项来源错误**：`loadModelOptions()` 从 `metrics_summary` 取 `backend_model`（如 `deepseek-v4-flash`），但选中 provider 后用 `provider.models[].name`（配置显示名如 `ds-flash`）去过滤，导致匹配 0 条。
2. **过滤字段错误**：`buildFilterParams()` 将选中值作为 `model` 参数传给后端，后端用 `rl.model LIKE %value%` 过滤。但 `rl.model` 存的是客户端模型名，`rm.backend_model` 才是实际转发模型名，两者不同时匹配失败。

**修复方案**：将单个模型过滤拆分为两个独立过滤条件——客户端模型（`rl.model`）和目标模型（`rm.backend_model`）。

## Functional Requirements

### Part A: Thinking Level Display

#### FR-A1: 提取 thinking level 并传递到前端

后端在代理请求处理流程中，从客户端请求体提取 thinking level 字符串，传递到前端。

**提取规则**（按 API 类型）：

| api_type | 提取来源 | 提取值 | 无参数时 |
|----------|---------|--------|---------|
| `openai` | `body.reasoning_effort` | 原始值（`"low"` / `"medium"` / `"high"`） | `"off"` |
| `anthropic` | `body.thinking?.type` | `"enabled"` 或 `"disabled"` | `"off"` |
| `openai-responses` | `body.reasoning?.effort` | 原始值（`"low"` / `"medium"` / `"high"`） | `"off"` |

注意：`reasoning_effort` 和 `reasoning.effort` 可能同时存在。优先级：`reasoning` 对象 > `reasoning_effort`（与 `thinking-resolver.ts` 一致）。

**传递路径**：

1. **实时监控**：在 `ActiveRequest` 类型中新增 `thinkingLevel?: string` 字段，在 `buildActiveRequest()` 中从请求体提取并设置。通过 SSE 广播到前端。
2. **请求日志/详情**：不新增 DB 列。前端从已有的 `client_request` JSON 字符串中解析提取。`client_request` 格式为 `{ headers: {...}, body: {...} }`，body 中包含原始请求参数。

**不展示** `budget_tokens`、`max_tokens` 等数值参数。

#### FR-A2: Monitor 实时监控页面展示 thinking level

在 Monitor 页面的活跃请求卡片中展示 thinking level。

#### FR-A3: Logs 请求日志列表展示 thinking level

在 LogTableRow 中展示 thinking level 列。

#### FR-A4: 请求详情 Modal 展示 thinking level

在 UnifiedRequestDialog（请求详情弹窗）的 RequestOverviewPanel 中展示 thinking level。

#### FR-A5: 无 thinking 参数时展示为 "off"

当请求中没有 thinking 相关参数时，thinking level 显示为 `"off"`。

### Part B: Model Filter Fix

#### FR-B1: 拆分为客户端模型和目标模型两个过滤条件

将现有的单个"模型"下拉框替换为两个独立下拉框：

| 过滤条件 | 标签 | 数据来源（下拉选项） | 过滤字段 | API 参数 |
|---------|------|-------------------|---------|---------|
| 客户端模型 | "Client Model" / "客户端模型" | `request_logs.model` 去重 | `rl.model` | `client_model` |
| 目标模型 | "Backend Model" / "目标模型" | `request_metrics.backend_model` 去重 | `rm.backend_model` | `backend_model` |

#### FR-B2: 后端 API 支持新的过滤参数

在 `GET /admin/api/logs` 端点中新增 `client_model` 和 `backend_model` 查询参数，分别过滤 `rl.model` 和 `rm.backend_model`。保留原 `model` 参数向后兼容。

#### FR-B3: 移除 provider 关联过滤

移除 `filteredModelOptions` 中按 provider.models 过滤的逻辑。两个模型下拉框的选项各自独立，不受 provider 过滤影响。

### Part C: 日志表格增加耗时列

#### FR-C1: 日志列表增加耗时列

在 LogTableRow 中新增一列展示请求耗时（`latency_ms`）。数据源为 `request_logs.latency_ms`，已在现有查询中返回。

展示格式：
- 有值时：格式化为易读形式（如 `1.2s`、`850ms`、`45ms`）
- 无值时：显示 `-`

列位置：放在状态/类型列之后、错误列之前。

## Acceptance Criteria

### Part A: Thinking Level Display

#### AC-A1: OpenAI 请求 thinking level 展示
- 发送 `reasoning_effort: "high"` 的 OpenAI 请求
- Monitor 页面显示 thinking level 为 "high"
- 请求日志列表和详情中显示 "high"

#### AC-A2: Anthropic 请求 thinking level 展示
- 发送 `thinking: { type: "enabled", budget_tokens: 8192 }` 的 Anthropic 请求
- 前端显示 thinking level 为 "enabled"（不显示 budget_tokens）

#### AC-A3: Responses API 请求 thinking level 展示
- 发送 `reasoning: { effort: "low" }` 的 Responses API 请求
- 前端显示 thinking level 为 "low"

#### AC-A4: 无 thinking 参数的请求
- 发送不含任何 thinking 参数的普通请求
- 前端显示 thinking level 为 "off"

#### AC-A5: Anthropic `thinking.type: "disabled"` 显式禁用
- 发送 `thinking: { type: "disabled" }` 的请求
- 前端显示 thinking level 为 "disabled"

#### AC-A6: client_request 为 null 的历史日志
- 对于详情未保留的历史日志（`client_request` 为 null）
- thinking level 显示为 "off"

#### AC-A7: 各 API 类型参数优先级
- OpenAI 请求同时包含 `reasoning` 对象和 `reasoning_effort` 字符串时，`reasoning.effort` 优先

### Part B: Model Filter Fix

#### AC-B1: 客户端模型过滤正确工作
- 日志页面选择客户端模型 `ds-flash` 过滤
- 返回所有 `rl.model = ds-flash` 的日志（包含转发到不同 backend_model 的记录）

#### AC-B2: 目标模型过滤正确工作
- 日志页面选择目标模型 `deepseek-v4-flash` 过滤
- 返回所有 `rm.backend_model = deepseek-v4-flash` 的日志（包含来自不同客户端模型的记录）

#### AC-B3: 两个过滤条件独立使用和组合使用
- 单独使用客户端模型过滤 → 正确返回
- 单独使用目标模型过滤 → 正确返回
- 同时使用两个过滤 → 交集正确返回

#### AC-B4: 下拉选项不再受 provider 过滤影响
- 选择 provider 后，客户端模型和目标模型下拉选项不变
- 选项列表仍然随 provider 过滤结果间接变化（只显示该 provider 下的模型）

#### AC-B5: 原 `model` 参数向后兼容
- 后端仍接受 `model` 参数，行为不变（过滤 `rl.model`）

### Part C: 耗时列

#### AC-C1: 日志列表展示耗时
- 有 `latency_ms` 值的日志行显示格式化的耗时（如 `1.2s`、`850ms`、`45ms`）
- `latency_ms` 为 null 的行显示 `-`

#### AC-C2: 耗时格式化正确
- `latency_ms < 1000`：显示为 `Xms`（如 `45ms`）
- `latency_ms >= 1000`：显示为 `X.Xs`（如 `1.2s`、`12.5s`）

## Constraints

- **不改 DB schema**：不新增迁移，不新增列。thinking level 从已有 `client_request` JSON 中提取。
- **不改 `thinking-resolver.ts` 的解析逻辑**：复用已有解析规则（优先级等），不在新位置重新实现解析。
- **前端遵循现有 UI 模式**：使用 Badge 组件展示 thinking level，使用 Select 组件做模型过滤，遵循 shadcn-vue 规范。
- **国际化**：thinking level 的值直接展示原始英文值，不做翻译。模型过滤标签需翻译。
- **向后兼容**：后端保留原 `model` 查询参数。

## Out of Scope

- 不按 thinking level 过滤/搜索请求日志
- 不在 Dashboard 统计中聚合 thinking level 分布
- 不展示 `budget_tokens` / `max_tokens` 数值
- 不修改 `thinking-resolver.ts` 或 `thinking-mapper.ts` 的核心逻辑
- 不修改 Monitor 页面的模型过滤（Monitor 没有 model filter）
- 不增加客户端模型/目标模型的自动补全或模糊搜索

## 业务用例

无业务用例。纯技术展示性需求和 bug 修复。

## Complexity Assessment

**低-中复杂度**。两个独立改动：

1. **Thinking Level Display**（低复杂度）：
   - 后端：`buildActiveRequest()` 提取一个字符串字段（~10 行）
   - 前端类型：`ActiveRequest`、`UnifiedRequestOverview` 各加一个可选字段
   - 前端 UI：3 个展示位置各加一个 Badge/标签
   - 前端提取逻辑：从 `client_request` JSON 解析 thinking level 的工具函数

2. **Model Filter Fix**（低复杂度）：
   - 后端：`LogFilterOptions` 新增 `client_model` 和 `backend_model`，SQL WHERE 子句各加一个条件
   - 前端：`useLogFilters` 拆分 `modelFilter` 为两个 ref，模板加一个 Select
   - 下拉选项数据源：从 `metrics_summary` 取两组不同字段

3. **耗时列**（极低复杂度）：
   - 前端：LogTableRow 加一个 TableCell，格式化 `latency_ms` 展示
   - 无后端改动，数据已在查询中返回

不涉及架构变更、无 DB 迁移、无新 API 端点。
