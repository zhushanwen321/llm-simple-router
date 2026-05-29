---
review:
  type: spec_review
  round: 2
  timestamp: "2026-05-29T23:30:00"
  target: ".xyz-harness/2026-05-29-provider-multi-api-type/spec.md"
  verdict: pass
  summary: "Spec 评审第2轮，3条 MUST FIX 全部修复，6条 LOW/INFO 同步修复，引入 0 条新 MUST FIX。verdict: pass"

statistics:
  total_issues: 2
  must_fix: 0
  must_fix_resolved: 3
  low: 1
  info: 1

previous_round_issues:
  - id: 1
    severity: MUST_FIX
    title: "openai-responses 枚举值无对应 AC"
    status: resolved
    resolved_in_round: 2
    resolution: "新增 AC-2b（精确匹配）+ AC-3b（降级）覆盖 openai-responses 的两种场景；Constraints 补充 openai ↔ openai-responses 关系说明"

  - id: 2
    severity: MUST_FIX
    title: "Provider 创建正向流程无 AC"
    status: resolved
    resolved_in_round: 2
    resolution: "AC-4 覆盖创建→DB密文验证→API明文验证→请求使用验证完整链路；AC-5 第二场景覆盖新 Provider 创建→多格式请求路由成功"

  - id: 3
    severity: MUST_FIX
    title: "endpoint 级 api_key 加密存储/解密读取无 AC"
    status: resolved
    resolved_in_round: 2
    resolution: "AC-4 四段式验证：DB 密文→API 明文→请求 key 正确→fallback 到 provider.api_key，覆盖完整加密→解密→使用链路"

  - id: 4
    severity: LOW
    title: "upstream_base_url 无独立 AC"
    status: resolved
    resolved_in_round: 2
    resolution: "AC-7 追加 upstream_base_url 断言"

  - id: 5
    severity: LOW
    title: "QuickSetup payload 变更无 AC"
    status: resolved
    resolved_in_round: 2
    resolution: "新增 AC-9 覆盖 QuickSetup 创建→请求成功路由"

  - id: 6
    severity: LOW
    title: "UI Demo HTML 作为 FR 是否必要"
    status: resolved
    resolved_in_round: 2
    resolution: "FR-7 标注为「可选交付物」，明确「不作为功能验收条件」"

  - id: 7
    severity: LOW
    title: "迁移脚本缺少幂等性保护描述"
    status: resolved
    resolved_in_round: 2
    resolution: "AC-5 明确幂等性要求：endpoints 列不存在时才 ADD COLUMN，endpoints IS NULL 的行才做填充，重复执行不重复处理"

  - id: 8
    severity: INFO
    title: "openai ↔ openai-responses 格式兼容性未说明"
    status: resolved
    resolved_in_round: 2
    resolution: "Constraints 补充说明：两者同属 OpenAI 系但 API 结构不同，需要 FormatRegistry 转换"

  - id: 9
    severity: INFO
    title: "upstream_path 无 AC 覆盖"
    status: resolved
    resolved_in_round: 2
    resolution: "新增 AC-10 覆盖 upstream_path 非空时的路径拼接"

issues:
  - id: 10
    severity: LOW
    location: "spec.md > Acceptance Criteria"
    title: "Provider Update 生命周期无独立 AC"
    status: open
    raised_in_round: 2

  - id: 11
    severity: INFO
    location: "spec.md > AC-5"
    title: "AC-5 合并了两个不相关的场景"
    status: open
    raised_in_round: 2
---

# Spec 评审 v2

## 评审记录
- 评审时间：2026-05-29 23:30
- 评审类型：Spec 评审（第 2 轮 — 修复验证 + 新问题检查）
- 评审对象：`.xyz-harness/2026-05-29-provider-multi-api-type/spec.md`

## 第 1 轮 MUST FIX 修复验证

### MUST FIX #1: openai-responses 枚举值无对应 AC → ✅ 已修复

