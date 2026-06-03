# RetryRules.vue 页面复审

## 分支对比结论

feat 分支与 main 分支的 RetryRules.vue 差异极小，仅 3 处样式变更：

| 行 | main | feat | 性质 |
|----|------|------|------|
| 外层容器 | `<div class="p-6">` | `<div class="page">` | 样式：全局工具类替换 |
| 表格容器 | `<div class="bg-card rounded-lg border overflow-hidden">` | `<Card flush>` | 样式：Card 组件替换 |
| import | 无 | `import { Card } from "@/components/ui/card"` | 新增 import |

RecommendedRules.vue 两个分支完全一致（diff 无输出）。

**<script setup> 逻辑完全一致**，CRUD 操作、表单验证、API 调用、错误处理均未改动。

## feat 分支引入的功能性 bug

**无。** 所有变更均为样式层面，未引入新的功能性问题。

## 既存 bug（main 和 feat 均存在）

### BUG-1: JSON 匹配模式创建规则时 body_pattern 为空导致后端 400

**严重度**: 高（阻断用户操作）

**复现路径**:
1. 点击"添加规则"
2. Body Pattern 切换到"JSON 匹配"标签页
3. 添加一条 JSON 条件（如 path=`error.code`, operator=`contains`, value=`1302`）
4. 填完其他字段，点保存

**原因链**:
- `DEFAULT_FORM.body_pattern = ""`
- 切换到 JSON 标签页后，regex 输入框不渲染，`body_pattern` 保持空字符串
- 前端 `validate()` 在 `matchMode === "json"` 时不校验 `body_pattern`
- `handleSave()` 始终发送 `body_pattern: form.value.body_pattern`（即 `""`）
- 后端 `CreateRetryRuleSchema` 要求 `body_pattern: Type.String({ minLength: 1 })`
- Fastify schema 校验拒绝，返回 400

**影响**: 用户无法通过 JSON 匹配模式创建新规则。

**修复方向**: 两种选一：
- A) JSON 模式时发送 `body_pattern: "."`（通配正则，后端已对空串做跳过处理，但通配更安全）
- B) 后端 schema 放宽 body_pattern 为 Optional（当 body_matchers 非空时）

### BUG-2: openEdit 编辑 JSON 规则时 body_pattern 未被清空/保护

**严重度**: 低（不影响当前功能，但与 BUG-1 交互时可能产生困惑）

**场景**: 编辑一条通过 JSON 模式创建的规则时，`openEdit` 把 `r.body_pattern`（可能是空或通配值）加载到 form 中。用户切换到 regex 标签页会看到空内容，但实际 payload 中 body_pattern 有值。

这是 BUG-1 的关联问题。如果 BUG-1 修复为方案 A（发送通配正则），编辑时 regex 输入框会显示 `"."`，对用户不够友好。

## 审查清单

| 检查项 | 结果 |
|--------|------|
| API 端点匹配（GET/POST/PUT/DELETE） | 通过 |
| 数据字段完整性（vs RetryRule type） | 通过 |
| 创建操作 | 存在 BUG-1 |
| 编辑操作（openEdit → handleSave） | 通过 |
| 删除操作（确认弹窗 + API 调用） | 通过 |
| 表单验证（name/status_code/body_pattern/delay/retries） | JSON 模式缺少 body_pattern 处理 |
| 错误处理（console.error + toast.error 双层） | 通过 |
| RecommendedRules 组件（批量添加） | 通过 |
| onMounted 数据加载 | 通过 |
| i18n 键覆盖 | 通过 |
| provider_id 双向映射（__all__ ↔ null） | 通过 |
| is_active 布尔/数值转换 | 通过 |
| 并行请求使用 Promise.allSettled | 通过 |
