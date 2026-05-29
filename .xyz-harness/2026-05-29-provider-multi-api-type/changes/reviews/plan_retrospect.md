---
phase: plan
verdict: pass
---

# Phase 2 (Plan) Retrospect — provider-multi-api-type

## 1. Phase Execution Review

### Summary
产出了完整的 L2 plan 交付物：plan.md 总纲 + 3 个子文档（plan-backend.md、plan-api-contract.md、plan-frontend.md）+ interface_chain.json + e2e-test-plan.md + test_cases_template.json + use-cases.md + non-functional-design.md + 前端 UI demo（HTML）。经过 5 轮 plan review 才通过 gate，核心阻力是跨文档一致性。

### Problems Encountered

1. **跨文档一致性维护成本极高**：resolveEndpoint 的空数组行为（throw vs fallback）、parseEndpoints 的位置（providers.ts vs resolve-endpoint.ts）、迁移文件拆分（单文件 vs 双文件）——每个决策在 4-5 个文档中都有引用，修改一处容易遗漏其他。5 轮 review 中 4 轮的 MUST FIX 都是跨文档同步问题，而非设计错误。

2. **前端 UI demo 迭代了 3 版**：v1（独立列设计，用户否决）→ v2（三列分离但编辑表单区分单/多模式）→ v3（统一列表模式 + 紧凑两行 + Shared key 内联）。用户对 UI 细节要求高（行高对齐、label 位置、预设模板适配），这部分占了不少对话轮次。

3. **review subagent 与主 agent 修复之间的时序竞争**：dispatch review subagent 后立即修复文档，导致 reviewer 看到的是修复前的状态。v3/v4 两轮都是这个问题。理想情况下应该先修复再 dispatch review，但实际操作中修复和 review 几乎同时进行。

### What Would You Do Differently

1. **先定行为表再写子文档**：resolveEndpoint 的 9 种输入场景应该在 plan.md 总纲中一次性定义清楚（行为表），所有子文档从行为表派生。而不是每个子文档独立描述，再反复对齐。

2. **前端 UI demo 和 plan 文档解耦**：UI demo 的迭代（用户反馈→修改→再反馈）应该作为一个独立的 review loop，不阻塞 plan 文档的 review 流程。这次 UI demo 的 3 轮迭代和 plan review 的 5 轮迭代混在一起，增加了总轮次。

3. **修复后再 dispatch review**：reviewer 发现 MUST FIX 后，应该先完成所有文档修复，验证无遗漏，再 dispatch 下一轮 review。而不是边修边 review，导致 reviewer 看到中间状态。

### Key Risks for Later Phases

1. **跨文档一致性问题会重现**：dev 阶段实现时，开发者可能读到 plan-backend.md 的某个旧版本描述（如 "fallback 到旧字段"），按错误语义实现。建议 dev 阶段开始前，统一清理子文档中的残留矛盾。

2. **前端表单重构复杂度**：plan-frontend.md 涉及 10 个文件、~550 行变更，包括新建 EndpointEditor 组件、重构 useProviderForm、改造 ModelCapabilitiesEditor。这是整个 plan 中前端变更量最大的部分，需要仔细的组件拆分。

3. **BG3 的 8 文件修改**：failover-loop.ts 的 12 处 provider 字段访问替换，加上 patch/transport/log 适配，涉及代理层核心路径。任何一处遗漏都会导致运行时错误。

## 2. Harness Usability Review

### Flow Friction

1. **L2 子文档模式的一致性成本**：plan-backend.md / plan-api-contract.md / plan-frontend.md 由不同 subagent 并行产出，风格和术语不一致是必然的。后续需要主 agent 做一轮手动对齐（本次花了 4 轮 review 的代价）。
2. **gate check 对 interface_chain.json 的 schema 校验严格**：要求 `version` 和 `class` 字段，但 skill 文档中的模板没有这两个字段。这种"文档模板 ≠ 实际 schema 要求"的 gap 增加了一轮失败。

### Gate Quality

1. **plan review subagent 质量高**：每轮都能准确识别跨文档矛盾，没有误报。第 1 轮的 5 条 MUST FIX 全部是真实问题。
2. **gate 脚本的文件存在性检查有效**：检测到 plan_bl_review.md 缺失、interface_chain.json 缺 version 字段。但这些检查在 subagent 返回 pass 后才触发，说明 gate 脚本和 review subagent 的校验范围有重叠但各有侧重。

### Prompt Clarity

1. **writing-plans skill 的 L2 Flow 指引清晰**：子文档拆分（backend + frontend + api-contract）+ 执行编排（Execution Groups + Wave Schedule）+ 接口契约（methods + data_flows + AC 矩阵）的结构很完整。
2. **Execution Groups 的 subagent 配置模板过于详细**：每个 Group 要列出 Agent 链、Model、注入上下文、读取文件、修改文件。对 L2 plan 来说这些信息大部分是重复的（如 BG1/BG2/BG3 的 Agent 链完全相同），增加了文档量但价值有限。

### Automation Gaps

1. **跨文档一致性检查应自动化**：resolveEndpoint 在 5 个文档中出现，parseEndpoints 在 4 个文档中出现。一个简单的 grep + diff 脚本就能检测矛盾，不需要 5 轮人工 review。
2. **subagent 产出应经过一致性 pre-check**：dispatch 子文档产出 subagent 后，主 agent 应该先做一轮自动一致性检查（grep 关键函数签名，对比返回值/边界条件），再 dispatch review subagent。

### Time Sinks

1. **5 轮 plan review** 占了 Phase 2 总时间的 ~60%。其中 ~80% 的问题是跨文档一致性，只有 ~20% 是真正的设计问题。如果有一致性检查脚本，理论上 2 轮就能通过。
2. **UI demo 迭代** 占了 ~25%。用户对 UI 细节很关注（行高对齐、label 位置），但这些都是实现阶段才需要精确处理的事情。在 plan 阶段做高保真 mockup 的 ROI 不高。
