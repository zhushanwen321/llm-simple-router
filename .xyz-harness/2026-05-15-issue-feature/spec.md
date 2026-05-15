# Spec: 映射原因追踪 (Mapping Reason Tracking)

## 目标

在请求详情左侧面板的 model@provider 行下方展示映射原因标签，让用户一眼看出当前请求的模型映射是通过哪个路径解析的，解决同时配置多种映射机制时无法区分触发原因的问题。

## 已做决策

| 决策项 | 选择 | 理由 | 是否可推翻 |
|--------|------|------|-----------|
| 存储位置 | 复用 `pipeline_snapshot` JSON 列的 routing stage，不新增 DB 列 | routing stage 已包含 `client_model`/`backend_model`/`provider_id`/`strategy`，新增 `mapping_reason` 字段是自然扩展；避免 migration | 否（已确认 routing stage 结构） |
| API 传递方式 | 不新增 API 返回字段，前端从已有的 `pipeline_snapshot` 字段解析 | 日志详情 API 已返回 `pipeline_snapshot` 完整 JSON；新增字段会破坏 API 兼容性 | 否（前端解析即可满足） |
| overflow 展示策略 | **后端覆写**：overflow 触发时，failover-loop.ts 将 `mappingReason` 覆写为 `overflow_redirect` 写入 ActiveRequest；pipeline_snapshot 保留双 stage（routing 原始原因 + overflow 触发状态） | 前端无需组合判断逻辑，ActiveRequest.mappingReason 始终是最终原因；pipeline_snapshot 保留原始信息供深度排查 | 可推翻（改为前端推断，但增加前端复杂度） |
| failover_retry 赋值位置 | **failover-loop.ts 后置覆写**：不在 `resolveMapping()` 内部返回 `failover_retry`，而是在 failover loop 的第 2+ 次迭代时由 failover-loop.ts 将 `mappingReason` 覆写为 `failover_retry` | `resolveMapping()` 不感知 failover 语义（它只做映射解析）；failover 是 loop 层的概念 | 否（职责分离清晰） |
| 类型定义位置 | 新增 `MappingReason` union type 在 `router/src/core/types.ts`，与 `ResolveResult` 同文件 | `MappingReason` 被 `resolveMapping()`、`failover-loop.ts`、`ActiveRequest`、前端转换器共同引用，应放在共享类型文件 | 可推翻（可改为 `routing/mapping-resolver.ts` 局部类型） |

## 范围

### In Scope

1. `resolveMapping()` 返回结果携带 `mappingReason` 字段（4 种值：direct_format / group_base_rule / group_schedule / fallback_provider）
2. failover-loop.ts 后置覆写 `mappingReason`（overflow_redirect / failover_retry）
3. `PipelineSnapshot` routing stage record 新增 `mapping_reason` 字段
4. `ActiveRequest`（后端 `router/src/core/monitor/types.ts`）新增 `mappingReason` 字段
5. `RequestTracker` 在 mapping 解析完成后回填 mappingReason 并通过 SSE 推送
6. 前端 `UnifiedRequestOverview` 新增 `mappingReason` 字段
7. `fromLogEntry()` 新增 `pipeline_snapshot` 解析逻辑；`fromActiveRequest()` 新增 `mappingReason` 字段映射
8. `RequestOverviewPanel.vue` 展示映射原因 Badge

### Out of Scope

1. 不新增 DB 列（复用 `pipeline_snapshot` JSON 字段）
2. 不修改请求日志主表格列（只在详情页展示）
3. 不修改 Admin API 接口签名（`pipeline_snapshot` 已返回）
4. `enhancement_directive` 和 `session_persistence` 模块已移除，不在本次范围内

## 类型定义位置

