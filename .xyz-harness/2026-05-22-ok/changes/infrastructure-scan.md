# Infrastructure Scan — Pipeline + Extension 架构深化

## 1. 项目结构

```
router/src/
├── cli.ts              # npm bin 入口
├── index.ts            # 库入口，buildApp() 组装插件
├── config/             # 配置单例 + 模型元数据白名单
├── core/               # DI 容器、并发控制、监控、循环检测
│   ├── container.ts    # ServiceContainer (11 个 SERVICE_KEYS)
│   ├── types.ts        # Target, TransportResult, MappingReason
│   ├── errors.ts       # ProviderSwitchNeeded, SemaphoreQueueFullError
│   ├── monitor/        # RequestTracker, StatsAggregator, RuntimeCollector
│   ├── concurrency/    # Semaphore, AdaptiveController
│   └── loop-prevention/ # ToolLoopGuard, NgramDetector, StreamLoopGuard
├── db/                 # better-sqlite3 直接 SQL (14 文件)
├── middleware/          # auth.ts, admin-auth.ts
├── proxy/
│   ├── handler/        # create-proxy-handler.ts, failover-loop.ts
│   ├── pipeline/       # pipeline.ts, context.ts, types.ts, hook-registry.ts, register-hooks.ts
│   ├── hooks/builtin/  # 15 个内置 hook (enhancement, route-resolve, format-transform, transport-execute 等)
│   ├── orchestration/  # orchestrator.ts, resilience.ts, scope.ts, retry-rules.ts
│   ├── format/         # registry.ts, types.ts, adapters/ (3), converters/ (6 透传文件)
│   ├── transform/      # 29 文件: request/response 转换 + 6 个 stream transform + types
│   ├── routing/        # mapping-resolver, overflow, modality-redirect, enhancement-config
│   ├── transport/      # http.ts, stream.ts, transport-fn.ts, proxy-agent.ts
│   └── patch/          # deepseek patches, tool-round-limiter
├── admin/              # 22 文件: CRUD 路由 + routes.ts 注册
├── routing/            # cache-estimator (顶层)
├── storage/            # log-file-writer, log-file-compressor
├── utils/              # crypto, password, token-counter, datetime
└── upgrade/            # checker, deployment, version
```

## 2. 关键接口和类型

| 接口 | 文件 | 核心字段 |
|------|------|---------|
| PipelineContext | proxy/pipeline/types.ts | request, reply, body, resolved, provider, metadata: Map<string, unknown> |
| PipelineHook | proxy/pipeline/types.ts | name, phase, priority, core?, execute(ctx) |
| HookPhase | proxy/pipeline/types.ts | pre_route, post_route, pre_transport, post_response, on_error, on_stream_event |
| PipelineDeps (拟新增) | — | db, container, matcher, tracker, adapter, orchestrator, ... |
| FormatAdapter | proxy/format/types.ts | apiType, defaultPath, errorMeta, beforeSendProxy?, formatError() |
| FormatConverter | proxy/format/types.ts | sourceType, targetType, transformRequest/Response, createStreamTransform |
| ResilienceResult | proxy/orchestration/resilience.ts | result, attempts, finalDecision |
| Target | core/types.ts | provider_id, backend_model, overflow_model?, overflow_provider_id? |
| ServiceContainer | core/container.ts | register(key, factory), resolve<T>(key) |

## 3. metadata 依赖清单

### 设置点: failover-loop.ts (20+ entry)

| 键 | 类型 | 消费者 hooks |
|----|------|-------------|
| db | Database | route-resolve, api-key-decrypt, enhancement-preprocess, cache-estimation, request-logging, error-logging, overflow-redirect, client-detection |
| container | ServiceContainer | format-transform, transport-execute, plugin-request, enhancement-preprocess, request-logging, usage-record |
| cachedTargets | Target[] | route-resolve, transport-execute |
| excludeTargets | Target[] | route-resolve |
| resolveResult | ResolveResult | (间接使用) |
| precomputeSnapshot | PipelineSnapshot | (间接使用) |
| decryptedApiKeys | Map<string, string> | api-key-decrypt |
| enhancementConfig | EnhancementConfig | transport-execute |
| adapter | FormatAdapter | transport-execute |
| orchestrator | ProxyOrchestrator | transport-execute |
| matcher | RetryRuleMatcher | transport-execute, request-logging, error-logging |
| tracker | RequestTracker | transport-execute |
| defaultUpstreamPath | string | format-transform |
| clientHeaders | RawHeaders | transport-execute |
| precomputedClientReq | string | transport-execute |
| retryBaseDelayMs | number | transport-execute |
| concurrencyOverride | ConcurrencyOverride | transport-execute |
| logFileWriter | LogFileWriter | request-logging, error-logging |
| errors | ProxyErrorFormatter | allowed-models |
| usageWindowTracker | UsageWindowTracker | usage-record |
| startTime | number | request-logging, error-logging (迭代级) |
| isFailoverIteration | boolean | (间接使用, 迭代级) |
| effectiveMappingReason | MappingReason | request-logging, error-logging, transport-execute (迭代级) |
| lastFailoverTrigger | string | request-logging (迭代级) |
| pendingToolErrors | FailedToolResult[] | request-logging, error-logging |

### 设置点: hooks/builtin/ (hook 间通信)

| 写入 hook | 键 | 读取 hooks |
|-----------|---|-----------|
| client-detection | client_type, session_id | request-logging, error-logging, cache-estimation, enhancement-preprocess |
| api-key-decrypt | apiKey | transport-execute |
| format-transform | needsTransform | transport-execute |
| cache-estimation | cache_read_tokens_estimated, cache_read_tokens | collectTransportMetrics (via request-logging) |

## 4. Pipeline 执行流

```
createProxyHandler(formatAdapter) → handleProxyRequest()
  → failover-loop.ts executeFailoverLoop()
    → L1 预计算: resolveMapping → modalityRedirect → overflow → allowedModels
    → 注入 20+ metadata entries
    → while(true) {
        proxyPipeline.emit("pre_route", ctx)    — enhancement, client-detection
        proxyPipeline.emit("post_route", ctx)   — route-resolve, allowed-models, overflow
        proxyPipeline.emit("pre_transport", ctx) — format-transform, api-key-decrypt, provider-patches, plugin-request, transport-execute
        proxyPipeline.emit("post_response", ctx) — stream-timeout, usage-record, cache-estimation, request-logging
        // catch: ProviderSwitchNeeded → exclude + continue
        // catch: PipelineAbort → reply + return
        // catch: SemaphoreQueueFullError/Timeout → reject + return
      }
```

## 5. 已有 ADR

| 编号 | 标题 | 与本次相关 |
|------|------|-----------|
| 0005 | Pipeline Hook + FormatAdapter | 核心：hook 架构设计 |
| 0006 | 函数式数据管线 | 相关：body 不可变 |
| 0011 | 核心步骤作为 Pipeline Hook | 核心：hook 抽取策略 |

## 6. 控制流问题

- ProviderSwitchNeeded: 从 resilience.ts throw → 穿透 orchestrator.ts → 穿透 transport-execute hook → failover-loop.ts catch
- failover-loop L291: 额外的 `if (failed)` 返回值检查（与 ProviderSwitchNeeded 并行）

## 7. Admin 层统计

| 文件 | 行数 | CRUD 骨架占比 |
|------|------|-------------|
| providers.ts | 502 | ~40% |
| retry-rules.ts | 456 | ~45% |
| groups.ts | 189 | ~35% |
| router-keys.ts | 114 | ~30% |
| schedules.ts | 264 | ~35% |
| constants.ts | 12 | 100% (纯透传) |
