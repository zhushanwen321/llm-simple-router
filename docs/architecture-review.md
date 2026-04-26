# 架构审查记录

> 审查时间：2026-04-25 | 触发：feat/1m-model PR 合并前审查

## Proxy 层

### P0: `executeFailoverLoop` 循环体过于复杂

**文件**: `src/proxy/proxy-handler.ts:193-384`

`while(true)` 循环体 ~190 行，包含 6 个 return、2 个 continue、3 层 try/catch。compact 检查、DeepSeek 补丁、日志收集、响应发送全塞在一个循环里。

**改法**: 将 compact 检查和 DeepSeek 补丁提取为独立阶段函数，循环体只保留 failover 核心逻辑。compact 已提取到 `compact.ts`，但 `executeFailoverLoop` 中调用 compact 的逻辑（约 30 行）仍应封装为 `applyCompactRedirect(ctx)` 之类的函数。

### P0: `applyEnhancement()` 职责爆炸

**文件**: `src/proxy/enhancement/enhancement-handler.ts:80-227`

6 个关注点串联在一个 147 行方法中：配置读取、tool result 解析、历史清理、指令解析、模型映射、会话记忆。任一关注点修改都可能影响后续路径。

**改法**: 拆为独立阶段函数，前一个阶段可短路后续：

```typescript
// 伪代码
const phases = [handleToolResult, handleCommand, handleDirective, handleMemory];
for (const phase of phases) {
  const result = phase(request, config);
  if (result.shortCircuit) return result;
}
```

### P1: 响应发送被三方瓜分

- `StreamProxy` 管理 SSE 流的 writeHead/write/end
- `Orchestrator.sendResponse` 管理非流式错误
- `proxy-handler.executeFailoverLoop` 管理最终的错误兜底

**改法**: Orchestrator 不直接操作 reply，只返回结果，由 proxy-handler 统一发送。

### P1: `ProviderSwitchNeeded` 异常做控制流

从 `resilience.ts` 抛出，穿透 `orchestrator.ts`，在 `proxy-handler.ts` 捕获。三层跨文件异常让调用链不可预测。

**改法**: 在 ResilienceResult 中加 `switchTo?: string` 字段，改为返回值。

### P1: `proxy_enhancement` 配置被两个模块独立解析

`enhancement-handler.ts` 和 `compact.ts` 各自 `getSetting` + `JSON.parse` 同一个 key。结构变化需要两处同步。

**改法**: 集中到一个 `loadEnhancementConfig(db)` 函数。

### P1: `modelState` 单例 + `init(db)` 模式

`src/proxy/model-state.ts` — `init()` 之前的 `set()` 只写内存不写 DB。单例模式使测试隔离困难。

**改法**: 改为工厂函数，在 RouteHandlerDeps 中注入实例。

### P2: `StreamProxy` 状态机与 I/O 混合

`src/proxy/stream-proxy.ts` — 状态转换和 I/O 操作紧密耦合，管道是硬编码的两级管道。`terminal()` 的 deferred 参数受测试框架隐式影响。

**改法**: 管道改为可配置的 Transform 流链，deferred 逻辑下沉到测试 helper。

---

## Admin + DB 层

### P1: 5 个 CRUD 路由 ~800 行，~40% 重复骨架

404 检查、逐字段 patch、Create/Update Schema 的 Optional 版本，每个文件重写一遍。

**改法**: 抽象 CRUD 工厂：
- 通用 404 helper: `const existing = getXxxById(db, id); if (!existing) return notFound(reply, ...);`
- `partialBody(schema)` 自动从 CreateSchema 生成 UpdateSchema
- `patchFields(body, schema)` 自动过滤 undefined 字段

### P1: API 响应格式不对称

成功时 send 裸数据，失败时走信封。前端需处理两种结构。

**说明**: `index.ts` 的 `onSend` hook 会包装成功响应为信封，但这是隐式行为。建议在路由代码中也显式使用 `success(data)` 保持一致性。

### P2: `MODEL_CONTEXT_WINDOWS` 硬编码 80+ 模型

`src/config/model-context.ts` — 不可动态更新，新增模型需改代码重新部署。

**改法**: 保留作为 fallback，但暴露 admin API 管理全局默认值。

### P2: Settings 存储三种风格并存

| 风格 | 示例 |
|------|------|
| 标量值 + 独立 get/set | `log_retention_days`, `db_max_size_mb` |
| 枚举值 + 独立 get/set | `config_sync_source` |
| JSON 对象 + 裸 getSetting/setSetting | `proxy_enhancement` |

**改法**: 声明式注册表自动生成类型安全的 get/set。

---

## 前端

### P2: `client.ts` 436 行职责三合一

axios 实例 + 全部类型定义 + 全部 API 方法。新增端点必须修改同一个文件。

**改法**: 拆为 `api/instance.ts`、`api/types.ts`、按领域拆分 `api/providers.ts` 等。

### P2: `extractErrorMessage` 模式在 4+ 文件重复

`(e as { apiMessage?: string }).apiMessage || '默认消息'` 反复出现。

**改法**: 提取为 `utils/error.ts` 中的 `extractErrorMessage(e: unknown): string`。

### P2: RetryRules.vue / ModelMappings.vue 无 composable 提取

381 行 / 306 行，所有 CRUD 逻辑内联。Logs/Dashboard 展示了好的 composable 模式，这两个页面没跟上。

### P3: 类型定义分散

分布三处：`types/mapping.ts`、`client.ts` 内联、组件本地。RetryRule 接口在 `client.ts` 和 `RetryRules.vue` 各定义一次。

**改法**: 全部收拢到 `types/` 目录，`client.ts` 只 import 使用。

### P3: `ProviderSummary` 类型抽象不当

缺少 `models` 字段，导致 ModelMappings.vue 需要 `(p as ProviderSummary & { models?: string[] })` 脆弱断言。

---

## 与本次 PR (feat/1m-model) 相关的问题

按相关程度排序：

| # | 问题 | 关联原因 |
|---|------|---------|
| 1 | `proxy_enhancement` 配置两处独立解析 | 本次 PR 在 `compact.ts` 和 `enhancement-handler.ts` 各自解析同一份配置 |
| 2 | `executeFailoverLoop` 中 compact 调用逻辑仍内联 | 本次 PR 新增的 compact 分支（约 30 行 if/else）在循环体中，应封装为函数 |
| 3 | `extractErrorMessage` 重复 | 新增的 `ContextCompact.vue` 中再次重复此模式 |
| 4 | `client.ts` 膨胀 | 本次 PR 新增 `ProxyEnhancementConfig`、`CompactModelEntry` 等类型和 3 个 API 方法 |
| 5 | 类型定义分散 | `CompactConfig` interface 在后端 3 处重复定义（compact.ts、proxy-enhancement.ts、proxy-handler 已移除） |
| 6 | API 响应格式不对称 | 新增的 `compact-models` 端点返回裸数组，其他端点有信封 |
