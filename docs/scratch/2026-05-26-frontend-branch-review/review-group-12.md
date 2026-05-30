# 分组 12: Model Mappings

## 审查结论
有差异（UI 架构重构 + 新增抽象层，核心功能逻辑一致）

## 差异详情

### 文件: ModelMappings.vue（两分支同名）

- 差异类型: 代码重构（架构层）
- 详细说明:
  - **布局变更**：main 使用 `grid grid-cols-3` 卡片网格布局，每个 mapping 渲染为一个 `ModelMappingCard`。feat 改为左右分栏（左侧 340px 列表 + 右侧详情编辑面板），编辑逻辑收拢在页面组件内。
  - **组件依赖**：main 页面通过 `ModelMappingCard`（内部再使用 `MappingEntryEditor`）完成编辑。feat 页面不再依赖这两个组件，直接使用 `CascadingModelSelect` 内联渲染 failover chain / overflow / multimodal 三个编辑区。
  - **Search 功能**：feat 新增搜索过滤（`searchQuery` + `filteredGroups` computed），main 无此功能。
  - **Summary text**：feat 左侧列表项显示由 `buildSummaryText()` 生成的摘要文本（ProviderA → ProviderB → ↓ OF → MM）。main 无摘要文本。
  - **Toggle active**：main 中 toggle 在 `ModelMappingCard` 右上角；feat 中 toggle 在右侧详情面板 header 中。均调用 `api.toggleMappingGroup(id)`，逻辑一致。
  - **删除确认**：main 使用独立的 `ModelMappingCard` 内 `AlertDialog`；feat 使用页面 footer 内联确认按钮。均调用 `api.deleteMappingGroup(id)`，逻辑一致。
  - **JSON 解析**：main 在 `buildEntries()` 中内联 `JSON.parse(g.rule)`；feat 通过 `mapping-domain.ts` 的 `parseMappingRule()` 实现，兼容性逻辑相同。
  - **JSON 序列化**：main 在 `ModelMappingCard.handleSave()` 中内联 `JSON.stringify({targets, multimodal_fallback})`；feat 通过 `serializeRule()` 实现，输出格式一致。
  - **Provider 转换**：main 在页面内 `providerGroups` computed 中内联 `Map<Provider, ProviderGroup>`；feat 通过 `useProviderGroups` composable 的 `toProviderGroups()` 实现，逻辑等价。
  - **数据加载**：两分支均使用 `Promise.allSettled([api.getMappingGroups(), api.getProviders()])`。main 额外调用 `buildEntries()` 将 DB 数据转换为 `MappingEntry[]`。feat 直接使用 `groups`（`MappingGroup[]`），在 `watch(selectedGroup)` 中按需解析 rule。
  - **新增对话框**：feat 有 `Dialog` 组件用于新增 Mapping Group（填写 client_model + 选择 provider/model）。main 通过添加一个空白 `ModelMappingCard`（`showAddCard` 模式）实现新增，无需弹窗。API 调用 `api.createMappingGroup()` 一致。
  - **Active 计数**：main 页面显示 `activeCount` 统计徽章；feat 不显示此计数（各列表项用 ON/OFF badge 表示状态）。
- 影响评估: 低（核心 API 调用、业务逻辑等价，差异均为 UI 架构和代码组织层面）

### 文件: cascading-types.ts（两分支同名）

- 差异类型: 无差异
- 详细说明: 类型定义完全一致（`ModelOption`、`ProviderGroup`、`SelectedValue`）。
- 影响评估: 无

### 文件: CascadingModelSelect.vue（两分支同名）

- 差异类型: 新增功能（feat 新增 prop）
- 详细说明:
  - feat 新增 `dashed?: boolean` prop，用于 overflow/multimodal 选择器的虚线边框样式。main 无此 prop。
  - feat 的 `compact` prop 有默认值 `false`，main 的 `compact` prop 无默认值（也需要显式传递，TypeScript `withDefaults` 中未列出 `compact`）。
  - 其余逻辑（`groups` computed、`selectedValue` computed、`onUpdate` emit）完全一致。
