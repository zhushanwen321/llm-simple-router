# 核心机制

## 安装流程

```
用户输入 Git 仓库地址
  → 验证可达性（git ls-remote）
  → git clone 到 data/plugins/{plugin-name}/
  → 读取 manifest.json，校验必要字段
  → npm install --production（信任模型，参见安全声明）
  → 写入 DB plugins 表（status='installed'）
  → 失败时：回滚 clone 目录，不写入 DB
```

安全声明：第一阶段为信任模型，插件可执行任意代码。
用户自行承担插件安全风险。后续阶段考虑沙箱隔离。

## 更新流程

P0 不支持热更新。用户需要 uninstall + 重新 install 来更新插件版本。

## 加载流程

```
启用插件
  → 读取 manifest，获取 serverEntry
  → dynamic import(serverEntry)
  → 调用 module.init(ctx)
  → 按 manifest.extensions 注册 hook
  → 更新 DB status='enabled'
  → init 失败：status='error'，记录 error_message
```

前端通过 `/admin/api/plugins/:id/client-assets/*` 获取入口文件，动态 import 加载。

## 数据库表

```sql
CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY,        -- 即 manifest.name
  version TEXT NOT NULL,
  repo_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'installed',
    -- installed / enabled / disabled / error
  manifest TEXT NOT NULL,
  installed_at TEXT NOT NULL,
  enabled_at TEXT,
  updated_at TEXT,
  error_message TEXT,
  settings TEXT               -- 插件私有配置 JSON
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
  // 恢复失败策略：单个插件 init 失败标记 error，不影响其他插件和启动
}
```

## 代理流程嵌入

```
handleProxyPost()
  ① pluginEngine.runBeforeProxy(ctx)     ← 在 failover 循环之前执行一次
  ② interceptResult = pluginEngine.runIntercept(ctx)
     → 拦截：直接返回，跳过整个 failover 循环
     → 未拦截：进入 failover 循环
  ③ [failover 循环 + retryableCall]      ← 插件不参与每次重试
  ④ pluginEngine.runAfterResponse(ctx, response)  ← 循环结束后执行一次
  → 返回客户端
```

关键决策：`beforeProxy` 和 `intercept` 在 failover 循环外执行一次，
确保插件不会在每个 failover 尝试中重复执行。
`afterResponse` 在循环结束后执行，仅用于后处理（如日志增强）。

## Hook 执行顺序

多个插件注册同一扩展点时，按 enable 时间顺序执行（先启用先执行）。
`beforeProxy`：链式传递 context，每个插件可修改并传给下一个。
`intercept`：第一个返回非 null 结果的插件胜出，后续不再执行。
`afterResponse`：链式传递 response。
