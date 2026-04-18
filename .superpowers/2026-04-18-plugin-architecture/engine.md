# 核心机制

## 安装流程

```
用户输入 Git 仓库地址
  → 验证可达性（git ls-remote）
  → git clone 到 data/plugins/{plugin-name}/
  → 读取 manifest.json，校验必要字段
  → npm install --production
  → 写入 DB plugins 表（status='installed'）
```

## 加载流程

```
启用插件
  → 读取 manifest，获取 serverEntry
  → dynamic import(serverEntry)
  → 调用 module.init(ctx)
  → 按 manifest.extensions 注册 hook
  → 更新 DB status='enabled'
```

前端通过 `/admin/api/plugins/:name/client-assets/*` 获取入口文件，动态 import 加载。

## 数据库表

```sql
CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  repo_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'installed',
    -- installed / enabled / disabled / error
  manifest TEXT NOT NULL,
  installed_at TEXT NOT NULL,
  enabled_at TEXT,
  error_message TEXT,
  settings TEXT
);
```

## Plugin Engine

```ts
class PluginEngine {
  // 生命周期
  install(repoUrl: string): Promise<PluginInstallResult>;
  uninstall(pluginId: string): Promise<void>;
  enable(pluginId: string): Promise<void>;
  disable(pluginId: string): Promise<void>;

  // Hook 执行
  runBeforeProxy(ctx: ProxyBeforeContext): Promise<ProxyBeforeContext>;
  runIntercept(ctx: ProxyBeforeContext): Promise<ProxyInterceptResult | null>;
  runAfterResponse(ctx, response): Promise<ProxyResult>;

  // 启动恢复
  restorePlugins(): Promise<void>;
}
```

## 代理流程嵌入

```
handleProxyPost()
  ① pluginEngine.runBeforeProxy(ctx)
  ② interceptResult = pluginEngine.runIntercept(ctx)
     → 拦截：直接返回
     → 未拦截：正常代理转发
  ③ pluginEngine.runAfterResponse(ctx, response)
  → 返回客户端
```

现有 `applyEnhancement()` 迁移为内置插件 `@internal/claude-code-enhancer`，
调用点替换为 Plugin Engine 的 hook 执行。

## Hook 执行顺序

多个插件注册同一扩展点时，按 enable 时间顺序执行（先启用先执行）。
`beforeProxy`：链式传递 context，每个插件可修改并传给下一个。
`intercept`：第一个返回非 null 结果的插件胜出，后续不再执行。
`afterResponse`：链式传递 response。
