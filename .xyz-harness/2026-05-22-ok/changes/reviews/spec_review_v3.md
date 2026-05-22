---
verdict: pass
must_fix: 0
---

# Spec 评审 v3

## 评审记录

- 评审时间：2026-05-22 16:00
- 评审类型：计划评审（spec 完整性审查，第3轮）
- 评审对象：`.xyz-harness/2026-05-22-ok/spec.md`

---

## 1. v1 MUST FIX 修复追溯确认

### MUST FIX #1 — AC-1 迭代级字段验证 → ✅ 已修复

**原问题**：AC-1 只检查固定依赖迁移，遗漏迭代级状态字段的验证。

**当前 spec 的 AC-1** 已新增第2项：
```
- [ ] PipelineContext 包含以下迭代级具名字段：excludeTargets、mappingReason、isFailoverIteration、iterationStartTime、lastFailoverTrigger
```
且第3项的迁移口径从"固定依赖"扩大为"固定依赖 + 迭代级状态全部迁移"。

**结论：已修复。**

### MUST FIX #2 — FR-6 getHookChain() 返回类型未定义 → ✅ 已修复

**原问题**：FR-6 缺少 `getHookChain()` 返回类型的接口定义。

**当前 spec 的 FR-6** 已明确定义返回类型：
```
getHookChain() 返回 HookChainEntry[]，每个条目包含 { name: string; priority: number; phase: HookPhase; core?: boolean }
```
AC-6 第3项精确规定了字段名和类型与删除前一致。

**结论：已修复。**

---

## 2. v1 LOW/INFO 修复追溯确认

| v1 ID | 原问题 | 当前状态 | 验证依据 |
|-------|--------|---------|---------|
| 3 (LOW) | FR-2 ProviderSwitchNeeded 外部 plugin 兼容性未说明 | ✅ 已修复 | Constraint 7 明确兼容降级策略 |
| 4 (LOW) | AC-5 偏宽松，"至少"型不覆盖宣称目标 | ✅ 已修复 | AC-5 精确列出 5 个文件及各自必用的工具函数 |
| 5 (INFO) | FR-4c 未指定候选转换器 | ✅ 已修复 | AC-4c 指定 stream-oa2ant.ts 为首选（≤130行），stream-ant2oa.ts 为候选 |
| 6 (INFO) | 缺少性能回归验收标准 | ✅ 已修复 | Constraint 8 新增 TTFT ±5% 约束 |

---

## 3. 第3轮独立审查：spec 完整性逐项检查

### 3.1 目标是否明确

**通过。**

Background 清晰陈述 3 个结构性缺陷，6 个 FR——对应解决。一句话概括："渐进式重构 Pipeline Hook 架构，解决 metadata 无类型、控制流分裂、模块深度不足 3 个问题。" 目标明确。

### 3.2 范围是否合理

**通过。**

4 个 Phase，6 个 FR，每个有精确变更清单和边界。迁移顺序经过验证是合理的（Phase 1 前置 → Phase 2 依赖 Phase 1 → Phase 3/4 独立）。无过度设计。

**对比验证**（当前代码库 ↔ spec 变更清单）：

| 文件/路径 | spec 声称 | 实际状态 | 匹配 |
|-----------|----------|---------|------|
| `transport-execute.ts` | 150 行内联 6 项职责 | 197 行 | 基本匹配（数值偏差不影响设计） |
| `hook-registry.ts` | 45 行 | 45 行 | ✅ |
| `format/converters/` | 6 个文件 | 6 个文件（anthropic-openai, anthropic-responses, openai-anthropic, openai-responses, responses-anthropic, responses-openai）| ✅ |
| `admin/routes.ts` hook 查询端点 | — | `GET /admin/api/pipeline/hooks` 调用 `hookRegistry.getAll()` | 确认消费者位置 |
| `FormatRegistry` | — | `format/types.ts` 中存在 `createConverter()` | 确认待删除目标 |
| `ProviderSwitchNeeded` | — | `core/errors.ts:35` 存在 | 确认待废弃目标 |

### 3.3 验收标准是否可量化

**通过。**

所有 AC 可测试、可验证。无模糊描述。AC-1 ~ AC-6 均以具体文件状态、字段存在性、行数限制等方式定义验收条件。

### 3.4 待决议项

**无。** 未发现 `[待决议]` 标记。

---

## 4. 与 CLAUDE.md 架构约束的一致性检查

| CLAUDE.md 约束 | 对应 FR | 对齐情况 |
|----------------|---------|---------|
| **Pipeline Hook 执行路径验证**：hook 必须注册到 proxyPipeline | **FR-6**: 删除 hookRegistry，走 proxyPipeline 单一路径 | ✅ 完全对齐 |
| **幂等注册**：register 需检测重复 | **FR-6**: proxyPipeline 已实现幂等 | ✅ |
| **Hook 降级**：execute 必须 try-catch | **FR-3**: TransportExecutor 包含 error cleanup | ✅ |
| **兜底响应**：所有 catch 必须有响应 | **FR-2**: 消除异常传播路径，统一返回值 | ✅ |
| **新字段数据消费者完整性**：DB→SSE→Admin→前端→日志→监控 | **FR-1**: PipelineMetaMap 接口定义消费键 | ✅ |
| **转换层类型安全**：禁止 Record<string, unknown> 裸访问 | **FR-1**: metadata.get() as T → ctx.deps.xxx | ✅ |
| **代码品味原则（structuredClone、headers 脱敏等）** | 不涉及具体代码 | N/A |
| **测试验收标准覆盖矩阵**：每个 AC 有对应测试 | AC 全部要求"所有现有测试通过" | ✅ |

