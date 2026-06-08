---
review:
  type: plan_review
  round: 2
  timestamp: "2026-06-08T17:00:00"
  target: ".xyz-harness/2026-06-08-metrics-aggregation/plan.md"
  verdict: pass
  summary: "计划评审第2轮。5 条 MUST FIX 全部解决。发现 2 条 LOW、2 条 INFO 新问题，均为文档一致性瑕疵，不影响功能正确性。"
statistics:
  total_issues: 9
  must_fix: 0
  must_fix_resolved: 5
  low: 2
  info: 2

issues:
  - id: 1
    severity: RESOLVED
    location: "plan-backend.md → insertMetrics 双写改造点"
    title: "双写失败静默 catch 导致聚合数据静默丢失"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
    resolution: "双写 catch 改为 console.error('upsertMetrics10min:', e)，显式声明'不静默吞异常'，并说明'聚合表是辅助查询通道，写入失败不抛出（不影响主请求流程），但必须有日志以便排查数据偏差'。"

  - id: 2
    severity: RESOLVED
    location: "plan-backend.md BG1 Files + plan.md File Structure"
    title: "metrics-10min.ts 职责归属矛盾"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
    resolution: "plan-backend.md BG1 Files 已包含 Create: metrics-10min.ts，plan.md File Structure 一致标注为 BG1 create。BG2 读取文件列表注明 'BG1 产出'。归属清晰。"

  - id: 3
    severity: RESOLVED
    location: "plan-backend.md BG3 getStats + plan-api-contract.md"
    title: "聚合段 success_rate 近似未告知前端"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
    resolution: "API 响应增加 is_approximate: boolean 字段（仅 GET /admin/api/stats），plan-backend.md BG3 和 plan-api-contract.md 均有说明。前端据此显示 '≈' 标记。方案选择合理——聚合表不存储 status_code，无法还原精确成功率。"

  - id: 4
    severity: RESOLVED
    location: "plan-backend.md BG3 + plan-api-contract.md"
    title: "查询路由函数读取 settings 缓存策略未定义"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
    resolution: "plan-backend.md BG3 查询路由策略显式声明'直接读 settings 表（SQLite 主键查询 < 0.01ms，无需缓存）'，plan-api-contract.md 配置生命周期表格列出所有读取方及缓存策略（均为直接读，无 TTL）。与 getLogRetentionDays() 策略一致。"

  - id: 5
    severity: RESOLVED
    location: "plan-backend.md BG1 迁移 SQL + metrics-10min.ts"
    title: "聚合表主键含 6 列且用 WITHOUT ROWID + router_key_id NULL/'' 转换散落"
    status: resolved
    raised_in_round: 1
    resolved_in_round: 2
    resolution: "移除 WITHOUT ROWID，改用 ROWID 模式（DB 迁移细节说明：'8K 行量级下空间差异可忽略，二级索引更灵活'）。router_key_id NULL/'' 转换集中在 metrics-10min.ts 处理：写入 COALESCE → ''、读取 NULLIF → NULL、UNION 明细表侧 COALESCE 对齐。三处转换点全部列出。"

  # --- v1 LOW/INFO carry-forward ---

  - id: 6
    severity: LOW
    location: "plan.md → Execution Groups → BG1"
    title: "BG1 职责偏重（DDL + CRUD + Settings + API 端点）"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  - id: 7
    severity: LOW
    location: "plan.md → Spec Coverage Matrix → FR-5"
    title: "FR-5 筛选维度在 Task 列表中无显式 Task 覆盖"
    status: open
    raised_in_round: 1
    resolved_in_round: null

  # --- v2 new issues ---

  - id: 11
    severity: LOW
    location: "plan-backend.md BG1 Files vs BG2 内容 + plan.md File Structure"
    title: "BG1 Files 列出 settings.ts 和 admin/settings.ts，但 BG1 接口签名变更未描述对这两个文件的改动（BG2 描述了实际改动）"
    status: open
    raised_in_round: 2
    resolved_in_round: null
    detail: |
      plan-backend.md BG1 Files 包含 settings.ts 和 admin/settings.ts（标记为 modify），但 BG1 的「接口签名变更」部分未提及对这两个文件的任何改动。实际的 getMetricsDetailDays/setMetricsDetailDays 函数和 admin settings 端点由 BG2 的接口签名变更描述。
      plan.md File Structure 也把这两个文件归为 BG1，与 plan-backend.md BG1 的文件列表一致但与 BG2 的实际工作内容矛盾。
      风险：BG1 subagent 可能尝试修改这两个文件但无具体指令，导致空操作或错误改动。BG2 subagent 有明确的接口描述，应该能正确执行。功能风险低，但文档一致性需改进。

  - id: 12
    severity: LOW
    location: "plan-backend.md BG1 Files vs plan.md File Structure"
    title: "迁移 SQL 文件名不一致：055_metrics_10min.sql vs 055_create_metrics_10min.sql"
    status: open
    raised_in_round: 2
    resolved_in_round: null
    detail: |
      plan-backend.md BG1 Files 和 DB 迁移细节章节使用 055_metrics_10min.sql，
      plan.md File Structure 使用 055_create_metrics_10min.sql。
      Subagent 执行时需要统一为一个文件名。

  - id: 13
    severity: INFO
    location: "plan-api-contract.md 共享类型定义"
    title: "is_approximate 字段未在共享类型中定义"
    status: open
    raised_in_round: 2
    resolved_in_round: null
    detail: |
      plan-api-contract.md 「唯一新增字段」段落声明 GET /admin/api/stats 响应增加 is_approximate: boolean，
      但「前后端共享类型定义」段落中没有对应的 TypeScript 类型定义。前端开发者需要从非类型段落推断字段存在。
      不影响正确性，但降低类型文档的完整性。

  - id: 14
    severity: INFO
    location: "plan-backend.md → log-cleaner 扩展点"
    title: "deleteMetricsBefore(db) 归属未明确映射到 BG"
    status: open
    raised_in_round: 2
    resolved_in_round: null
    detail: |
      log-cleaner 扩展点写道「deleteMetricsBefore(db, beforeDate) 放在 metrics.ts 中（数据归属），log-cleaner.ts 调用」。
      但 plan-backend.md 的 BG 分组中，BG1 的接口签名变更描述了 metrics.ts 的 upsertMetrics10min 和 insertMetrics 改动，未提及 deleteMetricsBefore。
      BG2 描述了 log-cleaner.ts 的改动（调用 deleteMetricsBefore），但 BG2 不修改 metrics.ts。
      实际执行中 BG1 subagent 最可能在创建 metrics.ts 相关函数时一并添加 deleteMetricsBefore（因为它已在修改 metrics.ts），
      但文档未显式分配。风险低——subagent 读取独立章节后通常会自行判断归属。
