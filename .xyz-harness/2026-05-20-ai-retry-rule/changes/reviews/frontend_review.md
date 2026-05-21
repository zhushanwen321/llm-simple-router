---
verdict: fail
must_fix: 2
---

# Frontend Code Review — AI Retry Rule Generate

**Commit:** `85305c3`
**Review Scope:** AC2 (日志详情触发) + AC4 (规则预览保存)

## 审查结论

**verdict: fail** — 发现 2 个 MUST FIX 问题，需修复后重新审查。

---

## MUST FIX

### 1. UnifiedRequestDialog.vue: `goToConfig()` 使用 `router.push()` 而非 `window.open()`

**违反 AC2 明确要求。**

- **位置:** `frontend/src/components/request-detail/UnifiedRequestDialog.vue` — `goToConfig()` 函数
- **问题:** spec AC2 明确要求：
  > "前往配置"按钮：`window.open('/admin/proxy-enhancement', '_blank')` 打开新标签页
  >
  > 不关闭日志详情弹窗

  当前实现使用 `router.push('/proxy-enhancement')`，会在当前标签页内导航，关闭日志详情弹窗（Dialog）。这违反了"不关闭日志详情弹窗"的要求。
- **修复:** 改为 `window.open('/admin/proxy-enhancement', '_blank')`，并删除多余的 `useRouter` 导入。
- **相关 spec 原文:**
  > AC2: 配置未完成时弹出提示 Dialog，"前往配置"打开新标签页，不关闭日志详情弹窗

### 2. AiRulePreviewDialog.vue: 缺少客户端表单验证

**违反 FR6 明确要求。**

- **位置:** `frontend/src/components/request-detail/AiRulePreviewDialog.vue` — `handleSave()` 函数
- **问题:** spec FR6 明确要求：
  > 保存时客户端校验（regex 合法性、status_code 范围、数值合理性）

  当前 `handleSave()` 直接调用 `api.createRetryRule()`，无任何前置校验。以下字段应校验：
  - `name`: 非空
  - `status_code`: 100-599 整数
  - `body_pattern`: 合法正则（需 `new RegExp()` 验证不抛异常）
  - `retry_delay_ms`: 正整数
  - `max_retries`: 0-100 整数
  - `max_delay_ms`: 正整数（仅 exponential 策略时）
- **修复:** 在 `handleSave()` 开头增加校验逻辑，校验失败时 `toast.error()` 提示，不发起 API 调用。可复用 `retryRules.json` 中已有的 validation 翻译 key（`nameRequired`、`statusCodeRange`、`bodyPatternInvalid`、`delayMin`、`retriesRange`）。

---

## 检查清单逐项审计

### AiRulePreviewDialog.vue（新建文件，202 行）

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 正确的 shadcn-vue Dialog 结构 | ✅ | `Dialog` → `DialogContent` → `DialogHeader/DialogTitle` → 表单 → `DialogFooter` |
| AI 摘要用绿色卡片显示 | ✅ | `bg-success/10` + `text-success-foreground` + `CheckCircle2` 图标 |
| 所有规则字段可编辑 | ✅ | name(Input), status_code(Input number), body_pattern(Textarea), retry_strategy(Select), retry_delay_ms(Input number), max_retries(Input number), max_delay_ms(Input number), is_active(Switch) |
| 表单验证 | ❌ MUST FIX | `handleSave()` 无任何前置验证 |
| 保存调用 `api.createRetryRule()` | ✅ | 正确传递 payload，含 `max_delay_ms: undefined` 对 fixed 策略的处理 |
| 使用 shadcn-vue 组件，无原生 HTML | ✅ | Button, Input, Textarea, Label, Badge, Switch, Dialog, Select 系列组件均从 ui/ 导入 |
| 无 `any` 类型 | ✅ | `RuleFormData`/`RuleForm` 接口正确定义 |
| 无 `eslint-disable` 注释 | ✅ | 无 |
| 双层错误处理 | ✅ | `console.error('AiRulePreviewDialog.handleSave:', e)` → `toast.error(getApiMessage(...))` |
| 文件行数限制 (template<800, script<600) | ✅ | 202 行整体，远低于限制 |

