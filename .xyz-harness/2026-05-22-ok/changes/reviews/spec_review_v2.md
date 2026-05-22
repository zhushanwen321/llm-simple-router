---
verdict: pass
must_fix: 0
---

# Spec Review — 2026-05-22-ok (Round 2)

**评审时间**：2026-05-22 13:00  
**评审类型**：计划评审（spec 完整性审查，第2轮）  
**评审对象**：`.xyz-harness/2026-05-22-ok/spec.md`  
**结论**：verdict: pass, must_fix: 0

---

## 1. v1 MUST FIX 修复确认

### MUST FIX #1 — AC-1 迭代级字段验证 → 已修复

**原问题**：AC-1 只检查了固定依赖迁移（deps 字段 + metadata.get("db") 等 as 断言移除），但 spec 正文明确说迭代级状态（excludeTargets、mappingReason、isFailoverIteration、iterationStartTime、lastFailoverTrigger）也要提升为 PipelineContext 具名字段，AC 无对应检查。

**当前 spec 的 AC-1** 第2项：
> - [ ] PipelineContext 包含以下迭代级具名字段：excludeTargets、mappingReason、isFailoverIteration、iterationStartTime、lastFailoverTrigger

同时 AC-1 第3项覆盖了 metadata.set 的移除：
> - [ ] failover-loop.ts 中无 metadata.set 调用（固定依赖 + 迭代级状态全部迁移）

**结论：已修复。** 迭代级字段已加入 AC-1，且 metadata.set 迁移口径从"固定依赖"扩大为"固定依赖 + 迭代级状态全部迁移"。

### MUST FIX #2 — FR-6 getHookChain() 返回类型未定义 → 已修复

**原问题**：FR-6 变更清单缺少 `getHookChain()` 返回类型的接口定义，Admin API 消费者无法预知数据结构，可能需要运行时 as 断言。

**当前 spec 的 FR-6** 变更清单已明确声明：
> - `proxy/pipeline/pipeline.ts`: getHookChain() 返回 `HookChainEntry[]`，每个条目包含 `{ name: string; priority: number; phase: HookPhase; core?: boolean }`

AC-6 也增加了对应检查：
> - [ ] Admin API 返回的 hook 数据结构字段名和类型与删除前一致（name: string; priority: number; phase: HookPhase; core?: boolean）

**结论：已修复。** 返回类型 `HookChainEntry[]` 已定义，字段列表与删除前的 hook-registry 输出一致。

---

## 2. v1 LOW/INFO 修复确认

| # | 原问题 | 当前状态 | 修复依据 |
|---|--------|---------|---------|
| 3 (LOW) | FR-2 ProviderSwitchNeeded 外部 plugin 兼容性未说明 | 已修复 | 新增 Constraint 7，明确说明兼容降级策略："ProviderSwitchNeeded 仅用于内部 failover 控制，external plugin 不应使用它" |
| 4 (LOW) | AC-5 偏宽松，"至少"型 AC 不覆盖宣称目标 | 已修复 | AC-5 现在精确列出 5 个文件（providers.ts、retry-rules.ts、groups.ts、router-keys.ts、schedules.ts）及各自必用的工具函数 |
| 5 (INFO) | FR-4c 未指定候选转换器 | 已修复 | AC-4c 明确指定 stream-oa2ant.ts 为首选（223 行，目标 ≤ 130 行），stream-ant2oa.ts 为候选 |
| 6 (INFO) | 缺少性能回归验收标准 | 已修复 | 新增 Constraint 8：TTFT 在 ±5% 范围内，实施阶段通过集成测试确认 |

---

## 3. 逐项检查：spec 完整性（第2轮独立审查）

### 3.1 目标是否明确

**通过。** Background 清晰陈述 3 个结构性缺陷（metadata 无类型、控制流分裂、模块深度不足），6 个 FR 一一对应解决。一句话概述明确。

### 3.2 范围是否合理

**通过。** 4 个 Phase、6 个 FR，每个有精确的变更清单和边界。迁移顺序合理（Phase 1 前置条件 → Phase 2 管道深化 → Phase 3 格式子系统 → Phase 4 Admin 工具）。无过度设计。

### 3.3 验收标准是否可量化

**通过。** 所有 AC 可测试、可验证。无模糊描述。

### 3.4 待决议项

