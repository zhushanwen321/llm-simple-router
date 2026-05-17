# Plan Review: 图片检测自动切换多模态模型（v1）

**日期**: 2026-05-15
**模式**: 计划评审（Stage 5）
**范围**: spec.md + plan.md + plan-backend.md + plan-frontend.md
**评审人**: reviewer agent（独立评审，无执行上下文）

---

## 1. Spec 完整性评估

### 1.1 目标明确性：通过

目标清晰——"请求含图片但当前模型不支持时，自动切换 fallback 模型"。范围边界合理，out-of-scope 列出了明确排除项。

### 1.2 验收标准可量化性：通过

AC1-AC20 每条都有明确的输入条件和预期行为，验证方式为"单元测试"或"手动验证"，可追溯。

### 1.3 已做决策记录：通过

D1-D6 每条都有决策、理由、可推翻标记。

### 1.4 行为约束：通过

Always/Never 约束列表完整，覆盖了降级、no-op、异常安全等关键行为。

---

## 2. Plan 与 Spec 一致性检查

### 2.1 AC 覆盖矩阵验证

逐条核对 plan.md 的 AC 覆盖矩阵与 spec AC 列表：

| AC | Spec 要求 | Plan 覆盖 | 状态 |
|----|----------|----------|------|
| AC1-AC4 | IR 层核心行为 | T2 (image-redirect.test.ts) | OK |
| AC5-AC6 | capabilities 解析 | T1 (model-capabilities.test.ts) | OK |
| AC7-AC8 | fallback provider 校验 | T2 | OK |
| AC9 | StageRecord 记录 | T5 + T2 | OK |
| AC10 | 异常降级 | T2/T4 | OK |
| AC11 | 前端 Provider 能力编辑 | TF1 | OK |
| AC12 | 前端映射组 fallback 配置 | TF2 | OK |
| AC13-AC16 | 图片检测格式 | T2 | OK |
| AC17 | validateRule 扩展 | T6 + admin-groups.test.ts | OK |
| AC18 | 分层路由集成 | T3 (layered-routing.test.ts) | OK |
| AC19 | failover exclude 无死循环 | T3 | OK |
| AC20 | 循环内无路由决策 | T3（代码审查） | OK |

**结论**: 所有 20 条 AC 均有对应 task 和验证方式。

### 2.2 Spec 约束在 Plan 中的落地

| Spec 约束 | Plan 落地 | 状态 |
|-----------|----------|------|
| "运行时补充，不修改 DB" | T1 parseModels() 改动 | OK |
| "IR fallback target 不参与 overflow" | T4 设计明确，applyOverflowRedirect 对无 overflow 字段的 target 返回 null | OK |
| "分层计算异常降级为返回原列表" | T2/T4 设计含 try-catch | OK |
| "validateRule 验证 provider_id 存在且 active" | T6 设计完整 | OK |

---

## 3. Task 完整性检查

### 3.1 各 Task 结构完整性

| Task | 描述 | 文件变更表 | 详细设计 | 验收标准 | 风险点 | 依赖 | 状态 |
|------|------|-----------|---------|---------|--------|------|------|
| T1 | 有 | 有 | 有 | AC5/AC6 | 有 | 无 | OK |
| T2 | 有 | 有 | 有（函数签名+流程+检测格式） | AC1-4/7-10/13-16 | 有 | T1 | OK |
| T3 | 有 | 有 | 有（重构前后对比+关键改动点） | AC18-20 | 有 | T2/T4 | OK |
| T4 | 有 | 有 | 有 | 内联描述 | 有 | 无 | OK |
| T5 | 有 | 有 | 有 | 内联描述 | 有 | 无 | OK |
| T6 | 有 | 有 | 有 | AC17 | 有 | 无 | OK |
| T7 | 有 | 有（5 个文件+分组） | 有 | 覆盖矩阵 | 有 | 全部 | OK |
| TF1 | 有 | 有（8 个文件） | 有（ADR+数据流+类型） | AC-TF1-1~6 | 有 | T1 | OK |
| TF2 | 有 | 有（6 个文件） | 有（ADR+数据流+类型） | AC-TF2-1~7 | 有 | T6 | OK |

