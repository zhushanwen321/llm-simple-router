# 管理界面

## Admin API

```
POST   /admin/api/plugins/install         { repoUrl }
DELETE /admin/api/plugins/:id
POST   /admin/api/plugins/:id/enable
POST   /admin/api/plugins/:id/disable
GET    /admin/api/plugins
GET    /admin/api/plugins/:id
GET    /admin/api/plugins/:id/manifest
GET    /admin/api/plugins/:id/client-assets/*
```

## 管理页面

新增 `/admin/plugins` 路由，包含：

1. **安装区** — 输入 Git 仓库地址，点击 Install
2. **Built-in 区** — 内置插件列表（不可卸载/禁用）
3. **Installed 区** — 用户插件列表（启用/禁用/卸载）

每个插件卡片展示：名称、版本、状态 badge、描述、注册的扩展点标签、操作按钮。

错误状态的插件用红色边框高亮，展示错误信息，提供 Retry 按钮。

## 日志查看器改造

```
当前：useSSEParsing.ts（硬编码）→ LogResponseViewer.vue（硬编码模板）

改造后：
  PluginRegistry.getLogParsers()
    → 按优先级尝试解析
    → 匹配到插件 → 使用插件 renderComponent
    → 未匹配 → fallback 到内置 SSE parser
```

前端新增 `PluginRegistry` 模块管理已加载的前端插件。
LogResponseViewer.vue 增加插件渲染分支，不匹配时 fallback。
