# 前端实现计划：映射原因追踪 (Mapping Reason Tracking)

## 概述

在请求详情左侧面板（`RequestOverviewPanel.vue`）的 model@provider 行下方，展示映射原因 Badge。映射原因从两个数据源获取：
- **实时场景**（Monitor 页面）：从 SSE 推送的 `ActiveRequest.mappingReason` 直接读取
- **历史场景**（Logs 页面）：从 `LogEntry.pipeline_snapshot` JSON 中解析 routing stage 的 `mapping_reason` 字段

无映射原因时不渲染 Badge，不显示占位符。

## 设计决策

### ADR-1: 为什么 fromLogEntry 需要 parseMappingReason() 而非内联解析

pipeline_snapshot JSON 结构复杂（数组，包含多种 stage variant），解析需要：
1. JSON.parse 容错（历史数据可能为 null、非法 JSON）
2. 遍历 stages 找到 routing stage
3. 检查 overflow stage.triggered 覆盖优先级
4. 提取 mapping_reason 字段（可能不存在）

封装为独立函数的理由：逻辑约 20 行，内联在 `fromLogEntry()` 会增加函数复杂度；函数可单独测试。

### ADR-2: overflow 优先级在前端的处理策略

`fromLogEntry()` 解析 pipeline_snapshot 时需要检查 overflow stage。当 `overflow.triggered === true` 时，即使 routing stage 的 mapping_reason 是 `group_schedule`，前端也应覆盖为 `overflow_redirect`。这与 `fromActiveRequest()` 的行为一致——后端已在 ActiveRequest.mappingReason 中覆写。

理由：pipeline_snapshot 保留原始信息供深度排查，但展示给用户的是最终原因。

### ADR-3: mappingReason 字段类型选择

`UnifiedRequestOverview.mappingReason` 使用 `string | undefined` 而非 `MappingReason` union type。理由：
- 前端不 import 后端类型定义
- JSON 解析的结果本身就是 string
- 展示端通过 i18n key 查找映射，不需要编译期类型约束

### ADR-4: Badge 样式选择

使用 `<Badge variant="secondary">`（灰色背景，低调展示）。理由：
- 映射原因是辅助信息，不应抢夺视觉焦点
- 与同一行已有的 status Badge（success/error 颜色）形成层次区分
- 6 种原因不区分颜色，避免语义过载——映射原因本身不是好坏判断

---

## Task 拆分

### Task F1: LogEntry 类型新增 pipeline_snapshot 字段

**描述**: 在 `LogEntry` interface 中新增 `pipeline_snapshot` 字段，使前端能够访问后端已返回但未声明的数据。

**变更文件**:

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `frontend/src/components/logs/types.ts` | 修改 | 新增 `pipeline_snapshot?: string \| null` |

**具体变更**:
```typescript
// LogEntry interface 新增（在 cacheReadTokensEstimated 之后）
pipeline_snapshot?: string | null;
```

**为什么是 optional**: 后端的列表 API（`getLogs`）不返回 `pipeline_snapshot`（节省带宽），只有详情 API（`getLogDetail`）返回。LogEntry 类型被两个 API 共用，列表场景下该字段为 undefined。

**验收标准**:
- [ ] TypeScript 编译通过（`cd frontend && npx vue-tsc -b --noEmit`）
- [ ] 现有 LogEntry 引用点无需修改（新增 optional 字段不破坏兼容性）

**风险点**: 无。optional 字段增量添加。

---

### Task F2: UnifiedRequestOverview 新增 mappingReason + parseMappingReason()

**描述**: 扩展 `UnifiedRequestOverview` 类型，新增 `parseMappingReason()` 工具函数和 `fromLogEntry()` / `fromActiveRequest()` 的映射逻辑。

**变更文件**:

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `frontend/src/components/request-detail/types.ts` | 修改 | 3 处变更（见下） |

**具体变更**:

#### 2-1: UnifiedRequestOverview 新增字段

