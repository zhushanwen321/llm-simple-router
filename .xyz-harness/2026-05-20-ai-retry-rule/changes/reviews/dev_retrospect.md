---
phase: dev
verdict: pass
---

# Phase 3 (dev) 复盘 — AI Retry Rule Generation

**复盘日期:** 2026-05-21
**复盘范围:** eeac50c..e5d25bb（11 commits, 23 files, +2306 / -240）
**Phase 状态:** 通过（code review v2 verdict: pass, 全部测试通过, 全部门禁通过）

---

## 一、Phase 执行复盘

### 1.1 时间线

```
23:36  TDD 种子     — test(llm-client): write failing tests for callLLM utility
23:39  前端 AC1     — feat(frontend): add AI retry rule config card to proxy enhancement page
23:44  后端 AC1     — feat: implement callLLM utility for AI retry rule decision-making
23:54  后端测试     — test: add integration tests for AI retry rule endpoints
23:56  前端 AC2-AC4 — feat: add AI retry rule generation button and preview dialog
00:43  后端 AC3     — feat: add AI retry rule generation endpoint and config extension
00:44  前端修复     — fix: address code review issues (window.open, client-side validation)
01:03  后端修复     — fix: resolve code review MUST FIXes (JSON.parse, lint, i18n)
01:09  关键修复     — fix: remove onSend envelope bypass (回归 bug)
01:20  最终修复     — fix: add 30s timeout to callLLM, remove stale comment
01:21  文档更新     — docs: update test results after all code review fixes
```

**总耗时:** 约 1 小时 45 分钟（从 TDD 种子到最终 commit）
**编码阶段:** ~1 小时 10 分钟（23:36 → 00:43）
**修复阶段:** ~38 分钟（00:44 → 01:21，6 个 fix commits）

### 1.2 执行路径与问题发现

编码分为三个阶段：

**阶段 A: 初始实现（5 commits, 23:36 → 00:43）**

按 plan.md 的 Execution Group 顺序执行：
1. Group A（前端 AC1）→ ProxyEnhancement.vue 配置卡片
2. Group A（后端 AC1）→ callLLM 工具 + 测试
3. Group B（后端 AC3）→ retry-rules.ts 端点 + 测试
4. Group B（前端 AC2-AC4）→ UnifiedRequestDialog + AiRulePreviewDialog

TDD 流程正确执行：先写 `llm-client.test.ts` 失败测试，再实现 `callLLM()` 通过测试。但集成测试（`ai-retry-rule.test.ts`）是端点写完后补的，属于"先实现后测试"，偏离了 plan 的 TDD 要求。

**阶段 B: 前端专项审查修复（1 commit, 00:44）**

前端审查发现 2 个 MUST FIX：
- `goToConfig()` 使用 `router.push()` 而非 `window.open()`（违反 AC2）
- `handleSave()` 缺少客户端表单验证（违反 FR6）

两个都是 spec 合规问题，编码时就应避免。`window.open` 要求在 spec AC2 中明确写了；表单验证在 FR6 中也有要求。

**阶段 C: 后端代码审查修复（4 commits, 01:03 → 01:21）**

后端代码审查 v1 发现 2 个 MUST FIX：
- MF-1: `JSON.parse(aiConfigRaw)` 无 try-catch（P1，阻断页面加载）
- MF-2: 前端 lint 2 warnings（魔法数字 128000 + 静默 catch）

修复 MF-1 和 MF-2 后，发现了 **onSend 信封绕过回归 bug**（commit 5134769）。

### 1.3 onSend 信封绕过回归 bug — 深度分析

这是本次 Phase 3 最严重的 bug，值得单独分析。

**问题本质：**
- 后端有一个全局 `onSend` hook（`index.ts:216`），会检测 payload 是否包含 `code` 属性，如果没有就自动包装为 `{code:0, message:'ok', data:payload}`
- 初始实现中，开发者为了"统一响应格式"，在 `reply.send()` 时手动注入了 `{code:0, message:'ok', ...}` 信封结构
- 这导致 onSend hook 检测到 `code` 属性存在，不再包装
- 前端 `request<T>()` 始终从 `body.data` 解包，但手动注入的信封结构中没有 `data` 属性
- 结果：`body.data === undefined`，整个 proxy-enhancement 页面数据加载失败

**影响范围：** 不仅影响 AI 重试规则功能，还会导致代理增强页面已有的所有配置无法加载——这是一个全页面回归。

**为什么 TDD 没有捕获：** 集成测试直接访问 `body.success`、`body.rule` 等字段，没有经过 `request<T>()` 的解包逻辑。测试的"客户端"和实际的客户端（前端）行为不一致。

**根因分析：** 开发者不了解（或忘记了）onSend hook 的自动包装机制。这个机制是框架级的隐式行为，不容易从端点代码中感知到。

