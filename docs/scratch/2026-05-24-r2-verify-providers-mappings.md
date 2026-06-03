# R2 审查修复验证：Providers & ModelMappings

## 1. ModelCapabilitiesEditor.vue — 并发 mode=none 守卫

**Bug**: 当 concurrencyMode 为 `none` 时，maxConcurrency / queueTimeoutMs / maxQueueSize 三个字段仍可见。

**修复验证**: 通过

第 436 行：
```html
<template v-if="props.modelValue.concurrencyMode !== 'none'">
```

三个字段（maxConcurrency、queueTimeoutMs、maxQueueSize）被 `<template v-if>` 包裹，mode=none 时全部隐藏。`onConcurrencyModeChange()` 函数也仅在 auto/manual 模式时设置默认值，none 模式不触碰这些字段。

**无新问题引入**。

---

## 2. MappingEntryEditor.vue — 原生 `<button>` 替换

**Bug**: 文件中存在 8 个原生 `<button>` 元素，违反"禁止使用原生 HTML 表单元素"规范。

**修复验证**: 通过

- 文件中 `<button`（小写）搜索结果为零。
- 共 8 处 `<Button>`（大写，shadcn-vue 组件），均正确 import 自 `@/components/ui/button`。

逐一确认 8 个 `<Button>` 用途：

| # | 用途 | variant | size |
|---|------|---------|------|
| 1 | 折叠行删除按钮 | ghost | icon-xs |
| 2 | 客户端模型编辑按钮 | ghost | xs |
| 3 | Failover 链条删除按钮（v-if 守卫） | ghost | icon-xs |
| 4 | 添加备用目标 | ghost | 默认 |
| 5 | Overflow 删除按钮（v-if 守卫） | ghost | icon-xs |
| 6 | 添加 Overflow | ghost | xs |
| 7 | Multimodal 删除按钮（v-if 守卫） | ghost | icon-xs |
| 8 | 添加 Multimodal fallback | ghost | xs |

**无新问题引入**。所有 Button 都有正确的 variant/size 属性和事件处理。

---

## 结论

两个页面的 R2 修复均验证通过，无遗留问题，无新问题引入。
