# 迁移策略

## 需要迁移的现有代码

已审计完成，以下文件包含硬编码颜色（`text-gray-*`、`bg-gray-*`、`text-red-*`、`bg-blue-*` 等）或硬编码间距：

### 组件层

| 文件 | 硬编码内容 | 迁移方式 |
|------|-----------|---------|
| `Sidebar.vue` | `bg-slate-800`、`border-slate-700`、`text-blue-400`、`text-gray-300` | → `bg-sidebar`、`border-sidebar-border`、`text-info`、`text-foreground` |
| `MappingGroupFormDialog.vue` | `text-gray-700`、`text-gray-500`、`text-gray-400`、`text-red-600` | → `text-foreground`、`text-muted-foreground`、`text-danger` |
| `JsonCopyBlock.vue` | 深色代码块背景 | → token 变量 |
| `LogRequestViewer.vue` | 结构化标签中的颜色 | → token 变量 |
| `LogResponseViewer.vue` | 结构化标签中的颜色 | → token 变量 |

### 页面层

| 文件 | 硬编码内容 | 迁移方式 |
|------|-----------|---------|
| `Login.vue` | `bg-gray-100`、`bg-blue-600`、`text-gray-900`、`text-gray-500`、`text-red-500` | → `bg-page`、`bg-primary`、`text-foreground`、`text-danger` |
| `Dashboard.vue` | `text-gray-900`、`text-gray-500`、`text-green-600`、`bg-blue-500`、`bg-purple-500` | → `text-foreground`、`text-success`、`bg-info` |
| `Providers.vue` | 大量 `text-gray-*`、`bg-gray-50`、`hover:text-blue-600`、`hover:text-red-600` | → shadcn 语义色 |
| `RouterKeys.vue` | 大量 `text-gray-*`、`bg-gray-50`、`text-green-500` | → shadcn 语义色 |
| `ModelMappings.vue` | `text-red-600`、`text-gray-*`、`bg-gray-100` | → `text-danger`、shadcn 语义色 |
| `Logs.vue` | 大量 `text-gray-*`、`bg-gray-50`、`bg-red-50/50`、`text-red-500`、`bg-red-50` | → `text-danger`、`bg-danger-light`、shadcn 语义色 |
| `RetryRules.vue` | `text-gray-*`、`bg-gray-50`、`text-red-600` | → shadcn 语义色 |
| `Metrics.vue` | `text-gray-*`、`bg-gray-50` | → shadcn 语义色 |

### TS 逻辑层

| 文件 | 硬编码内容 | 迁移方式 |
|------|-----------|---------|
| `composables/useMetrics.ts` | `#3b82f6`、`#8b5cf6`、`#10b981`、`#f59e0b` 及对应 rgba | → `design-tokens.ts` 中的 `CHART_COLORS` 常量 |

## 实施顺序

### Phase 1: 基础设施
1. 创建 `styles/tokens.css` — 所有业务 token
2. 创建 `styles/components.css` — 通用组件类
3. 创建 `styles/design-tokens.ts` — TS 等价常量
4. 更新 `tailwind.config.js` — 注册新 token
5. 更新 `style.css` — 添加 import 链

### Phase 2: 强制机制
1. 编写 ESLint 自定义规则（3 个）
2. 更新 `.githooks/install-hooks.sh` — 添加前端检查段
3. 编写 `frontend/docs/design-system.md`

### Phase 3: 现有代码迁移
1. 迁移 `composables/useMetrics.ts` 的 Chart.js 颜色
2. 迁移 `Sidebar.vue` 的硬编码颜色
3. 迁移各 views 的硬编码颜色（按文件逐个处理）
4. 迁移自定义组件的硬编码颜色

### Phase 4: 验证
1. 运行 ESLint 确认无违规
2. 目视检查 light/dark 两套主题
3. 确认 Chart.js 图表颜色使用 design-tokens.ts
