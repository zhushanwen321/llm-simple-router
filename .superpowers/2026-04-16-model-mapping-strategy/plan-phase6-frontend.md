# Phase 6: 前端实施计划

## 涉及文件

| 文件 | 操作 |
|------|------|
| `frontend/src/api/client.ts` | 修改 - 新增类型和 API 方法 |
| `frontend/src/views/ModelMappings.vue` | 重写 - 分组卡片视图 |
| `frontend/src/views/RetryRules.vue` | 新建 - 重试规则管理页 |
| `frontend/src/router/index.ts` | 修改 - 添加 `/retry-rules` 路由 |
| `frontend/src/components/layout/Sidebar.vue` | 修改 - 添加"重试规则"菜单项 |

## Step 1: API 客户端

在 `client.ts` 中新增 `MappingGroupPayload`、`RetryRulePayload` 两个接口，并在 `api` 对象中添加 8 个方法：mapping-groups 的 CRUD（get/create/update/delete）和 retry-rules 的 CRUD。

注意：旧的 `getMappings` / `createMapping` / `updateMapping` / `deleteMapping` 保留，后端仍需兼容旧接口直到迁移完成。

## Step 2: 重写 ModelMappings.vue

从表格视图改为**分组卡片视图**。每个 mapping group 渲染为一张 Card：

- **CardHeader**：显示 `client_model`、`strategy` Badge、展开/收起按钮、删除按钮
- **CardContent**（展开时）：
  - 默认模型行：backend_model + provider 名称（只读，点编辑打开 Dialog）
  - 时间窗口列表（仅 scheduled 策略）：每行 start-end -> target
  - "添加窗口"按钮
- **添加/编辑 Dialog**：
  - client_model Input + strategy Select（random / priority / scheduled）
  - 默认 target：backend_model Input + provider Select
  - 策略特定配置区域（scheduled 时显示动态窗口列表）
  - 保存时将窗口数据序列化为 rule JSON 字符串

关键逻辑：解析 `rule` JSON 时需 try-catch 容错，rule 为空或非法时回退到空配置。

## Step 3: 新建 RetryRules.vue

标准 CRUD 表格页，参考现有 RouterKeys.vue 的模式：

- 表格列：name、status_code、body_pattern、is_active Badge、操作
- 添加/编辑 Dialog：name Input、status_code Input(number)、body_pattern Input
- 删除确认 AlertDialog

全部使用 shadcn-vue 组件，禁止原生 HTML 元素。

## Step 4: 路由

在 `router/index.ts` 的 routes 数组中，`/mappings` 之后添加：

```typescript
{
  path: '/retry-rules',
  name: 'retry-rules',
  component: () => import('@/views/RetryRules.vue'),
  meta: { requiresAuth: true },
}
```

## Step 5: 侧边栏

在 `Sidebar.vue` 的 `navItems` 数组中，`/mappings` 之后添加"重试规则"菜单项，使用合适的 SVG 图标（建议用循环箭头图标）。

## Step 6: 验证

```bash
cd frontend && npm run dev
```

浏览器测试：mapping groups 的 CRUD、scheduled 策略的窗口编辑、retry rules 的 CRUD、侧边栏导航跳转。

## 依赖关系

本阶段依赖 Phase 1（数据库）和 Phase 5（管理 API）完成后再执行。API 端点必须已就绪。
