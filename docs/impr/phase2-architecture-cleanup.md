# 第二阶段：架构债务清理

> 来源：feat-performance-impr 四维分析 | 预估工时：32.5h
> 优先级：建议下个迭代完成

---

## 改进清单

### 后端架构（8 项）

#### 1. 完成 Pipeline 迁移（8h）

**问题**：Pipeline/Hook 系统注册了 9 个 hook，但 `emit()` 仅在 `create-proxy-handler.ts:263` 的 `pre_route` 阶段调用了一次。以下 7 个 hook 从未被执行：
- `overflowRedirectHook`（post_route）
- `pluginRequestHook`（pre_transport）
- `providerPatchesHook`（pre_transport）
- `requestLoggingHook`（post_response）
- `errorLoggingHook`（on_error）
- `allowedModelsHook`（pre_route）
- `cacheEstimationHook`（pre_route，可能不完整）

`failover-loop.ts` 中仍保留内联旧逻辑（溢出重定向、plugin 调用、provider patches、日志写入等），与 hook 定义双重维护。

**方案**：在 `failover-loop.ts` 的关键节点添加 `proxyPipeline.emit()`：
- Route 之后 → `emit("post_route", ctx)`
- Transport 之前 → `emit("pre_transport", ctx)`
- 请求成功后 → `emit("post_response", ctx)`
- 错误发生后 → `emit("on_error", ctx)`
- 迁移完成后删除对应的内联代码

**影响文件**：
- `router/src/proxy/handler/failover-loop.ts` — 添加 emit 调用 + 移除内联逻辑
- `router/src/proxy/handler/create-proxy-handler.ts` — 确保 emit 路径完整
- `router/src/proxy/pipeline/register-hooks.ts` — 验证所有 hook 正确注册
- `router/src/proxy/hooks/builtin/*.ts` — 各 hook 实现

#### 2. 合并 hookRegistry 和 proxyPipeline（2h）

**问题**：`registerBuiltinHooks()` 同时注册到 `hookRegistry`（Admin API 查询用）和 `proxyPipeline`（实际执行用），两个注册表可能不一致。`hookRegistry.register()` 允许重复注册（数组 push），`proxyPipeline.register()` 幂等（同名跳过）。

**方案**：合并为单一注册表，由 `proxyPipeline.getHookChain()` 满足 Admin API 查询需求，删除 `hookRegistry`。

**影响文件**：
- `router/src/proxy/pipeline/hook-registry.ts` — 删除或合并
- `router/src/proxy/pipeline/register-hooks.ts` — 统一注册
- `router/src/admin/monitor.ts` — 查询改用 proxyPipeline

#### 3. 修复 admin/providers.ts → proxy/transport/http 反向依赖（2h）

**问题**：`admin/providers.ts` 导入了 `proxy/proxy-core.js` 和 `proxy/transport/http.js`，用于 provider 连接测试。这引入了 admin → proxy 的反向依赖，绕过了 StateRegistry 抽象。

**方案**：通过 StateRegistry 或独立接口封装连接测试逻辑。

**影响文件**：
- `router/src/admin/providers.ts`
- `router/src/proxy/proxy-core.ts`
- `router/src/proxy/transport/http.ts`
- `router/src/core/registry.ts`

#### 4. failover-loop.ts 拆分为四个阶段函数（4h）

**问题**：`failover-loop.ts`（558 行）是单体编排器，包含 route → transform → transport → failover 全部逻辑，缺乏阶段划分，难以单元测试。

**方案**：拆分为独立的纯函数：
- `routePhase(ctx)` — 路由解析 + 溢出重定向
- `transformPhase(ctx)` — 格式转换
- `transportPhase(ctx)` — HTTP 传输
- `failoverDecision(ctx, result)` — 失败决策

**影响文件**：
- `router/src/proxy/handler/failover-loop.ts` — 拆分
- 新增：`router/src/proxy/handler/phases/route.ts`
- 新增：`router/src/proxy/handler/phases/transform.ts`
- 新增：`router/src/proxy/handler/phases/transport.ts`
- 新增：`router/src/proxy/handler/phases/failover.ts`

#### 5. 格式转换层提取共享类型映射表（3h）

**问题**：`transform/` 目录（4161 行，24 文件）存在结构复制：
- Anthropic Content Block ↔ OpenAI tool_call 映射在 4 个文件中重复
- `message-mapper.ts` 和 `request-bridge-responses.ts` 共享 Messages ↔ Input Items 映射
- 双向流式转换结构对称但独立维护

**方案**：提取共享类型映射常量，强化 `stream-transform-base.ts` 基类。

**影响文件**：
- `router/src/proxy/transform/` 下的多个文件
- 新增：`router/src/proxy/transform/shared-mappings.ts`