### 3.2 文件变更准确性

后端变更文件经与实际代码库核对：

- `model-context.ts`（179 行）：T1 在 parseModels() 中增加 capabilities 补充，在 buildModelInfoList() 中传递——**与现有代码结构吻合**。
- `failover-loop.ts`（557 行）：T3 需要重构循环——**文件确实包含循环内的 resolveMapping 和 overflow 代码**（已确认 168-193 行有 BP-H2 缓存逻辑，259-266 行有 overflow 内联代码）。
- `overflow.ts`（131 行）：T4 新增 expandOverflowTargets() 包装函数——**applyOverflowRedirect 已存在且可复用**。
- `pipeline-snapshot.ts`：T5 新增 StageRecord 变体——**当前 union type 有 5 个变体，新增 1 个是安全的**。

前端变更文件经与描述核对，均为已有文件的增量修改。

---

## 4. 依赖正确性检查

### 4.1 依赖图验证

```
T1 ──┬── T2 ──┬── T3 ── T7
T4 ──┘       │        │
T5 ──────────┘        │
T6 ── TF2             │
T1 ── TF1             │
                  T7
```

验证结果：

| 依赖 | 是否合理 | 验证 |
|------|---------|------|
| T2 → T1 | 合理 | T2 的 computeImageRedirectTargets 调用 parseModels() 获取 capabilities，parseModels 在 T1 中修改 |
| T3 → T2 | 合理 | T3 在 failover-loop.ts 中调用 computeImageRedirectTargets() |
| T3 → T4 | 合理 | T3 在 failover-loop.ts 中调用 expandOverflowTargets() |
| TF1 → T1 | 合理 | 前端需要后端 API 返回 capabilities 字段 |
| TF2 → T6 | 合理 | 前端保存需要后端 validateRule 通过 |
| T7 → 全部 | 合理 | 集成测试依赖所有实现完成 |

**无循环依赖，无缺失依赖。**

---

## 5. T3 高风险评估

T3（failover-loop.ts 重构）是本 plan 的核心风险点。逐项评估：

### 5.1 重构范围清晰度

plan-backend.md T3 中给出了：
- 需要移除的代码位置（resolveMapping 调用 ~30 行、overflow 内联 ~8 行、allowed_models ~6 行）
- 重构后的代码结构伪代码
- 4 个关键改动点的详细说明

**评估**: 移除位置和目标结构都足够清晰，Phase 2 agent 可以据此操作。

### 5.2 保留逻辑的完整性

T3 需要保留的逻辑清单（plan 中虽未显式列表，但从伪代码可推断）：
- provider inactive 检查
- tool error 提取
- format transform + upstreamPath 决策
- plugin adjustments
- provider patches
- API key 解密
- transport 构建
- orchestrator.handle() 调用
- resilience result 处理（日志/metrics/failover 判断/stream content）
- ProviderSwitchNeeded / SemaphoreQueueFullError / SemaphoreTimeoutError 异常处理
- PipelineAbort 异常处理
- AbortError 处理（客户端断连）

**这些逻辑的保留在 T3 伪代码中用 `// ... 后续代码不变` 概括。** 对于 Phase 2 agent 来说，这个范围描述是充分的——agent 只需要确保"while 循环内从 provider 查找到最后的 try/catch 块"保持不变。

### 5.3 风险缓解

- 现有集成测试覆盖完整 failover 路径（spec 和 plan 中都提到了这一点）
- plan 中将 T3 放在最后执行（依赖最多的 task）
- T7 的 layered-routing.test.ts 覆盖了 IR+OF+failover 联合场景

**评估**: T3 风险描述充分，缓解措施合理。

### 5.4 发现的问题

**blocking #1: T3 的 allowed_models 检查位置存在歧义**

plan-backend.md T3 详细设计中有一段关键讨论：

> "只检查 allTargets[0]，因为 IR fallback target 是用户显式配置的，不应被 allowed_models 阻止（或者应该检查？这里需要确认——如果用户限制了 allowed_models，IR fallback target 也应该在 allowed 范围内。但 spec 未提及此约束，保守起见只检查原始 target）。"

