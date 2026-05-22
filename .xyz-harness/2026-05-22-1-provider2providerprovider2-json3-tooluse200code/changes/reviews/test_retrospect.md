---
phase: test
verdict: pass
---

# Test Phase Retrospect — retry-rule-upgrade

## Phase 执行质量

### 做得好的

1. **AC 覆盖完整**：8 个 AC 全部有自动化测试覆盖。AC4 stream_error 端到端测试、AC1 matcher 排序测试、AC8 向后兼容测试在 Round 2 中补全。

2. **前端测试基础设施搭建**：项目原无前端测试框架，Rounds 3-7 中安装了 `@vue/test-utils` + `jsdom`，配置了 `frontend/vitest.config.ts`，编写了 5 个前端组件测试覆盖 AC6/AC7 的 Provider 选择逻辑和 JSON matcher 编辑器交互。

3. **TypeBox null→空字符串 bug 在测试中发现并修复**：写 AC7 body_matchers=null 测试时发现 TypeBox 将 `null` coerce 为 `""`，及时修复了 `validateBodyMatchers`。

4. **1508 测试全部通过**：后端 127 files / 1503 tests + 前端 5 tests，零失败。

### 可改进的

1. **review loop 过长（7 轮）**：由于 subagent 扩展文件被置空（扩展冲突），review subagent 无法正常运行。前 6 轮 review 均由后备逻辑执行，但无法感知新提交的前端测试文件。第 7 轮在用户修复扩展后才看到完整证据。
   - **教训**：evidence 文件（test_execution.json、test_results.md）必须及时更新引用新测试文件，review 不会自动扫描源码目录。

2. **前端测试基础设施不应在 Phase 4 才引入**：项目没有前端测试框架（无 vitest、无 @vue/test-utils），导致 AC6/AC7 的 frontend UI 覆盖需要临时搭建。理想情况下，前端测试框架应在项目初始化时就配置好。

3. **created_at DESC 排序测试需要直接 DB 插入**：通过 API 创建的两条规则在同一秒内产生相同的 `created_at`，无法可靠测试排序。改用直接 `db.prepare()` 插入不同时间戳。

## Harness 体验

1. **Gate 重试限制合理**：10 次上限防止无限循环。遇到基础设施问题（扩展故障）时，人工干预（修复扩展文件 + 更新 evidence 引用）后可继续。

2. **Cross-reference 验证有效**：gate 脚本 cross-ref test_execution.json → test_cases_template.json，确保所有 template case 都有执行记录。round 轮次验证只检查最大 round。

3. **Evidence 驱动而非源码扫描**：review subagent 基于 evidence 文件判断覆盖率，不扫描源码目录。这意味着测试文件存在 ≠ 被 review 认可，必须更新 test_results.md 和 test_execution.json 显式引用。

## 关键指标

| 指标 | 值 |
|------|---|
| 执行轮次 | 7（前 6 轮扩展故障，第 7 轮修复后通过） |
| 测试用例总数 | 17（template）+ 前端额外覆盖 |
| 后端测试 | 127 files, 1503 tests, 全部通过 |
| 前端测试 | 1 file, 5 tests (vitest + jsdom) |
| 总测试数 | 1508（全部通过） |
| MUST FIX 数量 | 3（全部已修复） |
| Bug 修复 | 1（TypeBox null→空字符串） |
| Gate + Review 结果 | PASS |
