---
phase: pr
verdict: pass
---

# 整体复盘 — AI Retry Rule Generation（Phase 1-5 全覆盖）

**特性:** AI 重试规则生成（从日志详情一键 AI 生成重试规则）
**时间跨度:** 2026-05-20 ~ 2026-05-21
**最终状态:** PR #150 已创建，CI 通过，全部 gate 通过
**规模:** 23 files, +2306 / -240, 25 测试用例, 1474 自动化测试通过

---

## 一、Phase 执行复盘（全 5 阶段）

### 1.1 总体时间线与交付质量

| Phase | 核心交付 | 迭代轮次 | MUST FIX | 质量评级 |
|-------|---------|---------|----------|---------|
| 1. Spec | spec.md（6 FR, 5 AC） | 2（v1 fail → v2 pass） | 3 | B+ |
| 2. Plan | plan.md + e2e-test-plan.md + test_cases_template.json | 2（6 MF → 全修） | 6 | B+ |
| 3. Dev | 11 commits, 23 files | 3 轮审查 | 5 | B |
| 4. Test | 25/25 case passed | 1（零返工） | 0 | B |
| 5. PR | PR #150, CI green | 1 | 0 | A- |

**总体评分: B+**

### 1.2 跨 Phase 问题链路追踪

把每个 Phase 的关键问题串联起来，看哪些是同一根因在不同阶段的表现：

**问题链 A："数据源验证不足"（贯穿 Phase 1-3）**

| Phase | 表现 | 发现者 |
|-------|------|--------|
| Phase 1 | spec 假设 `upstream_response.body` 始终非空，遗漏 `stream_text_content` | spec review #MF-1 |
| Phase 2 | plan 确认了 stream_text_content 的格式（序列化 JSON），但没有回溯修正 spec 的数据源描述 | plan review |
| Phase 3 | callLLM 实现正确使用了 `extractResponseText()`（同时读 body 和 stream_text_content） | dev 正确实现 |

结论：Phase 1 评审有效拦截，Phase 2 补充验证，Phase 3 正确实现。这条链路是 Harness 质量保障的成功案例。

**问题链 B："FR 间一致性缺失"（Phase 1 → Phase 3）**

| Phase | 表现 |
|-------|------|
| Phase 1 | summary 字段在 FR5（Prompt）遗漏但在 FR6（前端）需要，spec review #MF-2 发现 |
| Phase 3 | buildSystemPrompt 使用精简英文版而非 spec 定义的详细中文 prompt，两轮 code review 标记为 NH 但未修 |

结论：Phase 1 修复了字段缺失，但 Phase 3 又在 prompt 内容上偏离 spec。一致性检查在字段级别有效，在内容级别失效。

**问题链 C："框架隐式行为感知不足"（Phase 3 独有）**

onSend hook 信封绕过回归 bug 是整个项目中最严重的单一缺陷。它在 Phase 3 内被发现并修复，但没有被任何自动化机制拦截——纯靠开发者自查。这说明：

1. 框架级隐式行为（onSend 自动包装）在 CLAUDE.md 中没有记录
2. 代码审查的检查维度缺少"reply.send payload 与框架 hook 的交互"
3. 集成测试没有模拟前端 `request<T>()` 的解包行为，测试通过但实际功能失败

这条链路的教训是：**框架约定应该和 API 契约一样被文档化、被测试、被审查。**

**问题链 D："前端测试覆盖为零"（Phase 3-4）**

| Phase | 表现 |
|-------|------|
| Phase 3 | 前端实现 0 个自动化测试 |
| Phase 4 | 25 个用例中 11 个（44%）降级为代码审查，0 个手动浏览器测试 |
| Phase 5 | PR 合并前没有浏览器 E2E 验证记录 |

结论：前端测试是本次特性的最大覆盖缺口。项目本身没有前端测试框架，但"0 手动浏览器测试"是不可接受的——至少应该跑一遍 spec 定义的 AC 流程。

### 1.3 各 Phase 执行效率分析

| Phase | 预估复杂度 | 实际耗时 | 返工率 | 效率评估 |
|-------|-----------|---------|--------|---------|
| Spec | L1 | ~1h | 33%（v1 fail → v2） | 正常 |
| Plan | L1 | ~1.5h | 40%（6 MF → 重修） | 偏慢，rate limit 加剧 |
| Dev | L1 | ~1h45m | 34%（6 fix commits / 11 total） | 正常，onSend bug 是主要返工源 |
| Test | L1 | ~30m | 0%（零返工） | 高效 |
| PR | - | ~15m | 0% | 高效 |

