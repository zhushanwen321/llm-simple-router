# R2 Review: QuickSetup.vue

Date: 2026-05-25

## Scope

对比 feat (`feat-frontend-design`) 和 main 分支的 QuickSetup 页面，审查功能性 bug 和遗漏。

审查范围：
- `QuickSetup.vue` (视图)
- `useQuickSetup.ts` + `quick-setup-actions.ts` + `quick-setup-helpers.ts` (feat composable)
- `useQuickSetup.ts` (main composable)
- `types.ts`, `ModelCard.vue`, `PatchChips.vue`
- `QuickSetupMappingList.vue`, `ConcurrencyControl.vue`, `TransformRulesForm.vue`
- 后端 `router/src/admin/quick-setup.ts`

## Pre-existing Bug (两个分支均存在)

### BUG-1: Custom Provider 无法提交 (P0)

**状态**: main 和 feat 均存在，feat 未修复

**原因**: `submit()` 函数以 `currentPreset` 作为提交守卫：

```ts
if (!ctx.currentPreset.value) {
  toast.error(t("quickSetup.messages.selectProviderAndPlan"));
  return;
}
```

`currentPreset` 的计算逻辑要求 `selectedGroup` 和 `selectedPlan` 均有值：

```ts
// useQuickSetup.ts L105-110
const currentPreset = computed(() => {
  if (!selectedGroup.value || !selectedPlan.value) return undefined;
  // ...
});
```

当用户选择 Custom Provider 时：
- `selectedGroup` = `"__custom__"`
- `selectedPlan` = `""` (在 `onProviderChange` 中被清空)

→ `currentPreset` 始终为 `undefined` → `submit()` 永远被拦截

**修复建议**: submit 守卫应改为 `if (!selectedGroup.value)` 或分别处理 preset 和 custom 的校验路径。

## Feat 分支新增功能 (对比 main)

以下功能在 feat 中新增或增强，main 中不存在。审查结果标注是否有 bug。

### FEAT-1: selectClient 自动选择默认 Provider

**feat 行为**: 选择客户端后，自动根据 `defaultProvider`/`defaultPlan`（如 Claude Code → DeepSeek Anthropic）选择 provider + plan + models
**main 行为**: 仅设置 `clientType`，不自动选择 provider

**审查结果**: 无 bug。`resolveClientDefaults()` 正确匹配 compatible format，降级到第一个 preset。首次加载体验显著改善。

### FEAT-2: 推荐重试规则按 shortname 过滤

**feat 行为**: 用 `providerGroups[].shortname`（如 `"deepseek"`）过滤推荐规则
**main 行为**: 用 `selectedGroup.value`（如 `"DeepSeek"`）直接匹配

**审查结果**: 修复了 main 分支的 bug。main 用中文名 `"DeepSeek"` 与 `providers: ["deepseek"]` 比较，永远不匹配，导致显示所有规则。feat 正确使用 shortname 过滤。

### FEAT-3: 重试规则 provider 绑定 (retryProviderMap)

**feat 新增**: 重试规则可选择绑定到特定 provider 或标记为 general。UI 提供 provider 下拉选择器。
**main 无此功能**: 重试规则全部创建为 general。

**审查结果**: 无 bug。
- `buildRetryProviderMap()` 正确初始化每个规则的绑定
- `buildRetryRulesPayload()` 正确设置 `provider_shortname: null | string`
- 后端 schema 和处理逻辑匹配（truthy → 绑定到新 provider ID，null → general）
- UI 下拉选择器正确绑定到 `retryProviderMap`

### FEAT-4: 推荐重试规则 "全选" 功能

**feat 新增**: 全选 checkbox + 计数 badge（含已存在规则数）
**main 无此功能**: 无全选按钮

**审查结果**: 无 bug。逻辑正确：
- 全选状态判断：`every(!r.exists && selected)` → true / `some(!r.exists && selected)` → indeterminate
- disabled 状态：所有规则都已存在时禁用
- 计数：`existing.length + selected.size`

### FEAT-5: 映射条目增强 (multimodalFallback + clientModel 编辑)

**feat 新增**: `update:multimodal-fallback` 和 `update:client-model` 事件
**main 无此功能**

**审查结果**: 无 bug。
- `buildQuickSetupPayload()` 正确检测 `hasAdvancedConfig`（targets > 1 或 overflow 或 multimodalFallback）
- 当有高级配置时，生成 `rule` JSON 字符串；否则简单发送 `client_model` + `backend_model`
- 后端 schema 支持 `rule` 字段并正确替换 `__new__` provider IDs

### FEAT-6: submit 只发送 enabled 模型

**feat 行为**: `ctx.modelConfigs.value.filter((m) => m.enabled)`
**main 行为**: `modelConfigs.value`（含 disabled 模型）

**审查结果**: 修复了 main 分支的 bug。main 将禁用的模型也发送给后端，后端会创建不需要的模型记录。

### FEAT-7: 预设 URL 可编辑

**feat 行为**: preset base URL 和 upstream path 使用 ref，watch 同步 preset 值，UI 中可编辑
**main 行为**: preset base URL 是 computed（readonly）

**审查结果**: 无 bug。是功能增强。用户可自定义预设 provider 的 URL（如使用代理端点）。切换 plan 时 watch 正确重置 URL。

### FEAT-8: 验证状态指示器

**feat 新增**: `validationState` ref + 验证成功/失败图标显示
**main 无此功能**: validateConfig 只弹 toast

**审查结果**: 无 bug。UI 正确反映验证状态。

### FEAT-9: ConcurrencyControl v-model 化

**feat 行为**: 使用 `v-model` + computed getter/setter
**main 行为**: 逐属性 event binding

**审查结果**: 无 bug。getter/setter 正确代理到 composable 的 ref。

### FEAT-10: TransformRulesForm v-model 化 + 可折叠

**feat 行为**: v-model + 可折叠面板
**main 行为**: 独立 Card + 逐属性 event binding

**审查结果**: 无 bug。computed getter/setter 正确代理。

## QuickSetupPayload 类型不一致 (非阻塞)

feat 的 `QuickSetupPayload` 类型定义中 `provider.models` 缺少 `stream_timeout_ms` 和 `capabilities` 字段，但 `buildProviderPayload()` 实际发送了这些字段。后端 schema 接受这些字段。

**影响**: TypeScript 类型检查时不会报错（因为 payload 的 models 类型比实际窄，但 `request<T>()` 解包时不做严格匹配），运行时正常工作。

**建议**: 更新 `QuickSetupPayload` 接口添加缺失字段。

## 总结

| 级别 | 编号 | 描述 | 状态 |
|------|------|------|------|
| P0 | BUG-1 | Custom Provider 无法提交（pre-existing） | main + feat 均未修复 |
| -- | FEAT-1~10 | feat 新增/增强功能 | 无功能性 bug |
| Low | TYPE-1 | QuickSetupPayload 类型不完整 | 非阻塞，运行时正常 |

**结论**: feat 分支修复了 main 的两个 bug（推荐规则过滤、disabled 模型发送），新增功能均无功能性 bug。唯一的阻塞问题 BUG-1（Custom Provider 无法提交）是两个分支共享的 pre-existing 问题。
