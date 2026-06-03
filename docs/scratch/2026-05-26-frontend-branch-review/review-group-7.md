# 分组 7: Log Types & Viewer Infrastructure

## 审查结论
有差异

## 差异详情

### 文件: useSSEParsing.ts

- **差异类型**: 功能变更（类型扩展）
- **详细说明**:
  feat 分支将 `useSSEParsing()` 函数的 `apiType` 参数类型从 `'openai' | 'anthropic'` 扩展为 `"openai" | "openai-responses" | "anthropic"`，新增了 `"openai-responses"` 选项。

  **关键问题**: 参数类型虽然接受 `"openai-responses"`，但函数体内没有任何对应的 Responses API 处理逻辑：
  - `openaiAssembled` computed 仅在 `apiType !== 'openai'` 时返回 `null`，即传入 `"openai-responses"` 时也会返回 `null`
  - 没有新增任何 responses 专用的 computed 属性
  - SSE 事件解析逻辑（`sseEvents`）对 responses 格式没有特殊处理

  这意味着 `apiType = "openai-responses"` 时，该函数的行为与传入 `"openai-responses"` 和 `"anthropic"` 时完全一致（除了 `openaiAssembled` 返回 null 之外），实际上不具备 Responses API 的特殊 SSE 解析能力。

- **影响评估**: 低（类型扩展是向前兼容的，不会破坏现有功能；但功能上未完成 Responses API 的 SSE 解析，属于预留接口）

### 文件: types.ts

无功能差异。`LogEntry` 接口和 `PROVIDER_ID_ROUTER` 常量在两个分支中完全一致。

### 文件: logColors.ts

无功能差异。所有角色/块/标签的颜色常量、辅助函数（`roleClass`、`blockClass`、`blockBorderClass`、`tagClass`）完全一致。

### 文件: requestBlockParser.ts

无功能差异。`Block`/`MsgBlock` 接口、`parseTaggedContent()` 和 `extractBlocks()` 函数完全相同。

### 文件: InfoBanner.vue

无功能差异。props（`icon`、`title`、`subtitle`、`details`）、模板结构、CSS 类完全一致。

## 新增文件说明

无新增文件。

## 移除文件说明

无移除文件。

## 附注：仅格式差异

以下差异属于代码风格/格式化差异，不影响功能：
- `useSSEParsing.ts`: feat 分支用双引号 + 分号 + 多行展开风格；main 分支用单引号 + 无分号 + 紧凑风格
- `useSSEParsing.ts` catch 块注释: feat 分支有 `/* JSON 解析失败，跳过该事件 */` 中文注释，main 分支无
