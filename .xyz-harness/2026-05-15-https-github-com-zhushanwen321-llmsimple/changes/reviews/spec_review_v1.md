# Spec 评审 v1

## 评审记录
- 评审时间：2026-05-15 19:30
- 评审类型：Spec 独立评审
- 评审对象：spec.md
- 评审轮次：第 1 轮

### 六要素覆盖矩阵

| 要素 | 覆盖状态 | 说明 |
|------|---------|------|
| Outcomes | ✅ | 终态清晰：请求含图片时不支持图片的模型自动切换到 fallback 模型 |
| Scope boundaries | ✅ | In-scope 和 out-of-scope 均有明确列表，out-of-scope 包含 5 个明确排除项 |
| Constraints | ✅ | 性能（O(n)）、兼容性（capabilities 可选/默认 text）、幂等性、无阻塞 |
| Decisions made | ⚠️ | 5 个决策有理由，但缺少"是否可推翻"列；D3 的 `MODEL_CAPABILITIES` 常量表未覆盖 `recommended-providers.json` 中全部模型（实际有 70+ 模型，spec 示例仅 5 个） |
| Verification | ✅ | 14 条 AC，11 条可自动化测试，3 条手动验证，无模糊词 |
| 已有基础设施 | ⚠️ | 列出了关键复用组件，但文件路径全部缺少 `router/` 前缀（项目是 monorepo），且引用了死代码路径（见下文） |

### 自包含性问题

**问题 1：文件路径缺少 monorepo 前缀**

spec 中所有路径省略了 `router/` 前缀。Phase 2 agent 按路径定位文件时会找不到。例如：
- spec 写 `src/config/model-context.ts` → 实际为 `router/src/config/model-context.ts`
- spec 写 `src/proxy/pipeline/types.ts` → 实际为 `router/src/proxy/pipeline/types.ts`
- 这影响了"已有基础设施"表中所有 8 行路径

**问题 2：`post_route` pipeline 阶段是死路径**

spec 声称新 Hook 应挂载到 `post_route` 阶段（priority 120，紧跟 overflow-redirect 的 100），并引用 `overflow-redirect.ts` 作为参考模式。但代码库验证显示：
- `proxyPipeline.emit("post_route", ctx)` **从未被调用**（`create-proxy-handler.ts` 只 emit 了 `pre_route`）
- `overflowRedirectHook` 虽然注册到 pipeline 且 phase 为 `post_route`，但从不会被执行
- 实际的 overflow 逻辑在 `failover-loop.ts:275` 内联执行（直接调用 `applyOverflowRedirect()`），不经过 pipeline

如果 Phase 2 agent 按 spec 实现为 `post_route` hook，图片检测逻辑将永远不会被触发。这是**致命的实现路径错误**。

### 发现的问题

