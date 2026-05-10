# 后端基础设施性能优化方案比较

> 分析日期：2025-05-10

---

## BI-C1: SQLite PRAGMA 优化缺失

### 当前实现

`initDatabase()` 仅设置 3 个 PRAGMA：`journal_mode=WAL`, `auto_vacuum=INCREMENTAL`, `foreign_keys=ON`。缺少 `synchronous`, `cache_size`, `busy_timeout`, `temp_store`, `mmap_size`, `journal_size_limit`。

### 方案 A: 添加全套性能 PRAGMA
```typescript
db.pragma("synchronous = NORMAL");
db.pragma("cache_size = -16000");      // 16MB
db.pragma("busy_timeout = 5000");
db.pragma("temp_store = MEMORY");
db.pragma("mmap_size = 67108864");     // 64MB
db.pragma("journal_size_limit = 67108864");
```
- 改动：`index.ts` +6 行
- 收益：写入延迟降 30-50%，聚合查询提升 2-5 倍

### 方案 B: 仅关键 3 项（synchronous + cache_size + busy_timeout）
- 收益：方案 A 的 80%

| 维度 | 方案 A | 方案 B |
|------|--------|--------|
| 性能收益 | 高 | 中高 |
| 复杂度 | 极低 | 极低 |

### 风险评估
- `synchronous=NORMAL` 在 WAL 模式下安全。断电时可能丢失最后一个 checkpoint 之后的事务。对代理路由器（日志/指标数据）完全可接受。
- `:memory:` 数据库执行这些 PRAGMA 不报错但部分无效
- 影响的测试：所有 40 个使用 `initDatabase(":memory:")` 的测试文件
- 风险等级：**低**

### 推荐：方案 A
理由：6 行代码无侵入，覆盖全面。WAL + synchronous=NORMAL 是 SQLite 官方推荐高性能配置。

---

## BI-C2: Prepared statements 未缓存

### 当前实现

所有 DB 查询用内联 `db.prepare().run()` 模式。高频路径每请求至少 4 次不必要的 SQL 编译。

### 方案 A: WeakMap 缓存工具 + 全量替换
- 5 个 db 文件，约 34 处替换
- 复杂度：中

### 方案 B: 仅热路径缓存（auth + settings + log insert）
- 使用 `WeakMap<Database, Map<string, Statement>>` 避免测试中 db 生命周期问题
- 约 10-15 处替换
- **注意**：不能用模块级 `_stmt` 变量，测试中每个用例创建新 `:memory:` db，旧 statement 指向已关闭的 db

| 维度 | 方案 A | 方案 B |
|------|--------|--------|
| 性能收益 | 中 | 中高（覆盖热路径） |
| 实现复杂度 | 中 | 低 |
| 风险 | 低 | 中（简单缓存模式破坏测试） |

### 推荐：方案 B + WeakMap 模式
理由：收益集中在热路径。使用 WeakMap 避免测试破坏，实际需缓存 SQL 不超过 10 条。

---

## BI-C3: MetricsExtractor 完整 tokenize thinking 内容

### 当前实现

`getMetrics()` 对 `thinkingContentBuffer` 等缓冲区完整调用 `encode()`。thinking 内容可达数万字符，`encode()` 是 O(n) BPE。

### 方案 A: 使用已有 `countTokens()` 采样估算
- 替换 `encode(buffer).length` 为 `countTokens(buffer)`（复用已有采样外推逻辑）
- 改动：`metrics-extractor.ts`，3 行替换 + 1 行 import
- 收益：>4000 字符时提升 3-25 倍

### 方案 B: 流式增量计数
- 每个 delta 立即 encode 并累加
- 问题：BPE 跨片段合并导致不准确，不可行

### 推荐：方案 A
- 风险等级：**低**
- thinking TPS 是趋势分析指标，5% 采样误差可接受
- 影响的测试：`metrics-extractor.test.ts`（精确值断言可能改为范围断言）

---