```typescript
export interface UnifiedRequestOverview {
  // ... 现有字段 ...
  mappingReason?: string;  // 新增：映射原因枚举值（6 种），undefined 表示无数据
}
```

#### 2-2: parseMappingReason() 工具函数

```typescript
/**
 * 从 pipeline_snapshot JSON 解析映射原因。
 * 优先级：overflow stage.triggered=true → overflow_redirect；否则取 routing stage 的 mapping_reason。
 * 防御性处理：JSON 解析失败、无 routing stage、无 mapping_reason 均返回 undefined。
 */
export function parseMappingReason(snapshot: string | null | undefined): string | undefined {
  if (!snapshot) return undefined;
  try {
  const stages = JSON.parse(snapshot);
  if (!Array.isArray(stages)) return undefined;

  // 检查 overflow stage（优先级最高）
  const overflowStage = stages.find((s: Record<string, unknown>) => s.stage === "overflow");
  if (overflowStage && overflowStage.triggered === true) {
    return "overflow_redirect";
  }

  // 从 routing stage 提取 mapping_reason
  const routingStage = stages.find((s: Record<string, unknown>) => s.stage === "routing");
  if (routingStage && typeof routingStage.mapping_reason === "string") {
    return routingStage.mapping_reason;
  }

  return undefined;
  } catch {
  return undefined;
  }
}
```

关键设计点：
- `JSON.parse` 用 `try-catch` 包裹，非法 JSON 安全返回 undefined
- 先检查 overflow stage 再取 routing stage，与 spec 的优先级一致
- `Record<string, unknown>` 用于 JSON 解析后的类型安全访问（spec 要求不信任上游结构）
- 返回 `undefined` 而非 `null`，与 `mappingReason` 字段类型一致（`string | undefined`）

#### 2-3: fromLogEntry() 补充 mappingReason

在 `fromLogEntry()` 的 return 对象中新增：
```typescript
mappingReason: parseMappingReason(entry.pipeline_snapshot),
```

#### 2-4: fromActiveRequest() 补充 mappingReason

在 `fromActiveRequest()` 的 return 对象中新增：
```typescript
mappingReason: req.mappingReason,
```

**为什么 fromActiveRequest 不需要 parseMappingReason**: 后端已在 `ActiveRequest.mappingReason` 中完成覆写（包括 overflow 和 failover），前端直接透传即可。

**验收标准**:
- [ ] `parseMappingReason(null)` → undefined
- [ ] `parseMappingReason("invalid json")` → undefined
- [ ] `parseMappingReason('[{"stage":"routing","client_model":"gpt-4","backend_model":"gpt-4o","provider_id":"p1","strategy":"scheduled","mapping_reason":"group_schedule"}]')` → `"group_schedule"`
- [ ] `parseMappingReason('[{"stage":"routing","mapping_reason":"group_schedule"},{"stage":"overflow","triggered":true}]')` → `"overflow_redirect"`
- [ ] `parseMappingReason('[{"stage":"routing"}]')` → undefined（无 mapping_reason 字段）
- [ ] `fromLogEntry()` 对无 pipeline_snapshot 的历史 LogEntry 返回 mappingReason: undefined
- [ ] `fromActiveRequest()` 对无 mappingReason 的旧 ActiveRequest 返回 mappingReason: undefined
- [ ] TypeScript 编译通过

**风险点**:
- pipeline_snapshot JSON 结构由后端控制。如果后端未实现 `mapping_reason` 字段，`parseMappingReason()` 返回 undefined，不渲染 Badge（优雅降级）
- `Record<string, unknown>` 类型下 `overflowStage.triggered` 的比较使用 `=== true` 严格匹配，避免 truthy 值误判

---

### Task F3: 前端 ActiveRequest 类型新增 mappingReason

**描述**: 在前端 `ActiveRequest` interface 中新增 `mappingReason` 字段，与后端 SSE 推送的字段对齐。

**变更文件**:

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `frontend/src/types/monitor.ts` | 修改 | `ActiveRequest` 新增 `mappingReason` |

