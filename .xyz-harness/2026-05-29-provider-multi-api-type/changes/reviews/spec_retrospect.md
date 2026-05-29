---
phase: spec
verdict: pass
---

# Phase 1 (Spec) Retrospect — provider-multi-api-type

## 1. Phase Execution Review

### Summary

完成了 Provider 多协议 Endpoint 支持的需求分析和 spec 编写。核心产出：
- **spec.md**：7 个 FR（数据模型、封装层、迁移、Admin API、日志、前端、UI Demo），13 条 AC，5 个决策，3 个业务用例
- **CONTEXT.md**：新增 Endpoint / ResolvedEndpoint 术语定义
- **ADR 0006**：记录 endpoints JSON 字段 vs 关系表的架构决策
- **前端 UI Demo**：4 个场景的 HTML mockup（列表、编辑、QuickSetup、日志）
- **两轮 spec review**：第 1 轮 3 条 MUST FIX，第 2 轮全部修复通过

关键设计决策历程：
1. 初始方案（endpoint JSON 字段 + 兼容旧字段）→ 用户要求统一一套逻辑
2. 修订为一次性迁移 + 全部代码只读 endpoints（消除双路径）
3. 用户要求格式转换也支持（降级策略），进一步简化架构
4. 用户提出封装 resolveEndpoint()，将 URL 决策逻辑封装在 provider 模块内部

### Problems Encountered

1. **初始方案过于保守**：第一版设计保留了 `if endpoints is null` 的双路径兼容，用户正确指出这违背架构简洁性。修正为一次性迁移 + 统一解析。
2. **Review 第 1 轮发现 AC 覆盖不足**：openai-responses 枚举值完全缺失 AC、Provider 创建正向流程无 AC、api_key 加密链路无验证。这说明初始写 AC 时聚焦了核心路由逻辑，忽略了 CRUD 生命周期和安全路径。
3. **前端影响面评估后置**：在讨论到前端改动时才启动 subagent 扫描，如果一开始就并行扫描，能更早确认影响范围。

### What Would You Do Differently

1. **AC 编写时先列枚举覆盖矩阵**：3 种 api_type × N 种行为 = 矩阵，确保每个枚举值在每个行为维度都有 AC。这比写完再被 review 指出效率更高。
2. **前端扫描并行化**：在 Step 2 提问阶段就启动前端影响面扫描，而不是等用户提到前端改动才做。这次扫描结果直接影响了 FR-6 的拆分粒度。
3. **CRUD 生命周期检查表**：spec 自检时加一个"创建→读取→更新→删除→迁移"的 checklist，避免遗漏正向流程。

### Key Risks for Later Phases

1. **DB 迁移的幂等性**：SQLite 的 `ALTER TABLE ADD COLUMN` 在列已存在时会报错。Plan 阶段需要明确迁移脚本的幂等保护策略（try-catch 或条件检查）。
2. **前端 Provider 编辑表单复杂度**：从单组字段改为可变长 endpoint 列表，表单逻辑（useProviderForm.ts）需要较大重构，且要处理单 endpoint 和多 endpoint 两种 UI 模式的切换。
3. **3 个中间层适配的一致性**：patch 层、plugin 层、transport-fn 层都需要从 `provider.api_type` 改为从 `ResolvedEndpoint` 取值，改法一致但分散在 3 处，容易遗漏。

## 2. Harness Usability Review

### Flow Friction

- **On-demand scan 时机合理**：3 次 subagent 扫描（provider 字段使用点、中间层冲突分析、前端影响面）都在关键决策点触发，没有无目的扫描。
- **用户参与度高**：用户在 4 个关键节点提供了方向性决策（纯路由选择、独立 key + 兜底、全部共享、统一封装），避免了 AI 自行猜测导致的返工。

### Gate Quality

- **Review 质量高**：第 1 轮审查准确识别了 3 个结构性缺陷（枚举覆盖、生命周期、安全路径），没有误报。第 2 轮确认全部修复。
- **Gate 脚本未实际运行**：本次 gate 由 coding-workflow-gate 工具直接检查 review verdict，未调用 `check_gate.py`。如果 gate 脚本有独立逻辑（如文件存在性检查），可能存在盲区。

### Prompt Clarity

- **Brainstorming skill 指导清晰**：Step 2 提问层次分明（Layer 1-3），帮助结构化地覆盖了目的、行为、边界。
- **Self-check checklist 有效**：枚举覆盖、生命周期、数据模型预检三个 checklist 直接导致了 review 中 MUST FIX 的发现（虽然是在 review 阶段而非自检阶段）。

### Automation Gaps

- **枚举覆盖矩阵应自动化**：spec 定义了 3 种 api_type，AC 中是否每种都有覆盖，这个检查可以由脚本完成而非人工 review。
- **前端影响面扫描可预置**：当 spec 涉及 DB schema 变更时，自动触发"哪些前端组件消费了这些字段"的扫描。

### Time Sinks

- **方案迭代**：初始方案→统一方案→加入格式转换降级，经历了 3 次方向调整。但这些调整都是用户主动提出的改进方向，不算浪费。
- **AC 补充**：第 1 轮 review 后补充了 5 条 AC（AC-2b/3b/4扩展/5扩展/9/10），占了较多时间。如果初始写 AC 时就用枚举矩阵，可以一次写完。