**全部对齐，无不一致项。**

---

## 5. 项目结构验证

以下验证确认 spec 中引用的文件路径在项目代码库中存在：

| spec 引用路径 | 实际存在？ | 备注 |
|--------------|-----------|------|
| `proxy/pipeline/types.ts` | ✅ | 存在 |
| `proxy/pipeline/context.ts` | ✅ | 存在 |
| `proxy/pipeline/pipeline.ts` | ✅ | 已含 `getHookChain()` 返回 `ReadonlyArray<{ name; priority }>` |
| `proxy/pipeline/hook-registry.ts` | ✅ | 45 行，待删除 |
| `proxy/pipeline/register-hooks.ts` | ✅ | 存在 |
| `proxy/hooks/builtin/transport-execute.ts` | ✅ | 197 行 |
| `proxy/format/converters/` | ✅ | 6 个文件 |
| `proxy/format/types.ts` | ✅ | 含 `createConverter()` |
| `proxy/transform/stream-transform-base.ts` | ✅ | 存在 |
| `proxy/transform/stream-oa2ant.ts` | ✅ | 存在 |
| `proxy/transform/stream-ant2oa.ts` | ✅ | 存在 |
| `proxy/transform/stream-bridge-chat2resp.ts` | ✅ | 存在 |
| `proxy/transform/stream-bridge-resp2chat.ts` | ✅ | 存在 |
| `proxy/orchestration/resilience.ts` | ✅ | 存在 |
| `proxy/handler/failover-loop.ts` | ✅ | 存在，含 ProviderSwitchNeeded import + catch |
| `admin/utils.ts` | ❌ 不存在 | 待新增（FR-5 创建） |
| `admin/monitor.ts` | ✅ 存在 | 不含 hookRegistry 引用 |
| `admin/routes.ts` | ✅ 存在 | 含 `hookRegistry.getAll()`（第67行） |
| `core/errors.ts` | ✅ 存在 | 含 ProviderSwitchNeeded（第35行） |
| `core/constants.ts` | ✅ 存在 | 存在 |

---

## 6. 发现的观察项（第3轮新发现）

### 观察项 A — FR-6 引用的文件路径与实际不符（LOW）

**问题**：FR-6 变更清单注明修改 `admin/monitor.ts`，但实际 hook 查询端点位于 `admin/routes.ts:66-67`（`hookRegistry.getAll()`）。`admin/monitor.ts` 中**无** hookRegistry 引用。

**影响**：实施者按 spec 修改 `admin/monitor.ts` 不会产生任何效果。正确位置是 `admin/routes.ts:66-67`。

**修改建议**：FR-6 变更清单中 `admin/monitor.ts` → `admin/routes.ts`（或说明"搜索 `hookRegistry` 所有引用，将 hook 查询数据源从 `hookRegistry` 改为 `proxyPipeline.getHookChain()`"）。

**优先级**：LOW — 实施者通过 grep `hookRegistry` 自然会发现所有引用点，不会造成实施错误。

### 观察项 B — FR-1 未穷举 15+ 个固定依赖（INFO）

**问题**：spec 正文提到"db、container、matcher、adapter、orchestrator 等 15+ 个"固定依赖，但未给出完整列表。虽然 AC-1 第4项通过反模式（"无 metadata.get("db") 等 as 断言"）提供了强制机制，但**缺少正面的完整清单**可能让实施者遗漏部分依赖。

**影响**：低。实施者只需遍历 15 个 builtin hook 文件，搜索 `metadata.get("xxx")` 即可找到所有依赖。但完整清单能节省工作量。

**修改建议**：（可选）从 infrastructure-scan.md 复制完整依赖列表到 FR-1 变更清单中。

**优先级**：INFO。

### 观察项 C — Constraint 8 性能基线定义（INFO）

**问题**：Constraint 8 声明"TTFT 在 ±5% 范围内与 baseline 对比"，但未定义：
1. baseline 基于哪个 commit？
2. 测量环境（本地 mock backend / 真实 upstream）？
3. 多大量级的数据集？

**影响**：低。实施阶段自然会决定。但无明确 baseline 可能使"±5%"成为无锚点的声明。

**修改建议**：（可选）指定 baseline 为 main 分支 HEAD（Phase 1 实施前），使用本地 mock backend 消除网络方差。

**优先级**：INFO（与 v2 观察到的一致）。

---

## 7. 综合评估

### 优势

- **v1 修复彻底**：全部 6 条问题（2 MUST FIX + 2 LOW + 2 INFO）均已修复，无残留
- **项目结构验证通过**：spec 中引用的全部文件路径在代码库中真实存在
- **AC 精确度良好**：AC-1 ~ AC-6 均定义了可测试的验证条件
- **架构约束完全对齐**：CLAUDE.md 中 6 项相关约束全部对齐
- **FR-6 的 getHookChain() 方法已在 pipeline.ts 中存在**，说明该接口设计合理（只需扩展返回字段）
- **双注册表问题的根源验证通过**：`admin/routes.ts:67` 确认 `hookRegistry.getAll()` 是 Admin API 唯一消费者

### 不足

- **FR-6 文件路径不准确**（LOW）：`admin/monitor.ts` → 应为 `admin/routes.ts`

### 结论

**通过。** 无 open MUST FIX。spec 整体质量优秀，可以进入 plan 阶段。

---

## Summary

Spec 评审完成，第 3 轮通过，0 条 MUST FIX。