**具体变更**:
```typescript
export interface ActiveRequest {
  // ... 现有字段 ...
  mappingReason?: string;  // 新增：映射原因（后端 SSE 推送，6 种枚举值）
}
```

放在 `completedAt` 之前或之后均可（保持字段逻辑分组即可）。

**验收标准**:
- [ ] TypeScript 编译通过
- [ ] SSE `request_update` 事件携带 `mappingReason` 时，`fromActiveRequest()` 能正确读取

**风险点**: 无。optional 字段，后端未推送时为 undefined。

---

### Task F4: RequestOverviewPanel.vue 展示映射原因 Badge

**描述**: 在 RequestOverviewPanel 的 model@provider 行（Row 1）下方新增映射原因 Badge 行，仅在 mappingReason 存在时渲染。

**变更文件**:

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `frontend/src/components/request-detail/RequestOverviewPanel.vue` | 修改 | 新增 Badge 行 |

**具体变更**:

在 Row 1（model @ provider）和 Row 2（status + SSE + apiType）之间插入：

```vue
<!-- Row 1.5: mapping reason (conditional) -->
<div v-if="overview.mappingReason" class="flex items-center gap-1.5">
  <Badge variant="secondary" class="text-[10px]">
  {{ t(`requestDetail.mappingReason.${overview.mappingReason}`) }}
  </Badge>
</div>
```

**位置选择理由**: 放在 model@provider 行下方，因为映射原因直接描述的是"模型是怎么映射过来的"，与 model@provider 信息紧密关联。放在 status 行之前，因为 status 是请求状态，映射原因是请求路径信息，逻辑上路径信息先于状态。

**为什么不显示 label 前缀**: 如"映射原因：直接指定"。Badge 本身的视觉语义已足够——它在 model@provider 下方，用户自然关联。添加 label 会增加面板噪音。

**i18n key 查找策略**: 使用 `t('requestDetail.mappingReason.${value}')` 动态查找。如果 key 不存在（未知的 mappingReason 值），vue-i18n 会返回 key 本身（如 `requestDetail.mappingReason.unknown_value`），不会崩溃。这提供了额外防御。

**不使用 lucide 图标**: 映射原因 Badge 不需要图标，文字标签已足够表达语义。与同行的 status Badge（有圆点指示器）保持视觉区分。

**验收标准**:
- [ ] mappingReason 有值时显示 Badge，无值时不渲染任何 DOM
- [ ] Badge 文本通过 i18n 显示中文标签
- [ ] template 行数不超过 400 行（当前约 130 行，新增约 4 行）
- [ ] script setup 行数不超过 300 行（当前约 90 行，无新增逻辑）

**风险点**:
- 如果后端返回了不在 6 种枚举中的 mappingReason 值，i18n 会显示完整 key 路径。可接受——这是一种降级，不会崩溃，且只有后端 bug 才会出现

---

### Task F5: i18n 翻译键

**描述**: 在中英文 requestDetail.json 中新增 6 个映射原因翻译键。

**变更文件**:

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `frontend/src/i18n/locales/zh-CN/requestDetail.json` | 修改 | 新增 6 个键 |
| `frontend/src/i18n/locales/en/requestDetail.json` | 修改 | 新增 6 个键 |

**具体变更**:

zh-CN:
```json
"mappingReason": {
  "direct_format": "直接指定",
  "group_base_rule": "基础规则",
  "group_schedule": "分时段规则",
  "fallback_provider": "Provider 匹配",
  "overflow_redirect": "溢出重定向",
  "failover_retry": "Failover 重试"
}
```

en:
```json
"mappingReason": {
  "direct_format": "Direct Format",
  "group_base_rule": "Base Rule",
  "group_schedule": "Scheduled Rule",
  "fallback_provider": "Provider Match",
  "overflow_redirect": "Overflow Redirect",
  "failover_retry": "Failover Retry"
}
```

