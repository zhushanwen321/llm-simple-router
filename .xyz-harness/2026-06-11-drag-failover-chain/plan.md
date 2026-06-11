---
topic: drag-failover-chain
status: draft
---

# Wave 执行计划 — 故障转移链拖拽重排

## 概览

| Wave | 职责 | 依赖 | 产出 | 预估 |
|------|------|------|------|------|
| W1 | `moveItem()` 纯函数 + 7 条单元测试 | 无 | 新文件 + 测试文件 | 15 min |
| W2 | ModelMappings.vue 拖拽集成 | W1 | 模板 + 事件 + 视觉反馈 | 60 min |
| W3 | 全链路验证 + 边界修复 | W2 | 通过所有 AC | 20 min |

**总计**: ~95 min（含测试）

---

## Wave 1: 纯函数层（零 UI 依赖）

**目标**: 实现 `moveItem()` 纯函数，编写 7 条单元测试。与 UI 完全解耦，可独立提交。

### 产出

| 文件 | 操作 | 说明 |
|------|------|------|
| `frontend/src/utils/array.ts` | 新建 | 导出 `moveItem()` |
| `frontend/src/utils/__tests__/array.test.ts` | 新建 | 7 条 vitest 用例 |

### 实现要点

```typescript
// frontend/src/utils/array.ts
export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (from === to) return [...arr]
  const result = [...arr]
  const [item] = result.splice(from, 1)
  result.splice(to, 0, item)
  return result
}
```

### 行为表（测试用例）

| # | 输入 | 期望输出 | 覆盖 AC |
|---|------|---------|---------|
| 1 | `moveItem([1,2,3,4], 0, 2)` | `[2,3,1,4]` | AC-11 |
| 2 | `moveItem([1,2,3,4], 3, 0)` | `[4,1,2,3]` | AC-11 |
| 3 | `moveItem([1,2,3,4], 0, 3)` | `[2,3,4,1]` | 边界 |
| 4 | `moveItem([1,2,3,4], 1, 2)` | `[1,3,2,4]` | 相邻交换 |
| 5 | `moveItem([1,2,3,4], 1, 1)` | `[1,2,3,4]` | AC-9 |
| 6 | `moveItem([], 0, 0)` | `[]` | 边界 |
| 7 | `moveItem([1], 0, 0)` | `[1]` | 单元素 |

### 验证命令

```bash
cd frontend && npx vitest run src/utils/__tests__/array.test.ts
```

### 提交

```
feat(drag): add moveItem() pure function for failover chain reordering
```

---

## Wave 2: ModelMappings.vue 拖拽集成

**目标**: 在 `ModelMappings.vue` 中实现完整拖拽能力（状态 + 事件 + 视觉）。依赖 W1 的 `moveItem()`。

### 改动范围

**仅** `frontend/src/views/ModelMappings.vue`，分 4 个子步骤：

#### 2a. 脚本层 — 拖拽状态 + 事件处理函数

在 `// --- Failover chain ---` 区域（`updateTarget` 之后）新增：

```typescript
// --- Drag state ---
const dragIndex = ref<number | null>(null)
const dropIndex = ref<number | null>(null)
const dropBefore = ref(true) // true=插入到目标行之前, false=之后

function handleDragStart(idx: number, e: DragEvent) {
  dragIndex.value = idx
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    // Firefox 要求设置 data 才能触发 drag
    e.dataTransfer.setData('text/plain', String(idx))
  }
}

function handleDragOver(idx: number, e: DragEvent) {
  if (dragIndex.value === null) return
  if (dragIndex.value === idx) { dropIndex.value = null; return }

  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const midY = rect.top + rect.height / 2
  const before = e.clientY < midY

  // 计算实际插入位置（考虑 from→to 偏移）
  let insertIdx = before ? idx : idx + 1
  if (dragIndex.value < insertIdx) insertIdx--

  if (insertIdx === dragIndex.value) {
    dropIndex.value = null
  } else {
    dropIndex.value = insertIdx
    dropBefore.value = before
  }
}

function handleDrop() {
  if (dragIndex.value === null || dropIndex.value === null) return
  editTargets.value = moveItem(editTargets.value, dragIndex.value, dropIndex.value)
}

function handleDragEnd() {
  dragIndex.value = null
  dropIndex.value = null
}
```

需要在文件顶部 import `moveItem`：
```typescript
import { moveItem } from '@/utils/array'
```

#### 2b. 模板层 — 事件绑定 + 拦截

修改 failover chain 的 `v-for` 容器 `<div>`：

```html
<!-- 改前 -->
<div
  v-for="(tgt, tIdx) in editTargets"
  :key="tIdx"
  class="flex items-center gap-2 px-3 py-2 bg-background border border-border rounded-md"
>

<!-- 改后 -->
<div
  v-for="(tgt, tIdx) in editTargets"
  :key="tIdx"
  class="flex items-center gap-2 px-3 py-2 bg-background border border-border rounded-md"
  :draggable="editTargets.length > 1"
  @dragstart="handleDragStart(tIdx, $event)"
  @dragover.prevent="handleDragOver(tIdx, $event)"
  @drop.prevent="handleDrop()"
  @dragend="handleDragEnd()"
>
```

