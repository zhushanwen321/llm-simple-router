# 监控 recent 接口性能优化

## 目标

`/admin/api/monitor/recent` 返回数据从 ~20-80MB 降低到 <1MB，通过在 `complete()` 时将 `clientRequest`/`upstreamRequest` 从 `recentCompleted` 中分离到独立的 `detailsMap`，实现列表摘要 + 详情按需加载。

## 背景

### 问题

- `recentCompleted` 数组最多 200 条，每条 `ActiveRequest` 携带 `clientRequest`（完整请求体 JSON，50-200KB）和 `upstreamRequest`（上游请求体 JSON，50-200KB）
- 200 × (50+50)KB = ~20MB，大型对话场景可达 ~80MB
- 前端列表页只用摘要字段，`clientRequest`/`upstreamRequest` 仅在用户点击查看详情时按需加载

### 现有消费路径

1. **列表加载**：`/admin/api/monitor/recent` → `tracker.getRecent()` → 返回 `recentCompleted` 全量
2. **详情加载（pending 请求）**：`/admin/api/monitor/request/:id` → `tracker.getRequestById()` → 从 activeMap 获取
3. **详情加载（completed 请求）**：前端 `loadLogDetail()` 从 DB 日志获取 `client_request`/`upstream_request`
4. **SSE 广播**：`request_start`/`request_complete` 已 strip `clientRequest`，但漏了 `upstreamRequest`

## 设计

### 核心变更：complete() 时分离大字段

```
complete() 调用时:
  1. 从 activeMap 中的 req 提取 clientRequest + upstreamRequest
  2. 存入 detailsMap（key=requestId, value={clientRequest, upstreamRequest, completedAt}）
  3. 创建 completed 对象时不携带这两个字段（设为 undefined 或不设置）
  4. 将 completed（无大字段）存入 recentCompleted
```

### detailsMap 生命周期

- **写入**：`complete()` 时
- **读取**：`getRequestById()` 优先从 detailsMap 获取详情，合并返回
- **清理**：随 `cleanupRecent()` 一起清理，TTL = 5min（与 recentCompleted 相同）
- **上限**：与 recentCompleted 相同，最多 200 条

### 数据流

```
请求完成时:
  activeMap{id → ActiveRequest(含 clientRequest/upstreamRequest)}
    ↓ complete()
  detailsMap{id → {clientRequest, upstreamRequest, completedAt}}
  recentCompleted.unshift(ActiveRequest(不含 clientRequest/upstreamRequest))

API 查询时:
  GET /recent → getRecent() → recentCompleted（摘要，无大字段）
  GET /request/:id → getRequestById()
    → activeMap 找（pending，完整数据）
    → recentCompleted 找 + detailsMap 合并详情（completed，按需加载）

清理时:
  cleanupRecent() 同时清理 recentCompleted 和 detailsMap 中过期条目
```

### broadcast 补漏

`request_start` 和 `request_complete` 事件中补上 `upstreamRequest` 的 strip：
```typescript
// 现在：只 delete copy.clientRequest
// 改为：同时 delete copy.clientRequest 和 copy.upstreamRequest
```

## 影响范围

### 后端文件

| 文件 | 变更 |
|------|------|
| `core/src/monitor/request-tracker.ts` | 新增 detailsMap + 修改 complete() / getRequestById() / cleanupRecent() / broadcast() |
| `core/src/monitor/types.ts` | 无变更（ActiveRequest 中 clientRequest/upstreamRequest 已是 optional） |

### 前端文件

无变更。前端对 completed 请求的详情加载已走 DB 日志路径（`loadLogDetail`），对 pending 请求走 tracker `getRequestById()`。

### 接口兼容性

- `GET /admin/api/monitor/recent` — 返回的 ActiveRequest 中 `clientRequest`/`upstreamRequest` 不再包含（或为 undefined），向后兼容
- `GET /admin/api/monitor/request/:id` — pending 请求完整返回，completed 请求从 detailsMap 合并返回（5min TTL 内）
- SSE 事件 — 补上 upstreamRequest 的 strip，减少带宽

## 验收标准

| # | 条件 | 验证方式 |
|---|------|---------|
| AC1 | `getRecent()` 返回的数组中无 `clientRequest`/`upstreamRequest` 大字段 | 单元测试 |
| AC2 | `getRequestById()` 对 completed 请求仍能返回完整 clientRequest（TTL 内） | 单元测试 |
| AC3 | detailsMap 条目在 TTL 过期后随 recentCompleted 一起清理 | 单元测试 |
| AC4 | `broadcast()` 的 request_start/request_complete 事件中同时 strip clientRequest 和 upstreamRequest | 单元测试 |
| AC5 | `/admin/api/monitor/recent` 响应体 < 1MB（200 条摘要数据） | 手动验证 |
| AC6 | pending 请求的 `getRequestById()` 行为不变（完整返回） | 单元测试 |

## 数据流

### 变更数据字段

| 字段 | 生产者 | 存储位置 | 消费者 | 读取时机 |
|------|--------|---------|--------|----------|
| detailsMap[id] | RequestTracker.complete() | 内存 Map | getRequestById() | API 请求时 |
| recentCompleted[].clientRequest | ~~之前有~~ | 现在无 | — | 不再返回 |

### 时序要求

- detailsMap 写入必须在 recentCompleted.unshift 之前（complete 内部顺序）
- detailsMap 清理必须与 recentCompleted 清理同步（同一 cleanupRecent 调用）
