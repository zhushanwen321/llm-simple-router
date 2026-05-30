# 分组 4: Shared Provider Config

## 审查结论
有差异 — 两处 v-model API 合约变更、一处清除行为差异；功能核心逻辑等价，差异为重构性质的接口变更。

---

## 差异详情

### 文件: ProxyConfigForm.vue

#### 差异 1: v-model API 合约变更（功能变更）
- **详细说明**: main 使用独立的 per-field props (`proxyType`, `proxyUrl`, `proxyUsername`, `proxyPassword`) 配合 per-field emits (`update:proxyType`, `update:proxyUrl`, `update:proxyUsername`, `update:proxyPassword`) 以及一个 `clear` 事件。feat 改为单一对象 `modelValue: ProxyConfig` 配合 `update:modelValue` v-model。
- **父组件影响**: 
  - main 中的 `ModelCapabilitiesEditor.vue` 消费方式: `<ProxyConfigForm :proxy-type="..." @update:proxy-type="..." @clear="..." />`
  - feat 中改为: `<ProxyConfigForm :model-value="props.modelValue.proxyConfig" @update:model-value="emitUpdate({ proxyConfig: $event })" />`
- **影响评估**: 高 — 所有消费 ProxyConfigForm 的父组件必须更新为新的 v-model 绑定方式。此为前端重构的正常预期变更，非功能缺失。

#### 差异 2: 清除代理时的行为差异（功能变更）
- **详细说明**: 
  - main: 当 proxyType 被设为空字符串时，仅 emit `clear` 事件，由父组件决定如何处理 URL/用户名/密码字段
  - feat: 当 proxyType 被设为空字符串时，直接 emit 包含全空字段的 `DEFAULT_PROXY_CONFIG` 对象，自动清空所有代理相关字段
- **影响评估**: 低 — feat 的清除行为更彻底、更自动化；main 提供更多父组件控制权。对最终用户体验无影响，但父组件不需要再监听 `clear` 事件单独处理清空逻辑。

#### 差异 3: 类型集中化（代码重构）
- **详细说明**: main 使用 `defineProps` 的 primitive 字符串 props（无明文类型定义）；feat 从 `@/components/shared/types` 导入 `ProxyConfig` 接口。
- **影响评估**: 无功能差异，纯代码组织优化。

---

### 文件: ConcurrencyControl.vue

#### 差异 1: v-model API 合约变更（功能变更）
- **详细说明**: main 使用独立 per-field props (`mode`, `maxConcurrency`, `queueTimeoutMs`, `maxQueueSize`) 配合 per-field emits (`update:mode`, `update:maxConcurrency`, `update:queueTimeoutMs`, `update:maxQueueSize`)。feat 改为单一对象 `modelValue: ConcurrencyConfig` 配合 `update:modelValue` v-model。
- **父组件影响**:
  - main 中 `ModelCapabilitiesEditor.vue` 消费方式: `<ConcurrencyControl :mode="..." :max-concurrency="..." :queue-timeout-ms="..." :max-queue-size="..." @update:mode="..." @update:max-concurrency="..." ... />`
  - main 中 `Schedules.vue` 消费方式: `<ConcurrencyControl :mode="..." @update:mode="(v: ConcurrencyMode) => form.concurrency_mode = v" ... />`
  - feat 中改为对象 v-model: `<ConcurrencyControl v-model="concurrencyConfig" />`
- **影响评估**: 高 — 所有消费方必须更新绑定方式；简化了父组件代码。

#### 差异 2: ConcurrencyMode 不再从组件局部导出（功能变更）
- **详细说明**: main 在 ConcurrencyControl.vue 中 `export type ConcurrencyMode = 'auto' | 'manual' | 'none'`（与 `@/types/concurrency.ts` 重复定义）。feat 不再重复定义，仅从 `@/components/shared/types` 导入 `ConcurrencyConfig`（其 `mode` 字段引用 `@/types/concurrency.ts` 的 `ConcurrencyMode`）。任何依赖 `import { ConcurrencyMode } from '@/components/shared/ConcurrencyControl.vue'` 的代码会失败。
- **实际影响**: 低 — 两个分支的消费代码均从 `@/types/concurrency.ts` 导入 `ConcurrencyMode`（非从组件文件），无实际 breakage。

