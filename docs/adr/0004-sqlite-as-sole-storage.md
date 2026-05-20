# ADR 0004: SQLite 作为唯一存储引擎

系统使用 SQLite（better-sqlite3）作为唯一持久化存储，承载配置、日志、指标、会话状态等全部数据。不使用 Postgres、Redis 或外部存储。核心依据是项目定位——单机部署的轻量代理路由器，目标用户是开发者个人或小团队本地运行。SQLite 零运维、单文件、嵌入进程内，完美匹配这个场景。

## Considered Options

1. **Postgres + Redis**：支持多实例部署、高并发写入、丰富查询。但引入运维复杂度，与"开箱即用"的目标冲突。
2. **SQLite + Redis 混合**：SQLite 存配置和日志，Redis 做实时状态（并发队列、活跃请求）。两套存储一致性难以保证，且 Redis 对目标用户群体仍是额外依赖。
3. **选定方案**：纯 SQLite。用 WAL 模式提升并发读，内存缓存（ModelStateManager、RetryRuleMatcher）弥补查询性能。单文件 `router.db` 方便备份和迁移。

## Consequences

- 不支持多实例水平扩展。所有状态在一台机器上，无法做负载均衡。
- 写入并发受 SQLite 单写锁限制。请求日志写入高峰期可能成为瓶颈，需要批量写入或异步队列缓解。
- 数据库迁移通过编号 SQL 文件执行（`src/db/migrations/*.sql`），新增表或列只需追加文件。
- 测试中通过 `:memory:` 内存库实现完全隔离，无需 mock 数据库层。