这段话表明设计者**自己也不确定**这个行为。两个选项：
- (a) 只检查原始 target（plan 当前选择）
- (b) IR fallback target 也需在 allowed_models 中

这不是一个可以在实现时随意决定的问题。如果 allowed_models 包含 "glm-5.1"，用户配置了 image_fallback 为 "moonshot-v1-128k"，但 allowed_models 不包含它，方案 (a) 会导致请求被路由到用户未授权的模型。

**建议**: 在 spec 中补充明确约束（推荐：IR fallback 不受 allowed_models 限制，因为它是配置在 mapping group 级别的，已由管理员控制），或在 plan 中做出明确决策并标注为 ADR。

### 5.5 发现的问题

**blocking #2: T3 的 provider inactive 处理语义变化未在 spec 中体现**

plan-backend.md T3 详细设计中写：

> "provider inactive 时改为 `exclude + continue`（而非直接返回错误），因为预计算的 target 列表可能有其他可用 target。"

但当前代码（failover-loop.ts 第 218-221 行）中，provider inactive 是**直接返回错误**（`rejectAndReply`），不是 exclude。这是一个行为变化。

如果 IR fallback provider 恰好是 inactive 的（validateRule 通过后 provider 被禁用），IR 层会在运行时跳过（AC7），所以 IR target 不会进入 failover 循环。但对于原始 targets 中的 inactive provider，当前行为是立即报错，改为 exclude+continue 后会尝试下一个 target。

这个行为变化**实际上是改进**（更健壮），但 spec 没有提及，且可能改变现有用户的行为预期。

**建议**: 在 spec 约束或 plan 的 ADR 中明确记录这个行为变化，或者在 T3 中保持原有语义（inactive → 直接返回错误，不做 exclude），将 exclude+continue 作为后续优化。

---

## 6. 跨 Plan 一致性检查

### 6.1 后端 ↔ 前端数据契约

| 字段 | 后端类型 | 前端类型 | 一致 |
|------|---------|---------|------|
| `ModelEntry.capabilities` | `string[]` (T1) | `string[]` (TF1 types/mapping.ts) | OK |
| `ModelInfo.capabilities` | `string[]` (T1) | `string[]` (TF1 types/mapping.ts) | OK |
| `Rule.image_fallback` | `{backend_model, provider_id}` (T6) | `{provider_id, backend_model}` (TF2) | OK |
| StageRecord image-redirect | T5 新增变体 | 前端未消费此字段（日志页未解析） | OK（plan-frontend 已标注） |

### 6.2 API 端点一致性

前端使用现有 API 端点（PUT/POST providers, PUT/POST mapping-groups），不需要新端点。后端 T6 扩展了 validateRule 但 API 签名不变。**一致。**

### 6.3 执行顺序一致性

plan.md 的执行顺序（T1+T4+T5+T6 并行 → T2 → T3 → TF1+TF2 → T7）与 plan-backend.md 和 plan-frontend.md 的依赖描述一致。

---

## 7. 可行性评估

### 7.1 Phase 2 Agent 实施可行性

每个 task 的信息密度是否足以让 agent 独立实施：

| Task | 伪代码/代码示例 | 边界条件 | 可独立实施 |
|------|---------------|---------|-----------|
| T1 | 有（parseModels 改动位置精确到行） | 有（缓存一致性） | 是 |
| T2 | 有（完整函数签名+8步流程） | 有（3 种 API 格式检测） | 是 |
| T3 | 有（重构前后对比+4 个关键改动点） | 有（5.4/5.5 中的歧义需先解决） | **部分**（需先解决 blocking issues） |
| T4 | 有（完整函数实现伪代码） | 有（per-target try-catch） | 是 |
| T5 | 有（类型定义） | 无（纯类型变更无边界） | 是 |
| T6 | 有（完整验证逻辑代码） | 有（向后兼容） | 是 |
| T7 | 有（测试分组+用例列表） | 有 | 是 |
| TF1 | 有（数据流+类型+组件变更说明） | 有（四态覆盖） | 是 |
| TF2 | 有（数据流+类型+组件变更+模板结构） | 有（四态覆盖） | 是 |

### 7.2 实现量估算合理性