## BI-H1: request_logs 索引覆盖不足

### 方案 A: 添加单列 + 复合索引
```sql
CREATE INDEX idx_request_logs_provider_id ON request_logs(provider_id);
CREATE INDEX idx_request_logs_created_at_provider ON request_logs(created_at DESC, provider_id);
CREATE INDEX idx_request_logs_created_at_router_key ON request_logs(created_at DESC, router_key_id);
```
- 改动：1 个 migration 文件
- 收益：10 万行查询从 500ms 降到 50ms

### 风险评估
- INSERT 略慢（每条多维护 2-3 个索引，微秒级）
- 磁盘空间增加约 10-30%
- 风险等级：**低**

---

## BI-H2: request_metrics 缺 router_key_id 索引

### 方案 A: 添加索引
```sql
CREATE INDEX idx_metrics_router_key ON request_metrics(router_key_id);
CREATE INDEX idx_metrics_created_at_router_key ON request_metrics(created_at, router_key_id);
```
- 收益：按密钥过滤的聚合查询提升 5-10 倍
- 风险等级：**低**

---

## BI-H3: log-file-writer 使用 appendFileSync 阻塞事件循环

### 方案 A: 批量缓冲 + 定时异步写入
- 内存缓冲 + 5s 定时 flush + `fs.appendFile`（异步）
- 复杂度：中

### 方案 B: Worker 线程写入
- 完全消除主线程阻塞
- 复杂度：高

### 方案 C: `fs.createWriteStream` 异步追加
- 为每个活跃文件维护 WriteStream，写入时 `stream.write()`
- 比方案 A 更简洁，Node 自带缓冲和背压
- 复杂度：低-中

| 维度 | 方案 A | 方案 B | 方案 C |
|------|--------|--------|--------|
| 性能收益 | 高 | 最高 | 高 |
| 复杂度 | 中 | 高 | 低-中 |
| 数据安全 | 缓冲期崩溃丢日志 | 同左 | 内核缓冲，风险小 |

### 推荐：方案 C（WriteStream）
- 风险等级：**中**
- 注意：进程优雅关闭时 `end()` 所有 stream；定期清理不活跃 stream
- 日志文件是辅助通道（已有 `try/catch` 静默失败），WriteStream 异步特性不会导致数据不一致

---

## BI-H4: SSE 广播频率过高

### 方案 A: 预序列化 + dirty flag + 条件推送
- `JSON.stringify` 只执行一次，所有客户端共享同一条消息
- dirty flag：`request_start/complete/update` 时标记，5s tick 只推送 dirty 事件
- 改动：`request-tracker.ts`，约 30 行
- 收益：Monitor 空转 CPU 降 50%+

### 风险评估
- 不改变推送内容，只改变推送频率和序列化策略
- dirty flag 可保守实现（宁可多推不遗漏）
- 风险等级：**低**

---

## BI-H5: estimateLogTableSize 全表扫描

### 方案 A: 采样估算（最近 100 行）
- `SELECT ... FROM request_logs ORDER BY created_at DESC LIMIT 100`，计算平均行大小 × 总行数
- 改动：`logs.ts`，约 15 行
- 收益：从 O(全表) 降到 O(100)

### 方案 B: 增量计数器
- INSERT/DELETE 时更新估算值
- 复杂度：中，需修改 3+ 个函数

### 推荐：方案 A
- 风险等级：**低**
- 用于"是否需要清理"的粗略判断，采样估算完全够用
- `CLEANUP_TARGET_RATIO = 0.8` 已有 20% 缓冲，可容忍 10% 采样误差

---

## BI-M1: Settings 表无内存缓存

### 方案 A: TTL 缓存 + setSetting 时失效
- `WeakMap<Database, Map<string, { value, expiresAt }>>` 缓存
- 30s TTL，`setSetting` 时 `cache.delete(key)`
- 改动：`settings.ts`，约 20 行

