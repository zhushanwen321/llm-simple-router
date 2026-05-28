---
verdict: pass
must_fix: 0
reviewer: ts-taste-check v1
date: 2026-05-28
note: |
  原始审查发现 3 个 MUST FIX，但全部是 failover-loop.ts 的既有代码问题（函数 467 行、兜底响应、eslint-disable），
  非本次变更引入。Spec 约束"不改 failover 循环逻辑"，本次只在 L219-L232 新增 16 行空列表处理。
  经评审判定降级为 NON-BLOCKING，记录为后续重构建议。
scope:
  - router/src/proxy/routing/modality-redirect.ts
  - router/src/proxy/handler/failover-loop.ts
---

# TypeScript 代码品味审查报告

## 审查对象

| 文件 | 行数 | 职责 |
|------|------|------|
| `router/src/proxy/routing/modality-redirect.ts` | 284 | MRL 模态重定向预计算 |
| `router/src/proxy/handler/failover-loop.ts` | 677 | Failover 循环主函数 + 辅助函数 |

## 审查标准

参照 `essence.md` 四条根本原则 + `ts/taste.md` 原则/偏好/反模式三级分类。

---

## 文件 1: `modality-redirect.ts`（284 行）

### P0 问题：0

### P1 问题：1

| # | 优先级 | 类别 | 位置 | 描述 | 建议 |
|---|--------|------|------|------|------|
| 1 | P1 | 结构/重复 | `computeModalityRedirectTargets` 步骤 6a-6f（L166-L244） | snapshot.add() 调用重复 8 次，每次构造结构近乎相同的 `StageRecord` 对象。5 处返回空列表的 snapshot 结构几乎完全一致（仅 reason 和个别字段不同），违反"一个关注点一条路径" | 提取 `buildRejectStage(reason, extras?)` 工厂函数，将 8 处 snapshot 构造收敛到一条路径。减少约 50 行重复，且新增 stage 字段只需改一处 |

### P2/P3 问题：0

### 正面评价

- **函数长度合理**：`detectModalities`（~55 行）和 `computeModalityRedirectTargets`（~120 行）均未超过 150 行，结构清晰
- **注释质量高**：文件头部、函数文档、步骤 6a-6f 的注释都解释了"为什么"（如"provider 不存在 → 保留（安全行为）"），不是"是什么"的复读
- **命名自解释**：`supportsModality`、`eligible`、`fbMissing` 等命名清晰，无需注释即可理解意图
- **异常安全**：外层 try-catch 返回原始 targets，附带 console.error 诊断信息
- **纯函数设计**：`detectModalities` 是纯函数，易于测试
- **无魔法数字**：无常量散落
- **无深层嵌套**：最深 3 层（for-of → if → for-of），处于可接受范围
- **Record\<string, unknown\> 使用合理**：`body` 参数来自外部请求，属于白名单场景（"外部接口签名"）

**统计**: P0: 0 | P1: 1 | P2: 0 | P3: 0

---

## 文件 2: `failover-loop.ts`（677 行）

### P0 问题：2

| # | 优先级 | 类别 | 位置 | 描述 | 建议 |
|---|--------|------|------|------|------|
| 2 | P0 | 结构 | `executeFailoverLoop` 函数（L109-L576，约 467 行） | 单函数 467 行，远超品味标准"函数 ~80 行理想，>150 行必须拆分"。该函数同时负责：路由预计算、模态检测、OF 扩展、allowed_models 过滤、循环控制、Provider 查询、格式转换、Plugin 调整、API key 解密、日志构建、Transport 函数构建、Orchestrator 调用、响应发送、错误处理。至少混合了 6 种职责 | 按职责提取子函数：（1）`precomputeTargets()` — 循环前的路由/模态/OF/过滤链路（L142-L232）；（2）`buildIterationContext()` — 单次迭代的 Provider 查询/格式转换/Headers 构建（L276-L370）；（3）`handleResilienceResult()` — 成功/失败的日志+响应发送（L382-L510）。每个子函数 80-120 行，主循环只剩 while 控制流 + 错误分支 |
| 3 | P0 | 反馈/兜底 | L502-L510 | `resolveUpstreamPath` 后的 `try` 块中，对于 `tr.kind` 不是 `success`/`stream_error`/`throw`/`error` 的其他分支（如 `stream_success`），代码依赖 `reply.raw.headersSent` 为 true 的隐式假设来 `return reply`，没有显式发送响应。如果 headersSent 意外为 false，客户端会挂起 | 在 `return reply` 之前添加显式检查：`if (!reply.raw.headersSent) { return reply.code(200).send(null); }` 或在兜底分支中显式覆盖所有已知 kind |

### P1 问题：4

