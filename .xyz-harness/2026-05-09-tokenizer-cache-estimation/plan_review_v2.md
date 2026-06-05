# 需求评审报告 v2（第二轮）

**评审类型**：计划评审（spec.md + plan.md）  
**评审日期**：2026-05-09  
**上一轮 v1 结论**：4 MUST FIX → 全部已修复

---

## 上一轮修复验证

| # | v1 问题 | v2 状态 |
|---|---------|---------|
| 1 | plan.md T3 依赖缺少 T4 | **已修复** — T3 依赖明确列出 T1, T2, T4；并行策略图标注"需先有 T4" |
| 2 | T3 post_response 钩子 API 返回缓存数据时未更新 Map | **已修复** — 伪代码中 `cache_read_tokens > 0` 分支调用 `cacheEstimator.update()` |
| 3 | spec.md 缺少验收标准 | **已修复** — 新增验收标准 AC1-AC10 |
| 4 | 未明确一个开关统一控制 | **已修复** — spec 架构决策和 plan T4 多处明确说明统一控制 |

---

## 本轮新发现问题

### MUST FIX 1：T3/T4 职责冲突 — `collectTransportMetrics()` 修改归属不清

**位置**：
- plan.md T3 描述
- plan.md T4 "说明" 段落

**问题**：两个任务均声称要修改 `collectTransportMetrics()` 中 `estimateInputTokens()` 的调用逻辑：

T3 说：
> 同时需要修改 `collectTransportMetrics()` 中已有的 `estimateInputTokens()` 逻辑：
> - 开关 OFF → 不再调用 `estimateInputTokens()`，`input_tokens_estimated` 保持 0
> - 开关 ON → 行为不变

T4 说：
> 需要同时修改 `collectTransportMetrics()` 中已有的 `estimateInputTokens()` 调用逻辑，使其受此开关控制（开关 OFF 时不再调用）。

这是同一项修改，但被两个任务重复声明。执行时会导致职责不明，可能重复实现或遗漏边界条件。

**修改建议**：
- **T4**：只负责创建 settings key（`token_estimation_enabled`）+ API 端点（GET/PUT `/admin/api/settings/token-estimation`）。在 T4 末尾加一句接口约定："T3 通过读取 `token_estimation_enabled` 设置项来控制 `collectTransportMetrics()` 和 cache 预估行为。"
- **T3**：作为此行为修改的唯一 owner，在 T3 描述中保留 `collectTransportMetrics()` 修改逻辑，删除 T4 中重复的修改描述。

---

### MUST FIX 2：plan.md 未说明 toggle 值如何传入 `collectTransportMetrics()` 和 post_response 钩子

**位置**：plan.md T3

**问题**：plan 说明了"做什么"（toggle 控制两个估算），但未说明"怎么做"（toggle 值如何流入目标函数）。具体而言：

1. `collectTransportMetrics()` 当前签名（`proxy-logging.ts:150`）：
   ```typescript
   export function collectTransportMetrics(
     db, apiType, result, isStream, lastSuccessLogId,
     providerId, backendModel, request, routerKeyId, statusCode
   )
   ```
   没有 toggle 参数。plan 未说明如何让它感知开关状态。

2. post_response 钩子伪代码直接引用 `settings.cacheEstimationEnabled`，未说明 `settings` 对象来源。

**上下文**：现有 hooks 通过 `ctx.metadata.get("db")` 获取 DB 实例（如 `enhancement-preprocess.ts`），然后调用 `loadEnhancementConfig(db)` 读取配置。本项目 hook 的标准模式已经建立。

**修改建议**：在 T3 中明确数据流：
- post_response 钩子：从 `ctx.metadata.get("db")` 获取 DB，调用 `getSetting(db, "token_estimation_enabled")` 读取开关
- `collectTransportMetrics()`：新增 `tokenEstimationEnabled: boolean` 参数。调用方（`failover-loop.ts`、`request-logging.ts`）在读 DB 后传入。或者指出备选方案：让 `collectTransportMetrics()` 直接从 `db` 参数读取 setting（不推荐，会增加函数对 settings 表 schema 的耦合）