| # | 优先级 | 维度 | 位置 | 描述 | 修改建议 |
|---|--------|------|------|------|---------|
| 1 | MUST FIX | 自包含性 | §已有基础设施 | 文件路径全部缺少 `router/` 前缀。本项目是 monorepo，源码在 `router/` 下。Phase 2 agent 无法按路径定位文件 | 所有路径加 `router/` 前缀，如 `router/src/config/model-context.ts` |
| 2 | MUST FIX | 自包含性 | §3 图片检测 Hook | 新 Hook 挂载到 `post_route` 阶段是**死路径**。`proxyPipeline.emit("post_route", ctx)` 从未被调用（只有 `pre_route` 被调用）。overflow-redirect hook 同样是死代码（实际 overflow 逻辑在 `failover-loop.ts:275` 内联执行）。按此方案实现的 Hook 永远不会执行 | 必须重新决定实现位置：要么在 `failover-loop.ts` 中内联添加图片检测逻辑（紧接 overflow 之后），要么先实现 `post_route` emit 调用点，再挂载 hook。两种方案都需要 spec 明确说明 |
| 3 | MUST FIX | 类型签名 | §3 检测逻辑 | Responses API 检测路径描述错误。spec 写"检查 `type === "image_url"`"，但实际类型定义中：`ResponseInputContentPart.type` 是 `"input_image"`（非 `"image_url"`），顶层 `ResponseInputImage.type` 也是 `"input_image"` | 修正为 `type === "input_image"`，并补充检测 `input[]` 中 `type === "input_image"` 的顶层项（不仅是 message.content 内部） |
| 4 | MUST FIX | 类型签名 | §4 日志记录 | `ctx.snapshot.add()` 使用 `{ stage: "image-redirect", ... }` 结构，但 `StageRecord` union type（`router/src/proxy/pipeline-snapshot.ts`）中没有 `"image-redirect"` 变体，只有 `"tool_round_limit" | "tool_guard" | "routing" | "overflow" | "provider_patch"`。按此签名编码会导致 TypeScript 编译错误 | spec 需明确要求扩展 `StageRecord` union type，新增 `{ stage: "image-redirect"; triggered: boolean; original_model: string; redirect_to: string; redirect_provider: string; reason: string }` 变体 |
| 5 | MUST FIX | 自包含性 | §1 模型能力标记 | `MODEL_CAPABILITIES` 常量的完整模型列表未在 spec 中给出（只列了 5 个示例）。`recommended-providers.json` 中实际有 70+ 模型。Phase 2 agent 无法确定哪些模型支持图片 | 给出完整的 `MODEL_CAPABILITIES` 表，或明确说明"初始版本只标记已知支持图片的模型，其余默认 `["text"]`"并列出完整的图片支持模型清单 |
| 6 | MUST FIX | 六要素 | §已做决策 | 决策表缺少"是否可推翻"列（CLAUDE.md 验收标准要求）。所有 5 个决策均未标注 | 每个决策添加"可推翻/不可推翻"标注 |
| 7 | LOW | 自包含性 | §2 Fallback 配置 | `image_fallback` 需要的 DB schema 变更未说明。`mapping_groups.rule` 是 JSON 文本字段，不需要 migration，但 `admin/groups.ts` 的 `validateRule()` 函数（`router/src/admin/groups.ts:50-80`）只验证 `targets` 数组，不认识 `image_fallback` 字段。需要说明是否需要扩展验证逻辑 | 说明 `validateRule()` 是否需要验证 `image_fallback` 的 provider_id 和 backend_model 合法性 |
| 8 | LOW | 数据消费者 | §数据消费者检查 | `StageRecord` 类型的 `pipeline-snapshot.ts` 消费点未在数据消费者检查中列出。新增 `"image-redirect"` stage 变体后，所有消费 `StageRecord` 的代码（日志写入、前端展示、SSE 监控推送）都需要确认兼容 | 在数据消费者检查表中补充 `StageRecord` / `PipelineSnapshot` 的消费点 |
| 9 | LOW | 验收标准 | §验收标准 | 缺少 `image_fallback` 配置的 validation 测试场景：配置了不存在的 provider_id 时应该怎样？AC7 只测了"非 active"但没测"不存在" | 考虑增加 AC：`image_fallback` 的 provider_id 在 DB 中不存在时，不切换 |
| 10 | LOW | 自包含性 | §1 模型能力标记 | `ModelEntry` 接口的 `capabilities` 字段声明放在 spec 的代码块中，但未说明是否需要同步更新 `buildModelInfoList()` 返回的 `ModelInfo` 接口（`ModelInfo` 目前没有 capabilities 字段），也未说明 Admin API 返回模型列表时是否需要包含 capabilities | 明确 `ModelInfo` 是否需要扩展 capabilities 字段，以及 Admin API 的返回格式 |

> 优先级定义：
> - **MUST FIX**：不修复则评审不通过，会阻塞流程
> - **LOW**：建议修复，但不阻塞
> - **INFO**：观察记录，无需操作

### 歧义标记检查

无未解决的 `[AMBIGUOUS]` 标记。

发现 1 处隐含歧义：
- `MODEL_CAPABILITIES` 表的覆盖范围未明确：是只标记确定支持图片的模型（白名单），还是需要覆盖 `recommended-providers.json` 中所有模型？如果只标白名单，未列出的默认 `["text"]`，那么这个表可以很短。但 spec 示例暗示需要覆盖所有模型，这与"不在表中的默认纯文本"语义矛盾。

### 类型签名抽查结果

| 抽查项 | spec 描述 | 代码库实际 | 一致？ |
|--------|----------|-----------|--------|
| `ModelEntry` 接口 | `{ name, context_window?, patches?, stream_timeout_ms?, capabilities? }` | `{ name, context_window?, patches?, stream_timeout_ms? }`（无 capabilities） | ⚠️ capabilities 是新增字段，spec 正确标注为新增 |
| `StageRecord` union | 未提及扩展 | 5 个变体，无 `"image-redirect"` | ❌ spec 的 snapshot.add() 调用不匹配 |
| Responses API `image_url` 检测 | `type === "image_url"` | `ResponseInputContentPart.type: "input_image" | "input_text" | "input_file"` | ❌ 字段值错误 |
| `PipelineContext.resolved` 类型 | `Target` | `Target \| null`（可空） | ✅ spec 在检测逻辑中检查了 `resolved` 存在 |
| `overflow-redirect` hook 执行 | 引用为参考模式 | 注册到 `post_route` 但该 phase 从未被 emit | ❌ 死代码路径 |

### 结论

需修改后重审

### Summary

Spec 评审完成，第1轮，6条MUST FIX，需重审。

MUST FIX 汇总：
1. 文件路径缺少 `router/` monorepo 前缀
2. `post_route` pipeline 阶段是死路径（从未 emit），新 Hook 按此实现将不会执行
3. Responses API 图片检测路径的 `type` 值写错（`"image_url"` → 应为 `"input_image"`）
4. `ctx.snapshot.add()` 的 `"image-redirect"` stage 不在 `StageRecord` union type 中，编译不通过
5. `MODEL_CAPABILITIES` 完整模型列表未给出
6. 决策表缺少"是否可推翻"列