在 `CascadingModelSelect` 和删除按钮的容器上加 `@dragstart.stop.prevent`：

```html
<!-- CascadingModelSelect 包裹 div -->
<div class="flex-1" @dragstart.stop.prevent>

<!-- 删除 Button 无需改（Button 组件已内置） -->
```

注意：删除按钮是 shadcn-vue `<Button>` 组件，Vue 事件系统会处理 `@dragstart.stop.prevent`。但 `<Button>` 是组件，需要确认事件是否透传。安全做法是在 Button 外层包一个 `<div @dragstart.stop.prevent>`，或者在 Button 上直接加（Vue 3 组件默认透传 attrs）。

#### 2c. 视觉层 — class 绑定

```html
<!-- 拖动中行：opacity 50% -->
<div
  v-for="(tgt, tIdx) in editTargets"
  :key="tIdx"
  :class="[
    'flex items-center gap-2 px-3 py-2 bg-background border border-border rounded-md transition-opacity',
    dragIndex === tIdx ? 'opacity-50' : '',
  ]"
  :style="{ cursor: editTargets.length > 1 ? (dragIndex !== null ? 'grabbing' : 'grab') : 'default' }"
  ...
>

<!-- 放置指示线：在 dropIndex 位置的行上方 -->
<!-- 在 v-for 循环内，每个 div 之前插入条件指示线 -->
<div
  v-if="dropIndex === tIdx && dropBefore"
  class="h-0.5 bg-primary rounded-full -mt-0.5 mb-0.5"
/>
<!-- 在 v-for 循环之后，如果 dropIndex === editTargets.length，显示在末尾 -->
<div
  v-if="dropIndex === editTargets.length"
  class="h-0.5 bg-primary rounded-full mt-0.5"
/>
```

#### 2d. 样式（如需）

`<style scoped>` 内只允许 `@apply`。如果需要额外样式：

```css
<style scoped>
.drag-over-top {
  @apply border-t-2 border-primary;
}
.drag-over-bottom {
  @apply border-b-2 border-primary;
}
</style>
```

但根据 FR-2.2，用独立 `<div>` 做指示线更简单，不需要额外 CSS class。

### 验证命令

```bash
cd frontend && npx vue-tsc -b --noEmit           # 类型检查
cd frontend && npx eslint src/views/ModelMappings.vue --max-warnings=0  # lint
cd frontend && npm run build                       # 构建
```

### 提交

```
feat(drag): add drag-and-drop reordering to failover chain in ModelMappings
```

---

## Wave 3: 全链路验证 + 边界修复

**目标**: 逐条验证 12 条 AC，修复发现的问题。

### AC 验证清单

| AC | 验证方式 | 通过标准 |
|----|---------|---------|
| AC-1 | `wrapper.find` 断言 `draggable` 属性 + computed style cursor | 属性存在 + cursor: grab |
| AC-2 | `trigger('dragstart')` + 断言 opacity class | opacity-50 |
| AC-3 | `trigger('dragover', {clientY})` 不同位置 | 指示线 DOM 出现 |
| AC-4 | `trigger('drop')` + 断言 `editTargets.value` 顺序 | 数组顺序正确 |
| AC-5 | mock API + 触发保存 | request body targets 顺序一致 |
| AC-6 | 对 CascadingModelSelect 触发 dragstart | 事件被拦截 |
| AC-7 | 对删除按钮触发 dragstart | 事件被拦截 |
| AC-8 | 设 `editTargets` 为单元素 | 无 `draggable` 属性 |
| AC-9 | 拖到自身位置 | 数组不变 |
| AC-10 | mount MappingEntryEditor | 无 `draggable` |
| AC-11 | W1 已覆盖 | — |
| AC-12 | `vi.spyOn(api, 'updateMappingGroup')` | 调用次数 0 |

### 可能的修复点

- `@dragstart.stop.prevent` 在 `<Button>` 组件上是否透传（Vue 3 attrs fallthrough）
- Firefox 的 `dataTransfer.setData` 必须调用（否则 drag 不启动）
- `dropIndex` 计算逻辑在边界情况（首→末、末→首）是否正确

### 验证命令

```bash
cd frontend && npx vitest run                      # 全部测试
cd frontend && npx vue-tsc -b --noEmit             # 类型检查
cd frontend && npx eslint . --max-warnings=0       # lint
cd frontend && npm run build                       # 构建
```

### 提交

```
fix(drag): edge cases and verification fixes for failover chain drag
```

（如无修复则不提交）

---

## 风险与注意事项

| 风险 | 影响 | 规避 |
|------|------|------|
| Firefox dataTransfer | 拖拽不启动 | W2a 设置 `setData('text/plain', idx)` |
| Button 组件 attrs 透传 | stop.prevent 不生效 | W2b 在 Button 外包 `<div @dragstart.stop.prevent>` |
| dropIndex 计算偏移 | 插入位置错误 | W3 用边界 case 测试（首→末、末→首） |
| `v-for` key 用 index | 拖动中 DOM 复用 | 当前用 `:key="tIdx"`，Vue 复用同一 DOM 节点，恰好有利于保留 opacity 状态 |
