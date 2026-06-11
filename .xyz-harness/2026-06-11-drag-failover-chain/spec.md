---
verdict: pass
---

# 故障转移链拖拽重排（ModelMappings 页面）

## Background

GitHub issue [#198](https://github.com/zhushanwen321/llm-simple-router/issues/198) 反馈：在管理后台"模型映射"页配置故障转移链时，调整供应商顺序需要先删除再重新添加，操作繁琐。希望用拖拽方式直接调整顺序。

当前实现（`frontend/src/views/ModelMappings.vue`）的故障转移链是一个垂直列表，顺序固定为 `editTargets` 数组顺序。每个 target 有：序号徽章 + `CascadingModelSelect` + 删除按钮。已有 `addTarget` / `removeTarget` / `updateTarget` 三个修改函数，但**没有任何重排入口**。

## Functional Requirements

### FR-1 拖拽触发

- FR-1.1 当 `editTargets.length >= 2` 时，每个 target 行启用 HTML5 原生拖拽（`draggable="true"`），整行可作为拖动源
- FR-1.2 鼠标悬停在可拖行上时显示 `cursor: grab`；按下时显示 `cursor: grabbing`
- FR-1.3 当 `editTargets.length <= 1` 时，行不启用拖拽，`cursor: default`
- FR-1.4 拖拽起点必须在行的"非控件区"上发起。"非控件区"指整行 `<div>` 中除 `CascadingModelSelect` 和删除按钮 `<Button>` 之外的剩余区域。在 `CascadingModelSelect` 和删除按钮的容器上绑定 `@dragstart.stop.prevent`，显式拦截浏览器原生 `dragstart` 事件（`stopPropagation` 阻止冒泡 + `preventDefault` 阻止浏览器启动拖拽），确保在控件区域操作时不会误触发拖拽（避免与下拉点击/删除点击冲突）

### FR-2 视觉反馈

- FR-2.1 正在拖动的行：透明度降到 50%，加 `cursor: grabbing`
- FR-2.2 放置指示线：在拖动行预期插入位置显示 2px 蓝色（`bg-primary`）横线。`dragover` 时按鼠标在目标行中的 y 坐标判定：上 1/2 → 在该行**之前**插入（指示线出现在该行顶部）；下 1/2 → 在该行**之后**插入（指示线出现在该行底部）。边界情况（如终点行）：将自身拖到自己位置视为 no-op
- FR-2.3 视觉反馈仅在拖动过程中存在，松手后立即清除

### FR-3 重排逻辑

- FR-3.1 `drop` 事件触发后，调用纯函数 `moveItem(arr, from, to)` 把 `editTargets.value` 中 `from` 位置的元素移到 `to` 位置
- FR-3.2 整个重排过程仅修改前端 `editTargets` ref 的顺序，**不**触发 API 调用
- FR-3.3 序号 ① ② ③ 同步重排（Vue 响应式自动重渲）

### FR-4 数据流不变

- FR-4.1 拖拽结果进入"未保存"状态，**不**自动持久化
- FR-4.2 用户点击"保存"按钮后，`serializeRuleDomain` 把重排后的 `editTargets` 序列化为 rule JSON
- FR-4.3 序列化输出的 `targets` 数组顺序与拖拽后 UI 顺序**完全一致**（顺序敏感，关系到 failover 选路）

### FR-5 不在范围

- FR-5.1 `frontend/src/components/mappings/MappingEntryEditor.vue`（QuickSetup 入口的同构编辑器）**不动**
- FR-5.2 触屏支持**不做**（原生 HTML5 DnD 在移动端体验差；本项目是 PC 端管理后台，无移动端需求）
- FR-5.3 跨容器拖拽、多选拖拽、自动滚动、placeholder 行级虚影**不做**

## Acceptance Criteria

| 编号 | 场景 | 期望 |
|------|------|------|
| AC-1 | `editTargets.length >= 2` 时，鼠标悬停任一 target 行 | `cursor: grab`；行具有 `draggable="true"` 属性 |
| AC-2 | 按住行的"非控件区"开始拖动 | 拖动行透明度 50%；显示 `cursor: grabbing`；被拖行跟随鼠标 |
| AC-3 | 拖动到任一其他 target 行的上半/下半 | 出现放置指示线（2px 蓝色横线），指示线在该行顶部（鼠标在上半）或底部（鼠标在下半） |
| AC-4 | 释放鼠标完成 drop | `editTargets.value` 的顺序按预期更新；DOM 中 ① ② ③ 顺序同步 |
| AC-5 | 拖动结束后点击"保存" | API `updateMappingGroup` 请求的 `rule.targets` 数组顺序与 UI 一致 |
| AC-6 | 对 `CascadingModelSelect` 触发 `dragstart` 事件（模拟浏览器原生拖拽启动）| dragstart 被拦截，不触发拖拽；下拉行为正常 |
| AC-7 | 对删除按钮触发 `dragstart` 事件（模拟浏览器原生拖拽启动）| dragstart 被拦截，不触发拖拽；按钮点击行为正常 |
| AC-8 | `editTargets.length === 1` 时 | 行不具有 `draggable="true"` 属性；`cursor: default` |
| AC-9 | 拖动到同一位置释放（被拖行 = 目标行） | 数组顺序不变；无报错；指示线不显示 |
| AC-10 | 在 `MappingEntryEditor.vue`（QuickSetup 入口）操作故障转移链 | 行为完全保持现状，无拖拽 |
| AC-11 | 纯函数 `moveItem([a,b,c,d], 0, 2)` | 返回 `[b,c,a,d]`；原数组不变（immutable） |
| AC-12 | 拖拽完成（未点击保存）后 | `updateMappingGroup` API **未**被调用（可通过 `vi.spyOn(api, 'updateMappingGroup')` 断言调用次数为 0） |

## Decisions Made

| 决策 | 选择 | 备选 | 理由 |
|------|------|------|------|
| 拖拽库 | **原生 HTML5 DnD API** | vuedraggable-next、@formkit/drag-and-drop | 用户选择零依赖；本场景是 PC 端管理后台，跨浏览器一致性可接受；不会引入长尾维护成本 |
| 拖拽触发区 | **整行可拖** | 专属手柄（GripVertical） | 用户选择；UX 上更直观 |
| 重排锁定 | **全链可拖** | 锁定 primary（①） | 用户选择；primary 是约定，运维可按需调整 |
| 改动范围 | **仅 `ModelMappings.vue`** | 同时改 `MappingEntryEditor.vue` | 用户选择；最小改动；QuickSetup 路径保留原状 |
| 重排时机 | **点击保存后才持久化** | 拖完立即 PUT API | 保持项目"保存按钮"模式（参见 `ProxyEnhancement.vue` 既有人机交互） |
| 拖拽核心 | **抽出 `moveItem()` 纯函数** | 内联在事件 handler | 便于单测覆盖行为表；与项目"纯函数可独立测试"原则一致 |

## Constraints

### 技术栈
- Vue 3.5 + TypeScript + Tailwind CSS v3.4
- **零新增依赖**：使用浏览器原生 HTML5 Drag and Drop API
- 不引入 vuedraggable / @formkit/drag-and-drop / sortablejs 等第三方库
- 不修改后端、不修改 Admin API、不修改 DB schema

### 兼容性
- 目标浏览器：Chrome、Firefox 最新两个稳定版
- 不支持触屏（已知限制，scope FR-5.2）

### 代码质量
- 拖拽核心逻辑（数组重排）必须抽出为**纯函数**，便于单元测试
- 遵循项目 lint/格式规范（`npm run lint` 必须 0 warning）
- 遵循 `frontend/<style scoped>` 内只允许 `@apply` 的硬性规范
- 不使用 emoji；拖拽手柄或视觉指示用 `@lucide/vue` 图标（如 `GripVertical`），若仅靠 CSS 也可

### 已有约束（来自 CLAUDE.md / CONTEXT.md）
- 故障转移语义已在 `CONTEXT.md:55-57` 定义，本 spec 不修改
- "保存按钮"模式（ProxyEnhancement / ModelMappings）：UI 状态变更**不**直调 API，必须点击保存
- 后端 API 的 `rule.targets` 顺序敏感，序列化必须按 UI 当前顺序输出

## 业务用例

> 业务场景描述。算法/纯技术性需求可标注"无业务用例"——本需求是纯 UI 改进，下文给出唯一用例。

### UC-1: 调整故障转移链顺序

- **Actor**: 管理员（配置 LLM 路由映射的运维/开发）
- **场景**: 管理员在"模型映射"页面编辑某个 client model 的故障转移链。当前 primary provider（①）出现持续 5xx 错误，管理员想把另一个更稳定的 provider 提升为 primary
- **预期结果**: 管理员用鼠标拖动目标 provider 行到 ① 位置，序号自动重排，点击保存后 API 调用使新顺序在后续请求的 failover 选路中生效
- **当前痛点**: 必须先删除原 primary，再添加新 primary，再把原 primary 加为 backup（要重复选 provider/model）；5 个 target 的链要折腾 5 次以上操作

## Complexity Assessment

| 维度 | 评估 |
|------|------|
| 业务复杂度 | 低。纯 UI 重排，不涉及路由逻辑、数据模型 |
| 技术复杂度 | 中。HTML5 DnD 跨浏览器一致性、控件事件冒泡拦截、视觉反馈 |
| 影响面 | 单文件（`ModelMappings.vue`），~50 行新增 |
| 风险点 | (1) 拖动过程中下拉框事件冲突 (2) Firefox vs Chrome 的 `dataTransfer` 行为差异 (3) 视觉反馈性能 |
| 测试难度 | 中。`@vue/test-utils` 模拟 DnD 事件可行；纯函数部分可独立 vitest |
| 预估实现 | 2-3 小时（含测试） |

## 实现要点（供 Phase 2 plan 参考，非 spec 强制）

### 1. 纯函数 `moveItem<T>(arr: T[], from: number, to: number): T[]`

放置位置：`frontend/src/utils/array.ts`（新建）或 `mapping-domain.ts` 复用文件

```typescript
// 行为表（驱动单元测试）
moveItem([1,2,3,4], 0, 2)  // → [2,3,1,4]  （前移）
moveItem([1,2,3,4], 3, 0)  // → [4,1,2,3]  （末→首）
moveItem([1,2,3,4], 0, 3)  // → [2,3,4,1]  （首→末边界）
moveItem([1,2,3,4], 1, 2)  // → [1,3,2,4]  （相邻交换）
moveItem([1,2,3,4], 1, 1)  // → [1,2,3,4]  （to === from，no-op）
moveItem([], 0, 0)         // → []          （空数组）
moveItem([1], 0, 0)        // → [1]         （单元素 no-op）
```

### 2. 模板改造

在 `ModelMappings.vue` 的 `<div v-for="(tgt, tIdx) in editTargets" :key="tIdx">` 容器上加：

- `:draggable="editTargets.length > 1"` (动态判断)
- `@dragstart="handleDragStart(tIdx, $event)"`
- `@dragover.prevent="handleDragOver(tIdx, $event)"`
- `@drop.prevent="handleDrop(tIdx)"`
- `@dragend="handleDragEnd"`

并在每个 `CascadingModelSelect` 和删除按钮容器上加 `@dragstart.stop.prevent` 显式拦截浏览器原生 dragstart 事件（避免与下拉选择/删除操作冲突）。

### 3. 状态

- `const dragIndex = ref<number | null>(null)` —— 记录被拖动源
- `const dropIndex = ref<number | null>(null)` —— 记录当前 drop 指示位置

### 4. 视觉

- 拖动行 class：`opacity-50`
- 指示线：行容器底部加 `h-0.5 bg-primary` + `transition-opacity`

## Out of Scope

- 触屏/移动端支持
- `MappingEntryEditor.vue`（QuickSetup 入口）的同步改造
- 拖拽到多模态 fallback 行（它们是不同的 section，不在同一列表内）
- 自定义拖拽动画曲线（仅用 CSS `transition`）
- 撤销/重做（拖错了直接拖回去）
