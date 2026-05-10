# 计划评审报告 v1

**评审对象：** spec.md + plan.md  
**评审模式：** 计划评审（阶段②）  
**评审轮次：** 1 / 3  
**评审日期：** 2026-05-10  

---

## 总结

spec 将三个独立改动打包在一起（Session 配置化 + Core 合并 + Pi 精简），目标清晰、范围合理。但 spec 后端改动表对 `ctx.sessionId` 消费者和 `detectClientAgentType()` 直接调用者的列举存在严重遗漏，plan 也未覆盖 core/tests 的迁移。这些问题会导致实现阶段频繁回退修改。

**结论：需修改后重审。**

---

## MUST FIX（3 条）

### MF-1: Spec 后端改动表遗漏大量 `ctx.sessionId` 消费者文件

**优先级：** MUST FIX  
**位置：** spec.md「后端改动」表  

**问题：**  
Spec 列出移除 `PipelineContext.sessionId` 时只提到改动 `context.ts` 和 `types.ts`。实际代码中有 **16 处** `ctx.sessionId` 引用分布在 6 个文件中：

| 文件 | 引用次数 | 用途 |
|------|---------|------|
| `failover-loop.ts` | 8 | 日志记录、metric 采集、reject 参数 |
| `create-proxy-handler.ts` | 1 | tool loop 检测的 sessionKey 构建 |
| `error-logging.ts` | 3 | error 日志记录 |
| `request-logging.ts` | 2 | success 日志记录（另有 1 处已 fallback 到 metadata） |
| `tool-error-logger.ts` | 1 | tool error 日志 |
| `orchestrator.ts` | 2 | config 接口定义 + 赋值 |

Spec 未列出其中任何一个，plan Task 3 步骤 5 只写了"更新所有读取 `ctx.sessionId` 的代码改为 `ctx.metadata.get("session_id")`"并标注"需 grep 确认"。

**风险：** 实现者按 spec 后端改动表执行会遗漏这些文件，移除 `PipelineContext.sessionId` 后编译失败。

**修改方向：**  
在 spec 后端改动表中补全所有消费 `ctx.sessionId` 的文件，明确每个文件的改动内容（改为 `ctx.metadata.get("session_id")` 或其他替代方案）。

---

### MF-2: `detectClientAgentType()` 直接调用者未在 spec 中提及

**优先级：** MUST FIX  
**位置：** spec.md「后端改动」表 + plan Task 3  

**问题：**  
`detectClientAgentType()` 除了在 `client-detection.ts` hook 中被调用外，还在以下 3 个位置被**直接调用**（绕过 hook 系统）：

1. `failover-loop.ts:165` — `clientAgentType: detectClientAgentType(request.headers as RawHeaders)`
2. `error-logging.ts:105` — `clientAgentType: detectClientAgentType(ctx.request.headers as Record<string, string>)`
3. `request-logging.ts:115` — `clientAgentType: detectClientAgentType(ctx.request.headers as Record<string, string>)`

Spec 只提到重构 `detectClientAgentType → detectClient` 并在 `client-detection.ts` 中使用。但这些直接调用者的存在意味着：

- 如果只删除旧函数并替换为新函数签名，这 3 个调用点需要额外传入 config 参数
- 如果改为从 `ctx.metadata.get("client_type")` 读取（更合理的做法），需要在 spec 中明确说明

**风险：** 重构后这 3 个调用点要么编译失败（旧函数不存在），要么行为不一致（不走配置驱动的识别逻辑）。

**修改方向：**  
明确这 3 个直接调用者的处理方式：要么改为从 `ctx.metadata.get("client_type")` 读取（因为 client-detection hook 已经在 pre_route 阶段设置了这个值），要么也传入配置调用 `detectClient()`。建议前者，因为 hook 已保证 metadata 中有值。

---

### MF-3: Plan 未考虑 core/tests/ 9 个测试文件的迁移

**优先级：** MUST FIX  
**位置：** plan.md Task 1 + Task 6  