#### 差异 3: 默认值策略（代码重构）
- **详细说明**: main 使用 `withDefaults` 在 props 上直接设置默认值（`maxConcurrency: 10`, `queueTimeoutMs: 120000`, `maxQueueSize: 100`）。feat 通过 `DEFAULT_CONCURRENCY_CONFIG` 和 `computed` 读取默认值，同时支持父组件传入 undefined 时的回退。
- **影响评估**: 无功能差异，默认值数值完全一致。feat 的 computed 回退方式对 `undefined` vs `0` 的行为更安全。

---

### 文件: ToggleRow.vue（新增）

- **功能说明**: 简单的开关行组件，包含标题 (`title`)、描述 (`description`) 和一个 `<Switch>` 开关。使用标准 v-model 模式 (`modelValue` + `update:modelValue`)。
- **用途**: 作为共享 UI 组件，用于 Provider 配置表单中的各种布尔开关行的统一样式渲染（如"自动重试"、"流式输出"等配置项）。替代 main 中各处内联的 `<div class="flex items-center justify-between"> + <Switch>` 重复代码。
- **main 分支**: 不存在此文件。相同功能通过各处内联实现。
- **影响评估**: 无功能差异，纯代码复用优化。

---

### 文件: types.ts（新增）

- **功能说明**: 集中定义共享类型和默认值常量:
  - `ConcurrencyConfig` 接口 + `DEFAULT_CONCURRENCY_CONFIG` + `DEFAULT_CONCURRENCY_MANUAL_CONFIG`
  - `TransformConfig` 接口 + `DEFAULT_TRANSFORM_CONFIG`
  - `ProxyConfig` 接口 + `DEFAULT_PROXY_CONFIG`
- **main 分支**: 不存在此文件。`ConcurrencyMode` 定义在 `@/types/concurrency.ts`；`ProxyConfig` 无类型（使用 primitive props）；`TransformConfig` 在 `TransformRulesForm.vue` 中应有对应定义。
- **影响评估**: 无功能差异，纯类型与常量集中化管理。旧分支中的 `ConcurrencyMode` 类型在 `@/types/concurrency.ts` 中定义，两个分支保持一致。

---

## 新增文件说明

| 文件 | 功能 | 说明 |
|------|------|------|
| `ToggleRow.vue` | 开关行 UI 组件 | 封装 title + description + Switch 的重复布局模式 |
| `types.ts` | 共享类型 & 默认值常量 | 集中 ProxyConfig、ConcurrencyConfig、TransformConfig 类型 |

## 移除文件说明

无 main 独有文件被移除。两个分支均保留 `ProxyConfigForm.vue`、`ConcurrencyControl.vue`、`TransformRulesForm.vue`、`QuickSetupMappingList.vue` 四个文件。

---

## 功能等价性总结

| 组件 | 核心业务逻辑 | API 调用 | 错误处理 | 验证逻辑 | 整体 |
|------|-------------|---------|---------|---------|------|
| ProxyConfigForm | 等价 | N/A（纯展示组件） | N/A | 等价 | v-model 合约变更 |
| ConcurrencyControl | 等价 | N/A（纯展示组件） | N/A | 等价 | v-model 合约变更 |
| ToggleRow | 新增 | N/A | N/A | N/A | 新增 |
| types.ts | 新增 | N/A | N/A | N/A | 新增 |

**结论**: 所有功能逻辑完全等价。差异是 v-model 合约从 per-field 改为对象形式（伴随前端整体重构的类型集中化），以及 ProxyConfigForm 清空行为的微妙改进。无功能缺失、无 API 端点变更、无错误处理遗漏。
