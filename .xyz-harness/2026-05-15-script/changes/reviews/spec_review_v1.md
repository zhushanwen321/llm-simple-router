# Spec 评审 v1

## 评审记录
- 评审时间：2026-05-15
- 评审类型：Spec 独立评审
- 评审对象：`.xyz-harness/2026-05-15-script/spec.md`
- 评审轮次：第 1 轮

### 六要素覆盖矩阵

| 要素 | 覆盖状态 | 说明 |
|------|---------|------|
| Outcomes | ✅ | 目标清晰：请求含图片但模型不支持时自动切换到 fallback 模型 |
| Scope boundaries | ✅ | In-scope 和 Out-of-scope 均明确列出，out-of-scope 包含音频/视频检测、session 粘性、自动能力获取等 |
| Constraints | ✅ | 性能(O(n))、兼容性(capabilities 可选)、幂等性、无阻塞(hook 失败降级)均有说明 |
| Decisions made | ✅ | 5 项决策表格完整，每项有理由和可推翻标记 |
| Verification | ✅ | 17 条验收标准，覆盖正向/边界/异常路径，全部可写单元测试验证 |
| 已有基础设施 | ✅ | 11 个组件列出位置和复用方式，数据消费者检查表覆盖 capabilities、image_fallback、StageRecord 三个维度 |

### 自包含性问题

**问题 1（MUST FIX）：post_route emit 后的数据回流缺失**

spec §方案-3 "图片检测实现位置" Step 1 描述在 `failover-loop.ts` 中 overflow 之后新增 `post_route` emit：

> emit 前需将局部变量赋值到 ctx：
> ```typescript
> ctx.resolved = resolved;
> ctx.provider = provider as unknown as ProviderInfo;
> ```

但 spec **未描述 emit 返回后需要从 ctx 读回局部变量**。

经验证 `router/src/proxy/handler/failover-loop.ts`，failover 循环内部全程使用**局部变量** `let resolved`（line 246）、`let provider`（line 258）、`let currentBody`（line 208），而非 `ctx.resolved`/`ctx.provider`/`ctx.body`。这些局部变量在 emit 之后仍被以下代码使用：

- line 289: `resolveUpstreamPath(...)` 使用 `resolved`、`provider`、`currentBody`
- line 303: routing snapshot 使用 `resolved`
- line 308: plugin adjustments 使用 `currentBody`、`provider`
- line 305: `parseModels(provider.models)` 使用 `provider`

如果 image-redirect hook 修改了 `ctx.resolved` 和 `ctx.body.model`，但不读回到局部变量，这些修改**不会影响实际请求流程**——后续所有代码仍使用旧的局部变量值。

**修改建议**：spec 应明确描述 emit 后的读回操作，例如：

```typescript
// emit 前：local → ctx
ctx.resolved = resolved;
ctx.provider = provider as unknown as ProviderInfo;
ctx.body = currentBody;

// emit
await proxyPipeline.emit("post_route", ctx);

// emit 后：ctx → local（hook 可能已修改）
resolved = ctx.resolved!;
provider = ctx.provider as unknown as typeof provider;
currentBody = { ...currentBody, model: (ctx.body as Record<string, unknown>).model as string };
```

### 发现的问题

| # | 优先级 | 维度 | 位置 | 描述 | 修改建议 |
|---|--------|------|------|------|---------|
| 1 | **MUST FIX** | 自包含性 | §方案-3 Step 1 | post_route emit 后缺少从 ctx 读回局部变量的描述。failover-loop.ts 使用局部变量 `resolved`/`provider`/`currentBody` 贯穿整个迭代，hook 对 ctx 的修改不会自动反映到局部变量 | 补充 emit 后的读回步骤：`resolved = ctx.resolved!`、`provider = ctx.provider as ...`、`currentBody.model = ctx.body.model`。明确写出代码或伪代码 |
| 2 | **MUST FIX** | 引用完整性 | §已有基础设施 — 数据消费者检查 | `router/src/monitor/request-tracker.ts` 路径错误，实际路径为 `router/src/core/monitor/request-tracker.ts` | 修正为正确路径 |
| 3 | LOW | 歧义标记 | §方案-3 Step 1 | "约 line 298" 行号不准确。overflow 内联代码在 line 278，格式转换在 line 289。spec 说 emit 在 "resolveMapping + overflow 之后、plugin adjustments 之前"，但未说明是在格式转换之前还是之后 | 明确 emit 插入位置应在 overflow 之后、格式转换（`resolveUpstreamPath`）之前，因为 image-redirect 会改变 model，格式转换依赖正确的 model |
| 4 | LOW | 自包含性 | §方案-2 | `image_fallback` 在 `mapping_groups.rule` JSON 中的位置（与 `targets` 同级）已描述，但未说明 rule 的 TypeScript 类型定义在哪里。`Target` 接口（`router/src/core/types.ts:17`）有 `overflow_provider_id`/`overflow_model`，但 rule 层面没有类型定义（rule 是 JSON 字符串） | 标注 rule 是 JSON 字符串（无类型定义），或建议新增 `ImageFallback` 接口 |
| 5 | LOW | 验收标准 | §验收标准 AC11/AC12 | AC11（Provider 前端编辑 capabilities）和 AC12（映射组前端配置 image_fallback）标注"手动验证"，但项目 CLAUDE.md 要求每个 AC 可写自动化测试 | 至少补充前端组件测试方案，或标注为"前端测试框架未就绪，本轮手动验证" |

