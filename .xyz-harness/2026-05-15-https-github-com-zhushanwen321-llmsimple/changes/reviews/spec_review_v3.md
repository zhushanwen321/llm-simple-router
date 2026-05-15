# Spec 评审 v3

## 评审记录
- 评审时间：2026-05-15 21:15
- 评审类型：Spec 独立评审（第三轮）
- 评审对象：spec.md（v3）
- 评审轮次：第 3 轮

## v2 MUST FIX 修复状态

| # | v2 问题描述 | 状态 | 验证 |
|---|------------|------|------|
| 1 | `post_route` emit 位置描述错误（指向 `create-proxy-handler.ts`，此时 `ctx.resolved` 为 null） | PARTIALLY RESOLVED | §3 Step 1 已修正为 `failover-loop.ts`，位置描述正确（resolveMapping + overflow 之后、plugin adjustments 之前），ctx 赋值操作已补充。但 In-scope 和已有基础设施表仍引用旧文件——见下方新 MUST FIX #1 |

### 六要素覆盖矩阵

| 要素 | 覆盖状态 | 说明 |
|------|---------|------|
| Outcomes | ✅ | 终态明确：请求含图片 + 模型不支持 + 配置了 fallback → 自动切换 |
| Scope boundaries | ✅ | In-scope 10 项 + Out-of-scope 4 项 |
| Constraints | ✅ | 性能 O(n)、兼容性、幂等性、无阻塞 |
| Decisions made | ✅ | 5 个决策均有理由 + 可推翻标注 |
| Verification | ✅ | 17 条 AC，无模糊词 |
| 已有基础设施 | ✅ | 10 个复用组件 + 3 张消费者检查表 |

### 自包含性问题

**问题 1（新 MUST FIX）：In-scope 和已有基础设施表与 §3 Step 1 矛盾**

§3 Step 1 正确描述了 emit 在 `failover-loop.ts` 中添加，但以下两处仍引用旧路径：

1. **In-scope** 列表第 5 项：
   > `post_route` emit 调用点新增（`create-proxy-handler.ts`）

2. **已有基础设施** 表第 5 行：
   > emit 调用点 | `router/src/proxy/handler/create-proxy-handler.ts` | 新增 `post_route` emit（当前只有 `pre_route`）

Phase 2 agent 扫描 In-scope 或已有基础设施时，会按 `create-proxy-handler.ts` 定位代码，但实际实现需在 `failover-loop.ts` 中进行。两处引用与 §3 Step 1 的正确描述冲突。

### 发现的问题

| # | 优先级 | 维度 | 位置 | 描述 | 修改建议 |
|---|--------|------|------|------|---------|
| 1 | MUST FIX | 自包含性 | §范围 In-scope 第5项 + §已有基础设施表第5行 | 两处引用 `create-proxy-handler.ts` 作为 emit 调用点，与 §3 Step 1 修正后的 `failover-loop.ts` 矛盾。Phase 2 agent 可能按错误的文件定位实现 | In-scope 改为 `post_route` emit 调用点新增（`failover-loop.ts`）；已有基础设施表改为 `router/src/proxy/handler/failover-loop.ts \| 新增 post_route emit（resolveMapping + overflow 之后）` |
| 2 | LOW | 自包含性 | §3 Step 2 | image-redirect hook 如何获取当前 mapping group 的 `image_fallback` 配置未说明（v2 #2 遗留） | — |
| 3 | LOW | 自包含性 | §1 | `buildModelInfoList()` 的 capabilities 传递路径未写明（v2 #3 遗留） | — |

> 优先级定义：
> - **MUST FIX**：不修复则评审不通过，会阻塞流程
> - **LOW**：建议修复，但不阻塞

### 类型签名抽查结果

v2 已验证 5 个标识符，全部一致。v3 仅修改 §3 Step 1 文字描述，未引入新的类型签名引用，无需重新抽查。

## 结论

需修改后重审

## Summary

Spec 评审完成，第 3 轮，1 条 MUST FIX（In-scope 和已有基础设施表仍引用 `create-proxy-handler.ts`，与 §3 Step 1 修正后的 `failover-loop.ts` 矛盾），需重审。修复量极小——仅需将两处旧引用改为 `failover-loop.ts` 即可通过。
