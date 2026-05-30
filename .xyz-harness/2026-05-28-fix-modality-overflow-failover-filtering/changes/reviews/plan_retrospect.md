---
phase: plan
verdict: pass
---

# Phase 2 (Plan) Retrospect

## 1. Phase Execution Review

### Summary

产出 L1 单文件 plan（3 个 Task、1 个 Execution Group BG1）+ e2e-test-plan + test_cases_template + use-cases + non-functional-design。核心设计：Task 1 重写 modality-redirect 核心逻辑，Task 2 扩展 ErrorKind 并处理空列表，Task 3 回归验证。两轮 review 通过。

### Problems Encountered

1. **ProxyErrorFormatter 接口遗漏（review v1）**：Plan 初版只关注 `ErrorKind` union 和 `createErrorFormatter` 工厂函数，遗漏了 `ProxyErrorFormatter` 接口声明也需要同步新增 `unsupportedModality()` 方法。审查 subagent 通过读代码发现了这个 TypeScript 编译时必然暴露的问题。

2. **create-proxy-handler.ts fallback errorMeta 遗漏（review v1）**：`create-proxy-handler.ts` L146-153 有一个 fallback `errorMeta` 对象字面量（当 `adapter?.errorMeta` 不存在时使用），新增 `ErrorKind` 值后此对象也必须补齐，否则 TypeScript 报错。初版 plan 的文件列表只有 6 个，遗漏了这个文件。

3. **Gate check 字段名不一致**：review v2 的 frontmatter 用 `must_fix_resolved` + `must_fix_remaining` 而非 gate 脚本期望的 `must_fix`，导致 gate FAIL。手动修复后通过。

### What Would You Do Differently

在列出受影响文件时，应该 grep 所有使用 `ErrorKind` 类型的位置（`grep -rn "ErrorKind" router/src/`），而不是凭记忆列举。这样能一次性覆盖 `proxy-core.ts`、`format/types.ts`、`create-proxy-handler.ts` 三处，避免遗漏。

### Key Risks for Later Phases

- Task 1 的现有测试更新量较大（modality-redirect.test.ts 有 1377 行），部分测试描述的旧行为（prepend）需要改为新行为（filter），需仔细区分哪些保留、哪些修改
- `create-proxy-handler.ts` 的 fallback errorMeta 在实际运行中很少触发（通常有 adapter），但 TypeScript 编译必须通过，dev 阶段需确保所有 `ErrorKind` 值都补齐

## 2. Harness Usability Review

### Flow Friction

Plan 阶段的交付物数量较多（6 个文件），但其中 4 个（e2e-test-plan、test_cases_template、use-cases、non-functional-design）是模板化内容，复杂度不高。对于 L1 级别的纯后端改动，use-cases.md 和 non-functional-design.md 的价值有限——UC 和 NFR 都很简单，写这些文件更像是完成 checklist 而非产出有价值的决策。

### Gate Quality

Gate check 正确识别了 review v2 的 `must_fix` 字段缺失问题。Review subagent 两轮都准确发现了真实问题（接口遗漏、fallback errorMeta 遗漏），没有误报。

### Automation Gains

Review subagent 再次证明价值——两个遗漏都是"读代码才能发现的架构一致性问题"，凭 plan 作者的记忆容易漏掉。两轮 review + fix 循环运作顺畅。