- 影响评估: 低（仅样式增强，不影响功能）

### 文件: MappingEntryEditor.vue（两分支同名）

- 差异类型: 功能变更（feat 大幅扩展）
- 详细说明:
  - **emits 扩展**：main 仅 emit `update:targets`、`update:clientModel`。feat 额外 emit `update:multimodalFallback`、`toggle-active`、`remove`、`expand`。
  - **Multimodal fallback**：feat 新增完整的 multimodal fallback 编辑区（选择模型 + session lock 警告框 + remove 按钮），main 无此 section（main 的 multimodal 在 `ModelMappingCard` 外层处理）。
  - **Tag 显示**：feat 新增 `tagClasses` + `tagLabel` computed，在 collapsed 视图显示来源标签（def/auto/cust/existing）。main 无此功能。
  - **Collapsed 视图**：feat 的 collapsed 视图增加了 overflow pill 和 multimodal pill 的 inline 展示，main 仅在单独区域展示 overflow。
  - **Overflow 移除**：feat 的 overflow 区域有 remove 按钮（`Trash2`），main 无显式 remove 按钮（overflow 通过设置为 undefined 来移除，但无直接删除 UI）。
  - **props**：feat 移除了 `editable` prop（main 中有此 prop 控制是否可编辑），因为 feat 始终可编辑。
  - **Client model editing**：feat 支持双击编辑 client_model（`startEditClient` → Input），main 仅在新卡片模式下支持编辑（`editableClientModel` prop）。
  - **新增功能**：feat 有 `modelTimeout` 显示超时，但此处 feat 版本中删除了这个功能（对比 main 的 timer 显示）。这是功能缺失。
- 影响评估: 中（但需注意：feat 的 `ModelMappings.vue` 页面本身**不使用** `MappingEntryEditor`，该组件仅由 QuickSetup 使用。对 Model Mappings 页面功能无直接影响）

### 文件: mapping-domain.ts（仅 feat 分支有）

- 差异类型: 新增文件（代码抽象层）
- 详细说明:
  - 从 main 的 `ModelMappings.vue`（`buildEntries()`）和 `ModelMappingCard.vue`（`handleSave()`）中提取 JSON 解析/序列化逻辑为纯函数。
  - `parseMappingRule()`: 解析 rule JSON，兼容旧 `default` 格式，与 main 的 `buildEntries()` 中等价逻辑一致。
  - `serializeRule()`: 将 targets + overflow + multimodal 序列化为 JSON，overflow 嵌入 `targets[0]`。与 main 的 `handleSave()` 中等价逻辑一致。
  - `buildSummaryText()`: 构建左侧列表的摘要文本，格式为 `ProviderA → ProviderB → ↓ OverflowProv → MM`，是 feat 新增功能。
- 影响评估: 低（纯函数提取，不改变行为）

### 文件: useProviderGroups.ts（仅 feat 分支有）

- 差异类型: 新增文件（composable 抽象层）
- 详细说明:
  - 从 main 的 `ModelMappings.vue` 内联 `providerGroups` computed 中提取 Provider → ProviderGroup 转换逻辑。
  - 新增 `toProviderGroups()` 函数，支持 `activeOnly`、`includeStreamTimeout`、`defaultContextWindow` 选项。main 版本无这些选项（始终转换全部 providers，包含 streamTimeout）。
  - 功能等价性：默认参数下（`activeOnly=false, includeStreamTimeout=true`）与 main 逻辑一致。
- 影响评估: 低（代码提取，不改变行为）

## 新增文件说明

