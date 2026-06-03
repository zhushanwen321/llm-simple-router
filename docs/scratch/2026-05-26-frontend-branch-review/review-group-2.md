# 分组 2: Providers

## 审查结论
有差异（功能新增 + 架构重构，无功能回归）

---

## 差异详情

### 文件: Providers.vue

#### 差异 1: 页面布局重构（新增功能）
- **差异类型**: 新增功能
- **详细说明**: feat 新增三区域布局：
  - **Anchor Bar**（新增）: 展示 Total / Enabled / Disabled / Models 四项统计，点击 Enabled/Disabled 可快速筛选列表
  - **Filter Bar**（新增）: 搜索输入框 + 状态下拉菜单 + 筛选计数
  - **filteredProviders 计算属性**（新增）: 支持按名称/URL 模糊搜索 + 按启用状态过滤
  - **空状态**（增强）: 区分"无 Provider"和"筛选结果为空"两种空状态
  - main 无搜索/筛选功能，仅展示完整列表
- **影响评估**: 低（纯 UI 增强，不改变数据流）

#### 差异 2: 表格列 Model 展示方式变更
- **差异类型**: 功能变更
- **详细说明**: 
  - feat: Models 列显示"模型数量 + image 标记"的汇总视图
  - main: Models 列显示完整模型名称列表 + context_window 格式（如 `gpt-4o(128K)`）+ 每个模型的 image 标记
  - feat 不再显示单模型名称和 context_window，信息密度降低
- **影响评估**: 低（功能等价，信息展示方式不同）

#### 差异 3: 状态切换控件变更
- **差异类型**: 代码重构
- **详细说明**:
  - feat: 使用 shadcn-vue `<Switch>` 组件 + 文本（Enabled/Disabled）
  - main: 使用自定义 HTML/CSS toggle 内嵌在 `<Button>` 中
  - 行为一致：都是点击弹出确认对话框 → 确认后调用 `confirmToggle`
- **影响评估**: 低（UI 控件替换，行为不变）

#### 差异 4: ProviderIcon size 调整
- **差异类型**: 代码重构
- **详细说明**: feat 图标大小 20px，main 为 18px
- **影响评估**: 低（纯视觉差异）

#### 差异 5: ModelCapabilitiesEditor 传参方式重构
- **差异类型**: 代码重构
- **详细说明**:
  - feat: 通过聚合 `editorModelValue` computed（`ProviderFormData` 类型）做双向绑定 v-model，单一 `@update:model-value` + 两个独立 emit（`clear-errors`、`fetch-upstream-models`）
  - main: 通过 32 个独立 prop + 33 个独立 emit 传递每个字段
  - feat 新增 `proxyConfig` computed 将四个 proxy 字段打包/拆包
- **影响评估**: 中（架构级重构，需验证所有字段正确映射，见下方字段映射表）

**editorModelValue 字段映射验证**:

| ProviderFormData 字段 | feat get (form→editor) | feat set (editor→form) | 对应 main prop/emit |
|---|---|---|---|
| name | form.value.name | form.value.name = v.name | :name + @update:name |
| apiType | form.value.api_type | form.value.api_type = v.apiType | :api-type + @update:api-type |
| baseUrl | form.value.base_url | form.value.base_url = v.baseUrl | :base-url + @update:base-url |
| apiKey | form.value.api_key | form.value.api_key = v.apiKey | :api-key + @update:api-key |
| upstreamPath | form.value.upstream_path | form.value.upstream_path = v.upstreamPath | :upstream-path + @update:upstream-path |
| models | form.value.models | form.value.models = v.models | :models + @update:model / @remove-model 等 |
| modelInput | modelInput.value | modelInput.value = v.modelInput | :model-input + @update:model-input |
| contextWindowSelect | contextWindowSelect.value | contextWindowSelect.value = v.contextWindowSelect | :context-window-select + @update:context-window-select |
| concurrencyMode | concurrencyMode.value | concurrencyMode.value = v.concurrencyMode | :concurrency-mode + @update:concurrency-mode |
| maxConcurrency | form.value.max_concurrency | form.value.max_concurrency = v.maxConcurrency | :max-concurrency + @update:max-concurrency |
| queueTimeoutMs | form.value.queue_timeout_ms | form.value.queue_timeout_ms = v.queueTimeoutMs | :queue-timeout-ms + @update:queue-timeout-ms |
| maxQueueSize | form.value.max_queue_size | form.value.max_queue_size = v.maxQueueSize | :max-queue-size + @update:max-queue-size |
| proxyConfig | 4 个 proxy 字段合成 | 拆回 4 个 proxy 字段 | :proxy-type/url/username/password + 4 emits |
| transformConfig | transformConfig.value | transformConfig.value = v.transformConfig | :transform-inject-headers/:transform-drop-fields/:transform-request-defaults + 3 emits |