**修复内容**：
- 新增 **AC-2b**：Provider 配置 openai + openai-responses + anthropic 三 endpoint，客户端 POST /v1/responses → 选择 openai-responses endpoint，无格式转换
- 新增 **AC-3b**：Provider 只有 openai endpoint，客户端发 Responses API 请求 → FormatRegistry 处理 openai-responses ↔ openai 转换
- Constraints 补充：openai 和 openai-responses 同属 OpenAI 系但 API 结构不同，两者之间需要 FormatRegistry 转换

**枚举值覆盖复查**：

| 枚举值 | 精确匹配 | 降级/转换 | 独立 AC |
|--------|----------|----------|---------|
| `openai` | AC-1 ✅, AC-2 ✅ | AC-3 ✅ (降级目标) | ✅ |
| `openai-responses` | AC-2b ✅ | AC-3b ✅ (降级) | ✅ |
| `anthropic` | AC-2 ✅, AC-3 ✅ (作为唯一) | AC-3 ✅ (作为降级源) | ✅ |

所有枚举值在精确匹配和降级两种模式下均有 AC 覆盖。

### MUST FIX #2: Provider 创建正向流程无 AC → ✅ 已修复

**修复内容**：
- **AC-4** 覆盖完整链路：创建 Provider（endpoints 含独立 api_key）→ DB 验证密文 → API GET 验证明文 → 请求验证 key 正确 → fallback 到 provider.api_key
- **AC-5 第二场景**：创建新 Provider（两 endpoint，各有独立 api_key）→ 发送两种格式请求 → 分别成功路由

**创建生命周期闭环验证**：

| 阶段 | AC 覆盖 |
|------|---------|
| 创建→DB 存储（加密） | AC-4 When/Then #1 |
| 创建→API 读取（解密） | AC-4 When/Then #2 |
| 创建→请求使用 | AC-4 When/Then #3 |
| 创建→多格式路由 | AC-5 第二场景 |
| 创建→校验失败 | AC-6 |

### MUST FIX #3: endpoint 级 api_key 加密/解密无 AC → ✅ 已修复

**修复内容**：
AC-4 四段式验证覆盖完整链路：
1. DB 密文验证：`endpoints JSON 中的 api_key 为 AES 密文（非明文 "key-a"）`
2. API 明文验证：`返回的 endpoints 中 api_key 为明文 "key-a"`
3. 请求 key 正确：`实际使用的 api_key 为 "key-a"（解密正确）`
4. Fallback 验证：anthropic endpoint（api_key=null）→ fallback 到 provider.api_key

链路完整，从写入加密到读取解密到实际使用均有断言。

## 第 1 轮 LOW/INFO 修复验证

| # | 问题 | 状态 | 修复方式 |
|---|------|------|---------|
| 4 | upstream_base_url 无独立 AC | ✅ | AC-7 追加 `upstream_base_url = "https://example.com/v1"` 断言 |
| 5 | QuickSetup payload 无 AC | ✅ | 新增 AC-9 覆盖 QuickSetup 创建→路由成功 |
| 6 | UI Demo 作为 FR 必要性 | ✅ | FR-7 标注「可选交付物」，不作为验收条件 |
| 7 | 迁移幂等性 | ✅ | AC-5 明确幂等三重保护（列不存在才 ADD、NULL 才填充、重复执行不处理） |
| 8 | openai ↔ openai-responses 关系 | ✅ | Constraints 补充两者关系说明 |
| 9 | upstream_path 无 AC | ✅ | 新增 AC-10 覆盖路径覆盖场景 |

## 新问题检查

逐项检查修复后的 spec 是否引入新问题：

| 检查维度 | 结果 |
|---------|------|
| 新增 AC（AC-2b, AC-3b, AC-9, AC-10）与现有 AC 是否矛盾 | ✅ 无矛盾 |
| FR 描述与 AC 断言是否一致 | ✅ 一致 |
| 约束条件是否与新 AC 冲突 | ✅ 无冲突 |
| 枚举覆盖完整性 | ✅ 三种枚举值均覆盖 |
| 数据消费者完整性 | ✅ DB/API/前端/SSE 均有对应 FR |
| AMBIGUOUS/TBD 标记 | ✅ 无未决议标记 |
| Out of Scope 与 FR 边界 | ✅ 清晰 |