| 文件 | 用途 |
|------|------|
| `src/utils/mapping-domain.ts` | 封装 mapping group rule 的 JSON 解析/序列化逻辑为纯函数。提供 `parseMappingRule()`、`serializeRule()`、`buildSummaryText()` 三个导出函数。替代 main 中 `ModelMappings.vue` 和 `ModelMappingCard.vue` 内联的 JSON 操作。 |
| `src/composables/useProviderGroups.ts` | 封装 Provider[] → ProviderGroup[] 转换逻辑为 `toProviderGroups()` 纯函数。替代 main 中 `ModelMappings.vue` 内联的 `providerGroups` computed。 |

## 移除文件说明

| 文件 | 替代方案 |
|------|---------|
| `src/components/mappings/ModelMappingCard.vue` | feat 将卡片编辑逻辑内联到 `ModelMappings.vue` 的右侧详情面板中。卡片的功能（保存/删除/toggle/overflow/multimodal）全部在页面组件内实现。main 中的 `originalActive` 字段在 feat 中不再需要（直接调 toggle API）。 |
| `src/components/mappings/MappingGroupDeleteDialog.vue` | feat 将删除确认内联到 `ModelMappings.vue` 页脚中（`showDeleteConfirm` 状态 + 内联 Button），不再使用独立 dialog 组件。功能等价。 |

## 功能覆盖矩阵

| 功能 | main | feat | 等价？ |
|------|------|------|--------|
| 列出所有 Mapping Groups | `api.getMappingGroups()` | 同 | 是 |
| 列出所有 Providers | `api.getProviders()` | 同 | 是 |
| 创建 Mapping Group | `api.createMappingGroup()` | 同 | 是 |
| 更新 Mapping Group | `api.updateMappingGroup(id, ...)` | 同 | 是 |
| 删除 Mapping Group | `api.deleteMappingGroup(id)` | 同 | 是 |
| Toggle Active | `api.toggleMappingGroup(id)` | 同 | 是 |
| Failover chain 编辑 | MappingEntryEditor + CascadingModelSelect | CascadingModelSelect 直接使用 | 是 |
| Context overflow 编辑 | MappingEntryEditor 内 addOverflow/updateOverflow | 页面内 toggleOverflow/updateOverflow | 是 |
| Multimodal fallback 编辑 | ModelMappingCard 外层 CascadingModelSelect | 页面内 toggleMultimodal/updateMultimodal | 是 |
| 旧版 default 格式兼容 | `buildEntries()` 中 `parsed.default && !parsed.targets` | `parseMappingRule()` 中同逻辑 | 是 |
| JSON 序列化格式 | `{targets, multimodal_fallback}` | `serializeRule()` 输出同格式 | 是 |
| 搜索过滤 | 无 | `searchQuery` + `filteredGroups` | feat 新增 |
| Summary text | 无 | `buildSummaryText()` | feat 新增 |
| Active count 显示 | 页面顶部 `activeCount` badge | 无（列表项 ON/OFF badge 替代） | 等价（不同 UI 表达） |
| 并行数据加载 | `Promise.allSettled` | 同 | 是 |
| 错误处理 | `console.error` + `toast.error(getApiMessage())` | 同 | 是 |

## 特别说明

1. **MappingEntryEditor.vue 的差异不影响 Model Mappings 页面**：feat 的 `ModelMappings.vue` 不 import 也不使用 `MappingEntryEditor`，该组件仅由 QuickSetup 使用。因此 feat 中 `MappingEntryEditor.vue` 的功能扩展不影响本次审查的页面范围。

2. **CascadingModelSelect 的 `dashed` prop**：feat 新增的 `dashed` prop 仅为样式增强（虚线边框用于 overflow/multimodal 选择器），不影响功能逻辑。

3. **mapping-domain.ts 的序列化注意点**：`serializeRule()` 在处理 `overflow` 时将其嵌入 `targets[0]`（`overflow_provider_id` + `overflow_model`），与 main 的行为一致。处理 `multimodal` 时作为顶层 `multimodal_fallback` 字段，仅当非 null 时包含，与 main 的 `backend_model` 非空判断逻辑等价。