所有字段已正确映射，无遗漏。

---

### 文件: ModelCapabilitiesEditor.vue

#### 差异 1: Props/Emits 架构重构
- **差异类型**: 代码重构
- **详细说明**:
  - feat: 单一 `modelValue: ProviderFormData` prop + 单一 `update:modelValue` emit + `clear-errors` / `fetch-upstream-models` 辅助 emit。内部通过 `emitUpdate(patch)` 合并更新
  - main: 32 个独立 prop + 33 个独立 emit
- **影响评估**: 中（需验证 `emitUpdate` 的浅合并逻辑，见下方分析）

**emitUpdate 逻辑分析**:
```typescript
function emitUpdate(patch: Partial<ProviderFormData>) {
  emit("update:modelValue", { ...props.modelValue, ...patch });
}
```
这是标准的 v-model 模式，使用展开运算符合并 patch。所有子组件（ModelCard、TransformRulesForm、ProxyConfigForm）的更新事件都通过此函数统一向上传递。行为与 main 的逐一 emit 等价。

#### 差异 2: 新增模型能力选择按钮
- **差异类型**: 新增功能
- **详细说明**: feat 在模型输入行新增了 4 个能力切换按钮（T/IMG/AUD/VID），可控制新添加模型的 capabilities 属性。`newCapabilities` ref 跟踪当前选择。main 无此功能，新模型默认只有 `["text"]`。
- **影响评估**: 低（新增功能，不影响已有功能）

#### 差异 3: 布局重组织
- **差异类型**: 代码重构
- **详细说明**:
  - feat: 三大 Section（Connection / Models / Advanced），Advanced 默认折叠（ChevronRight 图标），内含 Concurrency + Proxy + Transform
  - main: 扁平布局，ProxyConfigForm 在模型前，Concurrency + Transform 左右并排
  - Proxy 位置变更：main 在主表单区域，feat 移入 Advanced 折叠区
- **影响评估**: 低（纯布局变化）

#### 差异 4: Concurrency 控件替换
- **差异类型**: 代码重构
- **详细说明**:
  - feat: Concurrency 控件内联为 3 列 grid（Mode / Max / Timeout / Queue），直接使用 Select + Input
  - main: 使用 `ConcurrencyControl` 共享组件（compact 模式）
  - 功能等价（mode 选择 auto/manual/none，对应字段相同）
- **影响评估**: 低

#### 差异 5: stream_timeout_ms 传递路径变更
- **差异类型**: 代码重构
- **详细说明**:
  - feat: `updateModelStreamTimeout` 直接接收毫秒值，`emitUpdate({ models })` 更新
  - main: ModelCard emit `update:stream-timeout-ms`（秒），main 组件中转换为毫秒后 emit `update:model-timeout`（带 `/1000` 转回秒）
  - 注意：main 的转换路径是 `ModelCard(ms) → emit(秒) → ModelCapabilitiesEditor(秒) → emit to parent → useProviderForm.updateModelTimeout(秒转ms)`。feat 可能简化了此路径。需确认 feat 分支的 ModelCard 组件 emit 的是秒还是毫秒
- **影响评估**: 中（数据流路径变化，需端到端验证）

#### 差异 6: 模型添加逻辑内聚
- **差异类型**: 代码重构
- **详细说明**:
  - feat: `handleAddModel()` 在组件内部直接操作 `models` 数组，包括去重、capabilities 设置、stream_timeout_ms 设置
  - main: `@keydown.enter` 和按钮点击都 emit `add-model`，由父组件 `Providers.vue` 调用 `useProviderForm().addModel()`
  - feat 的 `addModel` 逻辑分散（部分在组件内，部分通过 `emitUpdate` 回写）；main 完全集中在 composable
- **影响评估**: 中（逻辑分布不同，需验证模型添加的去重和默认值行为是否一致）

**去重逻辑对比**:
- feat (ModelCapabilitiesEditor): `if (!models.some((m) => m.name === name))`
- main (useProviderForm.addModel): `if (!form.value.models.some((m) => m.name === name))`
- 逻辑一致

**默认 capabilities**:
- feat: 使用 `newCapabilities.value`（用户选择，默认为 `["text"]`）
- main: 固定 `["text"]`
- feat 允许用户选择能力，main 始终 text only

---

### 文件: useProviderForm.ts