**修复方式：** 移除所有手动 `{code, message}` 注入，让 `reply.send()` 只发送业务 payload，让 onSend hook 统一包装。测试更新为 `body.data.xxx` 访问路径。

**教训：**
1. 框架级隐式行为应该在 CLAUDE.md 的架构部分明确记录
2. 集成测试应该模拟前端的解包行为，而不是直接访问裸 payload
3. 新端点的 `reply.send()` 模式应该遵循项目约定（只发业务 payload）

### 1.4 代码审查发现汇总

| 审查轮次 | MUST FIX | NICE TO HAVE | 关键发现 |
|---------|----------|-------------|---------|
| 前端审查 | 2 | 3 | window.open 要求未满足、表单验证缺失 |
| 后端 v1 | 2 | 6 | JSON.parse 无保护、lint 警告 |
| 后端 v2 | 0 (1 已修复) | 3 | callLLM 缺少超时（已在 commit 中修复） |

**审查捕获率：** 全部 MUST FIX 都是 spec 合规问题或明显缺陷，没有"误报"。审查质量高。

**遗漏：** callLLM 超时问题（v2 MF-1）在 v1 中未发现。v1 只关注了 JSON.parse 和 lint，遗漏了 FR2 明确要求的"30 秒超时"规约。

### 1.5 做得好的

1. **TDD 种子正确执行** — `llm-client.test.ts` 先于实现编写，8 个测试覆盖了成功/超时/错误/流式等场景
2. **文件行数控制** — 所有文件在 lint 限制内（最大 retry-rules.ts 346 行 < 1000）
3. **架构合规** — 正确使用 settings 表存储配置、callLLM 不经代理流程、编辑-保存模式、全 shadcn-vue 组件
4. **spec 合规矩阵** — 两次代码审查都产出了详细的 FR/AC 覆盖矩阵，逐条验证
5. **修复速度** — 6 个 fix commits 在 38 分钟内完成，问题定位精准
6. **i18n 完整** — 中英文翻译同步添加，没有遗漏 key

### 1.6 做得不好的

1. **onSend 信封绕过** — 最严重的回归 bug。编码时应该检查已有端点的 `reply.send()` 模式，而不是自创信封格式
2. **前端 spec 违规** — `window.open` 和表单验证在 spec 中明确要求，编码时应优先保证 spec 合规
3. **集成测试与前端行为不一致** — 测试直接访问 `body.xxx`，而前端通过 `body.data.xxx` 解包，导致测试通过但实际功能失败
4. **callLLM 超时遗漏** — v1 审查未对照 FR2 逐条检查，遗漏了"30 秒超时"规约
5. **prompt 与 spec 偏差** — buildSystemPrompt 使用精简英文版，spec 定义了详细中文 prompt。两轮审查都标记为 NH，但实际对 AI 生成质量有影响

### 1.7 如果重来

1. **编码前先读 reply.send 惯例** — 花 2 分钟 grep `reply.send(` 看已有端点的模式，就能避免 onSend 回归
2. **先写端到端测试框架** — 如果集成测试模拟 `request<T>()` 的解包行为，onSend bug 会在编码阶段被捕获
3. **编码时对照 spec FR 逐条** — 用 checklist 方式逐项实现，避免遗漏 window.open、表单验证、超时等明确要求
4. **prompt 应与 spec 对齐或更新 spec** — 如果认为精简英文 prompt 更好，应该在 spec 阶段就提出并修改 spec，而不是在实现中偏离
5. **减少 fix commits** — onSend 修复和 callLLM 超时可以合并到一次修复提交中，减少来回

---

## 二、Harness 体验复盘

### 2.1 Subagent 调度效率

本次 Phase 3 由主 agent 手动编排执行（非 subagent 驱动），原因：
- 功能复杂度为 L1，plan 只拆了 2 个 Execution Group
- 代码审查使用独立 reviewer subagent

**审查 subagent 调度：**
- 前端审查：1 次 dispatch，发现 2 MUST FIX
- 后端 v1 审查：1 次 dispatch，发现 2 MUST FIX
- 后端 v2 审查：1 次 dispatch，确认全部修复，0 MUST FIX
- 总计 3 次 subagent dispatch

**效率评估：** 3 次 review dispatch + 修复 → 总计约 38 分钟（从 00:44 到 01:21），效率合理。没有出现 plan 阶段的 rate limit 问题。

### 2.2 TDD 流程有效性

**有效部分：**
- `llm-client.test.ts` 先于实现编写，TDD 种子正确
- 测试覆盖了 callLLM 的主要路径（成功、超时、错误、流式 fallback）
- 测试与实现解耦良好（mock HTTP server，不依赖外部服务）

**失效部分：**
- `ai-retry-rule.test.ts` 是端点实现后补写的，不是 TDD
- 测试未模拟前端 `request<T>()` 解包行为，导致 onSend bug 未被捕获
- plan 要求"纯函数 TDD，状态机可先实现后测试"，但实际执行中没有严格遵循

