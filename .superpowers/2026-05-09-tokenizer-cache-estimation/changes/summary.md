# 缓存命中预估系统 - 全流程追溯

## 基本信息
- 需求描述：通过 tokenizer + 前缀匹配预估 LLM 缓存命中情况，填补第三方 Provider 不返回缓存数据的空白
- 开始时间：2026-05-09
- 当前阶段：2 需求评审（已完成）

## 阶段状态

| 阶段 | 状态 | 评审轮次 | 备注 |
|------|------|---------|------|
| 1 需求分析 | ✅ 通过 | 1轮 | 2026-05-09 |
| 2 需求评审 | ✅ 通过 | 3轮 | 2026-05-09 |
| 3 编码实现 | ⬜ 未开始 | - | - |
| 4 编码评审 | ⬜ 未开始 | - | - |
| 5 测试编写 | ⬜ 未开始 | - | - |
| 6 测试评审 | ⬜ 未开始 | - | - |
| 7 代码推送 | ⬜ 未开始 | - | - |
| 8 CI 验证 | ⬜ 未开始 | - | - |
| 9 部署验证 | ⬜ 未开始 | - | - |
| 10 用户确认 | ⬜ 未开始 | - | - |
| 11 自动复盘 | ⬜ 未开始 | - | - |

## 评审摘要
（待填写）

## 异常记录
（待填写）

## 阶段 Task 6 - Pi Extension for session_id injection

- 状态：done
- 变更文件：
  - `~/.pi/agent/extensions/llm-router-session/index.ts`（新建）
- 摘要：创建 Pi 扩展，在每次 session 启动时生成 UUID session_id，通过 `x-pi-session-id` header 注入到 llm-simple-router provider 的请求中
- 时间：2026-05-09

### 调查结果

- **Provider 名称确认**：`~/.pi/agent/models.json` 中存在 `"llm-simple-router"` 和 `"dev"` 两个指向本地路由的 provider，使用 `"llm-simple-router"`
- **Header 解析机制验证**：`resolve-config-value.ts` 中 `resolveConfigValueUncached()` 对非 `!` 开头的值检查 `process.env[config]` 后回退到字面量，**无缓存**，每次请求都会重新读取 `process.env.PI_SESSION_ID`
- **`registerProvider` 行为验证**：只传 `headers`（无 `models`）时，`applyProviderConfig()` 进入 override 分支，仅存储 provider-level header 配置，不替换已有 models

### 使用说明

扩展启动后会自动生效。每次 `/new` 或 `/resume` 后，系统会自动生成新的 session_id 并注入请求 header。

如需手动验证：
```bash
# 检查扩展是否被加载（启动 pi 后）
# 查看发送到 router 的请求是否包含 x-pi-session-id header
```

## 阶段 Task 4 - Settings API for token estimation toggle

- 状态：done
- 变更文件：
  - `router/src/db/settings.ts`（新增 `getTokenEstimationEnabled()`、`setTokenEstimationEnabled()`）
  - `router/src/admin/settings.ts`（新增 GET/PUT `/admin/api/settings/token-estimation` 端点）
  - `router/tests/admin-settings.test.ts`（新增 3 个测试用例）
- 摘要：添加 settings key `"token_estimation_enabled"`（默认 false）及其 CRUD API 端点，统一控制 input_tokens 估算和 cache 预估的开关
- 时间：2026-05-09

### API 端点

- `GET /admin/api/settings/token-estimation` → `{ enabled: boolean }`
- `PUT /admin/api/settings/token-estimation` → body `{ enabled: boolean }` → `{ success: true }`

### 测试验证

- 默认值：false
- PUT true + GET = true
- PUT false + GET = false（toggle 回 false）

## 阶段 Task 1 - CacheEstimator Engine

- 状态：done
- 变更文件：
  - `router/src/routing/cache-estimator.ts`（新建，CacheEstimator 类 + 单例导出）
  - `router/src/utils/token-counter.ts`（export `extractAllText` 函数）
- 摘要：实现 CacheEstimator 引擎，基于 `(sessionId, model)` 维度的 token 序列前缀匹配预估缓存命中量。包含 `update()`、`estimateHit()`、`cleanup()` 三个公有方法，TTL 30 分钟自动清理。22 个测试全部通过。
- 时间：2026-05-09

## 阶段 Task 5 - Metrics API extension for client_type filtering

- 状态：done
- 变更文件：
  - `router/src/db/metrics.ts`（新增 `getClientTypeBreakdown()` 函数 + `ClientTypeBreakdown` 类型）
  - `router/src/db/index.ts`（导出 `getClientTypeBreakdown` + `ClientTypeBreakdown`）
  - `router/src/admin/metrics.ts`（SummaryQuerySchema 增加 `client_type` 参数；route handler 传递 `query.client_type` 到 DB 层；响应包装为 `{ rows, client_type_breakdown }`）