**总返工率：~25%（返工主要来自评审发现的 MUST FIX 修复）**

这个返工率在合理范围内。返工的根因分布：
- Spec 不完整（3 MF）→ Phase 1 评审拦截
- Plan 类型合同错误（6 MF）→ Phase 2 评审拦截
- Dev spec 合规 + 框架认知（5 MF）→ Phase 3 评审拦截

如果没有评审，这些问题会累积到测试甚至生产阶段，修复成本 5-10x。

### 1.4 关键设计决策回顾

| 决策 | 在哪个 Phase 做出 | 是否正确 | 后续影响 |
|------|-----------------|---------|---------|
| callLLM 直接调 Provider，不经代理 | Phase 1 (spec) | 正确 | 避免了 semaphore/tracker/resilience 的不必要耦合 |
| 同步阻塞 + Loading spinner | Phase 1 (spec) | 正确 | 实现简单，用户反馈即时 |
| 预览 Dialog 再编辑再保存 | Phase 1 (spec) | 正确 | 用户保持控制权，符合 AI-as-assistant 模式 |
| HTTP 200 + { success, error } 统一错误格式 | Phase 2 (plan) | 正确 | 简化了前端错误处理 |
| 复用已有 CreateRuleDialog | Phase 1 (spec) | 正确 | 减少新代码量，UI 一致性 |
| buildSystemPrompt 使用精简英文版 | Phase 3 (dev) | 存疑 | 偏离 spec，AI 生成质量未验证 |
| reply.send 手动注入信封 | Phase 3 (dev) | 错误 | 导致 onSend 回归，已修复 |

### 1.5 如果从 Phase 1 重来会做什么不同

**Phase 1 改进：**
1. spec 编写前做数据模型预检——grep `upstream_response` 和 `stream_text_content` 的使用方式
2. 增加 FR 交叉引用表作为 spec 内建章节
3. Background 的每句话追踪到 FR/AC

**Phase 2 改进：**
1. 类型定义预扫描——读取 cascading-types.ts、request-detail/types.ts 的实际类型，而非靠猜测
2. 使用 `taskComplexity` 替代硬编码 model 名称
3. encryption_key 访问模式在 spec 阶段就确认，不留"需要确认"占位符

**Phase 3 改进：**
1. 编码前花 2 分钟 grep `reply.send(` 了解项目的响应格式约定
2. 集成测试模拟前端 `request<T>()` 解包行为
3. 编码时对照 spec FR 逐条实现，用 checklist 避免遗漏
4. buildSystemPrompt 与 spec 对齐，或在 spec 阶段就更新

**Phase 4 改进：**
1. 至少跑一遍浏览器手动 E2E，截图存为 evidence
2. 用真实 LLM 做 3-5 个 AI prompt 质量的探索性测试
3. TC-4 改为真正的全链路集成测试

**Phase 5 改进：**
1. 合并前确认手动 E2E 测试已执行
2. PR description 中明确标注前端测试覆盖缺口

### 1.6 风险遗留项

| 风险 | 严重度 | 缓解措施 | 状态 |
|------|--------|---------|------|
| 前端零自动化测试 | 中 | 合并前手动 E2E | 待执行 |
| AI prompt 质量未用真实 LLM 验证 | 中 | 手动探索性测试 | 待执行 |
| buildSystemPrompt 与 spec 偏差 | 低 | 合并后观察用户反馈 | 已知 |
| RetryRuleMatcher 缓存刷新未端到端验证 | 中 | live proxy 测试 | 待执行 |

---

## 二、Harness 体验复盘

### 2.1 Flow Friction（流程摩擦）

**摩擦点 1：Subagent model 选择**

Phase 2 的 skill 模板指定了不存在的 model 名称（`llm-simple-router/glm-5-turbo`），导致 dispatch 失败。Phase 3 改用 `taskComplexity` 参数后问题解决。这是跨 Phase 的系统性摩擦——Harness skill 的 model 引用应与实际可用 model 解耦。

**影响：** Phase 2 评审阶段被阻塞约 15 分钟。

**摩擦点 2：Rate limit 脆弱性**

Phase 2 同一晚 `router-openai/glm-5.1` 和 `zai/glm-5-turbo` 同时触达 5 小时配额，导致自动化评审无法 dispatch。后续 Phase 3-5 没有再遇到，因为错开了高峰时段。

**影响：** Phase 2 评审被迫手动执行。

**摩擦点 3：LOW 问题膨胀**