### 发现的新问题

| # | 优先级 | 位置 | 描述 |
|---|--------|------|------|
| 10 | LOW | AC 章节 | **Provider Update 无独立 AC**：AC-4 覆盖 Create，AC-5 覆盖迁移+创建，AC-6 覆盖校验失败，但"更新已有 Provider 的 endpoints 后请求行为是否正确"无独立验证。FR-4 声明 Create/Update 使用相同格式，resolveEndpoint 对创建和更新的 Provider 不做区分，因此 update 路径隐含被覆盖，但显式 AC 更稳妥 |
| 11 | INFO | AC-5 | **AC-5 合并两个不相关场景**：迁移幂等性（DB 层面）和 Provider 创建正向流程（API 层面）是两个独立的关注点，合并在一条 AC 中降低可测试性。建议 plan 阶段拆分为独立测试用例 |

## Six-element 复查

| 维度 | 状态 | 说明 |
|------|------|------|
| **Outcomes** | ✅ | 清晰不变 |
| **Scope boundaries** | ✅ | FR-1~FR-7，FR-7 标注可选，Out of Scope 6 项 |
| **Constraints** | ✅ | 7 条约束，补充了 openai-responses 关系说明 |
| **Decisions made** | ✅ | 5 条决策，理由充分 |
| **Verification** | ✅ | 12 条 AC（AC-1~AC-10，含 AC-2b/AC-3b），覆盖所有枚举值、加密链路、创建正向流程、迁移幂等、UI 展示、QuickSetup、upstream_path |
| **Business use cases** | ✅ | 3 个 UC 覆盖核心场景 |

## AC 覆盖矩阵

| AC | 覆盖内容 | 对应 FR | 状态 |
|----|---------|---------|------|
| AC-1 | 单 endpoint 向后兼容 | FR-2, FR-3 | ✅ |
| AC-2 | 多 endpoint 精确匹配 (openai+anthropic) | FR-2 | ✅ |
| AC-2b | 多 endpoint 精确匹配 (含 openai-responses) | FR-2 | ✅ 新增 |
| AC-3 | 无匹配 endpoint 格式转换降级 | FR-2 | ✅ |
| AC-3b | openai-responses → openai 降级 | FR-2 | ✅ 新增 |
| AC-4 | 独立 api_key + 加密存储全链路 | FR-1, FR-4 | ✅ 扩展 |
| AC-5 | DB 迁移 + 创建正向流程 | FR-3, FR-4 | ✅ 扩展 |
| AC-6 | api_type 唯一性校验 | FR-4 | ✅ |
| AC-7 | 日志上下游 api_type + base_url | FR-5 | ✅ 扩展 |
| AC-8 | 前端列表多 endpoint 展示 | FR-6a | ✅ |
| AC-9 | QuickSetup payload 格式 | FR-6c | ✅ 新增 |
| AC-10 | upstream_path 覆盖 | FR-1 | ✅ 新增 |

## 结论

**Verdict: PASS**

第 1 轮 3 条 MUST FIX 全部修复，修复质量充分：
- openai-responses 枚举值在精确匹配（AC-2b）和降级（AC-3b）两种模式下均有覆盖
- Provider 创建正向流程有 AC-4（加密链路）和 AC-5 第二场景（路由成功）双重覆盖
- api_key 加密/解密链路有 AC-4 四段式验证

6 条 LOW/INFO 同步修复，spec 质量显著提升。新引入 0 条 MUST FIX，仅 1 条 LOW（Update 无独立 AC）和 1 条 INFO（AC-5 场景合并建议），均不阻塞。

**可以进入 Plan 阶段。**