**无。** 未发现 `[待决议]` 标记。

---

## 4. 与 CLAUDE.md 架构约束的一致性

| CLAUDE.md 约束 | 对应 FR | 是否满足 |
|----------------|---------|---------|
| Pipeline Hook 执行路径验证（新增 Hook 必须注册到 proxyPipeline 并验证 emit 路径） | **FR-6**: 合并双注册表，只需注册一次 | 是 |
| 幂等注册（register 方法必须检测重复） | **FR-6**: 删除 hookRegistry，proxyPipeline 已实现幂等 | 是 |
| Hook 降级（execute 必须 try-catch） | **FR-3**: TransportExecutor 包含 error cleanup | 是 |
| 兜底响应 | **FR-2**: 统一控制流，消除异常传播路径 | 是 |
| 新字段数据消费者检查 | **FR-1**: PipelineMetaMap 接口声明所有 hook 通信键 | 是 |
| 转换层类型安全规范 | **FR-1**: metadata.get("xxx") as T → ctx.deps.xxx | 是 |
| 禁止运行时 readFileSync 加载可内联资源 | 不涉及 | N/A |
| 测试模式（Vitest + app.inject） | AC 全部使用"所有现有测试通过" | 是 |

---

## 5. 发现的观察项（第2轮新发现）

以下均为 INFO 级别，不阻塞流程：

### INFO-A: AC-4c 中 stream-oa2ant.ts 行数硬编码

AC-4c 明确写道"stream-oa2ant.ts（OpenAI→Anthropic，同构转换，当前 223 行）"。当前行数硬编码在 spec 中，如果实施前有其他 PR 修改了该文件，行数基准可能过时。建议标记为"实施时确认当前行数"。

**位置**：spec.md AC-4c  
**建议**：非阻塞，实施阶段自然会确认。

### INFO-B: AC-5 引用了 schedules.ts，但 CLAUDE.md 的 admin 文件清单中未列出

AC-5 要求 `schedules.ts（必用 partialBody + extractDefinedFields + notFound）`，但项目 CLAUDE.md 文档的 admin 文件清单未列出 schedules.ts。如果这是一个已存在的新文件（来自之前的 PR），则无问题；如果不存在，则 AC 引用了一个不存在的文件。

**位置**：spec.md AC-5  
**建议**：实施阶段先确认 schedules.ts 是否存在。如果不存在，则直接删除 AC 中对该文件的引用。

### INFO-C: FR-4b 高阶方法名与低阶方法名潜在冲突

FR-4b 新增 `transformRequestBody()` / `transformResponseBody()` 方法，与现有的低阶方法 `transformRequest()` / `transformResponse()` 名称接近。transformRequestBody 返回 `{ body, upstreamPath }`，而 transformRequest 返回 `Record<string, unknown>`。如果调用方未留意参数差异，可能误调用。

**位置**：spec.md FR-4b  
**建议**：实施时注意方法签名的显式区分，或考虑命名为 `transformWithUpstream()` 等更明确的名字。

### INFO-D: Constraint 8 性能基线未定义测量方法

Constraint 8 声明"TTFT 在 ±5% 范围内与 baseline 对比"，但没有定义 baseline 如何建立（哪个 commit？什么负载？什么网络条件？）。

**位置**：spec.md Constraint 8  
**建议**：实施时指定 baseline commit（如 Phase 1 实施前的 main 分支 HEAD），测试用本地 mock backend 避免网络方差。

---

## 6. 综合评估

### 优势
- **修复彻底**：v1 全部 6 条问题（2 MUST FIX + 2 LOW + 2 INFO）均已修复，没有任何残留
- **AC 精确度显著提升**：AC-1 新增迭代级字段验证、AC-6 定义 HookChainEntry 数据结构、AC-5 从"至少"型改为精确的文件逐项覆盖
- **Constraint 7/8 补全盲点**：ProviderSwitchNeeded 兼容降级策略和性能回归边界填补了 v1 评审识别的重要盲区
- **架构一致性**：与 CLAUDE.md 声明的关键架构约束完全对齐

### 结论

**通过。** 无 open MUST FIX。spec 整体质量优秀，可以进入 plan 阶段。

# Spec 评审 v2

## 评审记录
- 评审时间：2026-05-22 13:00
- 评审类型：计划评审（spec 完整性审查，第2轮）
- 评审对象：`.xyz-harness/2026-05-22-ok/spec.md`