### 风险评估
- `setSetting` 主动清缓存保证写后读一致
- setup 流程写 `initialized=true` 后立即清缓存
- WeakMap 确保测试中 `:memory:` db 隔离
- 其他 settings 延迟 30s 生效可接受
- 风险等级：**低**

---

## BI-M2: MetricsExtractor 缓冲区无上限

### 方案 A: 数组收集 + join + 容量上限
- `thinkingChunks: string[]` + `thinkingTotalLength` 计数器
- `MAX_BUFFER_SIZE = 500_000` 字符上限
- 改动：`metrics-extractor.ts`，约 20 行
- 收益：O(n²) → O(n)，长请求内存降 50%+

### 风险评估
- 超出上限后 `thinkingTokens` 低估，但只用于 TPS 计算，可接受
- 500K 字符远超正常 thinking 内容（通常 < 50K）
- 风险等级：**低**

---

## BI-M3: getRequestLogsGrouped N+1 子查询

### 方案 B（推荐）: CTE 分页后 subquery
```sql
WITH page_ids AS (
  SELECT id FROM request_logs rl WHERE ${where}
  ORDER BY rl.created_at DESC LIMIT ? OFFSET ?
)
SELECT ..., COALESCE(child.cnt, 0) AS child_count
FROM page_ids
JOIN request_logs rl ON rl.id = page_ids.id
LEFT JOIN (
  SELECT original_request_id, COUNT(*) cnt
  FROM request_logs WHERE original_request_id IN (SELECT id FROM page_ids)
  GROUP BY original_request_id
) child ON child.original_request_id = rl.id
ORDER BY rl.created_at DESC
```
- 改动：`logs.ts` SQL 查询重写
- 收益：N+1 → 固定 2-3 次子查询
- 风险等级：**低**

---

## BI-M4: StatsAggregator 排序开销

### 推荐：不优化
理由：1000 元素 `Array.sort()` 在 V8 中约 50-100μs，每 5s 执行 1 次，总耗时 < 1ms。这不是瓶颈。

---

## BI-M5: Auth 拒绝请求写日志

### 方案 A: 移除认证失败 DB 日志
- 删除 `logRejectedAuth()` 及其 3 处调用
- 保留 `request.log.info()`（应用层日志）
- 改动：`auth.ts`，-20 行

### 方案 B: 限流日志写入（每分钟最多 100 条）

### 推荐：方案 A
理由：认证失败不是业务日志，属于安全审计范畴，应通过应用日志而非 DB 记录。保留在 DB 中是设计缺陷——攻击时反而成为 DoS 放大器。
- 风险等级：**低**
- 影响的测试：`auth.test.ts`（可能验证了 DB 中存在失败日志记录）

---

## 实施优先级

| 优先级 | 编号 | 推荐 | 预估改动 | 风险 |
|--------|------|------|---------|------|
| P0 | BI-C1 | 方案 A：全套 PRAGMA | +6 行 | 低 |
| P0 | BI-C3 | 方案 A：countTokens() | ~4 行 | 低 |
| P0 | BI-M5 | 方案 A：移除失败日志 | -20 行 | 低 |
| P1 | BI-H1 | 方案 A：复合索引 | 1 migration | 低 |
| P1 | BI-H2 | 方案 A：router_key_id 索引 | 1 migration | 低 |
| P1 | BI-M1 | 方案 A：TTL 缓存 | ~20 行 | 低 |
| P1 | BI-M2 | 方案 A：数组 + 容量上限 | ~20 行 | 低 |
| P1 | BI-H5 | 方案 A：采样估算 | ~15 行 | 低 |
| P2 | BI-C2 | 方案 B+WeakMap | ~50 行 | 中 |
| P2 | BI-H3 | 方案 C：WriteStream | ~40 行 | 中 |
| P2 | BI-H4 | 方案 A：预序列化+dirty | ~30 行 | 低 |
| P2 | BI-M3 | 方案 B：CTE 分页 | ~15 行 | 低 |
