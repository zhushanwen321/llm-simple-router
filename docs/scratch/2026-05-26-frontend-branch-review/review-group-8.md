# 分组 8: Log Viewer — Request/Response

## 审查结论
一致

## 差异详情
无功能差异。

### 文件: LogRequestViewer.vue
- 差异类型: 代码重构（类型扩展）
- 详细说明: `apiType` prop 类型从 main 的 `"openai" | "anthropic"` 扩展为 feat 的 `"openai" | "openai-responses" | "anthropic"`。模板和 script 中均无对 `"openai-responses"` 的特殊渲染分支 — 该组件不按 `apiType` 分发内容，仅做通用请求体结构化展示（messages/tools/system）。类型扩展仅为了让调用方可以传入新 API 类型而不触发 TS 类型错误，不影响运行时行为。
- 影响评估: 低

### 文件: LogResponseViewer.vue
- 差异类型: 代码重构（类型扩展）
- 详细说明: 同 LogRequestViewer，`apiType` prop 类型从 main 的 `"openai" | "anthropic"` 扩展为 feat 的 `"openai" | "openai-responses" | "anthropic"`。模板中非流式（`v-if="apiType === 'openai'"` / `v-if="apiType === 'anthropic'"`）、流式完整响应、流式原始事件三处均无 `"openai-responses"` 分支。传入 `"openai-responses"` 时，结构化视图将不渲染 body 内容（仅显示 status code + headers），raw 视图照常显示。类型扩展为前向兼容，不改变现有功能。
- 影响评估: 低

### 文件: JsonCopyBlock.vue
- 无差异。模板（复制按钮 + `<pre>` JSON 显示）、script（`useClipboard` + `useI18n`）、props（`content: string; hideCopyButton?: boolean`）在两个分支完全一致。

### 文件: StatPill.vue
- 无差异。props（`label`、`value`、`highlight?`）、模板（Badge 组件变体切换）在两个分支完全一致。

### 文件: TagPill.vue
- 无差异。props（`label`）、模板（Badge outline 样式）在两个分支完全一致。

## 新增文件说明
无。两个分支的 `log-viewer/` 目录下文件清单完全一致（11 个文件）。

## 移除文件说明
无。main 分支的所有文件在 feat 分支中均存在。
