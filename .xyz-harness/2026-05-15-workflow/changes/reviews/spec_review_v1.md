# Spec 评审 v1

## 评审记录
- 评审时间：2026-05-15
- 评审类型：Spec 独立评审
- 评审对象：`.xyz-harness/2026-05-15-workflow/spec.md`
- 评审轮次：第 1 轮

## 六要素覆盖矩阵

| 要素 | 覆盖状态 |
|------|---------|
| Outcomes | PASS — 目标清晰可测 |
| Scope boundaries | PASS — in-scope 9 项 + out-of-scope 5 项 |
| Constraints | PASS — 性能、兼容性、循环简化、无阻塞 |
| Decisions made | PASS — 6 条决策含理由 |
| Verification | PASS — 20 条 AC |
| 已有基础设施 | PASS — 组件复用表 + 数据消费者表 |

## 引用完整性

所有文件路径验证存在。类型签名与代码库一致。

## 发现的问题

### 问题 #1 — IR fallback target 的 overflow 行为未定义

spec 伪代码中 overflow 层对 IR_F 也写了 `OF_IRF?`，但 `image_fallback` 配置结构（只有 `{provider_id, backend_model}`）决定了它没有 `overflow_provider_id`/`overflow_model`。这导致伪代码与数据模型不一致。

**修复建议**：
- 明确声明 IR fallback target 不参与 overflow 重定向
- 更新伪代码移除 `OF_IRF?`
- AC18 给出具体期望输出示例

### 问题 #2-3 — 与 #1 同根

- 伪代码 `OF_IRF?` 的歧义
- `applyOverflowRedirect()` 对无 overflow 字段的 target 返回 null 是否预期

### 其他建议（5 条 LOW）

1. image_fallback DB 查询路径缺函数名
2. failover 循环简化后 overflow 内联代码移除细节
3. `expandOverflowTargets()` 签名未给出
4. OF 层对 IR_F 的处理应在"不影响现有逻辑"表说明
5. AC18 可与 AC19 合并

## 结论

CONDITIONAL PASS — 3 个阻塞问题同根（IR fallback overflow 行为），修复成本低（一行声明 + AC18 具体化），修复后可通过。
