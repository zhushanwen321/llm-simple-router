# 全栈性能问题清单

> 分析日期：2025-05-10
> 分支：feat-performance-impr-more
>
> ## 状态说明
> - ✅ = 已完成（Round 1）
> - ⬜ = 待实施

## 一、后端热路径（代理转发链路）

| 编号 | 级别 | 问题 | 预估收益 |
|------|------|------|----------|
| BP-C1 | CRITICAL | 无 HTTP Agent 连接复用，每次请求新建 TCP+TLS 连接 | P50 降低 30-80ms | ✅ |
| BP-C2 | CRITICAL | CacheEstimator 重复 tokenize，同一请求最多 4-6 次 BPE 编码 | 长对话 P50 降低 30-100ms | ✅ |
| BP-C3 | CRITICAL | failover 循环每次迭代 `structuredClone(body)` 深拷贝 | 正常请求 P50 降低 5-50ms |
| BP-H1 | HIGH | `loadEnhancementConfig()` 每次请求查 DB | 每请求减少 2-4 次 SQLite 查询 | ✅ |
| BP-H2 | HIGH | `resolveMapping()` 每次迭代查 DB，无缓存 | 减少 90%+ mapping 查询 |
| BP-H3 | HIGH | API Key 每次 failover 迭代重复 AES 解密 | failover 场景减少冗余密码学操作 | ✅ |
| BP-H4 | HIGH | 日志 `JSON.stringify` 请求体在循环内重复 3 次 | 大 body P50 降低 3-15ms | ✅ |
| BP-H5 | HIGH | `excludedTargets` 用 `Array.some()` 做 O(N×M) 过滤 | 10+ targets 场景有意义 | ✅ |
| BP-M1 | MEDIUM | Pipeline hooks 串行执行 | 当前 <1ms，未来扩展瓶颈 |
| BP-M2 | MEDIUM | SSE `\r\n` 每个 chunk 做正则替换 | 减少 50%+ 临时字符串分配 | ✅ |
| BP-M3 | MEDIUM | `Buffer.concat` 在 BUFFERING 状态每 chunk 调用 | CPU 降低 30-50% |
| BP-M4 | MEDIUM | `allowed_models` 每次请求重复 JSON.parse | 消除冗余解析 |
| BP-M5 | MEDIUM | `parseModels()` 无缓存，重复 JSON.parse | 消除 failover 中重复解析 | ✅ |
| BP-M6 | MEDIUM | `collectTransportMetrics` 重复调用 cache estimation | 长对话减少一次完整 tokenize | ✅ |

### BP-C1: 无 HTTP Agent 连接复用
- **文件**: `router/src/proxy/transport/http.ts:72-81`, `router/src/proxy/transport/stream.ts:345-365`
- **问题**: `http.request` / `https.request` 未配置 keep-alive Agent，每次请求新建 TCP 连接 + TLS 握手
- **影响**: P50 延迟增加 30-80ms（HTTPS），高并发时端口耗尽（TIME_WAIT 积累）

### BP-C2: CacheEstimator 重复 tokenize
- **文件**: `router/src/routing/cache-estimator.ts:68-72`, `router/src/proxy/redirect/overflow.ts:69`
- **问题**: `estimateHit()` + `update()` 各调用 `tokenize()`，`collectTransportMetrics()` 也调用，同一请求最多 4-6 次 BPE 编码
- **影响**: 长对话 5-20ms/次 tokenize，6 次就是 30-120ms

### BP-C3: structuredClone(body) 每次迭代深拷贝
- **文件**: `router/src/proxy/handler/failover-loop.ts:193`
- **问题**: 每次迭代开头 `structuredClone(ctx.body)` 对整个请求体做深拷贝
- **影响**: 长 body 数 MB，深拷贝 10-100ms，绝大多数请求不触发 failover

### BP-H1: loadEnhancementConfig 每次查 DB
- **文件**: `router/src/proxy/routing/enhancement-config.ts:17-30`
- **问题**: 每次请求调用 `getSetting(db, "proxy_enhancement")`，至少 2 次/请求
- **影响**: 每请求 2-4 次同步 SQLite 查询

### BP-H2: resolveMapping 无缓存
- **文件**: `router/src/proxy/routing/mapping-resolver.ts:98-160`
- **问题**: 每次 failover 迭代查 DB（mapping_groups + schedules + providers）
- **影响**: 每迭代 3-5 次 SQLite 查询 + JSON 解析

### BP-H3: API Key 重复 AES 解密
- **文件**: `router/src/proxy/handler/failover-loop.ts:295-297`
- **问题**: 每次迭代调用 `decrypt(provider.api_key, encryptionKey)`
- **影响**: failover 场景重复解密同一 provider 的 key

