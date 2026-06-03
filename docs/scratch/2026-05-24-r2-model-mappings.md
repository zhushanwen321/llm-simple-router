# R2: ModelMappings.vue 页面审查

**对比**: feat vs main 分支 `frontend/src/views/ModelMappings.vue` 及其子组件
**日期**: 2026-05-25

## 架构变更概述

| 方面 | main | feat |
|------|------|------|
| 布局 | 3 列卡片网格 (`grid-cols-3`) | 左右分栏：列表 340px + 详情面板 |
| 组件结构 | `ModelMappingCard.vue` + `MappingGroupDeleteDialog.vue` + `MappingEntryEditor.vue` | 全部内联在 `ModelMappings.vue` 中，删除了 `ModelMappingCard.vue` 和 `MappingGroupDeleteDialog.vue` |
| 添加映射 | 卡片网格内新增空卡片 | Dialog 弹窗 |
| 删除确认 | `AlertDialog` 组件 (`MappingGroupDeleteDialog.vue`) | footer 内 inline 确认 UI |
| 状态编辑 | Card 内展开/折叠 | 选中后右侧面板编辑 |
| 搜索 | 无 | 左侧列表顶部搜索框 |

## 功能性 Bug

### BUG-1: MappingEntryEditor.vue 使用原生 `<button>` 违反项目规范 (MUST FIX)

**文件**: `frontend/src/components/mappings/MappingEntryEditor.vue` (8 处)
**行号**: 294, 343, 400, 419, 464, 472, 521, 529

项目规范明确要求禁止使用原生 HTML 表单/交互元素，必须用 shadcn-vue 组件。feat 版本的 `MappingEntryEditor.vue` 使用了 8 个原生 `<button>` 元素替代了 main 版本中的 `<Button>` 组件。

**对比**:
- main 版本使用 `<Button variant="ghost" size="icon-xs">` — 合规
- feat 版本使用 `<button class="...">` — 违规

**影响**: `vue_rules_checker.py` pre-commit hook 会拒绝此文件。

**修复**: 将所有 `<button>` 替换为 `<Button>` 组件。

---

### 无其他功能性 Bug

以下方面经逐一对比，feat 分支实现正确：

| 检查项 | 结果 |
|--------|------|
| API 调用完整性 (CRUD) | 正确。get/create/update/delete/toggle 全部覆盖 |
| Rule JSON 序列化 | 正确。`serializeRule()` 正确组装 targets + overflow + multimodal_fallback |
| Rule JSON 反序列化 | 正确。`parseRule()` 兼容旧格式 `{default: ...}` 和新格式 `{targets: [...]}` |
| is_active toggle | 正确。通过独立 `api.toggleMappingGroup()` 调用，保存时不影响 is_active |
| Overflow 字段映射 | 正确。overflow_provider_id/overflow_model 仅附加到 targets[0]，与后端 `validateRule()` 一致 |
| Multimodal fallback 序列化 | 正确。条件写入 `multimodal_fallback`，前端判断 `!!editMultimodal` |
| Multimodal fallback 反序列化 | 正确。从 `rule.multimodal_fallback` 读取 |
| 删除后选中逻辑 | 正确。删除后选中 remaining[0]，无剩余则 null |
| 添加后选中逻辑 | 正确。`selectedId.value = result.id` 选中新建项 |
| 搜索过滤 | 正确。client_model 的 toLowerCase includes 匹配 |
| 数据加载 | 正确。`Promise.allSettled` 并行加载 groups + providers |
| 错误处理 | 正确。所有 catch 块同时包含 `console.error` 和 `toast.error` |
| 编辑状态同步 | 正确。`watch(selectedGroup)` 在切换选中时深拷贝 targets/overflow/multimodal |
| providerGroups 构建 | 正确。与 main 版本一致，使用 `DEFAULT_CONTEXT_WINDOW` 兜底 |

## 功能性遗漏

### OMIT-1: MappingGroupDeleteDialog.vue 和 ModelMappingCard.vue 删除但未清理注册

`ModelMappingCard.vue` 和 `MappingGroupDeleteDialog.vue` 从 components/mappings/ 目录中移除（架构重构，功能已内联），这不构成 bug——这两个组件的 import 不存在于任何 feat 文件中。但需要确认 git 中是否已物理删除。

### 无其他功能性遗漏

feat 分支完整覆盖了 main 分支的所有功能：
- 映射组 CRUD
- Failover chain 编辑（添加/删除/修改 target）
- Context overflow 配置
- Multimodal fallback 配置（含 session lock warning）
- Active/Inactive toggle
- 搜索过滤

## 总结

| 级别 | 数量 | 说明 |
|------|------|------|
| MUST FIX | 1 | BUG-1: MappingEntryEditor.vue 原生 `<button>` 违反项目规范 |
| 建议改进 | 0 | — |
| 功能性 Bug | 0 | 除了规范违规外无功能性 bug |
| 功能遗漏 | 0 | feat 完整覆盖 main 的所有 CRUD 和编辑功能 |
