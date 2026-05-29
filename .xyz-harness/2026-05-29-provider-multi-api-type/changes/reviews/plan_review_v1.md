---
review:
  type: plan_review
  round: 1
  timestamp: "2026-05-29T20:30:00"
  target: ".xyz-harness/2026-05-29-provider-multi-api-type/plan.md"
  verdict: fail
  summary: "计划评审完成，第1轮，5条MUST FIX（行为契约矛盾、迁移SQL错误、文件列表遗漏），需修改后重审"

statistics:
  total_issues: 8
  must_fix: 5
  must_fix_resolved: 0
  low: 3
  info: 0

issues:
  - id: 1
    severity: MUST_FIX
    location: "plan.md Interface Contracts + interface_chain.json + plan-backend.md §1.3/§1.4"
    title: "parseEndpoints/resolveEndpoint 行为契约跨文档矛盾"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 2
    severity: MUST_FIX
    location: "plan-backend.md §2.1 migration SQL"
    title: "Migration SQL 使用 json_group_array（聚合函数）而非 json_array（标量函数）"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 3
    severity: MUST_FIX
    location: "plan.md File Structure vs plan-backend.md §2.4"
    title: "迁移文件数量矛盾：plan.md 列 051+052 两个文件，plan-backend.md 说同一文件"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 4
    severity: MUST_FIX
    location: "plan.md BG3 File Structure + plan-backend.md §5"
    title: "BG3 缺少 db/logs.ts 和 admin/logs.ts——日志新字段的写入和读取链路断裂"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 5
    severity: MUST_FIX
    location: "plan.md File Structure vs plan-backend.md §1.4"
    title: "parseEndpoints 函数位置矛盾：resolve-endpoint.ts vs providers.ts"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 6
    severity: LOW
    location: "plan-frontend.md §3.4 + §4.1"
    title: "preset.dualProtocol 字段在后端/数据源中无定义"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 7
    severity: LOW
    location: "plan.md File Structure FG1 行"
    title: "前端 i18n JSON 文件和 useProviderPresets.ts 未列入 File Structure"
    status: open
    raised_in_round: 1
    resolved_in_round: null
  - id: 8
    severity: LOW
    location: "plan-backend.md §4.1"
    title: "failover-loop.ts 行号硬编码，实现时可能已过期"
    status: open
    raised_in_round: 1
    resolved_in_round: null
---

# 计划评审 v1

## 评审记录
- 评审时间：2026-05-29 20:30
- 评审类型：计划评审
- 评审对象：`plan.md` + `plan-backend.md` + `plan-api-contract.md` + `plan-frontend.md` + `interface_chain.json` + `e2e-test-plan.md` + `use-cases.md` + `non-functional-design.md` + `spec.md` + `test_cases_template.json`
- 评审轮次：第 1 轮

---

## 1. spec 完整性

**目标明确性**: ✅ 通过。spec 第一段清楚描述目标：Provider 新增 `endpoints` JSON 字段存储多 endpoint 数组，客户端请求自动匹配，不匹配走 FormatRegistry 格式转换。

**范围合理性**: ✅ 通过。In Scope / Out of Scope 边界清晰。六项 Out of Scope 明确排除了 failover/retry/mapping group 等不改动的子系统。

**验收标准可量化**: ✅ 通过。AC-1 到 AC-10 全部使用 Given/When/Then 格式，可直接映射为测试用例。无模糊描述。

**[待决议] 项**: 无。

**结论**: spec 本身质量好，无需修改。

---

## 2. plan 可行性

### 任务拆分

5 个 Task 分 4 个 Execution Group，粒度适中：
- Task 1 (BG1): 类型 + 迁移 + resolveEndpoint —— 核心数据基础，适合独立完成
- Task 2 (BG2): Admin API CRUD —— 依赖 BG1 类型定义，粒度合理
- Task 3 (BG3): 代理层 + 日志 —— 依赖 BG1 resolveEndpoint，**但文件列表有遗漏**（见 Issue #4）
- Task 4+5 (FG1): 前端表单 + 列表 + QuickSetup + 日志 —— 合并为一个 Group 合理

### 依赖关系

依赖图正确：`BG1 → BG2 ∥ BG3 → FG1`。BG2 和 BG3 可并行，无文件冲突。✅

### 工作量估算

plan.md 列出 24 个文件变更（5 create + 19 modify），前端预估 550 行变更。对于"中等"复杂度需求，估算合理。

### 遗漏检查

