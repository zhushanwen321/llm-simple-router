# ProxyEnhancement.vue 页面复审

## 审查范围

- feat 分支 vs main 分支 `ProxyEnhancement.vue` 全量对比
- 后端 API：`proxy-enhancement.ts`、`settings.ts`
- 前端 API 层：`client.ts`（ProxyEnhancementConfig 类型）、`settings-api.ts`

## 上一轮修复验证：persisted 标记

**结论：已正确修复。**

main 分支问题：`handleSave()` 成功后未将新增条目的 `persisted` 标记为 `true`，导致保存后 `client_type` 输入框仍为可编辑状态，用户可以修改已持久化的 `client_type`。

feat 分支修复（L522-525）：
```ts
for (const entry of clientSessionHeaders.value) {
  if (entry.client_type.trim() && entry.session_header_key.trim()) {
    entry.persisted = true;
  }
}
```
逻辑正确：只标记有效条目（非空 client_type + session_header_key），空行条目不标记。

## 功能性 Bug

### BUG-1：保存后脏状态未更新 initialConfig（main 分支遗留）

**严重度：中**

feat 分支 `handleSave()` 在保存成功后更新了 `initialConfig = snapshot()`，修复了 main 分支的遗留问题（main 分支保存后不更新 snapshot，导致"取消"按钮无法正确恢复）。

**结论：已修复。** 无需再处理。

### BUG-2：客户端 session headers 清空后保存会报 400

**严重度：中**

后端 `PUT /admin/api/settings/client-session-headers` 要求 `entries` 为非空数组：
```ts
if (entries.length === 0) {
  return reply.code(400).send("entries must be a non-empty array");
}
```

前端过滤逻辑：
```ts
const entriesToSave = clientSessionHeaders.value
  .filter((e) => e.client_type.trim() && e.session_header_key.trim())
  .map(...)
```

场景：用户把所有条目都清空（client_type 和 session_header_key 都删掉），`entriesToSave` 为空数组 → 后端返回 400 → `Promise.allSettled` 中该 promise rejected → 前端显示 "保存失败: entries must be a non-empty array"。

但同时另外两个 API（proxy-enhancement、token-estimation）可能已经成功了。用户看到错误提示，不知道部分配置已保存。

**main 分支也存在此问题。** 不是回归，但建议修复。

### BUG-3（非 bug）：删除按钮允许减到 1 条

UI 上删除按钮 `:disabled="clientSessionHeaders.length <= 1"`，当只剩 1 条时不可删除。但这条记录可以是空行（用户清空了内容）。用户如果想完全清空配置，做不到。

这和 BUG-2 是同一个根因：后端要求至少 1 条有效条目，但前端 UI 无法表达"完全清空"的意图。这不是 bug 而是设计约束，但在 main 分支中行为一致。

## API 字段对比

| 字段 | 后端 GET 返回 | 前端读取 | 后端 PUT 接收 | 前端发送 | 一致？ |
|------|-------------|---------|-------------|---------|--------|
| tool_call_loop_enabled | boolean | `data.tool_call_loop_enabled` | boolean | `toolCallLoopEnabled.value` | OK |
| stream_loop_enabled | boolean | `data.stream_loop_enabled` | boolean | `streamLoopEnabled.value` | OK |
| tool_round_limit_enabled | boolean | `data.tool_round_limit_enabled` | boolean | `toolRoundLimitEnabled.value` | OK |
| tool_error_logging_enabled | boolean | `data.tool_error_logging_enabled` | boolean | `toolErrorLoggingEnabled.value` | OK |
| ai_retry_config | object\|null | `data.ai_retry_config ?? undefined` | optional object\|null | `aiRetryConfig.value ?? null` | OK |

所有字段映射正确，无遗漏。

## 交互模式对比

| 检查项 | feat | main | 合规 |
|--------|------|------|------|
| Switch 直调 API | 否，本地状态 | 否，本地状态 | OK |
| 保存按钮模式 | 是（fixed bar + isDirty） | 部分（无 isDirty，按钮始终可点） | feat 更好 |
| 取消按钮 | 有，恢复 initialConfig | 无 | feat 新增，OK |
| 脏状态提示 | 有 isDirty computed | 无 | feat 新增，OK |

feat 分支正确实现了"编辑→保存按钮"模式，符合项目规范。

## main 分支中 feat 已修复的问题清单

| 问题 | main 分支 | feat 分支 |
|------|-----------|-----------|
| persisted 标记未更新 | 缺失 | 已修复（L522-525） |
| initialConfig 未更新 | 缺失 | 已修复（L528） |
| 无 isDirty 检测 | 无 | 已添加（computed + snapshot） |
| 无取消按钮 | 无 | 已添加 |
| 无加载态/错误态 | 无 | 已添加（Skeleton + loadError） |
| loadConfig 中 token 和 headers 串行 | 串行 await | 已改为 Promise.allSettled |
| 默认值不一致（toolRoundLimitEnabled） | `ref(true)` | `ref(false)`，从 API 获取 | feat 正确，从后端取值 |

## 结论

**无新增功能性 bug。** 上一轮修复（persisted 标记 + initialConfig 更新）已正确实现。唯一的已知问题（BUG-2：空 entries 保存报 400）是 main 分支遗留的设计问题，不是回归。

feat 分支相比 main 分支有显著改进：脏状态检测、取消恢复、加载/错误状态、persisted 标记更新、并行加载。