---

## 1. v1 MUST FIX 修复确认

### MUST FIX #1 — AC-1 迭代级字段验证 → ✅ 已修复

**原问题**：AC-1 只检查了固定依赖迁移（deps 字段 + metadata.get("db") 等 as 断言移除），但 spec 正文明确说迭代级状态（excludeTargets、mappingReason、isFailoverIteration、iterationStartTime、lastFailoverTrigger）也要提升为 PipelineContext 具名字段，AC 无对应检查。

**当前 spec 的 AC-1** 第2项：
```
- [ ] PipelineContext 包含以下迭代级具名字段：excludeTargets、mappingReason、isFailoverIteration、iterationStartTime、lastFailoverTrigger
```

同时 AC-1 第3项覆盖了 metadata.set 的移除：
```
- [ ] failover-loop.ts 中无 metadata.set 调用（固定依赖 + 迭代级状态全部迁移）
```

**结论：已修复。** 迭代级字段已加入 AC-1，且 metadata.set 迁移口径从"固定依赖"扩大为"固定依赖 + 迭代级状态全部迁移"。

---

### MUST FIX #2 — FR-6 getHookChain() 返回类型未定义 → ✅ 已修复

**原问题**：FR-6 变更清单缺少 `getHookChain()` 返回类型的接口定义，Admin API 消费者无法预知数据结构，可能需要运行时 `as` 断言。

**当前 spec 的 FR-6** 变更清单已明确声明：
```
- `proxy/pipeline/pipeline.ts`: getHookChain() 返回 `HookChainEntry[]`，每个条目包含 `{ name: string; priority: number; phase: HookPhase; core?: boolean }`
```

AC-6 也增加了对应检查：
```
- [ ] Admin API 返回的 hook 数据结构字段名和类型与删除前一致（name: string; priority: number; phase: HookPhase; core?: boolean）
```

**结论：已修复。** 返回类型 `HookChainEntry[]` 已定义，字段列表与删除前的 hook-registry 输出一致。

---

## 2. v1 LOW/INFO 修复确认

| # | 原问题 | 当前状态 | 修复依据 |
|---|--------|---------|---------|
| 3 (LOW) | FR-2 ProviderSwitchNeeded 外部 plugin 兼容性未说明 | ✅ **已修复** | 新增 Constraint 7，明确说明兼容降级策略："ProviderSwitchNeeded 仅用于内部 failover 控制，external plugin 不应使用它" |
| 4 (LOW) | AC-5 偏宽松，"至少"型 AC 不覆盖宣称目标 | ✅ **已修复** | AC-5 现在精确列出 5 个文件（providers.ts、retry-rules.ts、groups.ts、router-keys.ts、schedules.ts）及各自必用的工具函数 |
| 5 (INFO) | FR-4c 未指定候选转换器 | ✅ **已修复** | AC-4c 明确指定 stream-oa2ant.ts 为首选（223 行，目标 ≤ 130 行），stream-ant2oa.ts 为候选 |
| 6 (INFO) | 缺少性能回归验收标准 | ✅ **已修复** | 新增 Constraint 8：TTFT 在 ±5% 范围内，实施阶段通过集成测试确认 |

---

## 3. 逐项检查：spec 完整性（第2轮独立审查）

### 3.1 目标是否明确

**通过。** Background 清晰陈述 3 个结构性缺陷（metadata 无类型、控制流分裂、模块深度不足），6 个 FR 一一对应解决。一句话概述明确。

### 3.2 范围是否合理

**通过。** 4 个 Phase、6 个 FR，每个有精确的变更清单和边界。迁移顺序合理（Phase 1 前置条件 → Phase 2 管道深化 → Phase 3 格式子系统 → Phase 4 Admin 工具）。无过度设计。

### 3.3 验收标准是否可量化

**通过。** 所有 AC 可测试、可验证。无模糊描述。

### 3.4 待决议项

**无。** 未发现 `[待决议]` 标记。

---

## 4. 与 CLAUDE.md 架构约束的一致性