| 类型 | 文件路径 | 当前关键字段 | 计划变更 |
|------|---------|-------------|---------|
| `MappingReason` | `router/src/core/types.ts` | 不存在（新增） | 新增 union type：`"direct_format" \| "group_base_rule" \| "group_schedule" \| "fallback_provider" \| "overflow_redirect" \| "failover_retry"` |
| `ResolveResult` | `router/src/core/types.ts` | `{ target, concurrency_override?, targetCount, allTargets? }` | 新增 `mappingReason: MappingReason` |
| `StageRecord` (routing) | `router/src/proxy/pipeline-snapshot.ts` | `{ stage: "routing"; client_model; backend_model; provider_id; strategy }` | 新增 `mapping_reason: MappingReason` |
| `ActiveRequest` (后端) | `router/src/core/monitor/types.ts` | 无 `mappingReason` | 新增 `mappingReason?: MappingReason` |
| `ActiveRequest` (前端) | `frontend/src/types/monitor.ts` | 无 `mappingReason` | 新增 `mappingReason?: MappingReason` |
| `UnifiedRequestOverview` | `frontend/src/components/request-detail/types.ts` | 无 `mappingReason` | 新增 `mappingReason?: string` |
| `LogEntry`（前端） | `frontend/src/components/logs/types.ts` | 无 `pipeline_snapshot` 字段 | 新增 `pipeline_snapshot?: string \| null`（后端 `SELECT rl.*` 已返回该列，前端类型未声明） |

## 映射原因分类

| 值 | 中文标签 | 赋值位置 | 含义 |
|----|---------|---------|------|
| `direct_format` | 直接指定 | `resolveMapping()` | 请求中使用 `provider/model` 格式 |
| `group_base_rule` | 基础规则 | `resolveMapping()` | 映射组基础规则命中（无分时段覆盖） |
| `group_schedule` | 分时段规则 | `resolveMapping()` | 映射组分时段规则命中 |
| `fallback_provider` | Provider 匹配 | `resolveMapping()` | 无映射组，回退到 provider 模型列表匹配 |
| `overflow_redirect` | 溢出重定向 | `failover-loop.ts` 后置覆写 | 上下文超出模型限制 |
| `failover_retry` | Failover 重试 | `failover-loop.ts` 后置覆写 | 前次目标失败，尝试下一个目标 |

### 赋值链路

```
resolveMapping()  → mappingReason ∈ { direct_format, group_base_rule, group_schedule, fallback_provider }
      ↓
failover-loop.ts:
  1. let currentReason = resolveResult.mappingReason
  2. if (excludeTargets.length > 0) currentReason = "failover_retry"
  3. if (overflowResult) currentReason = "overflow_redirect"
  4. iterationSnapshot.add({ stage: "routing", ..., mapping_reason: currentReason })  ← 扩展现有 add() 调用
  5. activeRequest.mappingReason = currentReason  ← 在已有 activeRequest 对象上赋值
      ↓
request_logs.pipeline_snapshot (JSON)  ← insertRequestLog() 自动序列化 snapshot
```

> **overflow 双记录策略**：pipeline_snapshot 同时保留 routing stage（含原始 `mapping_reason`，如 `group_schedule`）和 overflow stage（`triggered: true`）。ActiveRequest.mappingReason 始终反映最终原因（overflow 触发时为 `overflow_redirect`）。

## 数据流

```
resolveMapping()
  → ResolveResult { ..., mappingReason: "group_schedule" | "group_base_rule" | ... }
  ↓
failover-loop.ts
  → 后置覆写: failover_retry / overflow_redirect
  → PipelineSnapshot routing stage { ..., mapping_reason }
  → PipelineSnapshot overflow stage { triggered: true, ... }  // 如触发（原始原因保留在 routing stage）
  ↓
request_logs.pipeline_snapshot  (已有列, JSON 字符串)
  ↓
前端 fromLogEntry()
  → JSON.parse(pipeline_snapshot) → 找 routing stage → 取 mapping_reason
  → 检查 overflow stage.triggered → 如为 true，用 "overflow_redirect" 覆盖
  ↓
前端 fromActiveRequest()
  → 直接取 ActiveRequest.mappingReason（后端已完成覆写）
  ↓
RequestOverviewPanel.vue → model @ provider 行下方 → 映射原因 Badge
```

