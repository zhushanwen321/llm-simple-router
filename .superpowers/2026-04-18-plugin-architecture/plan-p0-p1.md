# P0-P1: Plugin Engine Core + Proxy Enhancement Plugin

## Task 1: DB Migration

**Files:**
- Create: `src/db/migrations/017_add_plugins_table.sql`

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
git add src/db/migrations/017_add_plugins_table.sql
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
- `runBeforeProxy(ctx)` — 链式执行所有 `beforeProxy` hook，合并返回 `ProxyBeforeResult`
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

**目录命名规则：**
```ts
function pluginIdFromRepoUrl(repoUrl: string): string {
  // 从 URL 提取仓库名，如 https://github.com/user/my-plugin.git → my-plugin
  const basename = repoUrl.split('/').pop()?.replace(/\.git$/, '') ?? '';
  // 校验与 manifest.name 一致性
  return basename;
}
```
插件安装目录：`data/plugins/{plugin-id}/`

**冲突检测：** 如果 pluginId 已存在但 repoUrl 不同，报错并要求用户先卸载旧插件。

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

在 failover 循环之前替换现有的 `applyEnhancement()` 调用：
```ts
// ① beforeProxy — 替换原有 applyEnhancement() 调用
const sessionId = (request.headers as RawHeaders)['x-claude-code-session-id'] as string | undefined;
const beforeCtx = await pluginEngine.runBeforeProxy({
  request, body: request.body as Record<string, unknown>,
  clientModel, apiType, sessionId,
  routerKeyId: request.routerKey?.id ?? null,
});
const effectiveModel = beforeCtx?.effectiveModel ?? clientModel;
const originalModel = beforeCtx?.originalModel ?? null;
if (beforeCtx?.body) {
  (request.body as Record<string, unknown>) = beforeCtx.body;
}

// ② intercept
const interceptResult = await pluginEngine.runIntercept({
  request, body: request.body as Record<string, unknown>,
  clientModel: effectiveModel, apiType, sessionId,
  routerKeyId: request.routerKey?.id ?? null,
});
if (interceptResult) {
  // 拦截时写入 request_log（参考现有 applyEnhancement 拦截逻辑）
  const logId = randomUUID();
  insertRequestLog(db, { ... });
  return reply.status(interceptResult.statusCode).send(interceptResult.body);
}
```

在 failover 循环结束后、非流式响应发送前添加 afterResponse：
```ts
// ④ afterResponse — 非流式场景在 reply.send 前执行，可修改响应
if (!isStream && afterCtx) {
  const afterResult = await pluginEngine.runAfterResponse(afterCtx, pr);
  if (afterResult?.body) pr.body = afterResult.body;
}
// 流式场景：响应已发送，afterResponse 仅用于后处理
if (isStream) {
  await pluginEngine.runAfterResponse(afterCtx, { statusCode: r.statusCode, isStream: true });
}
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

## Task 7: Implement Built-in Proxy Enhancement Plugin

**说明：** 代理增强功能已合并到 main（PR #23），代码在 `src/proxy/enhancement-handler.ts`。本任务将现有 `applyEnhancement()` 逻辑提取为内置插件 `@internal/claude-code-enhancer`。

**参考文件（main 分支上已存在）：**
- `src/proxy/enhancement-handler.ts` — 主逻辑（applyEnhancement、buildModelInfoTag、InterceptResponse）
- `src/proxy/directive-parser.ts` — 指令解析
- `src/proxy/response-cleaner.ts` — 历史消息清理
- `src/proxy/model-state.ts` — 会话级模型状态持久化（单例 + DB 双写）
- `src/db/session-states.ts` — session_model_states / session_model_history 表操作

**Files:**
- Create: `src/plugins/internal/claude-code-enhancer.ts`
- Modify: `src/proxy/proxy-core.ts` — 移除 applyEnhancement/buildModelInfoTag 导入和调用

- [ ] **Step 1: Implement enhancement as plugin**

实现 `ServerPluginModule`：
- `init(ctx)` — 用 `ctx.db` 初始化 `modelState` 单例（`modelState.init(ctx.db)`）
- `beforeProxy(ctx)` — 调用 `cleanRouterResponses` + `parseDirective` + 查询 `modelState.get()`，返回 `{ body, effectiveModel, originalModel }`
- `intercept(ctx)` — select-model 命令拦截，返回 `InterceptResponse`
- `afterResponse(ctx, response)` — 非流式场景注入 `buildModelInfoTag`

注意：`beforeProxy` 和 `intercept` 在 spec 中分离，但实际 `applyEnhancement()` 把它们合在一个函数里。
提取时需拆分：`beforeProxy` 处理消息清理和模型替换，`intercept` 只处理命令拦截。

- [ ] **Step 2: Register as built-in plugin**

在 `buildApp()` 中自动注册内置插件：
```ts
engine.registerBuiltIn('@internal/claude-code-enhancer', claudeCodeEnhancer);
```

- [ ] **Step 3: Remove old applyEnhancement call**

从 `proxy-core.ts` 中移除：
- `import { applyEnhancement, buildModelInfoTag } from "./enhancement-handler.js"` 导入
- `applyEnhancement(db, request, clientModel, sessionId)` 调用（第 138 行）
- 拦截日志记录逻辑（第 141-159 行）
- 非流式 model-info tag 注入（第 304-313 行）

改用 Task 6 中嵌入的 `pluginEngine.runBeforeProxy()` + `runIntercept()` + `runAfterResponse()`。

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