| CLAUDE.md 约束 | 对应 FR | 是否满足 |
|----------------|---------|---------|
| Pipeline Hook 执行路径验证（新增 Hook 必须注册到 proxyPipeline 并验证 emit 路径） | **FR-6**: 合并双注册表，只需注册一次 | ✅ |
| 幂等注册（register 方法必须检测重复） | **FR-6**: 删除 hookRegistry，proxyPipeline 已实现幂等 | ✅ |
| Hook 降级（execute 必须 try-catch） | **FR-3**: TransportExecutor 包含 error cleanup | ✅ |
| 兜底响应 | **FR-2**: 统一控制流，消除异常传播路径 | ✅ |
| 新字段数据消费者检查 | **FR-1**: PipelineMetaMap 接口声明所有 hook 通信键 | ✅ |
| 转换层类型安全规范 | **FR-1**: metadata.get("xxx") as T → ctx.deps.xxx | ✅ |
| 禁止运行时 readFileSync 加载可内联资源 | 不涉及 | N/A |
| 测试模式（Vitest + app.inject） | AC 全部使用"所有现有测试通过" | ✅ |
| 代码品味原则（structuredClone 等） | 不涉及具体代码 | N/A |

---

## 5. 发现的观察项（第2轮新发现）

以下均为 INFO 级别，不阻塞流程：

### INFO-A: AC-4c 中 stream-oa2ant.ts 行数硬编码

AC-4c 明确写道"stream-oa2ant.ts（OpenAI→Anthropic，同构转换，当前 223 行）"。当前行数硬编码在 spec 中，如果实施前有其他 PR 修改了该文件，行数基准可能过时。建议标记为"实施时确认当前行数"。

**位置**：spec.md AC-4c
**建议**：非阻塞，实施阶段自然会确认。

### INFO-B: AC-5 引用了 schedules.ts，但 CLAUDE.md 的 admin 文件清单中无此文件

AC-5 要求 `schedules.ts（必用 partialBody + extractDefinedFields + notFound）`，但项目 CLAUDE.md 文档的 admin 文件清单（`src/admin/` 下）未列出 `schedules.ts`。如果这是一个已存在的新文件（来自之前的 PR），则无问题；如果不存在，则 AC 引用了一个不存在的文件。

**位置**：spec.md AC-5
**建议**：实施阶段先确认 src/admin/schedules.ts 是否存在。如果不存在，则直接删除 AC 中对该文件的引用。

### INFO-C: FR-4b 高阶方法名与低阶方法名潜在冲突

FR-4b 新增 `transformRequestBody()` / `transformResponseBody()` 方法，与现有的低阶方法 `transformRequest()` / `transformResponse()` 名称接近。`transformRequestBody` 返回 `{ body, upstreamPath }`，而 `transformRequest` 返回 `Record<string, unknown>`。如果调用方未留意参数差异，可能误调用。

**位置**：spec.md FR-4b
**建议**：实施时注意方法签名的显式区分，或考虑命名为 `transformWithUpstream()` 等更明确的名字。

### INFO-D: Constraint 8 性能基线未定义测量方法

Constraint 8 声明"TTFT 在 ±5% 范围内与 baseline 对比"，但没有定义 baseline 如何建立（哪个 commit？什么负载？什么网络条件？）。

**位置**：spec.md Constraint 8
**建议**：实施时指定 baseline commit（如 Phase 1 实施前的 main 分支 HEAD），测试用本地 mock backend 避免网络方差。

---

## 6. 综合评估

### 优势
- **修复彻底**：v1 全部 6 条问题（2 MUST FIX + 2 LOW + 2 INFO）均已修复，没有任何残留
- **AC 精确度显著提升**：AC-1 新增迭代级字段验证、AC-6 定义 HookChainEntry 数据结构、AC-5 从"至少"型改为精确的文件逐项覆盖
- **Constraint 7/8 补全盲点**：ProviderSwitchNeeded 兼容降级策略和性能回归边界填补了 v1 评审识别的重要盲区
- **架构一致性**：与 CLAUDE.md 声明的前 6 项关键架构约束完全对齐

### 第2轮观察
- 新发现的 4 项均为 INFO 级别，主要是实施阶段的注意事项，不阻塞 spec 阶段
- 最值得关注的是 INFO-B（schedules.ts 是否存在），但实施阶段自然会发现

### 结论

**通过。** 无 open MUST FIX。spec 整体质量优秀，可以进入 plan 阶段。

---

## Summary

Spec 评审完成，第 2 轮通过，0 条 MUST FIX。