**为什么用嵌套对象而非扁平 key**: vue-i18n 的 `mergeLocaleMessage` 通过 JSON 文件名做 namespace（`requestDetail`），文件内的嵌套对象自动映射为 `requestDetail.mappingReason.direct_format`。使用扁平 key（如 `mappingReason.direct_format`）会导致 JSON key 中含点号，不规范。

**验收标准**:
- [ ] 6 种映射原因在中英文下均有正确翻译
- [ ] JSON 格式合法（无尾逗号、转义问题）
- [ ] key 名称与后端 MappingReason 枚举值完全一致

**风险点**: 无。纯数据添加。

---

## 实现顺序

```
Task F1 (LogEntry 类型) ← 无依赖，可先做
Task F3 (ActiveRequest 类型) ← 无依赖，可先做
  ↓
Task F2 (types.ts: parseMappingReason + 转换器) ← 依赖 F1、F3
  ↓
Task F5 (i18n) ← 无依赖，可与 F2 并行
  ↓
Task F4 (RequestOverviewPanel.vue) ← 依赖 F2、F5
```

建议实现顺序：F1 + F3 并行 → F2 + F5 并行 → F4。

## 四态覆盖

本需求无异步 API 调用（映射原因从已有数据中解析），因此四态简化为：

| 状态 | 表现 |
|------|------|
| 有映射原因 | 显示 Badge，文本为 i18n 翻译的中文标签 |
| 无映射原因（历史数据） | 不渲染 Badge，无占位符，无 console 错误 |
| 无映射原因（映射未完成） | 实时场景：SSE request_start 时 mappingReason 为 undefined → 不渲染；request_update 后填充 |
| 映射原因值非法 | i18n fallback 显示 key 路径（不会崩溃） |

## 暂定 API 调用

本需求不新增 API 调用。所有数据从已有响应中解析：

| 场景 | 数据源 | 获取方式 |
|------|--------|---------|
| 历史日志详情 | `getLogDetail()` 返回的 `LogEntry.pipeline_snapshot` | 已有 API，字段已返回但前端未声明 |
| 实时监控 | SSE `request_update` / `request_complete` 事件的 `ActiveRequest.mappingReason` | 已有 SSE 连接，字段后端新增 |

## AC 覆盖矩阵

| AC | 前端 Task | 验证点 |
|----|----------|-------|
| AC1 | F2, F4, F5 | `direct_format` → Badge 显示「直接指定」 |
| AC2 | F2, F4, F5 | `group_base_rule` → Badge 显示「基础规则」 |
| AC3 | F2, F4, F5 | `group_schedule` → Badge 显示「分时段规则」 |
| AC4 | F2, F4, F5 | `fallback_provider` → Badge 显示「Provider 匹配」 |
| AC5 | F2, F3, F4, F5 | `overflow_redirect` → fromLogEntry 检查 overflow stage；fromActiveRequest 直接读取 |
| AC6 | F2, F3, F4, F5 | `failover_retry` → fromLogEntry 取 routing stage；fromActiveRequest 直接读取 |
| AC7 | F2 | `fromLogEntry()` 和 `fromActiveRequest()` 对同一请求返回相同的 mappingReason |
| AC8 | F2, F4 | 无 pipeline_snapshot 或无 mapping_reason → parseMappingReason 返回 undefined → v-if 不渲染 |
| AC9 | （前端不涉及 DB 验证） | — |

## 自检清单

- [x] 每个 Task 有明确的验收标准
- [x] 每个设计选择有"为什么"
- [x] 代码段只用于接口签名/类型定义，无完整实现
- [x] 使用 shadcn-vue Badge 组件，无原生 HTML 元素
- [x] 无 Emoji
- [x] mappingReason 不存在时不渲染（v-if），不显示占位符
- [x] overflow 优先级在 fromLogEntry 中正确处理
- [x] 历史数据防御性解析（try-catch + null 检查）
- [x] 暂定 API 标注（本需求无新增 API）
- [x] 与项目前端规范一致（composable 模式、shadcn-vue、i18n、Badge variant）
- [x] template ≤ 400 行、script setup ≤ 300 行
