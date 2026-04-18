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

  // 按优先级尝试解析，返回第一个匹配的结果
  parseResponse(body: string, apiType: string, isStream: boolean): ParsedResponse | null {
    for (const parser of this.parsers) {
      const result = parser.parseResponse?.(body, apiType, isStream);
      if (result) return result;
    }
    return this.builtIn?.parseResponse?.(body, apiType, isStream) ?? null;
  }

  // 动态加载远程插件
  async loadPlugin(pluginId: string) {
    const mod = await import(`/admin/api/plugins/${pluginId}/client-assets/index.js`);
    if (mod.default?.parseResponse) {
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

## Task 9: Built-in SSE Log Parser Plugin

**Files:**
- Create: `frontend/src/components/log-viewer/BuiltInSseParser.ts`

- [ ] **Step 1: Extract SSE parsing to plugin**

将 `useSSEParsing.ts` 的解析逻辑提取为 `ClientPluginModule`：
- `parseResponse(body, apiType, isStream)` — 解析 SSE/JSON 响应
- `renderComponent` — 可选，返回结构化展示的 Vue 组件

保留 `useSSEParsing.ts` 的 computed 逻辑，但通过 PluginRegistry 注册。

- [ ] **Step 2: Register as built-in**

在应用初始化时注册：
```ts
import { PluginRegistry } from './PluginRegistry';
import { builtInSseParser } from './BuiltInSseParser';

const registry = new PluginRegistry();
registry.register(builtInSseParser, true); // true = built-in
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/log-viewer/BuiltInSseParser.ts
git commit -m "feat: extract SSE parser to built-in frontend plugin"
```

## Task 10: Refactor Log Viewers

**Files:**
- Modify: `frontend/src/components/log-viewer/LogResponseViewer.vue`
- Modify: `frontend/src/components/log-viewer/LogRequestViewer.vue`

- [ ] **Step 1: Modify LogResponseViewer**

将硬编码的 SSE 解析逻辑替换为 PluginRegistry 调用：

```ts
// 当前
import { useSSEParsing } from './useSSEParsing';
const { openaiAssembled, assembledBlocks } = useSSEParsing(body, isStream, apiType);

// 改为
import { getPluginRegistry } from './PluginRegistry';
const registry = getPluginRegistry();
const parsed = computed(() => registry.parseResponse(body.value, apiType, isStream));
```

模板中：
```vue
<!-- 当前硬编码 -->
<template v-if="apiType === 'openai'">...</template>
<template v-else-if="apiType === 'anthropic'">...</template>

<!-- 改为插件驱动 -->
<component v-if="parsed?.renderComponent" :is="parsed.renderComponent" :data="parsed" />
<template v-else> <!-- fallback 到内置渲染 --> </template>
```

- [ ] **Step 2: Modify LogRequestViewer**

同样的模式，使用 `registry.parseRequest()` 替代硬编码解析。

- [ ] **Step 3: Verify日志详情页正常工作**

Run: `cd frontend && npm run dev`
Expected: 日志详情页结构化展示功能不变

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/log-viewer/LogResponseViewer.vue frontend/src/components/log-viewer/LogRequestViewer.vue
git commit -m "refactor: use PluginRegistry in log viewers"
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
