# Plan Review: 图片检测自动切换多模态模型（v2）

**日期**: 2026-05-15
**模式**: 计划评审（Stage 5），第 2 轮
**范围**: spec.md（v2 已修复两个 blocking）+ plan.md + plan-backend.md + plan-frontend.md
**评审人**: reviewer agent（独立评审，无执行上下文）
**前置**: plan_review_v1.md 发现 2 条 blocking，spec 已修复，本轮验证 plan 是否同步

---

## 1. v1 Blocking 问题修复验证

### Blocking #1: allowed_models 检查位置

**v1 问题**: T3 详细设计中 allowed_models 对 IR fallback 的适用性存在歧义（"或者应该检查？这里需要确认"）。

**spec 修复**: spec.md 各层职责表中 resolveMapping 行新增：
> "allowed_models 检查在此层之后、IR 层之前执行（只检查原始 client model 对应的 target，IR fallback 由 admin 配置视为已授权）"

**plan 同步状态**: ❌ **plan-backend.md 未同步**

plan-backend.md T3 关键改动点 #3（约第 308 行）仍保留原文：
> "只检查 allTargets[0]，因为 IR fallback target 是用户显式配置的，不应被 allowed_models 阻止（或者应该检查？这里需要确认——如果用户限制了 allowed_models，IR fallback target 也应该在 allowed 范围内。但 spec 未提及此约束，保守起见只检查原始 target）"

spec 已经做出了明确决策（allowed_models 只检查原始 target，IR fallback 由 admin 配置视为已授权），但 plan 的这段文字还在说"需要确认"。Phase 2 agent 看到 plan 这段话会陷入困惑——spec 说"已授权"，plan 说"需要确认"。

**结论**: plan 需更新此段为明确决策，引用 spec 的结论，删除歧义讨论。

### Blocking #2: provider inactive 处理语义

**v1 问题**: T3 将 provider inactive 从"直接返回错误"改为"exclude + continue"，这是行为变化，spec 未提及。

**spec 修复**: spec.md 各层职责表中 failover 循环行新增：
> "provider 不存在或 inactive 时直接返回错误（保持原有行为，非 exclude+continue）"

**plan 同步状态**: ❌ **plan-backend.md 未同步**

plan-backend.md T3 中有两处与 spec 矛盾：

1. 伪代码（约第 295 行）：
   ```typescript
   if (!provider || !provider.is_active) {
     excludeTargets.push(resolved);
     continue;  // 不直接返回，尝试下一个 target
   }
   ```
   spec 明确说"直接返回错误，非 exclude+continue"，但 plan 伪代码仍然用 exclude+continue。

2. 关键改动点 #4（约第 309 行）：
   > "循环内 provider inactive 时改为 `exclude + continue`（而非直接返回错误），因为预计算的 target 列表可能有其他可用 target。"
   
   这与 spec 的"保持原有行为"直接矛盾。

**结论**: plan 需将 T3 的 provider inactive 处理改回"直接返回错误"，与 spec 和原始行为一致。

---

## 2. Plan 与 Spec 一致性复查（两个 blocking 之外）

### 2.1 AC 覆盖矩阵

v1 已验证全部 20 条 AC 均有对应 task 和验证方式。spec v2 未新增/删除 AC，覆盖矩阵不变。**通过。**

### 2.2 Spec 约束在 Plan 中的落地

| Spec 约束 | Plan 落地 | v2 状态 |
|-----------|----------|---------|
| "运行时补充，不修改 DB" | T1 parseModels() | OK |
| "IR fallback target 不参与 overflow" | T4 设计 | OK |
| "分层计算异常降级为返回原列表" | T2/T4 | OK |
| "validateRule 验证 provider_id 存在且 active" | T6 | OK |
| **"allowed_models 只检查原始 target"** | **T3 未同步** | ❌ 见 Blocking #1 |
| **"provider inactive 直接返回错误"** | **T3 未同步** | ❌ 见 Blocking #2 |
| "循环内无路由决策" | T3 伪代码结构 | OK |

