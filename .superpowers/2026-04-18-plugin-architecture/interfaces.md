# 接口规范

## Manifest（manifest.json）

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "插件描述",
  "author": "作者名",
  "serverEntry": "server/index.js",
  "clientEntry": "client/index.js",
  "extensions": {
    "proxy:beforeProxy": true,
    "proxy:intercept": true,
    "log:parseResponse": true,
    "log:renderComponent": true
  }
}
```

Manifest 让管理后台在不加载代码时展示插件信息和能力列表。
`extensions` 声明使用的扩展点，系统只注册声明的扩展点。

## 插件包结构

```
my-plugin/
├── manifest.json
├── package.json
├── server/index.js    # 后端入口（ServerPluginModule）
├── client/index.js    # 前端入口（ClientPluginModule）
```

插件仓库必须包含构建后的 JS 文件，避免宿主环境编译。
源码可放在 `src/`，构建产物放 `dist/`，manifest 指向 `dist/` 下的文件。

## 后端接口

```ts
interface PluginContext {
  db: Database.Database;
  logger: FastifyLoggerInstance;
  getSetting(key: string): string | null;
}

interface ProxyBeforeContext {
  request: FastifyRequest;
  body: Record<string, unknown>;
  clientModel: string;
  apiType: 'openai' | 'anthropic';
  sessionId?: string;
}

interface ProxyInterceptResult {
  statusCode: number;
  body: unknown;
  meta?: { action: string; detail?: string };
}

interface ServerPluginModule {
  init?(ctx: PluginContext): void | Promise<void>;
  destroy?(): void | Promise<void>;
  beforeProxy?(ctx: ProxyBeforeContext): ProxyBeforeContext | null;
  intercept?(ctx: ProxyBeforeContext): ProxyInterceptResult | null;
  afterResponse?(ctx: ProxyAfterContext, response: ProxyResult): ProxyResult;
}
```

## 前端接口

```ts
interface ClientPluginModule {
  parseRequest?(body: string, apiType: string): ParsedRequest | null;
  parseResponse?(body: string, apiType: string, isStream: boolean): ParsedResponse | null;
  renderComponent?: Component;
}
```

前端通过动态 `import()` 加载，后端通过 Admin API 提供静态文件服务。
