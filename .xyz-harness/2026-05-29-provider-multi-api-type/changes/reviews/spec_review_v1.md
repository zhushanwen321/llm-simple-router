---
review:
  type: spec_review
  round: 1
  timestamp: "2026-05-29T22:00:00"
  target: ".xyz-harness/2026-05-29-provider-multi-api-type/spec.md"
  verdict: fail
  summary: "Spec 评审第1轮，3条 MUST FIX，枚举值覆盖和生命周期验收存在缺口"

statistics:
  total_issues: 9
  must_fix: 3
  must_fix_resolved: 0
  low: 4
  info: 2

issues:
  - id: 1
    severity: MUST_FIX
    location: "spec.md > Acceptance Criteria"
    title: "openai-responses 枚举值无对应 AC"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 2
    severity: MUST_FIX
    location: "spec.md > Acceptance Criteria"
    title: "Provider 创建正向流程无 AC（CRUD 生命周期缺失）"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 3
    severity: MUST_FIX
    location: "spec.md > Acceptance Criteria"
    title: "endpoint 级 api_key 加密存储/解密读取无 AC"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 4
    severity: LOW
    location: "spec.md > FR-5 > AC-7"
    title: "upstream_base_url 字段声明但无独立 AC 验证"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 5
    severity: LOW
    location: "spec.md > FR-6c"
    title: "QuickSetup payload 格式变更无 AC"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 6
    severity: LOW
    location: "spec.md > FR-7"
    title: "UI Demo HTML 文件作为功能需求是否必要"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 7
    severity: LOW
    location: "spec.md > FR-3"
    title: "迁移脚本缺少幂等性保护描述"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 8
    severity: INFO
    location: "spec.md > FR-2"
    title: "openai 与 openai-responses 的格式兼容性未说明"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 9
    severity: INFO
    location: "spec.md > Constraints"
    title: "upstream_path 字段无任何 AC 覆盖"
    status: open
    raised_in_round: 1
    resolved_in_round: null
---

# Spec 评审 v1

## 评审记录
- 评审时间：2026-05-29 22:00
- 评审类型：Spec 评审（计划评审 - spec 完整性维度）
- 评审对象：`.xyz-harness/2026-05-29-provider-multi-api-type/spec.md`

## Six-element 完整性检查

| 维度 | 状态 | 说明 |
|------|------|------|
| **Outcomes（目标）** | ✅ 完整 | 一段话明确说清：Provider 支持多 endpoint 配置，按 api_type 自动匹配，避免不必要格式转换 |
| **Scope boundaries（范围边界）** | ✅ 完整 | FR-1~FR-7 覆盖数据模型、封装层、迁移、API、日志、前端、UI Demo；Out of Scope 列表清晰，6 项排除项 |
| **Constraints（约束）** | ✅ 完整 | 7 条约束，包括架构不变、共享资源、加密一致、api_type 枚举值等 |
| **Decisions made（已做决策）** | ✅ 完整 | 5 条决策带理由，覆盖 JSON 字段 vs 关系表、一次性迁移、降级策略、封装位置、日志双字段 |
| **Verification（验收标准）** | ⚠️ 缺口 | 8 条 AC 用 Given/When/Then 格式，但存在枚举覆盖和生命周期缺口（详见 MUST FIX） |
| **Business use cases（业务用例）** | ✅ 完整 | 3 个 UC 覆盖双协议配置、单协议兼容、跨协议降级 |

## 枚举值覆盖检查

spec 定义 api_type 枚举值：`openai` | `openai-responses` | `anthropic`

| 枚举值 | 作为匹配目标 | 作为降级源 | 独立 AC 覆盖 |
|--------|-------------|-----------|-------------|
| `openai` | AC-1 ✅, AC-2 ✅ | AC-3 ✅ | ✅ |
| `anthropic` | AC-3 (降级源) | AC-2 (匹配目标隐含) | ⚠️ 无独立 AC |
| `openai-responses` | ❌ 无 | ❌ 无 | ❌ 无 |