对照 spec FR 逐条：
- FR-1 ~ FR-5: 后端覆盖 ✅
- FR-6a ~ FR-6c: 前端覆盖 ✅
- FR-7 (UI Demo): 标记为可选，不阻塞验收 ✅
- **遗漏**: FR-5 数据消费者链不完整（见 Issue #4）

---

## 3. spec 与 plan 一致性

### FR 覆盖检查

| FR | plan 覆盖 | Task | 子文档 |
|----|----------|------|--------|
| FR-1 Endpoint 数据模型 | ✅ | Task 1 | plan-backend.md §1 |
| FR-2 resolveEndpoint | ✅ | Task 1 | plan-backend.md §1.3 |
| FR-3 DB 迁移 | ✅ | Task 1 | plan-backend.md §2 |
| FR-4 Admin API | ✅ | Task 2 | plan-backend.md §3 |
| FR-5 请求日志 | ⚠️ 部分 | Task 3 | plan-backend.md §5（见 Issue #4） |
| FR-6a 列表页 | ✅ | Task 5 | plan-frontend.md §2 |
| FR-6b 编辑表单 | ✅ | Task 4 | plan-frontend.md §3 |
| FR-6c QuickSetup | ✅ | Task 5 | plan-frontend.md §4 |
| FR-7 UI Demo | ✅ 可选 | — | — |

### AC 覆盖矩阵

plan.md 的 Spec Coverage Matrix 覆盖了所有 10 个 AC。交叉验证：

| AC | plan 覆盖 | 子文档覆盖 | 测试用例 |
|----|----------|-----------|---------|
| AC-1 | ✅ Task 1 | plan-backend §1.3 行#1 | TC-1-01, TC-1-02 |
| AC-2 | ✅ Task 1 | plan-backend §1.3 行#3 | TC-1-03 |
| AC-2b | ✅ Task 1 | plan-backend §1.3 行#5 | TC-1-05 |
| AC-3 | ✅ Task 1 | plan-backend §1.3 行#2 | TC-1-04 |
| AC-3b | ✅ Task 1 | plan-backend §1.3 行#6 | TC-1-06 |
| AC-4 | ✅ Task 2 | plan-backend §3.2-3.3 | TC-2-05 |
| AC-5 | ✅ Task 1+2 | plan-backend §2 | TC-1-01, TC-1-02 |
| AC-6 | ✅ Task 2 | plan-backend §3.1 | TC-2-02, TC-2-03 |
| AC-7 | ✅ Task 3 | plan-backend §5 | TC-3-03, TC-3-04 |
| AC-8 | ✅ Task 5 | plan-frontend §2 | TC-4-01 |
| AC-9 | ✅ Task 5 | plan-frontend §4 | TC-4-04 |
| AC-10 | ✅ Task 1 | plan-backend §1.3 | TC-3-05 |

所有 AC 有对应测试用例。✅

### plan 额外工作

plan-frontend.md §3.4 引入了 `preset.dualProtocol` 概念和 `buildEndpointsFromPreset()` 函数。这在 spec 中未提及（spec 只说了 QuickSetup payload 格式变更），属于前端实现细节扩展，不与 spec 矛盾，但该数据字段不存在于后端推荐 Provider 数据中（见 Issue #6）。

---

## 4. Execution Groups 合理性

### 分组合理性

| Group | 文件数 | Task 数 | 合理性 |
|-------|--------|---------|--------|
| BG1 | 5 | 1 | ✅ 功能内聚：数据基础层 |
| BG2 | 3 | 1 | ✅ 功能内聚：Admin API |
| BG3 | 6（实际应为 8，见 Issue #4） | 1 | ✅ 功能内聚：代理层 + 日志 |
| FG1 | 10（实际应为 ~15，见 Issue #7） | 2 | ✅ 前端统一，无后端混合 |

### 类型划分

BG1/BG2/BG3 纯后端，FG1 纯前端。✅ 无前后端混合 Group。

### Wave 编排

Wave 2（BG2 ∥ BG3）可并行：无文件冲突。✅

### Subagent 配置完整性

所有 4 个 Group 都包含 Agent、Model、注入上下文、读取文件、修改/创建文件。✅