Phase 1 的 spec review 产生了 8 个 LOW/INFO 问题，部分在 v2 又新增了 4 个。这些问题（步骤编号重复、Constraints 文本未同步）不阻塞 gate 但消耗撰写和阅读时间。Phase 3 的 code review 也产生了类似比例的 NICE-TO-HAVE 项。

**影响：** 每个 Phase 约多花 10-15 分钟处理 LOW 级别问题。

**摩擦点 4：test_cases_template → test_execution 的验证方式偏差**

模板中标注 `type: "ui"` / `type: "manual"` 的用例，执行时全部降级为代码审查。实际执行方式与模板描述不一致，但 gate 无法检测这个偏差。

### 2.2 Gate Quality（门禁质量）

| Phase | Gate 结果 | 误报 | 漏报 | 评价 |
|-------|----------|------|------|------|
| Spec | v1 fail, v2 pass | 无 | 无 | 精准拦截 3 个 MUST FIX |
| Plan | v1 fail, v2 pass | 无 | 无 | 精准拦截 6 个 MUST FIX |
| Dev | pass | 无 | onSend bug 未被 gate 检测 | gate 不覆盖运行时行为 |
| Test | pass | 无 | 自动化覆盖率 56% 被 25/25 passed 掩盖 | 需增加覆盖率维度 |
| PR | pass | 无 | 无 | — |

**Gate 的核心盲区：**
1. **无法区分测试验证方式** — 代码审查通过和自动化测试通过在 gate 层面等价
2. **无法检测框架隐式行为违规** — onSend 信封绕过在代码层面合法，只有运行时才暴露
3. **无法追踪跨 Phase 的一致性** — Phase 3 的 prompt 偏离了 Phase 1 的 spec，gate 不检查这个

### 2.3 Prompt Clarity（指令清晰度）

**清晰的环节：**
- spec 的 6 个 FR 层次分明，编号步骤让实现者可直接按序编码
- plan 的 Execution Group 和 Wave 调度关系清楚，代码模板提供了具体起点
- E2E Test Plan 的 7 个场景步骤具体可执行

**不清晰的环节：**
- `writing-plans` skill 对 subagent model 的引用方式不明确（应使用 taskComplexity）
- test_cases_template 的 `type` 字段语义模糊——是"理想验证方式"还是"分类标签"？
- code review checklist 中缺少"框架隐式行为"和"reply.send payload 与 hook 交互"维度

### 2.4 Automation Gaps（自动化缺口）

| 缺口 | 影响 | 可自动化程度 | 建议 |
|------|------|------------|------|
| 前端测试 | 11/25 用例无自动化 | 高（Playwright 可覆盖关键路径） | 引入 Playwright 冒烟测试 |
| AI prompt 质量 | mock LLM 无法验证真实效果 | 低（需要真实 LLM） | 手动探索性测试 + 截图记录 |
| FR 交叉引用检查 | 依赖人工 | 中（可脚本扫描 spec 中的字段引用一致性） | spec lint 工具 |
| 类型合同验证 | Phase 2 的 ProviderGroup 类型错误 | 高（TypeScript compiler 可以检测） | plan 阶段运行 tsc --noEmit |
| reply.send 约定检测 | onSend 回归 | 中（可 lint 检测 reply.send 中是否包含 code 字段） | 新增 ESLint 规则 |
| 测试验证方式追踪 | gate 无法区分自动化/代码审查 | 高（JSON 字段扩展） | test_execution.json 增加 verification_method |

### 2.5 Time Sinks（时间陷阱）

| 陷阱 | 耗时 | 占总时间 | 可避免性 |
|------|------|---------|---------|
| Phase 2 rate limit 等待 | ~15min | ~8% | 可避免（错峰或用本地模型） |
| LOW 问题处理 | ~40min（跨 Phase） | ~20% | 部分可避免（收紧准入标准） |
| onSend bug 修复 | ~10min | ~5% | 可避免（编码前检查约定） |
| test_execution.json 逐条填写 | ~10min | ~5% | 可避免（模板预填充） |
| Phase 2 文件读取（14 个源文件） | ~15min | ~8% | 部分可避免（预建类型索引） |

**总可避免时间：约 50 分钟 / 总 ~5 小时 ≈ 17%**

### 2.6 Harness 核心价值评估

** Harness 的核心价值 = 评审在正确的时间拦截了正确的问题**