### BP-H4: 日志 JSON.stringify 重复
- **文件**: `router/src/proxy/handler/failover-loop.ts:305-312`
- **问题**: 循环内 3 次 `JSON.stringify`，其中 `clientReq` 每次迭代都一样
- **影响**: 100KB body 序列化 5-20ms

### BP-H5: excludedTargets O(N×M) 过滤
- **文件**: `router/src/proxy/orchestration/resilience.ts:111-115`
- **问题**: `Array.some()` 嵌套 `Array.filter()` 做排除检测
- **影响**: 10+ targets 场景有 O(N×M) 开销

### BP-M2: SSE \r\n 正则
- **文件**: `router/src/metrics/sse-parser.ts:24`
- **问题**: 每个 chunk 做 `buffer.replace(/\r\n/g, "\n")`
- **影响**: 高频 SSE 场景创建大量临时字符串

### BP-M3: Buffer.concat 重复
- **文件**: `router/src/proxy/transport/stream.ts:208-213`
- **问题**: BUFFERING 状态每 chunk 调用 `Buffer.concat` + `.toString("utf-8")`
- **影响**: O(已缓冲总量) 操作

### BP-M5: parseModels 无缓存
- **文件**: `router/src/config/model-context.ts:126-155`
- **问题**: 对同一 provider 的 `models` JSON 字符串反复解析
- **影响**: failover 迭代中重复 JSON.parse + map + filter

## 二、后端基础设施（DB/监控/Admin）

| 编号 | 级别 | 问题 | 预估收益 |
|------|------|------|----------|
| BI-C1 | CRITICAL | SQLite 缺 `synchronous=NORMAL`/`cache_size`/`busy_timeout` 等关键 PRAGMA | 代理写入延迟降 30-50% | ✅ |
| BI-C2 | CRITICAL | Prepared statements 未缓存，每次查询重新编译 SQL | 每请求减少 0.1-0.3ms |
| BI-C3 | CRITICAL | MetricsExtractor 对 thinking 内容完整 tokenize | thinking 模型 metrics 延迟降 50-80% | ✅ |
| BI-H1 | HIGH | `request_logs` 缺复合索引 | 10 万行查询从 500ms 降到 50ms | ✅ |
| BI-H2 | HIGH | `request_metrics` 缺 `router_key_id` 索引 | Dashboard 聚合提升 5-10x | ✅ |
| BI-H3 | HIGH | `log-file-writer` 用 `appendFileSync` 阻塞事件循环 | 高并发减少 0.5-2ms/请求 |
| BI-H4 | HIGH | SSE 广播频率过高（5s 定时 + 流内容叠加） | Monitor 空转 CPU 降 50%+ |
| BI-H5 | HIGH | `estimateLogTableSize()` 全表扫描 | 大表监控从秒级降到毫秒级 | ✅ |
| BI-M1 | MEDIUM | Settings 表无内存缓存 | 减少高频 DB 查询 30% | ✅ |
| BI-M2 | MEDIUM | MetricsExtractor 缓冲区无上限 + O(n²) 字符串拼接 | 长请求内存降 50%+ | ✅ |
| BI-M3 | MEDIUM | `getRequestLogsGrouped()` N+1 子查询 | grouped 视图查询优化 |
| BI-M4 | MEDIUM | StatsAggregator 每次 5s 调用做 O(n log n) 排序 | Monitor 推送 CPU 降 60% |
| BI-M5 | MEDIUM | Auth 拒绝请求写日志 | 攻击场景 DB 负载降 50%+ | ✅ |

### BI-C1: SQLite PRAGMA 缺失
- **文件**: `router/src/db/index.ts:initDatabase()`
- **缺失项**: `synchronous=NORMAL`, `cache_size=-64000`, `busy_timeout=5000`, `temp_store=MEMORY`, `mmap_size`, `journal_size_limit`
- **影响**: 默认 FULL 模式每次 WAL 写入 fsync，页缓存仅 2MB

### BI-C2: Prepared statements 未缓存
- **文件**: 贯穿 `router/src/db/*.ts`，典型 `settings.ts:getSetting()`, `logs.ts:insertRequestLog()`
- **问题**: 所有 DB 查询用内联 `db.prepare().run()` 模式
- **影响**: 每请求至少 4 次不必要的 SQL 编译

### BI-C3: MetricsExtractor 完整 tokenize
- **文件**: `router/src/metrics/metrics-extractor.ts:getMetrics()` 第 107、134、137 行
- **问题**: 流结束时对 thinkingContentBuffer 等缓冲区调用 `encode()` 计算 token
- **影响**: thinking 模型长内容 encode 可能数百 ms