## 数据消费者检查清单

| 消费者 | 文件路径 | 变更说明 |
|--------|---------|---------|
| DB 写入 | `router/src/db/logs.ts` `insertRequestLog()` | 无变更：`pipeline_snapshot` 列已存在，routing stage 新增 `mapping_reason` 字段后自动 JSON 序列化 |
| SSE — ActiveRequest 定义 | `router/src/core/monitor/types.ts` | 新增 `mappingReason?: MappingReason` 字段到 `ActiveRequest` interface |
| SSE — RequestTracker 赋值 | `router/src/monitor/request-tracker.ts` | mapping 解析完成后，设置 `activeRequest.mappingReason = ctx.mappingReason`。注意：`request_update` 事件的 strip 逻辑（`broadcastActiveRequests()`）当前移除 `clientRequest`/`upstreamRequest`/`streamContent`/`streamMetrics`，**不会 strip `mappingReason`**（它是标量字段，非大字段） |
| SSE — 事件携带 | 同上 | `request_start` 事件发出时 mapping 可能尚未完成，`mappingReason` 为 undefined。`request_update`（每 5s）和 `request_complete` 会携带已填充的值 |
| Admin API | `router/src/admin/logs.ts` 日志详情 API | 无变更：已返回 `pipeline_snapshot` 完整 JSON |
| 前端 — LogEntry 类型 | `frontend/src/components/logs/types.ts` | 新增 `pipeline_snapshot?: string \| null` 字段（后端已返回该列，前端类型缺失无法读取） |
| 前端转换器 — fromLogEntry | `frontend/src/components/request-detail/types.ts` | 新增 `parseMappingReason(snapshot: string \| null): string \| undefined` 工具函数。防御性解析：JSON.parse 失败或无 routing stage 时返回 undefined |
| 前端转换器 — fromActiveRequest | 同上 | 直接读取 `activeRequest.mappingReason`，无则 undefined |
| 前端展示 | `frontend/src/components/request-detail/RequestOverviewPanel.vue` | `mappingReason` 存在时在 model@provider 行下方渲染 Badge，不存在时不渲染（v-if） |
| 前端 i18n | `frontend/src/locales/` | 新增 `requestDetail.mappingReason.*` 6 个翻译键 |

## 约束

1. 映射原因存储在已有的 `pipeline_snapshot` 列（routing stage record 新增 `mapping_reason` 字段），不新增数据库列
2. 前端解析 `pipeline_snapshot` 提取映射原因，不新增 API 返回字段
3. 历史日志（`pipeline_snapshot` 中无 `mapping_reason` 字段）优雅降级：不显示映射原因标签，不报错
4. 映射原因使用英文枚举值存储，前端通过 i18n 映射为中文标签

## 行为约束

### Always
- `resolveMapping()` 必须在所有返回路径（direct format / mapping group / fallback scan）中填充 `mappingReason`。当 `resolveMapping()` 整体返回 `null`（无映射）时，`ResolveResult` 不存在，`mappingReason` 不适用，由调用方处理拒绝逻辑
- failover-loop.ts 在 overflow 触发时必须将 `mappingReason` 覆写为 `overflow_redirect`，在第 2+ 次迭代时覆写为 `failover_retry`
- pipeline_snapshot 同时保留 routing stage（原始原因）和 overflow stage（触发状态）
- `fromLogEntry()` 解析 `pipeline_snapshot` 时必须防御性处理：JSON.parse 失败、无 routing stage、无 `mapping_reason` 字段均返回 undefined
- 前端对缺失 `mappingReason` 的历史数据必须优雅降级（不渲染 Badge，不报错）

