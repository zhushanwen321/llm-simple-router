---
phase: dev
verdict: pass
---

# Phase 3 (Dev) Retrospect — provider-multi-api-type

## 1. Phase Execution Review

### Summary

实现了 Provider 多 API 类型支持的全部功能代码。按 Wave 调度 3 批 subagent：
- **Wave 1 (BG1)**: ProviderEndpoint/ResolvedEndpoint 类型、parseEndpoints/serializeEndpoints、resolveEndpoint()、迁移 051。TDD 流程：先写 22 个测试用例（全红），再实现函数（全绿）
- **Wave 2 (BG2+BG3 并行)**: Admin API endpoints 格式（加密/解密/双写兼容）+ 代理层适配（failover-loop resolveEndpoint 集成、日志 upstream 字段、迁移 052）
- **Wave 3 (FG1)**: 前端 EndpointEditor 组件、Providers 表单/列表、QuickSetup 适配、日志箭头显示

最终结果：140 测试文件通过（1730 tests）、前端 build/lint/type-check 全绿。

### Problems Encountered

**1. subagent 实现 BG2 时修改了 BG1 的 providers.ts**

BG2 subagent 在实现 Admin API 时，修改了 `updateProvider()` 的 Pick 类型（新增 `"endpoints"`）和 `createProvider()` 的签名。这属于跨 Group 的边界入侵——BG2 不应该改 BG1 的 DB 层函数签名。

原因：`createProvider()` 的参数类型需要包含 `endpoints`，但这个改动本应在 BG1 完成而未完成（BG1 只加了 Provider interface 的 endpoints 字段和 PROVIDER_FIELDS，漏了 createProvider 参数类型）。

影响：轻微。BG2 subagent 的修改是正确的，只是说明 BG1 的 task 定义对 createProvider 的签名变更覆盖不足。

**2. 5 维度评审中 2 维 FAIL，共 5 个 MUST FIX**

| 维度 | ID | 问题 | 根因 |
|------|----|------|------|
| TS Taste | M1 | `ApiType` 在 3 个文件重复定义 | 新增类型时未搜索现有同名类型，直接 copy |
| TS Taste | M2 | `failover-loop.ts` 659 行超限 | 历史债务 + 本次变更加重 |
| TS Taste | M3 | eslint-disable 违规 | 历史代码中的 suppress，本次未清理 |
| Robustness | MF-1 | resolveEndpoint 在循环内无 try-catch | 编码时遗漏异常边界 |
| Robustness | MF-2 | parseEndpoints 不校验必填字段 | 解析层防御不足 |

M1 违反了 CLAUDE.md 的"写之前先读"。MF-1 是最严重的——resolveEndpoint 异常会让 failover 循环直接崩溃而非跳过 target。

**3. Taste Review v2 引入了新的 MUST FIX（M4）**

修复 M2（failover-loop 拆分）时，subagent 在 catch 块中添加了 `// eslint-disable-line taste/no-silent-catch` 注释，这本身就是 M3 正在修复的同类违规。v2 审查员正确地把它标记为新 MUST FIX。

这说明修复 MUST FIX 时引入新违规的风险不可忽视——特别是代码品味类规则（eslint-disable 是最容易被"顺手"加上的）。

**4. 瞬态测试失败**

首次运行全量测试时出现 1 个测试文件失败（modality-redirect.test.ts 的 DB 连接问题），但第二次运行全部通过。这是 SQLite :memory: 测试的已知 flakiness，不是代码问题。

### What Would You Do Differently

1. **BG1 task 定义应更精确**：createProvider() 的参数类型变更应该在 BG1 中完成，而不是留给 BG2。task prompt 应明确列出所有需要修改的函数签名，包括 INSERT 语句中的列名变更。

2. **编码前执行类型查重**：新增 `ApiType` 时应该先 `grep -r "type ApiType" router/src/` 确认是否已存在。这是"写之前先读"的基本要求，CLAUDE.md 明确列出。

