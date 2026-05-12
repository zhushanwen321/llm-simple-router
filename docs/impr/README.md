# LLM Simple Router — 架构&性能四维分析汇总

> 分析日期：2026-05-12 | 分支：feat-performance-impr

---

## 总览

| 维度 | 架构评分 | 性能评分 | 综合 |
|------|---------|---------|------|
| **前端** | 7.7 / 10 | 6.5 / 10 | **7.1 / 10** |
| **后端** | 7.5 / 10 | 6.5 / 10 | **7.0 / 10** |
| **总体** | 7.6 / 10 | 6.5 / 10 | **7.05 / 10** |

前端架构略优于后端架构（组件化更成熟、API 层设计更好），两端性能评分一致（都在 6.5 分），共同的主要拖累项是**数据写入/读取阻塞主线程**和**缺少全局监控边界**。

---

## 各维度详细报告

| 报告 | 路径 |
|------|------|
| 前端架构分析 | [docs/impr/frontend-architecture.md](./frontend-architecture.md) |
| 前端性能分析 | [docs/impr/frontend-performance.md](./frontend-performance.md) |
| 后端架构分析 | [docs/impr/backend-architecture.md](./backend-architecture.md) |
| 后端性能分析 | [docs/impr/backend-performance.md](./backend-performance.md) |

---

## 跨维度共性发现

### 1. 四份报告一致指出的最高优先级问题（P0）

| # | 问题 | 维度 | 影响 |
|---|------|------|------|
| ① | **同步 SQLite 写入阻塞事件循环** | 后端性能 | 高并发下 P99 延迟恶化 30-50%，是所有请求的热路径阻塞点 |
| ② | **Pipeline/Hook 系统重构半完成** — 9 个 hook 注册但仅 1 个 emit 点 | 后端架构 | 7 个 hook 从未被执行（死代码），内联逻辑与 hook 双重维护 |
| ③ | **前端缺少全局错误处理器** — 无 `app.config.errorHandler`、无 ErrorBoundary 组件、路由无 errorComponent | 前端架构 | 任何组件渲染异常导致白屏，用户体验灾难 |
| ④ | **`request_metrics` 表缺少复合索引** | 后端性能 | Dashboard 统计查询全表扫描，数据量增长后性能线性恶化 |

### 2. 跨维度重复出现的模式

**"重构到一半"的遗留代码**
- 后端 Pipeline/Hook 架构定义了完整的 hook 体系但仅 emit 了 pre_route，其余阶段逻辑仍在 `failover-loop.ts` 中内联重复实现
- `css/components.css` 中的全局类名（如 `.dot-success`）与 Tailwind utility 功能重叠，两套样式系统并存
- `env.d.ts` 中 `*.vue` 模块声明与 `vue-tsc` 自动类型推导冲突
- `hookRegistry` 和 `proxyPipeline` 双注册表功能重叠

**热路径上的重复计算**
- 后端：`JSON.stringify(requestBody)` 在 failover-loop → transport 被重复调用
- 后端：SSE `data` 字符串在 BaseSSETransform 和 SSEMetricsTransform 中被分别 `JSON.parse`
- 后端：`MetricsExtractor.getMetrics()` 中 `join()` 创建完整字符串后 `countTokens()` 只用前 4000 字符
- 后端：`bufferChunks` 和 `captureChunks` 存储完全相同的 Buffer 引用，内存占用翻倍
- 前端：`App.vue` 和 `router.beforeEach` 做两次认证状态检查

**缺乏全局缓存**
- 前端：providers、routerKeys、modelOptions 等低频变更数据在多个页面间重复请求
- 前端：i18n 翻译文件阻塞 app mount（白屏直到全部 JSON 加载完成）
- 后端：`tool-mapper.ts` 中的 tool definition 转换可缓存

---

## 综合改进路线图

### 第一阶段：稳定性修复（建议本迭代完成）

| # | 维度 | 改进项 | 预估工时 |
|---|------|--------|----------|
| 1 | 前端-架构 | 注册全局 `app.config.errorHandler` + 添加 404/errorComponent 路由 | 1h |
| 2 | 前端-架构 | 实现 `<ErrorBoundary>` 组件包裹关键组件树节点 | 2h |
| 3 | 前端-性能 | i18n 翻译文件不阻塞 app mount（先渲染骨架屏，异步加载 locale） | 2h |
| 4 | 前端-性能 | `useDashboard` refreshTimer 在 `onUnmounted` 中清理 | 0.5h |
| 5 | 后端-性能 | 日志写入改为内存缓冲 + 批量异步写入 | 4h |
| 6 | 后端-性能 | 添加 `(is_complete, created_at, provider_id, backend_model)` 复合索引 | 0.5h |
| 7 | 后端-性能 | 移除 StreamProxy 冗余的 `captureChunks` 数组 | 1h |
| 8 | 后端-性能 | `MetricsExtractor.getMetrics()` join 截断到 SAMPLE_SIZE | 0.5h |
| | | **小计** | **11.5h** |

### 第二阶段：架构债务清理（建议下个迭代）

