# P2-P3: Frontend Plugin System + Admin UI

## Task 8: Frontend Plugin Registry

**Files:**
- Create: `frontend/src/components/log-viewer/PluginRegistry.ts`

- [ ] **Step 1: Write PluginRegistry**

```ts
// 全局插件注册中心
class PluginRegistry {
  private parsers: LogParser[] = [];
  private builtIn: LogParser | null = null;

  register(parser: LogParser, isBuiltIn = false) {
    if (isBuiltIn) this.builtIn = parser;
    else this.parsers.push(parser);
  }

  // 按优先级尝试匹配插件，返回第一个匹配的插件对象
  matchPlugin(body: string, apiType: string, isStream: boolean): LogParser | null {
    for (const parser of this.parsers) {
      if (parser.canRender?.(body, apiType, isStream)) return parser;
    }
    return this.builtIn;
  }

  // 动态加载远程插件
  // 后端通过 Content-Type: application/javascript serve 插件文件
  // 前端直接用 import(url) 加载运行时 URL，Vite 不会参与分析
  async loadPlugin(pluginId: string) {
    const url = `/admin/api/plugins/${pluginId}/client-assets/index.js`;
    const mod = await import(/* @vite-ignore */ url);
    if (mod.default?.renderComponent) {
      this.register(mod.default);
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/log-viewer/PluginRegistry.ts
git commit -m "feat: add frontend PluginRegistry"
```

## Task 9: Built-in SSE Log Viewer Plugin

**Files:**
- Create: `frontend/src/components/log-viewer/BuiltInLogViewer.vue`
- Create: `frontend/src/components/log-viewer/BuiltInSseParser.ts`

- [ ] **Step 1: Extract LogResponseViewer template to component**

`BuiltInLogViewer.vue` 是一个 Vue 组件，内部调用 `useSSEParsing()` composable（保持所有细粒度 computed 属性不变），对外暴露统一的 props 接口：
```ts
interface LogViewerProps {
  body: string;
  apiType: 'openai' | 'anthropic';
  isStream: boolean;
}
```

- [ ] **Step 2: Register as built-in plugin**

`BuiltInSseParser.ts` 导出 `ClientPluginModule`：
```ts
export const builtInSseParser: ClientPluginModule = {
  renderComponent: BuiltInLogViewer,
};
```

应用初始化时注册：
```ts
import { PluginRegistry } from './PluginRegistry';
import { builtInSseParser } from './BuiltInSseParser';

const registry = new PluginRegistry();
registry.register(builtInSseParser, true);
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/log-viewer/BuiltInLogViewer.vue frontend/src/components/log-viewer/BuiltInSseParser.ts
git commit -m "feat: extract built-in log viewer to plugin component"
```

## Task 10: Refactor LogResponseViewer as Dispatcher

**Files:**
- Modify: `frontend/src/components/log-viewer/LogResponseViewer.vue`
- Modify: `frontend/src/components/log-viewer/LogRequestViewer.vue`

- [ ] **Step 1: Simplify LogResponseViewer to dispatcher**

`LogResponseViewer.vue` 不再包含具体解析和渲染逻辑，只负责插件分发：

```vue
<template>
  <component 
    v-if="matchedPlugin?.renderComponent" 
    :is="matchedPlugin.renderComponent" 
    :body="body" 
    :apiType="apiType" 
    :isStream="isStream" 
  />
  <BuiltInLogViewer 
    v-else 
    :body="body" 
    :apiType="apiType" 
    :isStream="isStream" 
  />
</template>
```

```ts
import { getPluginRegistry } from './PluginRegistry';
const registry = getPluginRegistry();
const matchedPlugin = computed(() => registry.matchPlugin(body.value, apiType, isStream));
```

`PluginRegistry.matchPlugin` 按优先级尝试匹配插件，返回第一个匹配的插件或 null。

- [ ] **Step 2: Simplify LogRequestViewer**

同样模式：提取 `BuiltInRequestViewer.vue`，`LogRequestViewer.vue` 简化为分发器。

- [ ] **Step 3: Verify日志详情页正常工作**

Run: `cd frontend && npm run dev`
Expected: 日志详情页结构化展示功能不变

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/log-viewer/LogResponseViewer.vue frontend/src/components/log-viewer/LogRequestViewer.vue frontend/src/components/log-viewer/BuiltInLogViewer.vue
git commit -m "refactor: simplify log viewers to plugin dispatchers"
```

## Task 11: Plugins Management Page

**Files:**
- Create: `frontend/src/views/Plugins.vue`
- Modify: `frontend/src/router/index.ts`
- Modify: `frontend/src/api/client.ts`

- [ ] **Step 1: Add API methods**

在 `frontend/src/api/client.ts` 中添加：
```ts
export const installPlugin = (repoUrl: string) => axios.post('/admin/api/plugins/install', { repoUrl });
export const listPlugins = () => axios.get('/admin/api/plugins');
export const enablePlugin = (id: string) => axios.post(`/admin/api/plugins/${id}/enable`);
export const disablePlugin = (id: string) => axios.post(`/admin/api/plugins/${id}/disable`);
export const uninstallPlugin = (id: string) => axios.delete(`/admin/api/plugins/${id}`);
```

- [ ] **Step 2: Add route**

```ts
// router/index.ts
{
  path: '/admin/plugins',
  name: 'Plugins',
  component: () => import('../views/Plugins.vue'),
  meta: { requiresAuth: true }
}
```

- [ ] **Step 3: Implement Plugins.vue**

页面结构（参考管理界面预览）：
1. 安装区 — 输入 Git 仓库地址 + Install 按钮
2. Built-in 区 — 内置插件列表（只读）
3. Installed 区 — 用户插件列表（启用/禁用/卸载）

使用 shadcn-vue 组件：Card、Button、Input、Badge、Table。

- [ ] **Step 4: Add sidebar link**

在 Sidebar.vue 中添加 Plugins 导航项。

- [ ] **Step 5: Verify页面**

Run: `cd frontend && npm run dev`
Expected: /admin/plugins 页面可访问，展示插件列表

- [ ] **Step 6: Commit**

```bash
git add frontend/src/views/Plugins.vue frontend/src/router/index.ts frontend/src/api/client.ts frontend/src/components/layout/Sidebar.vue
git commit -m "feat: add plugins management page"
```

## P2-P3 Complete

前端插件系统 + 管理界面完成。
