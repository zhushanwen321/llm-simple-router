# 计划评审报告 v2（第 2 轮）

**评审模式：** 计划评审（阶段②）
**评审对象：** spec.md + plan.md
**日期：** 2026-05-10

## 上轮 MUST FIX 修复验证

### MF-1: sessionId 消费者文件列表完整性

**结论：已部分修复，但仍有遗漏。**

spec 后端改动表现已列出 failover-loop.ts（19 处）、create-proxy-handler.ts、proxy-logging.ts、tool-error-logger.ts、orchestrator.ts。但通过实际代码扫描发现 **3 个文件遗漏**：

- `error-logging.ts` 有 3 处 `ctx.sessionId`（line 66, 89, 108），spec 仅列出其 `detectClientAgentType()` 调用需改，**未列出 sessionId 需迁移**
- `request-logging.ts` 有 3 处 `ctx.sessionId`（line 63, 89, 118），同上
- `enhancement-preprocess.ts` 有 1 处从 ctx 解构 `sessionId`（line 28: `const { request, body, sessionId, metadata } = ctx`），**在 Part 1 后端改动表中完全未出现**

一旦 `PipelineContext.sessionId` 字段被移除（Task 3 步骤 3），这 3 个文件将产生编译错误。

**→ 仍为 MUST FIX，见下方 MF-1**

### MF-2: detectClientAgentType 3 处直接调用改为 ctx.metadata.get

**结论：已修复。**

spec 后端改动表和 plan Task 3 步骤 6 均明确列出：
- `failover-loop.ts`（line 165）
- `error-logging.ts`（line 105）
- `request-logging.ts`（line 115）

改为 `ctx.metadata.get("client_type")`，与时序约束一致。

### MF-3: core/tests 9 个文件迁移步骤

**结论：已修复。**

plan Task 1 步骤 7 明确列出：迁移 `core/tests/` 9 个测试文件到 `router/tests/core/` 对应子目录，更新 import。实际验证：core/tests 下确有 9 个 .ts 文件，共 1523 行（与 spec 一致）。

## 新发现的问题

### MF-1 [MUST FIX]: sessionId 消费者遗漏 3 个文件

**问题：** spec 后端改动表和 plan Task 3 步骤 5 的 sessionId 迁移文件列表遗漏 3 个文件：

| 遗漏文件 | ctx.sessionId 使用 |
|----------|-------------------|
| `router/src/proxy/hooks/builtin/error-logging.ts` | 3 处（line 66, 89, 108） |
| `router/src/proxy/hooks/builtin/request-logging.ts` | 3 处（line 63, 89, 118） |
| `router/src/proxy/hooks/builtin/enhancement-preprocess.ts` | 1 处（line 28 解构） |

**影响：** Task 3 移除 `PipelineContext.sessionId` 后，这 3 个文件编译失败。

**修复方向：**
1. spec 后端改动表：为 `error-logging.ts` 和 `request-logging.ts` 的改动描述补充 `ctx.sessionId` → `ctx.metadata.get("session_id")` 迁移
2. spec 后端改动表：新增 `enhancement-preprocess.ts` 行，说明解构 `sessionId` 需改为 `ctx.metadata.get("session_id")`
3. plan Task 3 步骤 5 的文件列表补充这 3 个文件
4. plan Task 3 涉及文件列表补充这 3 个文件

---

## 其他检查结果

### spec 完整性

- **目标明确：** 三部分改动（配置化 + core 合并 + pi 精简），边界清晰
- **数据流：** 新增字段的生产者、存储、消费者、读取时机均已列出
- **时序约束：** 明确了 client-detection hook（pre_route, priority 200）是最早业务 hook，后续 hook 通过 metadata 读取
- **AC 可量化：** AC1-AC5 验收标准具体，可测试

**精确度问题（非 MUST FIX）：**
- spec 称 failover-loop.ts 有 "19 处 `ctx.sessionId`"，实际 `ctx.sessionId` 仅 8 处，`sessionId` 全文 10 处（含接口定义和参数传递）。数量标注不准确但不影响执行
- spec 称 "40 处 import，20 个文件"，实际 38 处 import，19 个唯一文件。偏差不影响正确性

### plan 可行性

- **任务拆分合理：** 6 个 Task 依赖关系正确，Task 1 先做 core 合并避免后续文件位置混乱
- **并行设计：** Task 4（前端）和 Task 5（Pi 插件）可并行，合理
- **验证步骤：** 每个 Task 都有验证步骤，Task 6 全量验证覆盖 lint/build/test

### spec 与 plan 一致性

- plan 覆盖了 spec 三个 Part 的所有需求
- AC 对应关系清晰：AC1→Task 2+3, AC2→Task 4, AC3→Task 1+6, AC4→Task 5, AC5→Task 6

### 数据消费者检查

CLAUDE.md 要求 "新增 DB 列或 metadata 字段时，必须列出所有消费点"。

| 字段 | 消费者 | spec 是否列出 |
|------|--------|-------------|
| client_type (metadata) | error-logging, request-logging, failover-loop, collectTransportMetrics | 是 |
| session_id (metadata) | cache-estimation, request-logging, enhancement, 所有 hook | 部分（遗漏 error-logging、request-logging、enhancement-preprocess 的 sessionId 消费） |

### 前端交互模式

- 使用 ProxyEnhancement.vue 的保存按钮模式，符合 CLAUDE.md 要求
- 不直调 API，符合规范

---

## 问题汇总

| ID | 优先级 | 类型 | 描述 |
|----|--------|------|------|
| MF-1 | **MUST FIX** | sessionId 消费者遗漏 | `error-logging.ts`（3处）、`request-logging.ts`（3处）、`enhancement-preprocess.ts`（1处解构）的 `ctx.sessionId` 迁移未在 spec 后端改动表和 plan Task 3 中列出 |

**MUST FIX: 1 条**

## 结论

**需修改后重审。** MF-1 是编译级别的遗漏——移除 `PipelineContext.sessionId` 后 3 个文件必然编译失败，必须在 spec 和 plan 中补充。
