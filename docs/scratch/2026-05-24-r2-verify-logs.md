# R2 Review: Logs 页面修复验证

## Bug: hasActiveFilters 计算逻辑

**位置**: `frontend/src/views/Logs.vue` L254-L262

**修复内容**: `hasActiveFilters` 改为直接检查各过滤条件是否偏离默认值。

**验证结果**: PASS

```typescript
const hasActiveFilters = computed(() => {
  return (
    providerFilter.value !== "all" ||
    modelFilter.value !== "all" ||
    keyFilter.value !== "all" ||
    statusFilter.value !== "all" ||
    !!dateRange.value.start ||
    !!dateRange.value.end
  );
});
```

**正确性分析**:
- 各 filter 的默认值在 `useLogFilters` composable 和 `clearAllFilters()` 中明确定义为 `"all"`
- `dateRange` 默认为 `{ start: "", end: "" }`，空字符串 falsy，`!!` 转换后为 false
- `period` 未包含在 hasActiveFilters 中，因为 "5h" 是默认 period 而非 "all"，且 period 不属于用户手动设置的"筛选条件"——它是时间范围的快捷方式，所有 period 值（包括默认的）都是合法选择
- `clearAllFilters()` 重置所有 filter 到默认值后，`hasActiveFilters` 正确返回 false，清空按钮消失
- 旧实现（推测）可能基于 filter 值数量或其他间接方式判断，新实现直接对比默认值，语义清晰无歧义

**覆盖范围检查**:
- `providerFilter` — 已检查 (默认 "all")
- `modelFilter` — 已检查 (默认 "all")
- `keyFilter` — 已检查 (默认 "all")
- `statusFilter` — 已检查 (默认 "all")
- `dateRange.start` — 已检查 (默认 "")
- `dateRange.end` — 已检查 (默认 "")
- `period` — 刻意排除（非 filter 性质，见上文分析）

**使用场景验证**:
- 无日志 + 无 filter → 只显示 "No logs" 提示
- 无日志 + 有 filter → 额外显示 filter hint + "Clear all filters" 按钮
- 有日志 → hasActiveFilters 不影响展示

**未引入新问题**: 无。`clearAllFilters()` 重置后的值与 hasActiveFilters 检查的默认值完全一致。
