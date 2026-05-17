# Spec 评审 v2

## 评审记录
- 评审时间：2026-05-15 20:30
- 评审类型：Spec 独立评审（第二轮）
- 评审对象：spec.md（v2）
- 评审轮次：第 2 轮

## v1 MUST FIX 修复状态

| # | v1 问题描述 | 状态 | 验证 |
|---|------------|------|------|
| 1 | 文件路径缺少 `router/` 前缀 | RESOLVED | 所有路径已加 `router/` 前缀（如 `router/src/config/model-context.ts`），覆盖已有基础设施表、数据消费者检查表、代码块注释 |
| 2 | `post_route` 是死路径 | PARTIALLY RESOLVED | spec 新增了 Step 1（新增 emit 调用点），承认当前 `post_route` 未被 emit。但 Step 1 的 emit 位置描述有误——见下方新 MUST FIX #1 |
| 3 | Responses API type 值错误（`image_url` → `input_image`） | RESOLVED | 检测逻辑表格中 Responses API 正确使用 `"input_image"`，并加了注释说明与 OpenAI `"image_url"` 的区别。AC16 也正确引用 `"input_image"` |
| 4 | StageRecord 缺少 `image-redirect` 变体 | RESOLVED | §4 明确列出 `StageRecord` 扩展代码块，包含完整的 `"image-redirect"` 变体定义（6 个字段） |
| 5 | MODEL_CAPABILITIES 完整模型列表未给出 | RESOLVED | §1 给出完整白名单（45 个模型），按供应商分组，注释清晰 |
| 6 | 决策表缺少"是否可推翻"列 | RESOLVED | 决策表已有"可推翻？"列，5 个决策均标注（4 个"否/是"，含理由） |

### 六要素覆盖矩阵

| 要素 | 覆盖状态 | 说明 |
|------|---------|------|
| Outcomes | ✅ | 终态明确：请求含图片 + 模型不支持 + 配置了 fallback → 自动切换 |
| Scope boundaries | ✅ | In-scope 10 项 + Out-of-scope 4 项，边界清晰 |
| Constraints | ✅ | 性能 O(n)、兼容性（可选字段/默认值）、幂等性、无阻塞 |
| Decisions made | ✅ | 5 个决策均有理由 + 可推翻标注 |
| Verification | ✅ | 17 条 AC（AC1-AC17），15 条自动化测试 + 2 条手动验证，无模糊词 |
| 已有基础设施 | ✅ | 10 个复用组件表 + 3 张数据消费者检查表（capabilities / image_fallback / StageRecord） |

### 自包含性问题

**问题 1（新 MUST FIX）：`post_route` emit 位置描述与代码架构不一致**

spec §3 Step 1 声称 emit 应加在 `router/src/proxy/handler/create-proxy-handler.ts` 中"路由解析完成后、failover loop 之前"。但代码库验证显示：

- `resolveMapping()` 在 `failover-loop.ts` 内部调用（line 230），不在 `create-proxy-handler.ts` 中
- `create-proxy-handler.ts` 中 failover loop 之前（line 263-288），`ctx.resolved` 仍为 `null`
- failover loop 内使用局部变量 `resolved`（`let resolved = resolveResult.target`），从未赋值给 `ctx.resolved`
- `overflow-redirect` hook（`router/src/proxy/hooks/builtin/overflow-redirect.ts`）依赖 `ctx.resolved` 非 null 才能执行

如果 Phase 2 agent 按 spec 在 `create-proxy-handler.ts` 的 failover loop 之前添加 `emit("post_route", ctx)`，则：
1. `ctx.resolved` 为 `null` → image-redirect hook 检查 `resolved` 为 null 时直接 return → 永远不切换
2. overflow-redirect hook 同理为 no-op

正确位置应在 `failover-loop.ts` 内部，`resolveMapping` 之后、overflow 之后（约 line 297），且需先将局部 `resolved` 赋值给 `ctx.resolved`、`provider` 赋值给 `ctx.provider`。

### 发现的问题