| # | 维度 | 改进项 | 预估工时 |
|---|------|--------|----------|
| 9 | 后端-架构 | 完成 Pipeline 迁移 — 在 `failover-loop.ts` 阶段节点添加 `emit()`，删除内联重复逻辑 | 8h |
| 10 | 后端-架构 | 合并 `hookRegistry` 和 `proxyPipeline` 为单一注册表 | 2h |
| 11 | 后端-架构 | 修复 `admin/providers.ts` → `proxy/transport/http` 反向依赖 | 2h |
| 12 | 前端-架构 | Composable 依赖改为函数参数注入（`useProviderForm` 等） | 3h |
| 13 | 前端-架构 | `App.vue` 移除 `checkAuth`，统一在路由守卫处理 | 1h |
| 14 | 前端-架构 | `useMonitorData` 中 `shallowRef` + `triggerRef` 改为 `ref` + 不可变更新 | 2h |
| 15 | 前端-性能 | Dashboard 主题切换时只更新图表颜色，不重取数据 | 2h |
| 16 | 前端-性能 | vite build.manualChunks 配置 + 启用 `@intlify/unplugin-vue-i18n` | 2h |
| 17 | 前端-性能 | providers/routerKeys 等元数据全局缓存 | 2h |
| 18 | 后端-架构 | `failover-loop.ts` 拆分为 Route/Transform/Transport/Failover 四个阶段函数 | 4h |
| 19 | 后端-架构 | 格式转换层提取共享类型映射表 | 3h |
| 20 | 后端-性能 | `callNonStream` 添加 `req.setTimeout()` | 0.5h |
| 21 | 后端-性能 | transport 层复用 failover-loop 中已计算的 `reqBodyStr` | 0.5h |
| 22 | 后端-性能 | `request_logs` 添加 `original_request_id` 和 `status_code` 索引 | 0.5h |
| | | **小计** | **32.5h** |

### 第三阶段：长期优化

| # | 维度 | 改进项 | 预估工时 |
|---|------|--------|----------|
| 23 | 后端-架构 | 格式转换层双向流式转换共享状态机基类 | 4h |
| 24 | 后端-架构 | 删除废弃 `src/routing/` 目录 | 0.5h |
| 25 | 后端-架构 | ServiceContainer 添加 `dispose()` 生命周期管理 | 2h |
| 26 | 前端-架构 | Schedules.vue 拆分为 `SchedulesList.vue` + `ScheduleDialog.vue` | 3h |
| 27 | 前端-架构 | `log-viewer/` 和 `logs/` 目录合并 | 1h |
| 28 | 前端-性能 | API 请求添加 AbortController 竞态处理 | 2h |
| 29 | 前端-性能 | 前端性能监控（Web Vitals + Lighthouse CI） | 4h |
| 30 | 后端-性能 | Worker Thread 隔离 SQLite | 8h |
| 31 | 后端-性能 | tool-mapper 转换结果缓存 | 2h |
| 32 | 后端-性能 | HTTP Agent 按 provider host 独立创建 | 2h |
| | | **小计** | **28.5h** |

**总工时估算：~72.5h（约 9 个工作日）**

---

## 各维度评分明细

### 前端架构（7.7）

| 评分项 | 分数 |
|--------|------|
| 组件架构 | 7.5 |
| 状态管理 | 7.0 |
| 路由设计 | 8.0 |
| API 层设计 | 8.5 |
| UI 组件库 | 8.5 |
| 设计系统 | 8.0 |
| i18n 架构 | 8.0 |
| 目录结构 | 7.5 |
| 类型系统 | 7.5 |
| 错误边界 | 6.5 |

**亮点**：API 层设计成熟（泛型、统一错误处理、allSettled），shadcn-vue 组件覆盖完整。
**短板**：错误边界缺失，部分 composable 间依赖无法注入 mock。

### 前端性能（6.5）

| 评分项 | 分数 |
|--------|------|
| 构建性能 | 6 |
| 首屏加载 | 5 |
| 运行时性能 | 7 |
| SSE 实时数据 | 8 |
| 内存管理 | 7 |
| 网络性能 | 6 |
| CSS 性能 | 8 |
| 静态资源 | 7 |
| 性能监控 | 2 |

**亮点**：SSE 实时数据管理规范、路由全量懒加载。
**短板**：首屏加载 blocked by i18n、缺少构建优化（manualChunks）、性能监控完全缺失。

### 后端架构（7.5）

| 评分项 | 分数 |
|--------|------|
| 分层架构 | 8 |
| 插件系统 | 7 |
| Pipeline/Hook | 5 |
| 格式转换 | 6 |
| 依赖注入 | 7 |
| 错误处理 | 8 |
| 数据库设计 | 7 |
| Admin API | 7 |
| 代码组织 | 6 |
| 可测试性 | 7 |

**亮点**：核心代理四层架构清晰、错误处理体系完整（三层错误、兜底响应全覆盖）。
**短板**：Pipeline/Hook 系统半完成状态（7/9 hook 未执行）、格式转换层代码重复严重。

### 后端性能（6.5）

| 评分项 | 分数 |
|--------|------|
| 流式代理 | 7 |
| 并发模型 | 8 |
| 数据库性能 | 5 |
| HTTP 传输 | 8 |
| 内存管理 | 6 |
| 格式转换 | 6 |
| 钩子系统 | 8 |
| 日志/监控 | 6 |
| Token 计数 | 7 |
| 资源池化 | 7 |

**亮点**：信号量实现考究（generation、动态降低不截断）、HTTP Agent keep-alive 连接复用。
**短板**：同步 SQLite 阻塞事件循环（最大性能风险）、request_metrics 缺索引、流式处理内存冗余。

---

## 附：所有报告文件

```
docs/impr/
├── README.md                     # 本文件（汇总）
├── frontend-architecture.md      # 前端架构分析（~200 行，含 3 个 P0 + 7 个 P1 + 7 个 P2-P3）
├── frontend-performance.md       # 前端性能分析（~300 行，含 6 个高优 + 6 个中优 + 7 个低优）
├── backend-architecture.md       # 后端架构分析（~350 行，含 4 个高优 + 7 个中优 + 5 个低优）
└── backend-performance.md        # 后端性能分析（~350 行，含 4 个高优 + 6 个中优 + 8 个低优）
```