**问题：**  
Core 包有 9 个测试文件，共 1523 行，覆盖核心基础设施：

| 文件 | 测试内容 |
|------|---------|
| `core/tests/concurrency/semaphore.test.ts` | 信号量 |
| `core/tests/loop-prevention/tool-loop-guard.test.ts` | 工具循环检测 |
| `core/tests/loop-prevention/stream-loop-guard.test.ts` | 流式循环检测 |
| `core/tests/loop-prevention/ngram-detector.test.ts` | N-gram 检测 |
| `core/tests/loop-prevention/session-tracker.test.ts` | Session 追踪 |
| `core/tests/monitor/request-tracker.test.ts` | 请求追踪 |
| `core/tests/monitor/stats-aggregator.test.ts` | 统计聚合 |
| `core/tests/monitor/runtime-collector.test.ts` | 运行时采集 |
| `core/tests/monitor/stream-content-accumulator.test.ts` | 流内容累积 |

Plan Task 1 步骤 8 写"删除 core/ 目录"，但没有步骤提到迁移这些测试。Task 6 只说"更新引用 @llm-router/core 的测试文件 import"，指的是 router/tests 中引用 core 的测试，而非 core 自身的测试。

**风险：** 删除 core/ 后丢失 1523 行核心基础设施测试覆盖率。这些测试验证并发控制、循环防护、监控等关键模块，不应被删除。

**修改方向：**  
在 Task 1 中增加步骤：将 `core/tests/` 迁移到 `router/tests/core/`（或 `router/tests/` 对应子目录），更新 import 路径，确保测试通过后再删除 core/。

---

## LOW（4 条）

### L-1: Plan Task 1 文件列表不完整

**位置：** plan.md Task 1「涉及文件」  

Plan 列出了约 25 个涉及文件，但以下 5 个含 `@llm-router/core` import 的文件未出现在列表中：

- `router/src/index.ts`（3 imports：SemaphoreManager, AdaptiveController, RequestTracker, SessionTracker）— **应用入口文件，遗漏会导致构建失败**
- `router/src/admin/providers.ts`（2 imports）
- `router/src/admin/monitor.ts`（1 import）
- `router/src/admin/quick-setup.ts`（2 imports）
- `router/src/core/registry.ts`（1 import）

建议补全文件列表，特别是入口文件 `index.ts`。

---

### L-2: 数据流图声称"内存缓存"但 spec/plan 未描述实现

**位置：** spec.md「数据流图」  

数据流图标注"每次请求加载 + 内存缓存"，但 spec 的识别逻辑和 plan 的 Task 3 都没有描述缓存实现。AC1.5 要求"修改配置后无需重启即生效"。

如果依赖 SQLite in-process 直读（项目现有 `getSetting()` 模式），性能上可接受，但数据流图的"内存缓存"描述具有误导性。建议：要么删除"内存缓存"描述，要么在 plan 中补充缓存实现步骤。

---

### L-3: Plan 依赖图与建议执行顺序矛盾

**位置：** plan.md 依赖关系图 + 建议执行顺序  

依赖图显示 Task 2 与 Task 1 无依赖（可并行），但建议执行顺序写的是 `Task 1 → Task 2`（串行）。建议统一为明确的串行顺序（Task 2 确实不依赖 Task 1，可以先做或并行）。

---

### L-4: Spec import 数量估算偏差

**位置：** spec.md「Import 更新（约 38 处）」  

实际统计为 **40 处** import 分布在 **20 个文件**（而非 spec 表格中列出的几类）。偏差不大，但建议更新为准确数字，避免实现者按 38 处估算工作量。

---

## 评审结论

| 级别 | 数量 |
|------|------|
| MUST FIX | 3 |
| LOW | 4 |

**结论：需修改后重审。** MF-1 和 MF-2 涉及 spec 对改动范围的遗漏，MF-3 涉及测试资产丢失风险。建议修复后进入第 2 轮评审。