**上下文充分性检查**:
- BG1 注入 `spec FR-1/FR-2/FR-3, plan-backend.md §1-§3`，读取 `types.ts, providers.ts, 050_*.sql` —— 充分 ✅
- BG2 注入 `spec FR-4, plan-api-contract.md, plan-backend.md §4`，读取 `admin/providers.ts, crypto.ts` —— 充分 ✅
- BG3 注入 `spec FR-2/FR-5, plan-backend.md §5-§6` —— **但缺少 db/logs.ts 和 admin/logs.ts 在文件列表中**（Issue #4）
- FG1 注入 `plan-frontend.md, UI demo HTML, shadcn-vue 规范` —— 充分 ✅

---

## 5. 接口契约审查

### interface_chain.json 一致性

`interface_chain.json` 中 `parseEndpoints` 的 edge cases 与 `plan-backend.md §1.4` 和 `plan-api-contract.md` 存在严重矛盾（见 Issue #1）。

### data_flows cross-reference

`flow-migration` 引用了 `serializeEndpoints()` 但迁移是纯 SQL，TypeScript 函数不会被调用。这是文档描述不准确，不影响功能，标为 INFO（不单独编号，合并到 Issue #1 的修复中）。

### AC 覆盖矩阵完整性

plan.md 的矩阵覆盖全部 10 个 adopted AC。无遗漏。✅

---

## 6. 后端设计充分性

### "为什么"说明

Decisions Made 章节解释了 5 个关键决策的理由。plan-backend.md 的每个设计选择都附有说明。✅

### 存储变更选型理由

Decision 1 说明了 JSON 字段而非关系表的理由（Provider 数量级小 < 50）。合理。✅

### API 端点对应业务场景

Provider CRUD 对应 UC-1（双协议配置）、UC-4（QuickSetup）。✅

### 遗漏的边界条件

- 迁移 SQL 技术错误（Issue #2）
- 日志链路不完整（Issue #4）

### 非功能性要求

`non-functional-design.md` 覆盖了稳定性、数据一致性、性能、数据安全。与 plan-backend.md §9 一致。✅

---

## 发现的问题

