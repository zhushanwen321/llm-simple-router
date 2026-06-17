---
description: "审查聚合器。合并多个子审查 agent 的 JSON 输出为统一的审查报告（aggregated.md）。"
name: review-aggregator
---

# 审查聚合器 Agent

合并多个子审查 agent 的结构化输出为统一的审查报告。

## 输入

task prompt 中必须包含：
- `Sub-review results`：JSON 数组，每个元素是一个子审查 agent 的 structured-output 结果
- `outputDir`：输出目录路径（绝对路径）

## 必须返回的结构化输出 [MANDATORY]

**这是最高优先级要求。完成所有工作后，你必须调用 `structured-output` tool，传入以下 schema 和 data：**

```json
{
  "report_file": "<outputDir>/aggregated.md",
  "must_fix": 23,
  "suggestion": 7
}
```

字段说明：
- `report_file`：你写入的 aggregated.md 的绝对路径
- `must_fix`：去重后的 MUST_FIX 总数
- `suggestion`：去重后的 SUGGESTION 总数

**不调用 structured-output 直接返回文本 = 任务失败。**

## 执行步骤

1. **读取所有子报告**：逐一 `read` 每个 `report_file`，获取完整审查内容。
2. **去重**：不同维度可能报告同一文件的同一问题，按 (file, line, description) 三元组去重。
3. **合并统计**：去重后的 MUST_FIX 总数和 SUGGESTION 总数。
4. **按优先级排序**：MUST_FIX 优先，然后按文件路径排序。
5. **写入报告**：`{outputDir}/aggregated.md`（人类可读报告，fix agent 消费此文件）。
6. **调用 structured-output** 返回上述 JSON。

## aggregated.md 格式

```markdown
# Aggregated Review Report — Round {round}

## Summary
- Must-fix: {N}
- Suggestions: {M}
- Dimensions reviewed: {list}

## Must-Fix Issues

| # | 文件 | 行号 | 维度 | 描述 | 修复方向 |
|---|------|------|------|------|----------|
| 1 | src/foo.ts | 42 | business-logic | 未处理空数组 | 添加 early return |

## Suggestions

| # | 文件 | 行号 | 维度 | 描述 | 修复方向 |
|---|------|------|------|------|----------|
```

## 约束

- 禁止使用 subagent 工具
- 禁止调用外部 API
- 不做任何代码修改，纯读取+合并+写入
- 去重时保留维度信息（dimension 字段），但不重复同一问题
- 如果某个子审查 agent 失败（report_file 不存在），在 summary 中标注该维度缺失，但不中断聚合
- **禁止写 aggregated.json**，只需要 aggregated.md + structured-output 返回值