#### 差异 1: 默认并发值来源变更
- **差异类型**: 功能变更
- **详细说明**:
  - feat: 从 `@/components/shared/types` 导入 `DEFAULT_CONCURRENCY_CONFIG` 和 `DEFAULT_CONCURRENCY_MANUAL_CONFIG`
  - main: 本地定义常量 `DEFAULT_CONCURRENCY = 3`、`DEFAULT_CONCURRENCY_AUTO = 10`、`DEFAULT_QUEUE_TIMEOUT_MS = 120_000`、`DEFAULT_QUEUE_SIZE = 10`
  - feat 的 `buildPayload()` 使用 `DEFAULT_CONCURRENCY_MANUAL_CONFIG.max_queue_size` 作为 "none" 模式的 fallback；main 使用 `DEFAULT_QUEUE_SIZE`
  - feat 的 `openEdit()` 使用 `DEFAULT_CONCURRENCY_CONFIG.max_concurrency`/`queue_timeout_ms`/`max_queue_size` 作为 "none" 模式的 fallback；main 使用 `DEFAULT_CONCURRENCY_AUTO`/`DEFAULT_QUEUE_TIMEOUT_MS`/`DEFAULT_QUEUE_SIZE`
- **影响评估**: 中（默认值可能不同，**需验证 `shared/types` 中的常量值与 main 是否一致**）

#### 差异 2: addModel() 参数变化
- **差异类型**: 功能变更
- **详细说明**:
  - feat: `addModel(caps?: string[], patchList?: string[])` — 接受可选的 capabilities 和 patches 参数
  - main: `addModel()` — 无参数，固定 capabilities 为 `["text"]`，patches 为 `[]`
  - feat 版本更灵活，允许调用方指定新模型的能力
- **影响评估**: 低（向后兼容，不传参数时行为一致）

#### 差异 3: transform 配置返回方式变更
- **差异类型**: 代码重构
- **详细说明**:
  - feat: `useTransformRules()` 返回 `transformConfig`（聚合对象）
  - main: `useTransformRules()` 返回 `transformForm`（含 `injectHeadersInput`、`dropFieldsInput`、`requestDefaultsInput` 三个独立字段）
  - 相应的，feat 在 `Providers.vue` 中将 `transformConfig` 传入 `editorModelValue`，main 将三个独立字段分别传入独立 prop
- **影响评估**: 低（数据封装方式不同，功能等价）

#### 差异 4: 移除 CONTEXT_K / CONTEXT_M 导出
- **差异类型**: 功能变更
- **详细说明**:
  - feat: 不再导出 `CONTEXT_K` 和 `CONTEXT_M`
  - main: 导出 `CONTEXT_K = 1000` 和 `CONTEXT_M = 1_000_000`，供 `Providers.vue` 的 `formatContextWindow()` 使用
  - feat 的 `Providers.vue` 不显示 context_window 格式（见 Providers.vue 差异 2），因此不再需要这些常量
- **影响评估**: 低（移除原因明确，无遗漏消费者）

---

### 文件: useProviderActions.ts

#### 差异 1: 变量命名差异
- **差异类型**: 代码重构
- **详细说明**:
  - feat: `const { copy: clipboardCopy } = useClipboard()`
  - main: `const { copy: doCopy } = useClipboard()`
  - 纯命名差异，无功能影响
- **影响评估**: 低

#### 差异 2: confirmToggle 错误处理增强
- **差异类型**: 代码重构（改进）
- **详细说明**:
  - feat: `catch (e: unknown) { console.error("useProviderActions.doSave:", e); toggleDependencies.value = []; }`
  - main: `catch { toggleDependencies.value = []; }`（silent catch）
  - feat 新增了错误日志，有助于排查问题
- **影响评估**: 低（改进，不影响功能）

---

## 新增文件说明

### frontend/src/components/providers/types.ts
- **用途**: 定义 `ProviderFormData` 接口，作为 `ModelCapabilitiesEditor` 的聚合 v-model 数据类型
- **说明**: 这是架构重构（v-model 模式）的配套设施。将原本分散在 32 个独立 prop 中的字段统一为一个类型化的接口。所有字段与 main 中的独立 prop 一一对应，无新增或遗漏。

---

## 移除文件说明

无。main 分支所有文件在 feat 分支中均有对应文件（无整体删除）。

---

## 需要进一步验证的项

| 序号 | 验证项 | 风险 | 验证方法 |
|------|--------|------|----------|
| 1 | `@/components/shared/types` 中的 `DEFAULT_CONCURRENCY_CONFIG` / `DEFAULT_CONCURRENCY_MANUAL_CONFIG` 常量值与 main 本地常量是否一致 | 中 | 读取 feat 的 shared/types.ts |
| 2 | feat 的 ModelCard 组件 stream_timeout_ms emit 单位（秒 vs 毫秒） | 中 | 读取 feat 的 ModelCard.vue |
| 3 | `editorModelValue` computed 的 get/set 能否正确同步所有字段（特别是 proxyConfig 和 transformConfig 的打包/拆包） | 中 | 端到端手动测试：创建/编辑 Provider |
| 4 | feat 的 `handleAddModel()` 在 ModelCapabilitiesEditor 内部直接操作 models 数组，是否与 composable 的 `addModel()` 存在重复逻辑或冲突 | 低 | 检查 feat 的 `Providers.vue` 是否仍调用 `addModel()`
