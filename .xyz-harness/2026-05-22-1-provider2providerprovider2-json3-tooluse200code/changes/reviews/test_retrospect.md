---
phase: test
verdict: pass
---

# Test Phase Retrospect — retry-rule-upgrade

## Phase 执行质量

### 做得好的

1. **AC 覆盖矩阵完整**：8 个 AC 全部有对应的自动化测试。Round 1 评审指出的 3 个 MUST FIX（AC4 stream_error、AC6 前端 Provider、AC7 JSON matcher）在 Round 2 中全部修复，由后端集成测试覆盖前端数据层。

2. **TypeBox null→空字符串 bug 在 Round 2 被发现并修复**：写 AC7 测试时发现 `body_matchers: null` 被 TypeBox coerce 为 `""` 导致 400 错误，及时修复了 `validateBodyMatchers` 中的空字符串判断。

3. **1501 测试全部通过**：完整测试套件（126 个文件）无回归，新增 14 个测试覆盖所有 AC。

### 可改进的

1. **AC1 created_at DESC 测试需要直接 DB 插入**：通过 API 创建的两条规则在同一秒内产生相同的 `created_at` 时间戳，无法可靠测试排序。改用直接 `db.prepare()` 插入不同时间戳。
   - **教训**：涉及时间精度排序的测试，必须考虑 second 精度限制。

2. **前端无测试框架**：AC6 和 AC7 的前端 UI 交互无法通过自动化测试覆盖，只能写后端 API 测试验证数据层。如果项目有端到端测试（Playwright/Cypress），可以更完整地验证前端功能。

3. **review subagent 扩展不可用**：coding-workflow 扩展在 gate PASS 后自动 dispatch review subagent，但 subagent 扩展被故意置空（扩展冲突）。需要手动写 review。

## Harness 体验

1. **Gate 跨引用验证有效**：gate 脚本 cross-ref test_cases_template.json 中的 caseId 和 test_execution.json，确保所有 case 都有执行记录。`round` 轮次验证有效（只检查最大 round）。

2. **Loop 机制触发了修复**：Round 1 评审发现的 3 个 MUST FIX 在 Round 2 中全部修复。修复过程中还发现并修复了 TypeBox coerce 的隐藏 bug。

3. **扩展冲突影响 flow**：subagent 扩展被故意留空导致 review subagent 无法 dispatch。虽然 gate 脚本通过（`Gate script passed`），但扩展错误阻止了 gate 的完整通过。

## 关键指标

| 指标 | 值 |
|------|---|
| 执行轮次 | 2 |
| 测试用例总数 | 17（template）+ 4（AC 扩展） |
| 通过率 | 100% (Round 2) |
| 新增测试文件 | 3 |
| 新增测试数 | 14 |
| 总测试数 | 1501（全部通过） |
| MUST FIX 数量 | 3（全部已修复） |
| LOW 修复 | 2（AC1 DESC, AC8 向后兼容） |
| Bug 修复 | 1（TypeBox null→空字符串） |