**结论**：`openai-responses` 在所有 AC 中完全缺失。AC-2 只覆盖 openai ↔ anthropic 双 endpoint 场景，openai-responses 的精确匹配、降级行为、与 openai 的关系均未验证。

## 生命周期检查（Provider 创建→运行→删除）

| 生命周期阶段 | AC 覆盖 | 说明 |
|-------------|---------|------|
| **创建** | ❌ 缺失 | FR-4 声明 Create Provider with endpoints，但无 AC 验证正常创建→存储→读取的完整流程 |
| **运行（请求路由）** | ✅ 完整 | AC-1~AC-4 覆盖单/多 endpoint 匹配、降级、api_key fallback |
| **运行（日志记录）** | ✅ 完整 | AC-7 覆盖上下游 api_type 记录 |
| **运行（前端展示）** | ✅ 完整 | AC-8 覆盖列表页多 endpoint 展示 |
| **更新** | ❌ 缺失 | 无 AC 验证更新 endpoints 后请求行为是否正确 |
| **删除** | ❌ 缺失 | 无 AC（CASCADE 删除相对简单，优先级低于创建） |
| **迁移** | ✅ 完整 | AC-5 覆盖迁移后行为不变 |

## AMBIGUOUS 标记检查

spec 中无 `[待决议]`、`AMBIGUOUS`、`TBD`、`TODO` 等未决议标记。✅

## 数据消费者完整性（CLAUDE.md 规范）

FR-5 新增 `upstream_api_type` + `upstream_base_url` 到 `request_logs`，消费者覆盖：

| 消费者 | 覆盖状态 | 说明 |
|--------|---------|------|
| DB 写入 (insertRequestLog) | ⚠️ 隐含 | FR-5 描述了字段用途，但未显式列出 insertRequestLog 修改点 |
| Admin API 查询 (log detail) | ✅ 隐含 | "日志展示页面在请求详情中显示两个字段" 暗示 API 返回 |
| 前端展示 (Logs.vue) | ✅ | FR-5 明确说明 |
| SSE 实时监控 | ✅ 不受影响 | RequestTracker 推送活跃请求指标，不涉及历史日志字段 |

FR-4 新增 endpoints 字段写入，消费者覆盖：

| 消费者 | 覆盖状态 | 说明 |
|--------|---------|------|
| DB 写入 (create/update provider) | ✅ | FR-4 明确 |
| DB 读取 (resolveEndpoint) | ✅ | FR-2 封装 |
| Admin API 返回 | ✅ | FR-4 Get Provider |
| 前端 Provider 列表/编辑 | ✅ | FR-6a/6b |
| 前端 QuickSetup | ✅ | FR-6c |

## 发现的问题