### 歧义标记检查

- 未发现 [AMBIGUOUS] 标记
- 未发现明显的隐含歧义需要用户确认

### 引用完整性检查

| 引用路径 | 实际存在 | 说明 |
|----------|---------|------|
| `router/src/config/model-context.ts` | ✅ | ModelEntry、ModelInfo、parseModels、buildModelInfoList、MODEL_CONTEXT_WINDOWS |
| `router/src/proxy/pipeline/types.ts` | ✅ | PipelineHook、PipelineContext、HookPhase |
| `router/src/proxy/pipeline/register-hooks.ts` | ✅ | ALL_HOOKS、registerBuiltinHooks |
| `router/src/proxy/hooks/builtin/overflow-redirect.ts` | ✅ | overflow-redirect hook（phase: post_route, priority: 100） |
| `router/src/proxy/handler/failover-loop.ts` | ✅ | failover 循环主体 |
| `router/src/proxy/pipeline-snapshot.ts` | ✅ | StageRecord union type |
| `router/src/admin/groups.ts` | ✅ | validateRule |
| `router/src/admin/providers.ts` | ✅ | Provider CRUD |
| `frontend/src/views/Providers.vue` | ✅ | Provider 管理页面 |
| `frontend/src/views/ModelMappings.vue` | ✅ | 映射组管理页面 |
| `router/src/proxy/log-helpers.ts` | ✅ | 日志写入 |
| `router/src/monitor/request-tracker.ts` | ❌ | 实际路径为 `router/src/core/monitor/request-tracker.ts` |
| `router/src/admin/logs.ts` | ✅ | Admin 日志查询 |
| `router/src/proxy/transform/types-responses.ts` | ✅ | Responses API 类型（含 ResponseInputImage） |
| `router/src/proxy/handler/create-proxy-handler.ts` | ✅ | pre_route emit 调用点 |

### 类型签名正确性抽查

| 抽查项 | spec 描述 | 代码库实际 | 一致性 |
|--------|---------|-----------|--------|
| `ModelEntry` 接口字段 | `name, context_window?, patches?, stream_timeout_ms?, capabilities?` | `name, context_window?, patches?, stream_timeout_ms?`（无 capabilities，需新增） | ✅ spec 描述为新增，正确 |
| `StageRecord` union type | 现有 5 个变体 + 新增 `image-redirect` | 代码中确实有 5 个变体（tool_round_limit, tool_guard, routing, overflow, provider_patch） | ✅ |
| `overflowRedirectHook` phase/priority | phase: post_route, priority: 100 | 代码中 phase: "post_route", priority: 100 | ✅ |
| `PipelineContext.resolved` 类型 | `Target \| null` | 代码中 `resolved: Target \| null`（可变字段） | ✅ |
| `ResponseInputImage.type` | `"input_image"` | 代码中 `type: "input_image"` | ✅ |

### 数据消费者检查

spec 的数据消费者检查分三个表（capabilities、image_fallback、StageRecord），覆盖了后端 API、前端、日志、SSE 监控。核查结果：

| 数据字段 | 消费者覆盖 | 遗漏 |
|----------|-----------|------|
| `capabilities` | parseModels, buildModelInfoList, image-redirect hook, Provider API GET/PUT, Provider 前端 | 无遗漏 |
| `image_fallback` | image-redirect hook, 映射组 API GET/PUT, 映射组前端 | 无遗漏 |
| StageRecord `image-redirect` | log-helpers, request-tracker(SSE), Admin logs API | 无遗漏 |

### 结论

需修改后重审

### Summary

Spec 评审完成，第1轮，2条 MUST FIX，需重审。

主要阻塞问题：post_route emit 后缺少从 ctx 读回局部变量的关键步骤，这会导致 image-redirect hook 的修改不会影响实际请求流程。此外有一个文件路径错误需修正。