3. **修复 MUST FIX 时禁止引入 eslint-disable**：在 dispatch 修复 subagent 的 task prompt 中应显式添加约束："修复过程中禁止添加任何 eslint-disable 注释"。

4. **failover-loop 应先重构再扩展**：在 BG3（向 failover-loop 添加 resolveEndpoint 调用）之前，应该先做文件拆分重构。先拆再扩，避免膨胀。

### Key Risks for Later Phases

1. **E2E 测试可能暴露前端联调问题**：前端 EndpointEditor 在 BG2 Admin API 就绪后才开发，但 subagent 没有实际联调环境。E2E 测试中可能发现 payload 格式不匹配（如 endpoints 数组中 null vs 空字符串）。

2. **failover-loop 重构的回归风险**：拆分后主函数 247 行 + 3 个子函数，虽然测试全绿但 failover-loop 是代理核心路径，任何边界条件遗漏都会在生产环境暴露。

3. **前端 QuickSetup 模板的预设逻辑**：QuickSetup 的 buildProviderPayload 现在输出 endpoints 格式，但预设模板（openai + anthropo）是硬编码的 api_type 组合。如果后端新增 API 类型（如 google-genai），前端模板也需要同步更新。

## 2. Harness Usability Review

### Flow Friction

1. **Wave 调度模式效果好**：3 个 Wave（BG1 → BG2+BG3 → FG1）的依赖关系清晰，BG2 和 BG3 并行执行节省了时间。每个 subagent 的 task prompt 包含了足够的上下文（接口契约、文件路径、约束条件），subagent 能独立完成编码。

2. **TDD 红绿阶段的 dispatch 顺序合理**：先 dispatch TDD subagent 写测试（红色），再 dispatch 实现 subagent 让测试通过（绿色）。但主 agent 没有实际运行红色阶段测试来确认"确实失败了"——只依赖 subagent 的报告。

### Gate Quality

1. **5 步专项审查比单步 code review 有效**：不同维度从不同角度发现同一问题（如 BLR 和 Robustness 都发现了 legacy 路径空 key），交叉验证增加了发现率。

2. **Integration Review 的串行依赖合理**：BLR 产出的模拟业务数据确实帮助 Integration Review 做了跨层数据链路验证。4 条数据链路（创建→DB→GET→显示、代理→resolve→transport→日志）都被追踪了。

3. **无 false positive**：5 个 MUST FIX 全部是真实问题，修复后评审确认通过。

### Prompt Clarity

1. **接口契约传递有效**：interface_chain.json 中的方法签名（params/returns/edge_cases）被注入到每个 subagent 的 task prompt 中。resolveEndpoint 的 9 种行为场景完整传递，实现完全对齐。

2. **前端 task prompt 的约束条件详细**：shadcn-vue 禁令、行数上限、错误处理模式都明确列出。前端 subagent 产出的代码没有违反任何约束。

### Automation Gaps

1. **MUST FIX 修复后无自动 re-review**：需要手动 dispatch v2/v3 审查 subagent。如果能自动触发"受影响维度的 re-review"，可以减少 2 轮手动调度。

2. **跨维度 issue 去重缺失**：BLR LOW-1 和 Robustness LOW-1 是同一个问题（legacy 路径空 key），但没有合并机制。在修复时需要人工判断是否是重复问题。

3. **瞬态测试失败的自动重试**：vitest 第一次运行偶尔会有 1 个文件失败（SQLite 连接问题），但第二次运行通过。gate 应该支持"允许 N 次重试"来处理 flaky tests。

### Time Sinks

1. **Taste Review 的 3 轮迭代**（v1→v2→v3）占了 dev 阶段审查时间的 ~50%。M1（ApiType 重复）和 M4（eslint-disable）都是"修复-审查-再修"的循环。根因是编码时没有执行基本的查重和规范检查。

2. **failover-loop.ts 的拆分重构**（M2）是单个最耗时的修复。从 659 行拆到 851 行（含 3 个提取函数 + 主函数 247 行），涉及大量代码移动和测试回归验证。
