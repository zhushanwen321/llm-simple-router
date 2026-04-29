# Phase 3: ServiceContainer + RouteHandlerDeps 简化

日期：2026-04-29
前置条件：Phase 1（core/ 抽取）+ Phase 2（proxy/ 子目录化）已完成
风险等级：中高（涉及 buildApp 装配逻辑 + RouteHandlerDeps 接口变更）

## 目标

1. 引入轻量 `ServiceContainer`，让 `buildApp()` 装配更清晰
2. 简化 `RouteHandlerDeps`（8字段 → 3字段），消除 "god interface"
3. 配置值从 `RouteHandlerDeps` 移到 `config` 单例读取

**不做的**：Pipeline + Middleware 模式。原因：proxy-handler.ts 中的中间件有两种不同调用时机（failover 循环外 vs 循环内），强行统一反而增加复杂度。当前 439 行尚可管理，等真正需要频繁新增步骤时再引入。

---

## Task 1: 创建 ServiceContainer

### 原理

一个简单的懒加载服务注册表。`buildApp()` 中注册所有服务，各模块通过 container 获取依赖，而不是通过 RouteHandlerDeps 逐个传递。

### 新增文件

`src/core/container.ts` (~60 行)

```typescript
export class ServiceContainer {
  private registry = new Map<string, () => unknown>();
  private cache = new Map<string, unknown>();

  register<T>(key: string, factory: (c: ServiceContainer) => T): void {
    this.registry.set(key, () => {
      if (this.cache.has(key)) return this.cache.get(key)!;
      const instance = factory(c);
      this.cache.set(key, instance);
      return instance;
    });
  }

  resolve<T>(key: string): T {
    const factory = this.registry.get(key);
    if (!factory) throw new Error(`Service not registered: ${key}`);
    return factory() as T;
  }
}
```

### 验证

- 编译通过
- 现有测试不受影响（container 目前不被任何代码引用）

---

## Task 2: 简化 RouteHandlerDeps（8 → 3 字段）

### 当前 RouteHandlerDeps

```typescript
export interface RouteHandlerDeps {
  db: Database.Database;           // → container.resolve("db")
  streamTimeoutMs: number;         // → config 读取
  retryBaseDelayMs: number;        // → config 读取
  matcher?: RetryRuleMatcher;      // → container.resolve("matcher")
  tracker?: RequestTracker;        // → container.resolve("tracker")
  orchestrator: ProxyOrchestrator; // → container.resolve("orchestrator")
  usageWindowTracker?: UsageWindowTracker; // → container.resolve("usageWindowTracker")
  sessionTracker?: SessionTracker; // → container.resolve("sessionTracker")
}
```

### 重构后

```typescript
export interface RouteHandlerDeps {
  db: Database.Database;
  orchestrator: ProxyOrchestrator;
  container: ServiceContainer;
}
```

- `streamTimeoutMs`, `retryBaseDelayMs` → 从 `getConfig()` 读取
- `matcher`, `tracker`, `usageWindowTracker`, `sessionTracker` → 从 container 获取

### 影响范围

| 文件 | 变更 |
|------|------|
| `proxy/handler/proxy-handler.ts` | deps.matcher → container.resolve("matcher") 等 |
| `proxy/handler/openai.ts` | 插件注册参数简化 |
| `proxy/handler/anthropic.ts` | 插件注册参数简化 |
| `src/index.ts` | buildApp 改用 container 装配 |

### Step-by-step

#### Step 1: 创建 container.ts

- 新增 `src/core/container.ts`
- 导出 `ServiceContainer` 类

#### Step 2: 修改 RouteHandlerDeps

- 在 `proxy/handler/proxy-handler.ts` 中：
  - 新增 `import { ServiceContainer } from "../../core/container.js"`
  - 修改 `RouteHandlerDeps` 接口（8 → 3 字段）
  - 替换所有 `deps.matcher` → `deps.container.resolve("matcher")`
  - 替换所有 `deps.tracker` → `deps.container.resolve("tracker")`
  - 替换所有 `deps.usageWindowTracker` → `deps.container.resolve("usageWindowTracker")`
  - 替换所有 `deps.sessionTracker` → `deps.container.resolve("sessionTracker")`
  - `deps.streamTimeoutMs` → `getConfig().STREAM_TIMEOUT_MS`
  - `deps.retryBaseDelayMs` → `getConfig().RETRY_BASE_DELAY_MS`

#### Step 3: 修改 openai.ts 和 anthropic.ts

- 这两个文件通过 `buildTransportFn()` 和 `handleProxyRequest()` 传递 deps
- `buildTransportFn` 的参数也需要从 container 获取相关服务
- 检查是否有直接使用 `deps.xxx` 的地方

#### Step 4: 修改 buildApp (src/index.ts)

- 创建 `ServiceContainer` 实例
- 注册所有服务：db, matcher, semaphoreManager, tracker, usageWindowTracker, sessionTracker
- `openaiProxy` 和 `anthropicProxy` 注册时只传 `{ db, container, orchestrator }`

#### Step 5: 更新测试

- 所有测试文件中构造 `RouteHandlerDeps` 的地方需要适配新接口
- 大部分测试使用 `buildTestApp()` 辅助函数，修改该函数即可

#### Step 6: 验证 + commit

- `npx tsc --noEmit` 零错误
- `npm test` 580 测试通过
- `npm run lint` 零警告

---

## Task 3: buildApp 注册标准化

### 目标

将 buildApp() 中的服务创建和注册标准化，用 container 统一管理。

### 变更

在 `src/index.ts` 中：

```typescript
const container = new ServiceContainer();

// 注册基础设施
container.register("db", () => db);
container.register("matcher", (c) => {
  const m = new RetryRuleMatcher();
  m.load(c.resolve("db"));
  return m;
});
container.register("semaphoreManager", () => new ProviderSemaphoreManager());
container.register("tracker", (c) => {
  const t = new RequestTracker({
    semaphoreManager: c.resolve("semaphoreManager"),
    logger: app.log,
  });
  t.startPushInterval();
  return t;
});
container.register("usageWindowTracker", (c) => {
  const uwt = new UsageWindowTracker(c.resolve("db"));
  uwt.reconcileOnStartup();
  return uwt;
});
container.register("sessionTracker", () => {
  return new SessionTracker(DEFAULT_LOOP_PREVENTION_CONFIG.sessionTracker);
});
```

然后 openaiProxy/anthropicProxy 注册简化为：

```typescript
app.register(openaiProxy, {
  db,
  container,
  orchestrator: createOrchestrator(),
});
```

---

## 不做清单

以下原设计文档中的内容**暂不实施**，留到真正需要时再做：

1. **ProxyPipeline + ProxyMiddleware** — 中间件时机不统一（failover 外 vs 内），强行抽象反而复杂
2. **proxy-core.ts 拆分** — 142 行已经足够精简
3. **proxy-logging.ts + log-helpers.ts 合并** — 当前各 ~100 行，合并无明确收益
4. **buildApp 拆成多个函数** — 327 行虽长但线性易读

---

## 执行顺序

1. Task 1: 创建 container.ts + 单元测试
2. Task 2: 简化 RouteHandlerDeps + 更新 proxy-handler.ts
3. Task 3: 更新 openai.ts + anthropic.ts
4. Task 4: 更新 buildApp (index.ts)
5. Task 5: 更新所有测试
6. Task 6: 全量验证 + commit

每个 Task 完成后立即 commit。