### Ask First
无（当前无需要人工确认的映射原因场景）

### Never
- 不在 `mappingReason` 缺失时显示错误状态或占位符
- 不将映射原因硬编码为中文（存储用英文枚举，展示用 i18n）
- 不在 `resolveMapping()` 内部返回 `failover_retry` 或 `overflow_redirect`（这两个值由 failover-loop.ts 后置覆写）

## 已有基础设施

1. **`PipelineSnapshot`**（`router/src/proxy/pipeline-snapshot.ts`）已有 routing stage（含 `client_model`, `backend_model`, `provider_id`, `strategy`）和 overflow stage（含 `triggered`, `redirect_to`, `redirect_provider`）
2. **`request_logs.pipeline_snapshot`** 列已存储 JSON 字符串
3. **`UnifiedRequestDialog.vue`** 已有共享详情弹窗，Logs 和 Monitor 页面共用
4. **`RequestOverviewPanel.vue`** 已有 model@provider 展示行
5. **`ActiveRequest`**（`router/src/core/monitor/types.ts`）SSE 数据结构已推送实时请求信息
6. **i18n** 已有完整的 `requestDetail.*` 翻译命名空间
7. **`ResolveResult`**（`router/src/core/types.ts`）已有 `target`, `concurrency_override`, `targetCount`, `allTargets` 字段

## 验收标准

AC1: 使用 `provider/model` 直接格式请求时，请求详情显示「直接指定」原因 Badge
AC2: 映射组基础规则命中时，显示「基础规则」Badge
AC3: 映射组分时段规则命中时，显示「分时段规则」Badge
AC4: 无映射组、回退 provider 匹配时，显示「Provider 匹配」Badge
AC5: 溢出重定向触发时，显示「溢出重定向」Badge（后端覆写 mappingReason，ActiveRequest 和 pipeline_snapshot overflow stage 均标记）
AC6: Failover 重试（第 2+ 次迭代）时，显示「Failover 重试」Badge
AC7: Logs 页面和 Monitor 页面打开同一请求详情，映射原因一致
AC8: 历史日志（`pipeline_snapshot` 中无 `mapping_reason`）不显示映射原因标签，无控制台报错
AC9: 映射原因写入 `pipeline_snapshot` 的 routing stage record，可通过 `SELECT pipeline_snapshot FROM request_logs WHERE id = ?` 验证

### AC 覆盖矩阵

| AC | 后端 resolveMapping | 后端 failover-loop 覆写 | 后端 pipeline_snapshot | SSE ActiveRequest | 前端 fromLogEntry | 前端 fromActiveRequest | 前端展示 |
|----|--------------------|-----------------------|-----------------------|-------------------|-------------------|----------------------|---------|
| AC1 | direct_format | — | routing.mapping_reason | mappingReason | 解析 routing stage | 直接读取 | Badge |
| AC2 | group_base_rule | — | routing.mapping_reason | mappingReason | 解析 routing stage | 直接读取 | Badge |
| AC3 | group_schedule | — | routing.mapping_reason | mappingReason | 解析 routing stage | 直接读取 | Badge |
| AC4 | fallback_provider | — | routing.mapping_reason | mappingReason | 解析 routing stage | 直接读取 | Badge |
| AC5 | 原始值（如 group_schedule） | 覆写为 overflow_redirect | overflow.triggered=true | mappingReason | 检查 overflow stage | 直接读取 | Badge |
| AC6 | 原始值 | 覆写为 failover_retry | routing.mapping_reason | mappingReason | 解析 routing stage | 直接读取 | Badge |
| AC7 | — | — | — | 一致性 | 两个转换器结果一致 | 两个转换器结果一致 | 两个页面 |
| AC8 | — | — | — | — | null 安全返回 undefined | null 安全 | v-if 不渲染 |
| AC9 | — | — | SQL 查询验证 | — | — | — | — |
