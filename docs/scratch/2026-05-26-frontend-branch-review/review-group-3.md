# 分组 3: Provider Groups & Presets

## 审查结论
基本一致，存在 1 处代码质量差异（feat 分支增加了错误日志，不影响功能），1 个新增文件。

## 差异详情

### 文件: useProviderPresets.ts

- 差异类型: 代码重构（非功能性）
- 详细说明:
  feat 分支的 `loadPresets()` catch 块包含 `console.error("useProviderPresets.loadPresets:", e)` 日志记录。
  main 分支的 `loadPresets()` catch 块为静默吞异常（`catch { providerPresets.value = []; }`）。
  两分支的异常处理行为完全一致：都将 `providerPresets` 置空。
  feat 增加的 console.error 仅改善调试体验，不影响业务逻辑。
- 影响评估: 低（无功能影响）

### 文件: useFetchUpstreamModels.ts

- 差异类型: 代码重构（非功能性）
- 详细说明:
  feat 分支的 `fetchUpstreamModels()` catch 块包含 `console.error("useFetchUpstreamModels.fetch:", e)` 日志记录。
  main 分支的 `fetchUpstreamModels()` catch 块为静默吞异常（`catch { applyPresetModels(); }`）。
  两分支的异常处理行为完全一致：异常时都走兜底逻辑 `applyPresetModels()`。
- 影响评估: 低（无功能影响）

### 文件: useProviderGroups.ts（无差异 — feat 新增，main 缺失）
见下方"新增文件说明"。

## 新增文件说明

### frontend/src/composables/useProviderGroups.ts

feat 分支新增。提供 `toProviderGroups(providers, options?)` 工具函数，将 `Provider[]` 统一转换为 `ProviderGroup[]` 格式。该格式用于映射选择器（ModelMappings / ProxyEnhancement / Schedules），消除三处重复的转换逻辑。

**功能要点**：
- 可选参数 `activeOnly`：仅包含激活的 Provider
- 可选参数 `includeStreamTimeout`：控制是否包含 `streamTimeoutMs` 字段
- 可选参数 `defaultContextWindow`：自定义默认上下文窗口值（默认 200000）

main 分支中此转换逻辑可能内联在调用方组件中，feat 将其提取为独立 composable 以避免重复。

**影响**：纯重构，不改变业务行为。如果 main 中的旧组件未更新则不影响兼容性；如果 feat 中已有组件改用此函数则需确保语义一致。

## 移除文件说明

无。本分组中 feat 分支未移除任何 main 分支中存在的文件。