plan-backend.md 估算总变更 ~730 新增 + ~90 修改 + ~40 删除 行。对比实际代码量：
- failover-loop.ts 557 行，plan 估算 -40/+30（净减 10 行）——**合理**，因为主要是移除循环内代码。
- image-redirect.ts 新建 ~120 行——**合理**，函数逻辑包括图片检测（~40 行）+ 主函数（~60 行）+ 辅助函数（~20 行）。

---

## 8. 其他发现

### 8.1 suggestion: T2 中 capabilities 查询路径效率

T2 详细设计中，获取 target capabilities 的路径是：
```
getProviderById(db) → parseModels(provider.models) → find entry by name → read capabilities
```

但 T1 的 parseModels() 有缓存（modelsCache），同一个 provider 的 models 只解析一次。所以这个路径在 failover 循环场景下不会重复解析。**无需修改**，仅记录。

### 8.2 suggestion: T2 中 getMappingGroup 的 client_model 匹配

T2 的 getImageFallback 通过 `getMappingGroup(db, clientModel)` 查询 mapping group。但 `getMappingGroup` 使用 `WHERE client_model = ? AND is_active = 1`，而 `resolveMapping` 内部也可能有类似的查询。这意味着 IR 层会多一次 DB 查询（resolveMapping 查过一次，IR 层再查一次获取 rule JSON）。

Plan 中已经讨论了这个设计选择（选择方案 b：IR 函数自包含），理由是"额外 DB 查询性能开销可忽略"。**同意此决策**。

### 8.3 suggestion: AC20（代码审查）是否需要更可量化的标准

AC20 的验证方式是"代码审查"，不是自动测试。Phase 2 agent 可以用 AST 分析或 grep 来验证 while 循环内不存在 resolveMapping/applyOverflowRedirect 调用。建议在 T3 验收标准中补充：**while 循环体内不存在对 `resolveMapping` 和 `applyOverflowRedirect` 的调用**（可通过 grep 验证）。

### 8.4 suggestion: plan-frontend.md 的 emoji 表示

plan-frontend.md 3.6 节中折叠视图示例使用了 emoji（🖼）。CLAUDE.md 明确禁止前端使用 emoji，应使用 lucide-vue-next 图标。虽然这只是文档描述而非实际代码，但建议用 `ImageIcon` 的文字描述替代，避免 agent 照搬。

---

## 9. 问题汇总

| # | 类型 | 位置 | 描述 | 建议 |
|---|------|------|------|------|
| 1 | **blocking** | plan-backend.md T3 detailed design | allowed_models 检查位置存在歧义——是否应检查 IR fallback target？plan 承认"需要确认"但未做决策 | 在 spec 或 plan ADR 中明确决策：推荐 IR fallback 不受 allowed_models 限制（mapping group 由管理员配置，视为已授权） |
| 2 | **blocking** | plan-backend.md T3 detailed design | provider inactive 处理从"直接返回错误"改为"exclude+continue"是行为变化，spec 未提及 | 在 spec 约束中明确此行为变化，或在 T3 中保持原有语义，将 exclude+continue 作为后续优化 |
| 3 | suggestion | plan-backend.md T3 AC20 | 代码审查标准不够可量化 | 补充"while 循环体内不存在 resolveMapping/applyOverflowRedirect 调用"的 grep 验证方式 |
| 4 | suggestion | plan-frontend.md 3.6 节 | 折叠视图示例使用 emoji 🖼 | 用文字描述替代（如 `[ImageIcon]`），避免 agent 误用在代码中 |

---

## 10. 结论

**2 条 blocking issues，结论：需修改后重审。**

两个 blocking issue 都集中在 T3 的设计歧义上。T3 是高风险核心 task，任何歧义都可能导致 Phase 2 agent 做出错误决策。建议：

1. 在 spec 或 plan 中补充 ADR 明确 allowed_models 对 IR fallback 的适用性
2. 在 spec 或 plan 中明确 T3 是否改变 provider inactive 的处理语义

修复这两个问题后，plan 的整体质量很高，AC 覆盖完整，依赖关系正确，T1/T2/T4/T5/T6/TF1/TF2 均可独立实施。