---

### MUST FIX 3：T3 Pipeline 钩子文件路径不符合现有项目结构

**位置**：plan.md T3 "新建文件"

**问题**：plan 指定新文件为 `router/src/proxy/pipeline/hooks/cache-estimation.ts`。但：

- 项目现有 hooks 均在 `router/src/proxy/hooks/builtin/` 下（共 7 个 hook 文件）
- 现有注册入口 `router/src/proxy/pipeline/register-hooks.ts` 从 `../hooks/builtin/` 导入
- `pipeline/hooks/` 子目录不存在

将新 hook 放在 `pipeline/hooks/` 下会破坏项目统一的目录约定。

**修改建议**：
- 文件路径改为 `router/src/proxy/hooks/builtin/cache-estimation.ts`
- 同时 plan 应补充说明：在 `register-hooks.ts` 中注册此 hook（遵循 `enhancementPreprocessHook` 等现有 hook 的注册模式）

---

### LOW 1：AC6 精度不足 — 缺少场景假设说明

**位置**：spec.md 验收标准 AC6

**AC6 原文**：
> 同一 session+model 连续两次请求 | 第二次请求的预估 cache_read_tokens 等于第一次请求的 input token 数（完全前缀匹配）

**问题**：此预期仅在标准多轮对话场景下成立（每轮请求的 `messages` 数组以追加方式包含上一轮全部消息）。如果第二轮请求的 system prompt 变更、添加新的 function definitions 或消息顺序不同，前缀匹配结果可能不完整。

**修改建议**：在 AC6 描述前加场景限定：
> **在标准多轮对话场景下**（每轮请求的 `messages` 数组包含上一轮全部消息），同一 session+model 连续两次请求 | 第二次请求的预估 cache_read_tokens 等于第一次请求的 input token 数（完全前缀匹配）

---

### LOW 2：spec 执行流程图仅覆盖 cache 路径，缺少 input_tokens 门控逻辑

**位置**：spec.md "详细执行流程"

**问题**：当前流程图展示的是 cache 预估的完整路径，但 input_tokens 估算（`estimateInputTokens()`）同样受统一开关控制，流程图中未体现这一点。可能导致开发者只关注 cache 路径而忽略 input_tokens 门控的修改。

**修改建议**：在执行流程图中增加 `collectTransportMetrics()` 内部逻辑的简要说明：
```
collectTransportMetrics()
  ├─ 检查：全局开关 ON？
  │   ├─ 否 → 跳过 input_tokens 估算（input_tokens_estimated = 0）
  │   └─ 是 → API 未返回 input_tokens？
  │       ├─ 是 → estimateInputTokens() + input_tokens_estimated = 1
  │       └─ 否 → 使用 API 值
  └─ (cache 预估流程由 post_response 钩子处理，同上)
```

---

## 评审结论

**结论**：需修改后重审（3 MUST FIX）

本轮发现 3 个 MUST FIX 和 2 个 LOW 问题。3 个 MUST FIX 均为 plan.md 的实现细节缺失：
- MUST FIX 1/2 属于接口和数据流约定不清晰（T3/T4 接口边界、toggle 传递方式）
- MUST FIX 3 属于文件命名不符合项目约定

上述问题不涉及 spec 层面的设计缺陷，均为 plan 的执行可操作性补充。修复后应能通过第三轮评审。

---

## v1 → v2 变更总结

| 方面 | v1 | v2 |
|------|----|----|
| 依赖完整性 | T3 缺 T4 依赖 | 依赖链路完整 |
| 验收标准 | 缺失 | AC1-AC10 完整 |
| API 缓存处理 | 缺少 Map 更新分支 | 伪代码覆盖 |
| 开关语义 | 不明确 | 统一控制明确 |
| 实现细节 | — | 3 个新问题（数据流、路径） |