### UnifiedRequestDialog.vue（修改文件，329→ 行）

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 按钮在左侧面板底部 | ✅ | 位于 `RequestOverviewPanel` 之后的 `mt-4 border-t pt-4` div 内 |
| 带 sparkle 图标 + loading 状态 | ✅ | `Sparkles` 图标 + `:disabled="generating"` + 文字切换 |
| `handleGenerateRule` 正确处理三种结果 | ✅ | 成功→预览Dialog, 配置缺失→hintDialog, 其他错误→toast |
| 配置缺失时弹出 hint Dialog | ✅ | `configPromptOpen` 控制，含 title/description/footer |
| 配置缺失 Dialog 使用 `window.open` | ❌ MUST FIX | 用了 `router.push()`，不满足"新标签页+不关闭日志弹窗" |
| toast 双层错误处理 | ✅ | `console.error('UnifiedRequestDialog.handleGenerateRule:', e)` + toast |
| 无 `any` 类型 | ✅ | `generatedRule` 使用内联类型定义 |
| 无 `eslint-disable` 注释 | ✅ | 无 |
| 文件行数限制 (template<800, script<600) | ✅ | 329 行整体 |

### i18n 翻译（zh-CN/logs.json, en/logs.json）

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 新增 key 完整覆盖 | ✅ | 8 个 key 中英文均添加 |
| 关键翻译相符 | ✅ | `generateRetryRule` / `生成重试规则`, `analyzing` / `分析中...`, `goToConfig` / `前往配置` 等 |
| 未使用的 key | ⚠️ 建议清理 | `aiAnalysisComplete` 定义了但未在任何组件中使用 |

### 规范合规

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 无 `any` 类型 | ✅ | 所有变量正确定义 |
| 无 `eslint-disable` 注释 | ✅ | 无 |
| `console.error` 在 `toast` 之前 | ✅ | 两份 catch 块均符合 |
| 禁止原生 HTML 表单元素 | ✅ | 全部使用 shadcn-vue 组件 |
| 无 Emoji | ✅ | 使用 `Sparkles` / `CheckCircle2` lucide 图标 |
| 无硬编码颜色 | ✅ | 使用 Tailwind 语义色系（`bg-success/10` 等） |

---

## 建议改进（非阻塞）

1. **`onRuleSaved()` 空函数** — 当前仅含注释。考虑移除或加入后续扩展逻辑（如刷新日志列表中的状态）。
2. **`aiAnalysisComplete` i18n key 未使用** — 建议移除或按需使用（如在成功 toast 中引用）。
3. **配置缺失错误匹配较脆弱** — 前端通过正则 `/config/i` / `/未配置/` 匹配后端错误消息定位配置缺失。建议后端返回结构化错误码（如 `error.code === "AI_CONFIG_MISSING"`）以减少对错误文本的依赖。当前方式可接受，但属于潜在维护风险。

---

## AC 覆盖矩阵

| AC | 覆盖状态 | 说明 |
|----|---------|------|
| AC2-1: 左侧栏底部按钮+sparkle图标 | ✅ | 通过 |
| AC2-2: 点击后 loading 状态 | ✅ | 通过 |
| AC2-3: 配置未完成弹出提示 Dialog，"前往配置"新标签页 | ❌ MUST FIX | `window.open` 要求未满足 |
| AC2-4: 配置完成+AI成功弹出预览Dialog | ✅ | 通过 |
| AC2-5: AI 调用失败 toast 显示错误 | ✅ | 通过 |
| AC4-1: 预览 Dialog 所有字段预填且可编辑 | ✅ | 通过 |
| AC4-2: AI 分析摘要正确显示 | ✅ | 通过 |
| AC4-3: 保存后规则出现在重试规则列表中 | ✅ | 通过（`saved` emit 让父组件有机会刷新列表） |
| AC4-4: 前端错误处理符合规范 | ✅ | 双层错误处理 |


