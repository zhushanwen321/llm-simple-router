---
phase: spec
verdict: pass
---

# Spec Phase Retrospect — retry-rule-upgrade

## Phase 执行质量

### 做得好的

1. **根因分析深入**：从 Kimi 429 usage-limit 的具体请求日志出发，追溯到 retry rule `5432e293` 的 body_pattern 正则过于宽泛，直接定位到"provider 隔离缺失"这一结构性问题。避免了"加个特殊 case"的治标方案。

2. **渐进式设计展示**：5 个 section 逐一展示并获取用户确认，每个 section 在前一个确认后才推进。避免了"一次抛出 20 页设计文档"的信息过载。

3. **术语同步更新**：在讨论过程中即时更新 CONTEXT.md（Body Matcher、Upstream Error Log、Retry Rule 扩展定义），ADR 0005 在 spec 写完后立即创建。

4. **审查中自我发现问题**：spec review 识别出 2 个 SHOULD FIX（stream_error 分支覆盖、error_type 提取优先级），虽然不影响 gate 通过，但为 Phase 2 plan 提供了明确的实现注意点。

### 可改进的

1. **subagent 调用失败**：spec review subagent 因 `CollectSubagentParams is not defined` 扩展加载错误连续失败 2 次。最终改为手动执行 review。根因是 pi 扩展代码有 bug，非流程问题。但浪费了 2 个 turn 在错误排查上。
   - **建议**：扩展修复后，对非关键步骤（review、retrospect）可接受手动执行作为 fallback，不必阻塞流程。

2. **前端 demo 未执行**：最初计划用 `/impeccable` skill 出前端交互 demo，但 PRODUCT.md 不存在导致 setup gate 不满足。最终改为在 spec 中用文字描述交互设计（FR6），推迟到 Phase 3 实现。
   - **决策合理**：RetryRules 页面是增量适配（加 2 个字段到现有 Dialog），不是全新页面，文字描述足够。

3. **spec 中缺少 out-of-scope 明确列表**：六要素检查中"Scope boundaries"标记为 PASS，但 spec 没有显式列出 out-of-scope 项。reviewer 没有标记为问题，因为 Constraints 和 AC8（向后兼容）隐式定义了边界。但更好的做法是显式列出 "不做 X"。
   - **建议**：后续 spec 模板增加 `## Out of Scope` 小节。

## Harness 体验

1. **brainstorming skill 的 checklist 清晰**：9 步 checklist + 流程图让执行者不会遗漏步骤。Step 1 (codebase scan) 的 subagent dispatch 模式在 extension 正常时很高效。

2. **Terminology Step 的 "MUST + Nullable" 设计合理**：强制检查但允许空产出，避免了"为写术语而写术语"的浪费。本次产出 3 个术语 + 1 个 ADR，都是有实际价值的。

3. **Gate check 脚本路径问题**：`skills/xyz-harness-gate/scripts/check_gate.py` 在项目本地不存在，需要用全局路径。这是 workspace 模式下 skill 路径解析的问题。
   - **建议**：gate check 脚本应支持从 PATH 或 npm bin 查找。

## 关键指标

| 指标 | 值 |
|------|---|
| 从需求到 spec 完成 | ~12 turns（含 2 次 subagent 失败） |
| spec FR 数量 | 9 |
| spec AC 数量 | 8 |
| Review MUST_FIX | 0 |
| Review SHOULD_FIX | 2 |
| 新增术语 | 3 |
| 新增 ADR | 1 |
| Gate 结果 | PASS |
