# R2 Review: Monitor 页面修复验证

## Bug 1: request_start handler 缺少 triggerRef

**位置**: `frontend/src/composables/useMonitorData.ts` L82-L87

**修复内容**: `request_start` case 中，`activeRequests.value.unshift(req)` 后紧跟 `triggerRef(activeRequests)`。

**验证结果**: PASS

```typescript
case "request_start": {
  const req = data as ActiveRequest;
  if (!recentCompleted.value.some((r) => r.id === req.id)) {
    activeRequests.value.unshift(req);
    triggerRef(activeRequests);  // 修复：shallowRef + mutation 需要 triggerRef
  }
  break;
}
```

**正确性分析**:
- `activeRequests` 是 `shallowRef`，`.unshift()` 是数组原位 mutation，不会触发 shallowRef 的响应式更新
- `triggerRef` 强制通知依赖该 ref 的 computed/template 重新求值
- 与同文件中 `stream_content_update` handler 的模式一致（也是 mutation 后 `triggerRef`）
- `request_update` handler 直接赋值整个数组 `activeRequests.value = data as ActiveRequest[]`，这是 ref 替换，不需要 triggerRef — 模式正确
- `request_complete` handler 使用 `.filter()` 产生新数组赋值给 `.value`，也是 ref 替换，不需要 triggerRef — 模式正确
- 去重检查 `recentCompleted.value.some((r) => r.id === req.id)` 仍在，避免 completed→start 竞态重复添加

**未引入新问题**: 无。

## Bug 2: en/monitor.json 缺少 providerStatsHide / providerStatsShow key

**位置**: `frontend/src/i18n/locales/en/monitor.json` L14-L15

**修复内容**: 新增 `providerStatsHide` 和 `providerStatsShow` 两个 key。

**验证结果**: PASS

```json
"providerStatsHide": "Hide Stats",
"providerStatsShow": "Show Stats",
```

**正确性分析**:
- Monitor.vue L369-370 使用 `t("monitor.providerStatsHide")` / `t("monitor.providerStatsShow")`，现在 en locale 有对应 key
- zh-CN locale 同步存在这两个 key（`"Hide"` / `"Show"`），两端一致
- Collapsible 按钮文案在 en locale 下不再回退到 key 名，显示有意义的 "Hide Stats" / "Show Stats"

**未引入新问题**: 无。