| # | 优先级 | 文件/位置 | 描述 | 修改建议 |
|---|--------|----------|------|---------|
| 1 | MUST FIX | plan.md Interface Contracts + interface_chain.json + plan-backend.md §1.3/§1.4 + plan-api-contract.md | **parseEndpoints/resolveEndpoint 行为契约跨文档矛盾**。interface_chain.json 说 parseEndpoints 对 null/invalid JSON "throws"；plan.md Interface Contracts 同样说 "null → throw; invalid JSON → throw"；但 plan-backend.md §1.4 说 "null/undefined/"" → 返回 []"，§1.3 的 resolveEndpoint 行为表行 #9 对空 endpoints 做 "defensive fallback" 而非 throw。plan-api-contract.md Error Cases 表说 parseEndpoints(null) 返回 `[]`。三份文档对同一函数的边界行为描述互相矛盾。 | 统一为 **防御性策略**（与 plan-backend.md 实现一致）：parseEndpoints 对 null/invalid JSON 返回 `[]` + console.warn；resolveEndpoint 对空 endpoints fallback 到旧字段。更新 plan.md Interface Contracts、interface_chain.json 和 plan-api-contract.md 中的 edge cases 描述，使四份文档一致。 |
| 2 | MUST FIX | plan-backend.md §2.1 migration SQL | **Migration SQL 使用 `json_group_array`（聚合函数）构造 JSON 数组**。`json_group_array` 是 SQLite 聚合函数，设计用于 `SELECT ... GROUP BY` 上下文。在 `UPDATE SET` 中使用语义不正确，可能导致每行聚合整个表的数据或直接报错。 | 改为 `json_array(json_object(...))`。`json_array()` 是标量函数，逐行构造单元素数组。同时去掉外层不必要的 `json_quote()`（`json_array` 返回值已经是合法 JSON 文本）。正确写法：`UPDATE providers SET endpoints = json_array(json_object('api_type', api_type, 'base_url', base_url, 'upstream_path', CASE WHEN upstream_path IS NULL THEN json('null') ELSE json(upstream_path) END, 'api_key', CASE WHEN api_key IS NULL THEN json('null') ELSE api_key END)) WHERE endpoints IS NULL AND api_type IS NOT NULL AND base_url IS NOT NULL;` |
| 3 | MUST FIX | plan.md File Structure vs plan-backend.md §2.4 | **迁移文件数量矛盾**。plan.md File Structure 列出两个迁移文件：`051_add_endpoints.sql`（BG1）和 `052_add_upstream_log_fields.sql`（BG3）。但 plan-backend.md §2.4 标题为"同一迁移文件中追加"，把 request_logs 的 ALTER TABLE 放在 051 中。 | 建议采用 plan.md 的 **两文件方案**（051 和 052 分离），理由：providers 表变更和 request_logs 表变更属于不同关注点，分属 BG1 和 BG3 不同 Task。修改 plan-backend.md §2.4，将 request_logs ALTER TABLE 移至独立的 052 文件描述。 |
| 4 | MUST FIX | plan.md BG3 File Structure + plan-backend.md §5 | **BG3 缺少 db/logs.ts 和 admin/logs.ts**。plan-backend.md §5.5 明确列出了 `upstream_api_type`/`upstream_base_url` 的数据消费者：(1) `db/logs.ts` 的 `rawInsertRequestLog()` 需要扩展 INSERT 语句；(2) `db/logs.ts` 的 `LOG_LIST_SELECT` 需要追加字段；(3) `admin/logs.ts` 需要在 API 响应中返回新字段。但 plan.md BG3 的 File Structure 和 Task 3 的修改/创建文件列表中都没有包含这两个文件。**后果**：即使 log-helpers.ts 传递了新字段，DB 层不会写入、Admin API 不会返回，前端拿不到数据，整条 FR-5 / AC-7 的链路断裂。 | 在 plan.md BG3 的文件列表中追加 `router/src/db/logs.ts` 和 `router/src/admin/logs.ts`。更新 plan.md File Structure 表，增加两行。确认 BG3 Subagent 配置的"读取文件"和"修改/创建文件"列表包含这两个文件。 |
| 5 | MUST FIX | plan.md File Structure vs plan-backend.md §1.4 | **parseEndpoints 函数位置矛盾**。plan.md File Structure 将 `parseEndpoints()` 放在 `src/proxy/routing/resolve-endpoint.ts`（新建文件，BG1）。plan.md Interface Contracts 的 Module 列也标注为 "resolve-endpoint"。但 plan-backend.md §1.4 明确写 "文件: `router/src/db/providers.ts`（新增函数）"。两处互相矛盾。 | 建议放在 `providers.ts`（DB 层），理由：(1) `parseModels()` 已在 `config/model-context.ts` 中，但 `parseEndpoints` 解析的是 DB 字段，与 `providers.ts` 的 `parseModels` 调用模式一致；(2) Admin API 的 GET handler 需要调用 `parseEndpoints` 做解密，如果放在 routing 层会引入反向依赖（admin → routing）。更新 plan.md File Structure 和 Interface Contracts 的 Module 列。 |
| 6 | LOW | plan-frontend.md §3.4 + §4.1 | **preset.dualProtocol 字段无后端定义**。plan-frontend.md 引入了 `ProviderPreset.dualProtocol` 和 `buildEndpointsFromPreset()` 来自动生成双协议 endpoint。但后端 spec 和 API 合约中没有 `dualProtocol` 字段，推荐 Provider 数据中也不存在此属性。 | 实现时需确认推荐 Provider 数据源是否有此信息。如果没有，前端可根据已知供应商列表硬编码映射（如 open.bigmodel.cn 同时支持 openai + anthropic），或暂时不实现双 endpoint 自动生成。 |
| 7 | LOW | plan.md File Structure FG1 行 | **前端 i18n 文件和 useProviderPresets.ts 未列入 File Structure**。plan-frontend.md §6 列出了 4 个 i18n JSON 文件和 `useProviderPresets.ts` 需要变更，但 plan.md File Structure 表的 FG1 行只有 10 个文件，遗漏了这些。 | 更新 plan.md File Structure 表，追加 `frontend/src/composables/useProviderPresets.ts` 和 4 个 i18n JSON 文件。FG1 文件数从 10 调整为 ~15。 |
| 8 | LOW | plan-backend.md §4.1 | **failover-loop.ts 行号硬编码**。§4.1 列出了 L342、L359、L360 等精确行号。BG1/BG2 先于 BG3 执行时可能引入新代码，导致行号偏移。 | subagent 执行时应以代码模式（如 `provider.api_type as ApiType`）搜索定位，不依赖行号。建议在 Subagent 注入上下文中加一句提醒。 |

---

## 结论

需修改后重审。5 条 MUST FIX 均为文档间一致性问题或文件遗漏，不涉及架构方向性错误。核心设计（endpoints JSON 字段 + resolveEndpoint 封装 + 四层架构不变）合理。

### Summary

计划评审完成，第1轮，5条MUST FIX，需修改后重审。