| # | 优先级 | 维度 | 位置 | 描述 | 修改建议 |
|---|--------|------|------|------|---------|
| 1 | MUST FIX | 自包含性 | §3 Step 1 | `post_route` emit 位置描述错误。spec 说放在 `create-proxy-handler.ts` "failover loop 之前"，但此时 `ctx.resolved` 为 `null`（resolveMapping 在 failover-loop.ts 内部调用）。image-redirect hook 检测到 `ctx.resolved === null` 会直接 return，永远不触发 | 修正 Step 1：emit 应在 `router/src/proxy/handler/failover-loop.ts` 内部，`resolveMapping` + overflow 之后、plugin adjustments 之前（约 line 297）。且 emit 前需将局部 `resolved` 赋值给 `ctx.resolved`，局部 `provider` 赋值给 `ctx.provider`，使 hook 能通过 ctx 访问当前路由结果 |
| 2 | LOW | 自包含性 | §3 Step 2 | image-redirect hook 的 `execute()` 需要读取 `mapping_groups.rule` 中的 `image_fallback` 配置，但 spec 未说明 hook 如何获取当前 mapping group 的 rule 数据。hook 的 `ctx` 接口（`PipelineContext`）中没有 mapping group 信息 | 说明 image_fallback 数据如何传递到 hook：是通过 `ctx.metadata` 传递（需在 failover-loop 中设置），还是 hook 自己查询 DB（需传入 client_model 反查 mapping group）？ |
| 3 | LOW | 自包含性 | §1 | `ModelInfo` 的 `capabilities` 字段说明为"同步扩展"，但 `buildModelInfoList()` 的函数签名（参数/返回值）未写明。Phase 2 agent 需要知道返回的 `ModelInfo[]` 中 `capabilities` 从何而来 | 补充说明 `buildModelInfoList()` 如何传递 `capabilities`（直接透传 `parseModels()` 的结果） |

> 优先级定义：
> - **MUST FIX**：不修复则评审不通过，会阻塞流程
> - **LOW**：建议修复，但不阻塞

### 歧义标记检查

无未解决的 `[AMBIGUOUS]` 标记。无隐含歧义。

### 类型签名抽查结果

| 抽查项 | spec 描述 | 代码库实际 | 一致？ |
|--------|----------|-----------|--------|
| `ModelEntry`（`router/src/config/model-context.ts:8`） | `{ name, context_window?, patches?, stream_timeout_ms?, capabilities? }` | `{ name, context_window?, patches?, stream_timeout_ms? }`（capabilities 为新增） | ✅ 新增字段标注正确 |
| `ModelInfo`（`router/src/config/model-context.ts:1`） | `{ name, context_window, patches, stream_timeout_ms?, capabilities? }` | `{ name, context_window, patches, stream_timeout_ms? }`（capabilities 为新增） | ✅ 新增字段标注正确 |
| `StageRecord`（`router/src/proxy/pipeline-snapshot.ts:1`） | 新增 `"image-redirect"` 变体 | 当前 5 个变体，无 image-redirect | ✅ spec 明确要求扩展 |
| `PipelineContext.resolved`（`router/src/proxy/pipeline/types.ts:67`） | hook 中检查 `resolved` 是否 null | `resolved: Target \| null` | ✅ |
| `validateRule()`（`router/src/admin/groups.ts:54`） | spec 要求扩展验证 `image_fallback` | 当前只验证 `targets[]`（line 54-90） | ✅ spec 正确描述需扩展 |

## 结论

需修改后重审

## Summary

Spec 评审完成，第 2 轮，1 条 MUST FIX（`post_route` emit 位置架构错误），需重审。v1 的 6 条 MUST FIX 中 5 条已完全修复，1 条（#2 post_route 死路径）部分修复但 emit 位置描述仍有误。核心问题：spec 指示在 `create-proxy-handler.ts` failover loop 前添加 emit，但此时 `ctx.resolved` 为 `null`，hook 无法工作。emit 必须在 `failover-loop.ts` 内部 resolveMapping 之后。
