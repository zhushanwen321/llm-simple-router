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
  db: Database.Database;          // 信任模型：直接暴露，第一阶段无沙箱
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

interface ProxyAfterContext {
  request: FastifyRequest;
  apiType: 'openai' | 'anthropic';
  clientModel: string;
  providerId: string;
  statusCode: number;
  isStream: boolean;
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
  // 流式场景下仅用于后处理（日志增强等），不可修改已发送的响应
  afterResponse?(ctx: ProxyAfterContext, response: ProxyResult): ProxyResult;
}
```

## 前端接口

```ts
interface ParsedRequest {
  apiType: string;
  model: string;
  messages?: Array<{ role: string; content: string }>;
  [key: string]: unknown;
}

interface ParsedResponse {
  apiType: string;
  statusCode: number;
  model?: string;
  usage?: Record<string, number>;
  content?: string;
  [key: string]: unknown;
}

interface ClientPluginModule {
  parseRequest?(body: string, apiType: string): ParsedRequest | null;
  parseResponse?(body: string, apiType: string, isStream: boolean): ParsedResponse | null;
  renderComponent?: Component;  // Vue 3 组件，必须与宿主 Vue 版本兼容
}
```

前端通过动态 `import()` 加载，后端通过 Admin API 提供静态文件服务。

## 构建约束

**后端插件：**
- 产物为 CommonJS 或 ESM，Node.js 直接 require/import
- 禁止使用 native 模块（如 better-sqlite3），避免与宿主冲突

**前端插件：**
- Vue / Vue Router 等宿主依赖必须标记为 external（peerDependency）
- 产物为 ESM，支持动态 import
- Vite 构建时通过 `build.rollupOptions.external` 排除宿主依赖