### 2.3 依赖图和执行顺序

v1 已验证无循环依赖、无缺失依赖。plan 未变更。**通过。**

### 2.4 前端一致性

v1 已验证后端↔前端数据契约一致。plan-frontend.md 未变更。**通过。**

---

## 3. 其他检查项（v1 已通过，本轮复查）

### 3.1 Task 结构完整性

所有 9 个 task（T1-T7 + TF1-TF2）均有完整的文件变更表、详细设计、验收标准、风险点、依赖说明。**无变化，通过。**

### 3.2 文件变更准确性

v1 已核对关键文件（model-context.ts、failover-loop.ts、overflow.ts、pipeline-snapshot.ts）与实际代码库结构。**无变化，通过。**

### 3.3 可行性评估

除 T3 外（因上述两个 blocking 未同步），其余 task 的信息密度足以让 Phase 2 agent 独立实施。**无变化，通过。**

### 3.4 实现量估算

v1 已评估 ~730 新增 + ~90 修改 + ~40 删除行为合理。**无变化，通过。**

---

## 4. 非阻塞性发现

### 4.1 LOW: plan-frontend.md 使用非语义颜色

plan-frontend.md 中 image_fallback 区域使用 `violet-400/15` 作为功能色区分 overflow 的 `primary` 色调。`violet-400` 是 Tailwind 原始色名，非语义 token。

CLAUDE.md 规则："禁止硬编码颜色值，使用 CSS 变量或 Tailwind 语义类名"。但项目内已有一处类似用法（QuickSetup.vue `bg-emerald-600`），且此处是用于区分功能区域（非主 UI 颜色），实际影响有限。建议在实施时考虑使用 CSS 变量或接受此例外。

### 4.2 LOW: plan-frontend.md 折叠视图示例仍有 emoji

plan-frontend.md 第 143 行和第 308 行仍使用 🖼 emoji。虽然这只是文档描述而非实际代码，但 v1 已建议用 `ImageIcon` 文字描述替代。Phase 2 agent 应按正文（第 311 行明确使用 `ImageIcon`）实施，不受此文档 emoji 影响。

---

## 5. 问题汇总

| # | 类型 | 位置 | 描述 | 建议 |
|---|------|------|------|------|
| 1 | **blocking** | plan-backend.md T3 关键改动点 #3（~L308） | allowed_models 检查仍有歧义讨论（"需要确认"），未同步 spec 的明确决策（IR fallback 由 admin 配置视为已授权） | 删除歧义讨论，改为明确决策："只检查 allTargets[0]（原始 target）。IR fallback target 由 admin 在 mapping group 中配置，视为已授权，不受 allowed_models 限制。" |
| 2 | **blocking** | plan-backend.md T3 伪代码（~L295）+ 关键改动点 #4（~L309） | provider inactive 处理仍为 exclude+continue，与 spec "直接返回错误（保持原有行为）"矛盾 | 伪代码改为 `return rejectAndReply(...)`，关键改动点 #4 改为："provider inactive 处理保持原有语义：直接返回错误。不做 exclude+continue。" |
| 3 | LOW | plan-frontend.md §3.6 / §7.1 | image_fallback 使用 `violet-400` 原始色名 | 实施时考虑用 CSS 变量替代，或标注为例外 |
| 4 | LOW | plan-frontend.md §2.7 / §3.6 | 折叠视图示例使用 emoji 🖼 | 用 `[ImageIcon]` 文字描述替代 |

---

## 6. 结论

**2 条 blocking issues，结论：需修改后重审。**

两个 blocking 都是 **plan-backend.md T3 未同步 spec v2 的修复**。spec 已经做出了明确决策，但 plan 仍然保留 v1 时的歧义讨论和矛盾代码。Phase 2 agent 在实施 T3 时会面对 spec 和 plan 的矛盾，可能做出错误决策。

修复方式简单：将 T3 的两处描述更新为与 spec 一致的明确决策即可。无需重新评审 spec 或其他 task。
