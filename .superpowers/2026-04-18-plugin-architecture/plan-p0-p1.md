# P0-P1: Plugin Engine Core + Proxy Enhancement Plugin

## Task 1: DB Migration

**Files:**
- Create: `src/db/migrations/015_add_plugins_table.sql`

- [ ] **Step 1: Write migration SQL**

```sql
CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  repo_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'installed',
  manifest TEXT NOT NULL,
  installed_at TEXT NOT NULL,
  enabled_at TEXT,
  updated_at TEXT,
  error_message TEXT,
  settings TEXT
);
```

- [ ] **Step 2: Verify migration runs on startup**

Run: `npm run dev`
Expected: 无报错，plugins 表已创建

- [ ] **Step 3: Commit**

```bash
git add src/db/migrations/015_add_plugins_table.sql
git commit -m "feat: add plugins table migration"
```

## Task 2: Plugin Types

**Files:**
- Create: `src/plugins/types.ts`

- [ ] **Step 1: Write plugin type definitions**

定义 ServerPluginModule、ProxyBeforeContext、ProxyAfterContext、ProxyInterceptResult、Manifest 等类型。
接口定义参见 spec `interfaces.md`。

- [ ] **Step 2: Commit**

```bash
git add src/plugins/types.ts
git commit -m "feat: add plugin type definitions"
```

## Task 3: Plugin Engine

**Files:**
- Create: `src/plugins/engine.ts`
- Test: `tests/plugins.test.ts`

- [ ] **Step 1: Write failing test**

测试 `PluginEngine.enable()` 能加载插件并注册 hook，
`runBeforeProxy()` 按顺序执行插件 hook。

- [ ] **Step 2: Implement PluginEngine**

核心方法：
- `enable(pluginId)` — dynamic import + init + 注册 hook
- `disable(pluginId)` — destroy + 卸载 hook
- `runBeforeProxy(ctx)` — 链式执行所有 `beforeProxy` hook
- `runIntercept(ctx)` — 顺序执行，第一个非 null 结果胜出
- `runAfterResponse(ctx, response)` — 链式执行
- `restorePlugins()` — 启动时恢复 status='enabled' 的插件

每个 hook 调用包裹 try-catch，异常只 log.error 不影响主流程。

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/plugins.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/plugins/engine.ts tests/plugins.test.ts
git commit -m "feat: add PluginEngine core"
```

## Task 4: Plugin Manager

**Files:**
- Create: `src/plugins/manager.ts`
- Modify: `src/db/index.ts` — 添加插件查询函数

- [ ] **Step 1: Write failing test**

测试 `install()` 能 git clone 仓库并写入 DB，
`uninstall()` 能删除目录和 DB 记录。

- [ ] **Step 2: Implement PluginManager**

方法：
- `install(repoUrl)` — git ls-remote 验证 → clone → 读取 manifest → npm install --production → 写入 DB
- `uninstall(pluginId)` — 先 disable → rm -rf 目录 → 删除 DB 记录
- `enable(pluginId)` — 调用 engine.enable + 更新 DB status
- `disable(pluginId)` — 调用 engine.disable + 更新 DB status

安装失败时回滚 clone 目录，不写入 DB。

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/plugins.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/plugins/manager.ts src/db/index.ts tests/plugins.test.ts
git commit -m "feat: add PluginManager lifecycle"
```

## Task 5: Admin API

**Files:**
- Create: `src/admin/plugins.ts`
- Modify: `src/admin/routes.ts` — 注册 plugins routes
- Test: `tests/admin-plugins.test.ts`

- [ ] **Step 1: Write failing test**

测试 POST /admin/api/plugins/install 能安装插件，
GET /admin/api/plugins 能列出插件。

- [ ] **Step 2: Implement Admin API routes**

```
POST   /admin/api/plugins/install      { repoUrl }
DELETE /admin/api/plugins/:id
POST   /admin/api/plugins/:id/enable
POST   /admin/api/plugins/:id/disable
GET    /admin/api/plugins
GET    /admin/api/plugins/:id
GET    /admin/api/plugins/:id/manifest
GET    /admin/api/plugins/:id/client-assets/*
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/admin-plugins.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/admin/plugins.ts src/admin/routes.ts tests/admin-plugins.test.ts
git commit -m "feat: add plugins admin API"
```

## Task 6: Embed Hooks in Proxy Flow

**Files:**
- Modify: `src/proxy/proxy-core.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Modify handleProxyPost**

在 failover 循环之前添加：
```ts
// ① beforeProxy — 在 failover 循环之前执行一次
const beforeCtx = await pluginEngine.runBeforeProxy({
  request, body, clientModel, apiType: 'openai' // 或 'anthropic'
});
if (beforeCtx) { /* 应用修改后的 body 和 clientModel */ }

// ② intercept
const interceptResult = await pluginEngine.runIntercept(beforeCtx || defaultCtx);
if (interceptResult) {
  // 直接返回拦截响应，跳过整个 failover 循环
  return reply.status(interceptResult.statusCode).send(interceptResult.body);
}
```

在 failover 循环结束后添加：
```ts
// ④ afterResponse — 循环结束后执行一次
await pluginEngine.runAfterResponse(afterCtx, response);
```

- [ ] **Step 2: Register PluginEngine in buildApp**

在 `src/index.ts` 中：
1. 创建 `PluginEngine` 和 `PluginManager` 实例
2. 启动时调用 `restorePlugins()`
3. 将 engine 传入 proxy 插件 options

- [ ] **Step 3: Commit**

```bash
git add src/proxy/proxy-core.ts src/index.ts
git commit -m "feat: integrate PluginEngine hooks into proxy flow"
```

## Task 7: Migrate enhancement-handler to Built-in Plugin

**Files:**
- Create: `src/plugins/internal/claude-code-enhancer.ts`
- Modify: `src/proxy/proxy-core.ts` — 移除旧 applyEnhancement 调用

- [ ] **Step 1: Extract enhancement logic to plugin**

将 `enhancement-handler.ts` 的 `applyEnhancement()` 逻辑提取为 `ServerPluginModule`：
- `beforeProxy` — 解析指令、清理消息、模型替换
- `intercept` — select-model 命令拦截
- `afterResponse` — 注入 model info tag（非流式场景）

- [ ] **Step 2: Register as built-in plugin**

在 `buildApp()` 中自动注册内置插件：
```ts
engine.registerBuiltIn('@internal/claude-code-enhancer', claudeCodeEnhancer);
```

- [ ] **Step 3: Remove old applyEnhancement call**

从 `proxy-core.ts` 中移除 `applyEnhancement()` 导入和调用，
改用 `pluginEngine.runBeforeProxy()` + `runIntercept()`。

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: 全部 PASS，enhancement 功能不受影响

- [ ] **Step 5: Commit**

```bash
git add src/plugins/internal/claude-code-enhancer.ts src/proxy/proxy-core.ts src/index.ts
git commit -m "refactor: migrate enhancement-handler to built-in plugin"
```

## P0-P1 Complete

后端插件系统骨架 + 代理增强插件化完成。