| # | 优先级 | 位置 | 描述 | 修改建议 |
|---|--------|------|------|---------|
| 1 | MUST FIX | AC 章节 | **openai-responses 无对应 AC**：spec 定义三种 api_type 枚举值，但 8 条 AC 中无一覆盖 openai-responses。AC-2 验证 openai+anthropic 双 endpoint，AC-3 验证 anthropic 单 endpoint 降级，openai-responses 的精确匹配、降级场景、与 openai 的交互行为完全未验证 | 新增 AC：Given Provider 配置 `[{api_type: "openai-responses", ...}, {api_type: "openai", ...}]`，When 客户端发送 Responses API 请求，Then 选择 openai-responses endpoint，无格式转换。同时补充 openai-responses 单 endpoint 降级场景 |
| 2 | MUST FIX | AC 章节 | **Provider 创建正向流程无 AC**：FR-4 描述了 Create Provider with endpoints，包括校验、api_key 加密存储、endpoints 写入，但无 AC 验证完整的创建→读取→请求成功路径。AC-5 只覆盖迁移场景，AC-6 只覆盖校验失败场景，正常创建的黄金路径缺失 | 新增 AC：Given 用户通过 Admin API 创建 Provider（endpoints 含两个 endpoint，各有独立 api_key），When 创建成功后通过 API 读取，Then endpoints 数组完整返回且 api_key 解密正确。When 发送请求，Then 请求成功路由到对应 endpoint |
| 3 | MUST FIX | AC 章节 | **endpoint 级 api_key 加密/解密无 AC**：FR-1 声明 endpoint 级 api_key 使用 AES-256-GCM 加密，FR-4 声明写入前加密，但无 AC 验证加密存储→解密读取→实际使用 key 正确的完整链路。AC-4 验证了 key 的选择逻辑（fallback），但未验证加密/解密正确性 | 在 AC-2 或新 AC 中补充验证：创建 Provider 后，DB 中 endpoints 的 api_key 为密文（非明文），Admin API 返回时为明文，请求实际携带的 api_key 为正确的明文 key |
| 4 | LOW | FR-5, AC-7 | **upstream_base_url 无独立 AC**：FR-5 新增 upstream_base_url 字段到 request_logs，但 AC-7 只验证 upstream_api_type，未验证 upstream_base_url 正确记录 | 在 AC-7 中追加断言：`request_logs.upstream_base_url = "实际的 base_url"` |
| 5 | LOW | FR-6c | **QuickSetup payload 变更无 AC**：FR-6c 声明 QuickSetup 的 payload 格式从 `{api_type, base_url, ...}` 变为 `{endpoints: [{...}]}`，但无 AC 验证 QuickSetup 创建的 Provider 能正常工作 | 新增 AC：Given 用户通过 QuickSetup 创建 Provider（配置 openai api_type + base_url），When 创建完成后发送请求，Then 请求成功路由（验证 QuickSetup payload 格式正确） |
| 6 | LOW | FR-7 | **UI Demo HTML 文件作为 FR 是否必要**：FR-7 要求创建 mockup HTML 文件。CLAUDE.md 规范"不自发生成报告/总结文件"。UI 变更已在 FR-6a/6b/6c 中充分描述，mockup 文件更像是开发辅助而非功能需求。建议降级为 plan 阶段的参考材料，不作为交付物 | 将 FR-7 移至 plan.md 的参考材料，或标注为"可选交付物" |
| 7 | LOW | FR-3 | **迁移脚本缺少幂等性保护描述**：FR-3 声明一次性迁移，Decision #2 声明不做双路径兼容，但未描述迁移脚本本身的幂等保护（如 endpoints 列已存在时跳过）。生产环境中服务重启会重新执行 migration SQL，若无保护会重复写入 | 在 FR-3 补充说明：`ALTER TABLE ... ADD COLUMN endpoints TEXT DEFAULT NULL` 天然幂等（SQLite 不支持，需 `CREATE TABLE IF NOT EXISTS` 方式或 try-catch），数据迁移部分需检查 endpoints IS NULL |
| 8 | INFO | FR-2 | **openai 与 openai-responses 格式兼容性未说明**：当 Provider 只有 openai endpoint，客户端发送 openai-responses 请求时（或反过来），是否需要格式转换？两者都是 OpenAI 系协议但 API 结构不同。spec 的降级逻辑会对这种场景设置 `needsTransform = true`，但 FormatRegistry 是否支持这种转换对？ | 建议在 Constraints 或 Decisions 中补充说明 openai ↔ openai-responses 的关系 |
| 9 | INFO | ProviderEndpoint | **upstream_path 字段无 AC 覆盖**：ProviderEndpoint 包含 `upstream_path?: string | null` 可选字段，用于覆盖默认路径，但所有 AC 的 base_url 都是泛指 "..."，未验证 upstream_path 非空时的路径拼接正确性 | 可考虑在 AC 中增加一个 upstream_path 非空的场景 |

> 优先级定义：
> - **MUST FIX**：不修复则评审不通过，会阻塞流程
> - **LOW**：建议修复，但不阻塞
> - **INFO**：观察记录，无需操作

### 结论

需修改后重审。3 条 MUST FIX 涉及核心枚举覆盖缺口（openai-responses 无 AC）和 CRUD 生命周期验收缺失（创建正向流程、api_key 加密路径）。建议补充 AC 后重新提交。

### Summary

Spec 评审完成，第1轮，3条 MUST FIX（枚举覆盖缺失 + 生命周期验收缺失 + 安全路径无验收），需修改后重审。
