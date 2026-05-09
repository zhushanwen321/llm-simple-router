# CI 验证输出报告

**分支**: `fix/chat2resp-text-accumulation`
**执行时间**: 2026-05-09 21:44 UTC+8
**执行环境**: macOS (local worktree)

---

## 1. `npm run build` — 编译

**Exit code**: 0
**耗时**: ~6s

```
> npm run build -w core -w router -w frontend

@llm-router/core: tsc → 成功
llm-simple-router: tsc → 成功 + postbuild (复制 migrations)
frontend: vue-tsc + vite build → 成功 (70 modules, 847ms)
```

**结果**: ✅ 通过

---

## 2. `npx vitest run router/tests/proxy/transform/stream-bridge.test.ts` — 核心测试

**Exit code**: 0
**耗时**: 297ms

```
 Test Files  1 passed (1)
      Tests  40 passed (40)
```

**结果**: ✅ 通过 (40/40)

---

## 3. `npm run test` — 全量测试

**Exit code**: 0
**耗时**: 20.87s

```
 Test Files  84 passed | 3 skipped (87)
      Tests  988 passed | 3 skipped (991)
```

其中 3 个 skipped 为预存跳过测试（与本次变更无关）：
- `transform-coordinator-responses.test.ts`
- `transform-coordinator.test.ts`
- `proxy-handler.test.ts`

**结果**: ✅ 通过 (988 passed, 0 failed)

---

## 4. `npm run lint -w router` — 后端 ESLint

**Exit code**: 0
**耗时**: <1s

输出为空（无错误无警告）。

注：初次运行因 `eslint-plugin-vue` 未安装失败（worktree 创建后 `npm install` 遗漏），执行 `npm install` 后重新运行通过。此为环境问题，非代码变更导致。

**结果**: ✅ 通过

---

## 5. 质量问题记录

### 5.1 `eslint-plugin-vue` 缺失
- **影响**: lint 命令首次运行失败
- **根因**: worktree 创建后 `npm install` 遗漏该依赖
- **修复**: `npm install` 重新安装依赖后解决
- **性质**: 环境问题，非代码缺陷

### 5.2 预存的 `example-plugin.js` CJS/ESM 兼容性警告
- **表现**: 多个测试打印 stderr 警告
  ```
  [plugin-registry] Failed to load plugin from example-plugin.js:
  ReferenceError: module is not defined in ES module scope
  ```
- **影响**: 不影响测试结果（所有测试通过）
- **性质**: 预存问题，非本次变更导致

---

## 质量门禁总结

| 检查项 | 命令 | 结果 | Exit Code |
|--------|------|------|-----------|
| 编译 | `npm run build` | ✅ 通过 | 0 |
| 核心测试 | `npx vitest run router/tests/proxy/transform/stream-bridge.test.ts` | ✅ 40 passed | 0 |
| 全量测试 | `npm run test` | ✅ 988 passed | 0 |
| 后端 Lint | `npm run lint -w router` | ✅ 通过 | 0 |

**结论：全部质量门禁通过。**