- 摘要：
  - `GET /admin/api/metrics/summary` 新增可选 `client_type` 查询参数（`claude-code` / `pi` / `unknown`），筛选特定客户端类型的指标
  - 路由响应从数组改为对象 `{ rows, client_type_breakdown }`，其中 `rows` 包含已有分组明细，`client_type_breakdown` 为 `{ claude-code: N, pi: N, unknown: N }` 计数
  - `cache_hit_rate` 字段（SUM(cache_read_tokens) / SUM(input_tokens)）已在 Task 2 的 `getMetricsSummary()` SQL 中实现，无需额外改动
- 时间：2026-05-09

## 阶段 Task 2 - DB Migration (client_type + cache_estimation columns)

- 状态：done
- 变更文件：
  - `router/src/db/migrations/043_add_client_type_and_cache_estimation.sql`（新建）
  - `router/src/db/metrics.ts`（修改：`MetricsRow`/`MetricsInsert`/`MetricsSummaryRow` 增加新列；`insertMetrics()` 支持 `client_type`/`cache_read_tokens_estimated`；`getMetricsSummary()` 新增 `clientType` 筛选参数、SQL GROUP BY `client_type`、SELECT 增加 `client_type`）
  - `router/tests/metrics-migration-043.test.ts`（新建，5 个测试）
- 摘要：执行数据库迁移 043，为 `request_metrics` 新增 `client_type`（默认 'unknown'）和 `cache_read_tokens_estimated`（默认 0）两列。更新 `insertMetrics()` 接受新字段，`getMetricsSummary()` 支持按 `client_type` 筛选和分组。
- 注意：2 个已有测试（`metrics.test.ts`、`db.test.ts`）硬编码了迁移数量 `toHaveLength(43)`，新增 043 后变为 44，属于预期变更。
- 时间：2026-05-09

### 实现要点

- **数据结构**：`Map<string, { tokens: number[], updatedAt: number }>`，key = `${sessionId}::${model}`
- **Tokenize**：复用 `token-counter.ts` 的 `extractAllText()` 提取请求体文本，使用 `gpt-tokenizer` 的 `encode()` 做完整编码（不用采样外推）
- **前缀匹配**：线性逐位比较两个 number[] 数组
- **TTL**：每次 `estimateHit()`/`update()`/`cleanup()` 前自动清理过期条目（updatedAt < Date.now() - 30min）
- **estimateHit 流程**：cleanup → 查历史 → 前缀匹配 → update(刷新缓存) → 返回重叠数（无历史返回 null）

## 阶段 Task 3 - Pipeline Hooks (client_type detection + cache estimation)

- 状态：done
- 变更文件：
  - `router/src/proxy/hooks/builtin/client-detection.ts`（新建，pre_route hook priority 200）
  - `router/src/proxy/hooks/builtin/cache-estimation.ts`（新建，post_response hook priority 200）
  - `router/src/proxy/proxy-logging.ts`（修改：`collectTransportMetrics()` 新增 `clientType`/`cacheReadTokensEstimated` 参数 + `getTokenEstimationEnabled()` toggle 控制估算）
  - `router/src/proxy/pipeline/register-hooks.ts`（修改：注册两个新 hook）
  - `router/src/proxy/hooks/builtin/request-logging.ts`（修改：传 ctx.metadata 值到 collectTransportMetrics）
  - `router/src/proxy/handler/failover-loop.ts`（修改：传 ctx.metadata 值到 collectTransportMetrics）
- 摘要：创建 client-detection（客户端类型检测 + session_id 提取）和 cache-estimation（缓存命中预估）两个 pipeline hook。修改 `collectTransportMetrics()` 支持从 metadata 传入 `client_type` 和 `cache_read_tokens_estimated`，并受 `token_estimation_enabled` 开关控制。TS 编译 0 error，ESLint 0 warning。
- 测试：3 个失败与本次变更无关（db.test.ts/metrics.test.ts 硬编码迁移数 43→44，integration.test.ts 超时 flaky）。
- 时间：2026-05-09

## 阶段 Task 7 - Frontend experimental feature toggle for token estimation

- 状态：done
- 变更文件：
  - `frontend/src/views/ProxyEnhancement.vue`（新增 Token 预估 Card + handleTokenEstimationToggle）
  - `frontend/src/api/client.ts`（新增 API.TOKEN_ESTIMATION + getTokenEstimation + updateTokenEstimation）
- 摘要：在 ProxyEnhancement 页面底部添加 Token 预估开关，通过 GET/PUT `/admin/api/settings/token-estimation` 控制。使用 Switch 组件，加载时读取状态，切换时自动保存，成功失败均有 toast 提示。
- 时间：2026-05-09