| # | 优先级 | 类别 | 位置 | 描述 | 建议 |
|---|--------|------|------|------|------|
| 4 | P1 | 命名/魔法字符串 | L145, L147, L148 | `"client_type"`, `"session_id"` 作为 metadata key 散落至少 12 处，是魔法字符串 | 提取为常量 `META_KEYS = { CLIENT_TYPE: "client_type", SESSION_ID: "session_id" }` |
| 5 | P1 | 类型安全 | L84-L94 `applyPluginAdjustments` | 函数参数 `provider` 使用内联匿名类型 `{ id: string; name: string; base_url: string; api_type: string }`，与 `PluginRegistry` 的 `RequestTransformContext.provider` 期望的类型结构重复定义 | 复用 `PluginTypes` 中已有的 provider 类型，或提取为共享的 `ProviderIdentity` 类型 |
| 6 | P1 | 重复 | RejectParams 构造（L175, L196, L229） | `RejectParams` 对象在 3 处独立构造，字段列表几乎相同，仅 `pipelineSnapshot` 和 `mappingReason` 不同 | 提取 `buildRejectParams(base, overrides)` 工厂函数，减少约 40 行重复 |
| 7 | P1 | 控制流 | L118-L142（循环前预计算段） | 循环前的预计算段（resolveMapping → modality → OF → allowed_models）有 3 处 early return，每处重复 `randomUUID + Date.now + isStream + RejectParams 构造 + rejectAndReply` 模式 | 提取 `rejectEarly(ctx, errors, reason)` 辅助函数，统一 early reject 路径 |

### P2 问题：1

| # | 优先级 | 类别 | 位置 | 描述 | 建议 |
|---|--------|------|------|------|------|
| 8 | P2 | 安全 | L111 | `// eslint-disable-next-line max-lines-per-function` 压制了函数长度警告。根据项目 CLAUDE.md `taste/no-eslint-disable` 规则，应通过拆分函数正面解决 | 拆分 `executeFailoverLoop` 为多个子函数后移除此注释 |

### P3 问题：0

### 正面评价

- **循环结构合理**：`while(true)` 配合 `MAX_FAILOVER_ITERATIONS` 上限和 `reply.raw.destroyed` 检查，满足 `taste/no-unbounded-while-true` 规则
- **常量管理好**：`HTTP_ERROR_THRESHOLD`、`UPSTREAM_ERROR_STATUS`、`HTTP_SERVICE_UNAVAILABLE`、`MAX_FAILOVER_ITERATIONS` 已提取为命名常量
- **日志脱敏**：`sanitizeHeadersForLog` 用于 `precomputedClientReq`，符合 headers 安全规范
- **异常分类完整**：`PipelineAbort`、`ProviderSwitchNeeded`、`SemaphoreQueueFullError`、`SemaphoreTimeoutError`、`AbortError` 五类错误逐个处理，无遗漏
- **Plugin 桥接设计**：`applyPluginAdjustments` 将 Plugin 逻辑从主循环解耦，职责清晰
- **API Key 缓存**：`decryptedApiKeys` Map 避免重复解密，性能意识好
- **resolveUpstreamPath 提取**：格式转换决策已提取为独立函数，降低主函数复杂度

**统计**: P0: 2 | P1: 4 | P2: 1 | P3: 0

---

## 汇总

| 优先级 | 数量 | 分布 |
|--------|------|------|
| P0 | 2 | failover-loop.ts: 函数过长(467行) + 兜底响应可能缺失 |
| P1 | 5 | modality-redirect: snapshot 重复; failover-loop: 魔法字符串 x2, 匿名类型, RejectParams 重复, early return 模式重复 |
| P2 | 1 | failover-loop: eslint-disable 压制 |
| P3 | 0 | — |

### MUST FIX（必须在合并前修复）

1. **P0 #2**: `executeFailoverLoop` 467 行，必须拆分为至少 3 个子函数（预计算、迭代上下文构建、结果处理）
2. **P0 #3**: while 循环末尾 `return reply` 分支依赖 `headersSent` 隐式假设，必须添加显式兜底响应
3. **P2 #8**: `eslint-disable max-lines-per-function` — 拆分函数后必须移除，不得压制 lint

### 建议修复顺序

1. 先拆分 `executeFailoverLoop`（P0 #2）→ 同时解决 P2 #8（移除 eslint-disable）
2. 修复兜底响应缺失（P0 #3）
3. 提取 `buildRejectStage` / `buildRejectParams` 工厂函数（P1 #1, #6, #7）
4. 提取 metadata key 常量和 Provider 类型（P1 #4, #5）

### 跨文件观察

两个文件的 `Record<string, unknown>` 使用均属于项目白名单范围（外部接口签名、输出对象构造），不视为违规。
`modality-redirect.ts` 质量明显高于 `failover-loop.ts`，后者的问题主要是历史积累导致的函数膨胀。
