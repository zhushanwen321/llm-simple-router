# R2 审查: Providers.vue 页面对比

**分支**: feat-frontend-design vs main
**审查日期**: 2025-05-25
**审查范围**: 功能性 bug 和遗漏，忽略纯样式微调

## 审查文件

| 文件 | 变更类型 |
|------|----------|
| `frontend/src/views/Providers.vue` | 重构：新增搜索/筛选、anchor bar 统计、Switch 组件 |
| `frontend/src/components/providers/ModelCapabilitiesEditor.vue` | 重构：分 section 布局、并发控制内联化、新增 capabilities 选择器 |
| `frontend/src/components/quick-setup/ModelCard.vue` | 重构：紧凑行内布局、新增 enable toggle |
| `frontend/src/composables/useProviderForm.ts` | 微调：`addModel` 签名增加 caps 参数 |
| `frontend/src/composables/useProviderActions.ts` | 微调：剪贴板复制逻辑改为 `navigator.clipboard` + `fallbackCopy` |
| `frontend/src/composables/useFetchUpstreamModels.ts` | 无变化 |
| `frontend/src/components/shared/ConcurrencyControl.vue` | 仅样式微调 |
| `frontend/src/components/shared/ProxyConfigForm.vue` | 仅格式化 |
| `frontend/src/components/shared/TransformRulesForm.vue` | 无变化 |
| `router/src/admin/providers.ts` | 无变化 |

## 发现问题

### BUG-1: 并发控制 mode=none 时未隐藏字段 (P2 Medium)

**文件**: `ModelCapabilitiesEditor.vue` (feat)

**现象**: feat 分支将并发控制从 `<ConcurrencyControl>` 组件改为内联实现时，遗漏了 `v-if="mode !== 'none'"` 条件判断。

**main 行为**: 当用户选择 mode = "none" 时，`max_concurrency`、`queue_timeout_ms`、`max_queue_size` 三个输入框自动隐藏。

**feat 行为**: 无论选择什么 mode，三个输入框始终显示。用户选 "none" 后仍可输入无效值，造成困惑。

**影响**: 非破坏性——后端会忽略 mode=none 时的并发值，但 UX 上会误导用户以为需要填写。

**修复建议**: 在内联的并发控制区域外包 `<template v-if="concurrencyMode !== 'none'">`。

### UX-1: ModelCard enable toggle 在 Provider 编辑上下文中无效 (P3 Low)

**文件**: `ModelCard.vue` + `ModelCapabilitiesEditor.vue` (feat)

**现象**: feat 分支的 ModelCard 新增了 enable/disable 复选框（左侧方形 checkbox）。但 `ModelCapabilitiesEditor` 传入 `enabled: true`（硬编码），且 `updateModel()` 不处理 `enabled` 字段。

**行为**: 用户点击 toggle 后视觉上切换到 disabled，但：
1. `updateModel` 不会将 `enabled` 写回 form（只更新 `context_window` 和 `patches`）
2. 下次 re-render 时恢复为 enabled（因为 prop 始终是 `true`）

**影响**: 不会产生数据错误，但用户会困惑——点了 toggle 似乎生效但实际无效。Provider 的模型没有单独禁用的概念（只有 Provider 级 `is_active`）。

**修复建议**: 在 `ModelCapabilitiesEditor.vue` 中，传给 ModelCard 的 model 对象不包含 enabled 字段，或在 ModelCard 中增加 `hideToggle` prop 控制。

### UX-2: 新建 Provider 未选模板时无提示 (P3 Low)

**文件**: `Providers.vue` (feat)

**现象**: main 分支在用户未选择模板时显示"请先选择模板"提示（`selectFirst`）。feat 分支移除了这个提示 UI。

**行为**: 新建 Provider 时，如果用户没有在下拉框中选择预设，只会看到模板选择区域，没有明确引导。用户可能不知道需要先选一个模板。

**影响**: 不影响功能，但引导性变差。

## 已确认无问题的差异

| 差异项 | 结论 |
|--------|------|
| 搜索/筛选功能（新增） | 新功能，逻辑正确，过滤 provider 名称和 base_url |
| Anchor bar 统计 | 新功能，computed 计算正确 |
| Switch 替代自定义 toggle | 使用 shadcn-vue Switch 组件，符合项目规范 |
| 模型列从逐个 Badge 改为数字统计 | 设计变更，功能等价 |
| `addModel(caps)` 签名变更 | composable 已同步更新，兼容调用 |
| 剪贴板复制改为 navigator.clipboard | 实现更简洁，有 fallbackCopy 兜底 |
| ConcurrencyControl 从组件调用改为内联 | 除了 BUG-1 外，三个字段（mode/max/timeout/queue）全部保留 |
| i18n 键 | 所有新增键（anchor/filter/empty）在 zh-CN/providers.json 中均已定义 |
| 后端 admin/providers.ts | 两分支完全相同，无 API 差异 |
| API client.ts | 仅有类型扩展，不影响 Provider CRUD |

## 总结

- **功能性 bug**: 1 个（BUG-1，并发 mode=none 字段未隐藏）
- **UX 问题**: 2 个（enable toggle 无效、未选模板无提示）
- **严重性**: 无 P0/P1 问题。BUG-1 为 P2，建议修复。