**评估：** TDD 对工具函数（callLLM）有效，对端点集成测试无效。集成测试的 value 在于验证端到端行为，但前提是测试的"客户端"行为要和真实客户端一致。

### 2.3 代码审查捕获率

| 问题类型 | 前端审查 | 后端 v1 | 后端 v2 | 总计 |
|---------|---------|--------|--------|------|
| Spec 合规 | 2 (MF) | 0 | 0 | 2 |
| 代码质量 | 0 | 2 (MF) | 1 (MF, 已修复) | 3 |
| 架构/安全 | 0 | 0 | 0 | 0 |
| 性能 | 0 | 0 | 0 | 0 |

**关键捕获：**
- `window.open` 违规（前端审查）— spec 明确要求，编码遗漏
- `JSON.parse` 无保护（后端 v1）— 实际会阻断页面加载的 P1 bug
- `callLLM` 缺少超时（后端 v2）— 会导致 admin API 无限挂起

**关键遗漏：**
- onSend 信封绕过 — 两轮后端审查都没有在代码中检测到这个问题。v2 专门做了"A. 信封格式正确性"专项检查，但那是在 5134769 修复之后。这说明 v1 审查时信封绕过代码还在，但 reviewer 没有检查 reply.send 的 payload 结构是否会被 onSend hook 正确处理。

**评估：** 审查对 spec 合规和代码质量问题捕获率 100%。对框架级隐式行为（onSend hook）的审查需要更明确的检查维度。

### 2.4 Dev-Flow 规范合理性

**合理的规则：**
- **编码评审 MUST NOT SKIP** — 本次证明了评审的价值：3 轮审查捕获了 5 个 MUST FIX，其中 2 个是阻断性 bug
- **AC 覆盖矩阵** — 每轮审查都产出 FR/AC 矩阵，确保 spec 逐条覆盖
- **YAML frontmatter 机器可读** — gate 检查可以自动解析 verdict/must_fix

**需要改进的规则：**
- **集成测试应模拟前端行为** — 当前测试规范没有要求测试的"客户端"行为和真实前端一致。建议新增规则："Admin API 集成测试应使用 `request<T>()` 等效的解包逻辑验证响应结构"
- **框架隐式行为审查维度** — 代码审查的检查维度应增加："reply.send() 的 payload 是否会被框架级 hook 正确处理"，特别是项目使用了全局 onSend hook 时
- **callLLM 超时属于 FR2 规约** — v1 审查遗漏了 FR2 的超时要求。建议在审查 checklist 中增加"逐条对照 FR 字段，标记已检查/未检查"

### 2.5 时间分配分析

| 阶段 | 时间 | 占比 | 说明 |
|------|------|------|------|
| TDD 种子 + 实现 | ~67 min | 64% | 5 feat/test commits |
| 前端修复 | ~1 min | 2% | 1 fix commit（审查发现的问题修复很快） |
| 后端修复 | ~37 min | 34% | 4 fix + 1 docs commits |

编码和修复的 64:34 比例偏重修复侧。理想状态应该在 80:20 左右。修复时间主要花在 onSend 回归 bug 上（需要理解框架行为、修改 3 个文件、更新测试字段路径）。

如果编码前花 2 分钟检查 reply.send 惯例，可以节省约 10 分钟（onSend 修复 + 测试更新），将比例改善到 ~75:25。

---

## 三、总结

### 关键数据

| 指标 | 数值 |
|------|------|
| 总 commits | 11（5 feat/test + 5 fix + 1 docs） |
| 总文件变更 | 23 files, +2306 / -240 |
| 测试用例 | 19（8 unit + 11 integration） |
| 审查轮次 | 3（前端 1 + 后端 2） |
| MUST FIX 发现 | 5（全部修复） |
| 回归 bug | 1（onSend 信封绕过，已修复） |
| 质量门禁 | 全部通过 |

### 一句话总结

编码阶段产出速度快、架构合规度高，但 onSend 信封绕过回归 bug 暴露了"框架隐式行为感知不足"的系统性问题。三轮代码审查有效捕获了所有阻断性缺陷，验证了评审不可跳过规则的合理性。如果编码前多花 2 分钟检查项目约定，可以避免最严重的回归。

### 行动项

| # | 行动 | 归属 | 优先级 |
|---|------|------|--------|
| 1 | 在 CLAUDE.md 架构部分记录 onSend hook 的自动包装机制和 reply.send 约定 | CLAUDE.md | P1 |
| 2 | 新增代码审查维度：reply.send payload 与框架 hook 的交互 | expert-reviewer skill | P2 |
| 3 | 集成测试应模拟前端 request<T>() 解包行为 | dev-flow 规范 | P2 |
| 4 | buildSystemPrompt 应与 spec 对齐，或在 spec 阶段就更新为实际使用的精简版 | spec | P3 |