### BI-H1: request_logs 索引不足
- **文件**: 索引定义 `migrations/009_add_request_logs_indexes.sql`，查询 `router/src/db/logs.ts`
- **缺失**: `provider_id` 索引、`model` 索引、`created_at + 其他条件` 复合索引
- **影响**: 10 万行+ 带过滤的查询明显变慢

### BI-H3: appendFileSync 阻塞
- **文件**: `router/src/storage/log-file-writer.ts:write()` 第 46 行
- **问题**: 同步文件写入阻塞事件循环，首次写入还触发 existsSync + mkdirSync
- **影响**: 高并发 50+ QPS 时文件 I/O 延迟叠加

### BI-H4: SSE 广播频率高
- **文件**: `router/src/core/monitor/request-tracker.ts:startPushInterval()` 第 243-259 行
- **问题**: 5s 定时推送 4 种事件 + 500ms 节流流内容推送
- **影响**: 多 admin 客户端时 CPU 开销倍增

### BI-H5: estimateLogTableSize 全表扫描
- **文件**: `router/src/db/logs.ts:estimateLogTableSize()` 第 239 行
- **问题**: 对所有大文本列做 `SUM(length())`
- **影响**: 10 万行日志全表扫描耗时数秒

### BI-M2: MetricsExtractor 缓冲区无上限
- **文件**: `router/src/metrics/metrics-extractor.ts` 第 57-64 行
- **问题**: `+=` 拼接创建新字符串 O(n²)，无大小限制
- **影响**: 长请求内存峰值高，GC 压力大

## 三、前端

| 编号 | 级别 | 问题 | 预估收益 |
|------|------|------|----------|
| FE-H1 | HIGH | Dashboard `loadProviderOutputTokens()` N+1 请求 | Provider >5 时首屏加速 | ✅ |
| FE-H2 | HIGH | Dashboard `refresh()` 每次触发 5 个并行请求 | 首屏时间减少 30-50% | ✅ |
| FE-H3 | HIGH | SSE `stream_content_update` 频繁 re-render | Monitor 流畅度 | ✅ |
| FE-H4 | HIGH | 路由切换重复鉴权请求 | 每次导航减少 1 请求 | ✅ |
| FE-H5 | HIGH | Chart.js 注册了不需要的模块 | 减少约 20KB gzip | ✅ |
| FE-M1 | MEDIUM | useSSEParsing computed 链 | 日志详情打开速度 | ✅ |
| FE-M2 | MEDIUM | LogTableRow 重复 useClipboard/useI18n 实例 | 内存优化 | ✅ |
| FE-M3 | MEDIUM | Monitor now ref 每秒 re-render | 活跃请求多时流畅度 | ✅ |
| FE-M4 | MEDIUM | SSE 重连无指数退避 | 后端不可用时行为 | ✅ |
| FE-M5 | MEDIUM | Dashboard watch 链重复请求 | 减少无效请求 | ✅ |
| FE-M6 | MEDIUM | Line chart 缺少 key | 图表视觉正确性 | ✅ |
| FE-L1 | LOW | Chunk 分割优化 | 首屏体积 |
| FE-L2 | LOW | zod 全量引入 | Providers chunk 体积 |

### FE-H1: Dashboard N+1 请求
- **文件**: `useDashboard.ts:170-186`
- **问题**: 对每个 provider 独立调用 `api.getStats(p2)` 获取 output tokens
- **影响**: N 个 provider 产生 N 次串行请求

### FE-H2: Dashboard refresh 5 并行请求
- **文件**: `useDashboard.ts:191-228`
- **问题**: 同时调用 getStats + getMetricsTimeseries(x3) + getMetricsSummary
- **影响**: 首次加载可能产生 7+N 个请求

### FE-H3: SSE stream_content_update 频繁 re-render
- **文件**: `useMonitorData.ts:37-68`
- **问题**: `activeRequests` 是 `ref`（非 shallowRef），每次修改内部属性触发深度追踪
- **影响**: 3 个 computed 依赖 activeRequests，高并发时频繁重算

### FE-H4: 路由切换重复鉴权
- **文件**: `App.vue:51-52`, `router/index.ts:96-102`
- **问题**: App.vue watch + router beforeEach 都调用 `api.getStats()` 鉴权
- **影响**: 每次导航 2 次鉴权请求

### FE-H5: Chart.js 未按需注册
- **文件**: `Dashboard.vue:126`
- **问题**: 注册了 Title、Legend 等不使用的模块
- **影响**: Dashboard chunk 179KB