#### 6. callNonStream 添加 req.setTimeout()（0.5h）

**问题**：非流式请求未设置超时，若上游建立 TCP 连接后不返回 HTTP response，请求将永久挂起。

**方案**：在 `callNonStream` 中添加 `req.setTimeout(timeoutMs, ...)` 并 abort。

**影响文件**：
- `router/src/proxy/transport/http.ts`

#### 7. transport 层复用 failover-loop 中已计算的 reqBodyStr（0.5h）

**问题**：`failover-loop.ts` 已预计算 `JSON.stringify(body)` 为 `reqBodyStr`，但 transport 层的 `http.ts` 仍重新序列化。

**方案**：将 `reqBodyStr` 作为参数传入 transport 层。

**影响文件**：
- `router/src/proxy/transport/http.ts`
- `router/src/proxy/transport/transport-fn.ts`
- `router/src/proxy/handler/failover-loop.ts`

#### 8. request_logs 添加 original_request_id 和 status_code 索引（0.5h）

**问题**：`original_request_id` 无索引导致分组日志查询全表扫描；`status_code` 无索引导致日志过滤页性能差。

**方案**：
```sql
CREATE INDEX idx_logs_original ON request_logs(original_request_id, created_at);
CREATE INDEX idx_logs_status ON request_logs(status_code);
```

**影响文件**：
- 新增迁移文件 `router/src/db/migrations/045_add_logs_indexes.sql`

---

### 前端架构（6 项）

#### 9. Composable 依赖改为函数参数注入（3h）

**问题**：`useProviderForm` 等在函数内部直接调用子 composable（`useTransformRules`、`useProviderPresets`），无法在测试中注入 mock。

**方案**：通过函数参数注入依赖，或使用 provide/inject。

**影响文件**：
- `frontend/src/composables/useProviderForm.ts`
- `frontend/src/composables/useTransformRules.ts`
- `frontend/src/composables/useProviderPresets.ts`

#### 10. App.vue 移除 checkAuth，统一在路由守卫处理（1h）

**问题**：`App.vue` 的 `checkAuth()` 和 `router.beforeEach` 做了两次认证检查，冗余。

**方案**：删除 `App.vue` 中的认证逻辑，统一在 `router.beforeEach` 处理。

**影响文件**：
- `frontend/src/App.vue`
- `frontend/src/router/index.ts`

#### 11. useMonitorData 中 shallowRef + triggerRef 改为 ref + 不可变更新（2h）

**问题**：`shallowRef` + `triggerRef` 模式依赖开发者记住调用 `triggerRef()`，容易遗漏。`stream_content_update` 事件直接 mutate 已存在的请求对象属性。

**方案**：改为 `ref` + spread 更新，或封装 `updateRequest(id, patch)` 方法。

**影响文件**：
- `frontend/src/composables/useMonitorData.ts`

#### 12. Dashboard 主题切换只更新图表颜色，不重取数据（2h）

**问题**：`useDashboard.ts` 的 `watchTheme` 在主题切换时调用 `refresh()` 发起 5 个 API 请求。但主题切换只需更新 Chart.js 的样式颜色。

**方案**：分离颜色更新和数据更新，主题切换只触发 chart options 重渲染。

**影响文件**：
- `frontend/src/composables/useDashboard.ts`
- `frontend/src/views/Dashboard.vue`

#### 13. vite build.manualChunks 配置 + 启用 @intlify/unplugin-vue-i18n（2h）

**问题**：
- `manualChunks` 未配置：chart.js（~200KB）、radix-vue 等大型库打包进同一 vendor chunk
- `@intlify/unplugin-vue-i18n` 已安装但未启用，i18n 文件在运行时动态加载产生 16 个 HTTP 请求

**方案**：
```ts
manualChunks: {
  'chart.js': ['chart.js'],
  'vendor-ui': ['radix-vue', 'reka-ui'],
  'vendor-i18n': ['vue-i18n'],
}
// 启用 VueI18nPlugin
```

**影响文件**：
- `frontend/vite.config.ts`

#### 14. providers/routerKeys 等元数据全局缓存（2h）

**问题**：`useLogFilters` 的 `onMounted` 中加载 providers、routerKeys、modelOptions，这些数据在多个页面间共享且变化频率低，每次页面加载都重新获取。

**方案**：提升为全局 composable（如 `useGlobalData`）并做短期缓存。

**影响文件**：
- 新增：`frontend/src/composables/useGlobalData.ts`
- `frontend/src/composables/useLogFilters.ts`
- `frontend/src/views/Providers.vue`

---

## 工时汇总

| 项 | 工时 |
|----|------|
| 后端架构 | 20.5h |
| 前端架构 | 12h |
| **合计** | **32.5h** |
