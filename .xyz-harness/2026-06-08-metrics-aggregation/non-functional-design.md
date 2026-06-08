---
verdict: pass
---

# Non-Functional Design — Metrics Aggregation

## 1. 稳定性

双写 UPSERT 与 insertMetrics 在同一同步调用链中。SQLite WAL 模式保证 UPSERT 原子性。如果聚合表写入失败（如磁盘满），catch 后静默跳过——聚合表是辅助查询通道，写入失败不影响主请求流程。查询路由通过 try-catch 降级：聚合表查询失败时 fallback 到明细表全表扫描（性能退化但不报错）。

## 2. 数据一致性

聚合表通过 UPSERT 保证同一桶行的原子累加，无并发冲突（SQLite 单写）。清理逻辑先删明细、聚合永久保留，不存在数据断层。跨分界线 UNION 查询使用严格的时间边界（`< detail_cutoff` 和 `>= detail_cutoff`），杜绝重叠。

## 3. 性能

聚合表 30 天约 8K 行（对比明细表 150K 行），查询扫描量降低 10-20 倍。活动图 API 从 metrics_10min 读 30 天 × 1440 桶/天 = 43K 行，但只需 `request_count` 一列，走覆盖索引，预期 < 50ms。双写增加每次 insertMetrics 的开销约 0.1ms（一次 UPSERT），对请求延迟无感知。

## 4. 业务安全

不涉及。聚合数据是 token 用量统计，不含用户隐私或密钥信息。Settings 端点复用现有 JWT 认证中间件。

## 5. 数据安全

不涉及新的敏感数据处理。metrics_detail_days 配置存储在 settings 表，与现有 log_retention_days 同等保护。
