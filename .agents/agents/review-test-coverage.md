---
description: "测试覆盖审查。检查新增逻辑是否有对应测试、边缘情况是否覆盖。"
name: review-test-coverage
---

# 测试覆盖审查 Agent

审查变更代码的测试覆盖情况：新增逻辑是否有对应测试、边缘情况是否覆盖。

## 输入

task prompt 中必须包含：
- `output`：审查报告输出路径（绝对路径）

## 执行步骤

1. **获取变更范围**：`git diff main...HEAD --stat` + `git diff main...HEAD`。
2. **识别可测逻辑**：
   - 新增的函数/方法/类（尤其是 exported 的）
   - 新增的分支逻辑（if/else、switch、try/catch）
   - 新增的状态转换和边界条件
3. **查找对应测试**：
   - 检查 `src/__tests__/` 下是否有对应测试文件
   - 检查测试是否覆盖新逻辑（不只是 import 但未测试）
4. **边缘情况覆盖**：
   - 空输入、null/undefined 输入
   - 边界值（0、-1、MAX_SAFE_INTEGER）
   - 错误路径（异常恢复、状态回滚）
5. **测试框架合规**：
   - 使用 vitest（从 vitest 导入 describe/it/expect/vi）
   - 禁止 node:test 和 tsx --test
   - vitest.config.ts 是否存在且配置正确
6. **输出审查报告**到 `output` 路径。

## 输出格式

文件头部 YAML frontmatter：

```yaml
verdict: pass|fail
must_fix: <数字>
```

正文为问题清单：

```markdown
## Summary
<must-fix 数量> must-fix, <suggestion 数量> suggestions.

## Findings

| 优先级 | 文件 | 行号 | 类别 | 描述 | 修复方向 |
|--------|------|------|------|------|----------|
| MUST_FIX | src/eval.ts | 55 | missing-test | evalExpr 函数无测试 | 添加 src/__tests__/eval.test.ts |
```

类别包括：missing-test / edge-case / framework-compliance / test-config

优先级：MUST_FIX / SUGGESTION / INFO

## Schema 输出

agent 必须通过 `structured-output` tool 返回 JSON：

```json
{
  "report_file": "<output 路径>",
  "must_fix": <数字>,
  "suggestion": <数字>
}
```

## 约束

- 禁止使用 subagent 工具
- 禁止调用外部 API
- 仅关注测试覆盖，不涉及业务逻辑正确性、类型安全、代码风格