| 被拦截的问题 | 拦截 Phase | 如果未拦截的后果 | 拦截 ROI |
|-------------|-----------|----------------|---------|
| stream_text_content 遗漏 | Phase 1 | Phase 3 后端读取 null body，调试 1-2h | 高 |
| summary 字段不一致 | Phase 1 | Phase 3 前后端接口不对齐，来回改 | 中 |
| 无退出路径 | Phase 1 | AI 对正常响应也生成无意义规则 | 中 |
| ProviderGroup 类型错误 | Phase 2 | Phase 3 编译错误，浪费时间 | 中 |
| JSON.parse 无保护 | Phase 3 | 生产 P1：admin 页面无法加载 | 高 |
| callLLM 无超时 | Phase 3 | admin API 无限挂起 | 高 |

**量化估算：** 6 个被拦截的问题，如果全部进入 Phase 4/5，总修复成本约 4-6 小时（含调试 + 修复 + 重测）。实际评审成本约 2 小时（含修复）。**净节省 2-4 小时。**

**Harness 最大的价值不是节省时间，而是避免了生产事故。** JSON.parse 无保护和 callLLM 无超时如果在 PR 合并后才发现，影响的是线上管理员——这是不可接受的。

---

## 三、关键数据汇总

### 跨 Phase 统计

| 指标 | 数值 |
|------|------|
| 总 MUST FIX | 14（spec 3 + plan 6 + dev 5） |
| 总审查轮次 | 7（spec 2 + plan 2 + dev 3） |
| 总 fix commits | 6 / 11 total（55% 是修复） |
| 自动化测试覆盖 | 14/25（56%） |
| 代码审查替代测试 | 11/25（44%） |
| 手动浏览器测试 | 0/25（0%） |
| CI 状态 | 全部通过 |
| PR | #150, CI green |

### Phase 间依赖关系验证

| Phase 1 产出 → | Phase 2 使用 | Phase 3 使用 | Phase 4 使用 | 一致性 |
|---------------|-------------|-------------|-------------|--------|
| 6 FR | 4 Tasks | 23 files | 25 cases | 基本一致 |
| 5 AC | E2E 7 scenarios | spec 合规矩阵 | AC 覆盖矩阵 | 一致 |
| stream_text_content | 确认格式 | extractResponseText | TC-1-10 覆盖 | 一致 |
| summary 字段 | plan 包含 | 后端输出 | TC-3-02 覆盖 | 一致 |
| buildSystemPrompt | plan 描述 | 精简英文版 | mock 测试 | **偏离** |

---

## 四、行动项（按优先级排序）

### P0：合并前必须完成

| # | 行动 | 归属 | 预计耗时 |
|---|------|------|---------|
| 1 | 手动执行 E2E Test Plan Scenario 1-3（配置→生成→保存全流程） | 合并前 | 15min |
| 2 | 用真实 LLM 做 AI prompt 质量探索性测试（3-5 种错误类型） | 合并前 | 20min |
| 3 | live proxy 测试 RetryRuleMatcher 缓存刷新 | 合并前 | 10min |

### P1：下一个迭代

| # | 行动 | 归属 |
|---|------|------|
| 4 | CLAUDE.md 架构部分记录 onSend hook 自动包装机制和 reply.send 约定 | CLAUDE.md |
| 5 | buildSystemPrompt 与 spec 对齐，或更新 spec 为实际使用的版本 | spec |
| 6 | Harness skill 的 subagent model 改用 taskComplexity，移除硬编码 model | harness skill |

### P2：改善 Harness

| # | 行动 | 归属 |
|---|------|------|
| 7 | test_execution.json 增加 verification_method 字段 | harness |
| 8 | code review checklist 增加"框架隐式行为"维度 | expert-reviewer skill |
| 9 | 集成测试规范：模拟前端 request<T>() 解包行为 | dev-flow 规范 |
| 10 | spec 增加 FR 交叉引用表内建章节 | spec skill |

### P3：长期改进

| # | 行动 | 归属 |
|---|------|------|
| 11 | 引入 Playwright 前端冒烟测试（至少 ProxyEnhancement + Logs 关键路径） | 项目规划 |
| 12 | 新增 ESLint 规则检测 reply.send 中的手动信封注入 | taste-lint |
| 13 | 收紧 LOW 问题准入标准（步骤编号、措辞润色标记为 INFO） | review skill |
| 14 | plan 阶段增加类型定义预扫描步骤 | plan skill |

---

## 五、一句话总结

五个 Phase 累计拦截了 14 个 MUST FIX（其中至少 2 个是生产阻断级缺陷），评审 ROI 为正。最大系统性问题是"框架隐式行为感知不足"（onSend 回归）和"前端测试覆盖为零"（44% 用例降级为代码审查）。Harness 流程的核心价值得到验证，但自动化水位还需提升——gate 层面无法区分"自动化测试通过"和"代码审查通过"是一个结构性盲区。