---

# 计划评审 v2

## 评审记录

- **评审时间**：2026-06-08 17:00
- **评审类型**：计划评审（L1）第 2 轮
- **评审对象**：修订后的 plan.md + plan-backend.md + plan-api-contract.md
- **复杂度**：L2（后端查询路由 + 跨表 UNION + 前端时间选择器完全重写）

---

## 1. MUST FIX 验证（v1 → v2）

| # | 问题 | 修复方案 | 验证结果 |
|---|------|---------|---------|
| 1 | 双写静默 catch | `console.error('upsertMetrics10min:', e)` + 显式声明"不静默吞异常" | ✅ 已修复 |
| 2 | metrics-10min.ts 归属矛盾 | BG1 Files 补充 metrics-10min.ts，plan.md File Structure 一致 | ✅ 已修复 |
| 3 | success_rate 近似欺骗 | API 响应增加 `is_approximate: boolean`，前端显示 "≈" 标记 | ✅ 已修复 |
| 4 | 缓存策略未定义 | 直接读 settings 表（< 0.01ms），无 TTL，写入后立即生效 | ✅ 已修复 |
| 5 | WITHOUT ROWID + NULL/'' 散落 | 移除 WITHOUT ROWID；NULL/'' 转换集中在 metrics-10min.ts | ✅ 已修复 |

**5/5 MUST FIX 全部解决。**

---

## 2. 新发现问题

### LOW #11：BG1/BG2 文件归属重叠

plan-backend.md BG1 Files 列出 `settings.ts` 和 `admin/settings.ts`（modify），但 BG1 的接口签名变更完全不涉及这两个文件。实际改动在 BG2 中描述。plan.md File Structure 也把这两个文件归为 BG1。

**影响**：BG1 subagent 可能在无具体指令的情况下尝试修改这两个文件。BG2 subagent 有明确的接口描述，应能正确执行。功能风险低，文档一致性需改进。

**建议**：从 BG1 Files 中移除 settings.ts 和 admin/settings.ts，或将它们改为"仅读取"（BG1 需要读取 settings.ts 了解现有函数模式）。在 plan.md File Structure 中将这两个文件重新分配给 BG2。

### LOW #12：迁移 SQL 文件名不一致

- plan-backend.md：`055_metrics_10min.sql`
- plan.md File Structure：`055_create_metrics_10min.sql`

**建议**：统一为 `055_metrics_10min.sql`（与项目现有迁移文件命名风格一致，如 `054_*.sql`）。

### INFO #13：is_approximate 未进入共享类型定义

plan-api-contract.md 声明了 is_approximate 字段，但「前后端共享类型定义」段落缺少对应 TypeScript interface。

**建议**：在共享类型段落补充 StatsResponse 类型定义，包含 is_approximate 字段。

### INFO #14：deleteMetricsBefore 归属未映射到 BG

log-cleaner 扩展点声明 deleteMetricsBefore 放在 metrics.ts 中，但 BG1 的接口签名变更未提及。BG2 调用它但不修改 metrics.ts。实际执行中 BG1 最可能创建（已在修改 metrics.ts），但文档未显式分配。

---

## 3. v1 LOW/INFO 继承状态

| # | 级别 | 状态 | 说明 |
|---|------|------|------|
| 6 | LOW | open | BG1 职责偏重，v2 未拆分，可接受 |
| 7 | LOW | open | FR-5 筛选参数透传在 BG3 中隐含处理，建议在 BG3 Task 描述中显式提及 |
| 8 | LOW | resolved | provider token labels 数据来源已在 plan-frontend.md 注意事项中明确说明 |
| 9 | INFO | open | 活动图端点 4320 条全量返回，当前规模可接受 |
| 10 | INFO | open | E2E 测试时间控制方案未补充，建议在编码阶段用组件测试替代 |

---

## 4. 总体评价

修订质量良好。5 条 MUST FIX 均有针对性修复，修复方案简洁且与现有架构风格一致（如缓存策略对齐 getLogRetentionDays）。无过度设计。

新增的 2 条 LOW 均为文档层面的一致性问题（文件归属重叠、文件名不一致），不影响功能正确性，但建议在编码前统一以减少 subagent 执行歧义。

**结论**：PASS。可进入编码阶段。建议在编码前快速修复 LOW #11（文件归属）和 LOW #12（文件名统一），耗时预计 < 5 分钟。
