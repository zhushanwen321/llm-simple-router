# Phase 3: 代码迁移（Tasks 10-21）

迁移遵循统一的替换规则：

| 硬编码 | 替换为 |
|--------|--------|
| `text-gray-900` / `text-slate-900` | `text-foreground` |
| `text-gray-700` / `text-slate-700` | `text-foreground` |
| `text-gray-600` / `text-slate-600` | `text-muted-foreground` |
| `text-gray-500` / `text-slate-500` | `text-muted-foreground` |
| `text-gray-400` / `text-slate-400` | `text-muted-foreground` |
| `text-gray-300` | `text-muted-foreground` |
| `text-red-500` / `text-red-600` / `text-red-700` | `text-destructive` |
| `text-green-500` / `text-green-600` | `text-success` |
| `text-blue-400` / `text-blue-600` | `text-primary` |
| `bg-gray-50` / `bg-gray-100` | `bg-muted` |
| `bg-red-50` / `bg-red-50/50` | `bg-destructive/10` |
| `bg-blue-500` / `bg-blue-600` | `bg-primary` |
| `bg-purple-500` | `bg-accent` |
| `bg-slate-800` / `bg-slate-700` | `bg-sidebar` |
| `border-slate-700` | `border-sidebar-border` |
| `bg-gray-100`（页面背景） | `bg-background` |
| `hover:text-blue-600` | `hover:text-primary` |
| `hover:text-red-600` / `hover:text-red-700` | `hover:text-destructive` |
| `hover:bg-slate-700` | `hover:bg-sidebar-accent` |
| `text-gray-400`（空状态/辅助） | `text-muted-foreground` |

## Task 10: 迁移 useMetrics.ts

**Files:**
- Modify: `frontend/src/composables/useMetrics.ts`

- [ ] **Step 1: 替换 Chart.js 硬编码颜色**

添加 import: `import { CHART_COLORS } from '@/styles/design-tokens'`

替换:
- `'#3b82f6'` → `CHART_COLORS.blue`，`'rgba(59,130,246,0.1)'` → `CHART_COLORS.blueFill`（注意 fill 的 0.1 和 0.3 不同）
- `'#8b5cf6'` → `CHART_COLORS.purple`，对应 rgba → `CHART_COLORS.purpleFill`
- `'#10b981'` → `CHART_COLORS.green`，对应 rgba → `CHART_COLORS.greenFill`
- `'#f59e0b'` → `CHART_COLORS.amber`，对应 rgba → `'oklch(0.78 0.16 80 / 0.1)'`

## Task 11: 迁移 Sidebar.vue

**Files:**
- Modify: `frontend/src/components/layout/Sidebar.vue`

- [ ] **Step 1: 替换硬编码颜色**

- `bg-slate-800` → `bg-sidebar`
- `text-white` → `text-sidebar-foreground`
- `border-b border-slate-700` → `border-b border-sidebar-border`
- `bg-blue-600` → `bg-sidebar-primary`
- `text-blue-400` → `text-sidebar-primary`
- `bg-slate-700` → `bg-sidebar-accent`
- `text-gray-300` → `text-sidebar-foreground`
- `hover:bg-slate-700` → `hover:bg-sidebar-accent`
- `border-t border-slate-700` → `border-t border-sidebar-border`
- `text-gray-400` → `text-sidebar-foreground`
- `hover:text-white hover:bg-slate-700` → `hover:text-sidebar-foreground hover:bg-sidebar-accent`

## Task 12: 迁移 Login.vue

**Files:**
- Modify: `frontend/src/views/Login.vue`

- [ ] **Step 1: 替换硬编码颜色**

- `bg-gray-100` → `bg-background`
- `bg-blue-600` → `bg-primary`
- `text-gray-900` → `text-foreground`
- `text-gray-500` → `text-muted-foreground`
- `text-gray-700` → `text-foreground`
- `text-red-500` → `text-destructive`

## Task 13: 迁移 Dashboard.vue

**Files:**
- Modify: `frontend/src/views/Dashboard.vue`

- [ ] **Step 1: 替换硬编码颜色**

- `text-gray-900` → `text-foreground`
- `text-gray-500` → `text-muted-foreground`
- `text-green-600` → `text-success`
- `bg-blue-500` → `bg-primary`
- `bg-purple-500` → `bg-accent`
- `text-gray-700` → `text-foreground`
- `text-gray-500`（标签） → `text-muted-foreground`

## Task 14-17: 迁移其他 views

每个文件按统一替换规则处理，模式相同：

- [ ] **Task 14: Providers.vue** — `text-gray-*` → 语义色，`bg-gray-50` → `bg-muted`，`hover:text-blue-600` → `hover:text-primary`
- [ ] **Task 15: RouterKeys.vue** — 同上 + `text-green-500` → `text-success`
- [ ] **Task 16: ModelMappings.vue** — `text-red-600` → `text-destructive`，`bg-gray-100` → `bg-muted`
- [ ] **Task 17: RetryRules.vue** — `text-red-600` → `text-destructive`

## Task 18: 迁移 Logs.vue

**Files:**
- Modify: `frontend/src/views/Logs.vue`

- [ ] **Step 1: 替换硬编码颜色**

Logs.vue 颜色较多，需要特别处理：
- `bg-red-50/50`（错误行背景） → `bg-destructive/10`
- `text-red-500`（错误文本） → `text-destructive`
- `text-red-600` → `text-destructive`
- `bg-red-50`（错误区域） → `bg-destructive/10`
- `border-red-300` → `border-destructive`
- `hover:bg-red-50` → `hover:bg-destructive/10`
- 其余 `text-gray-*` → 语义色

## Task 19: 迁移 Metrics.vue

**Files:**
- Modify: `frontend/src/views/Metrics.vue`

- [ ] **Step 1: 替换 `text-gray-*` → 语义色**

## Task 20: 迁移 MappingGroupFormDialog.vue

**Files:**
- Modify: `frontend/src/components/mappings/MappingGroupFormDialog.vue`

- [ ] **Step 1: 替换硬编码颜色**

- `text-gray-700` → `text-foreground`
- `text-gray-500` → `text-muted-foreground`
- `text-gray-400` → `text-muted-foreground`
- `text-red-600` → `text-destructive`

## Task 21: 迁移 Log Viewer 组件

**Files:**
- Modify: `frontend/src/components/logs/JsonCopyBlock.vue`
- Modify: `frontend/src/components/logs/LogRequestViewer.vue`
- Modify: `frontend/src/components/logs/LogResponseViewer.vue`

- [ ] **Step 1: 扫描并替换每个文件中的硬编码颜色**

对每个文件执行 Grep 查找 `text-gray-|bg-gray-|text-red-|bg-red-` 等，按统一规则替换。
