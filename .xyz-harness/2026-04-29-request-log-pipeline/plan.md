# 请求日志管线重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构请求日志管线，消除 in-place mutation，引入函数式数据流和 pipeline_snapshot 元数据记录，使日志能完整重建请求生命周期。

**Architecture:** 每个加工函数接收 body 作为输入参数，返回 `{ body, meta }` 元组。body 作为值在管线中流动。PipelineSnapshot 收集器在各阶段后记录 meta。model-info 注入从 transport 层移到 handler 层（日志记录之后）。

**Tech Stack:** TypeScript, Fastify, better-sqlite3, Vitest

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/proxy/pipeline-snapshot.ts` | Create | PipelineSnapshot 类 + StageRecord 类型 |
| `src/proxy/response-transform.ts` | Create | maybeInjectModelInfoTag 函数 |
| `src/db/migrations/033_add_pipeline_snapshot.sql` | Create | ALTER TABLE 添加 pipeline_snapshot 列 |
| `src/proxy/enhancement/enhancement-handler.ts` | Modify | 接收 body 参数，返回新 body + meta |
| `src/proxy/patch/index.ts` | Modify | 返回新 body + meta（内部 deep clone） |
| `src/proxy/loop-prevention/tool-loop-guard.ts` | Modify | injectLoopBreakPrompt 返回新 body |
| `src/proxy/transport-fn.ts` | Modify | 删除 model-info 注入逻辑 |
| `src/proxy/proxy-handler.ts` | Modify | 函数式数据流 + snapshot 收集 |
| `src/proxy/log-helpers.ts` | Modify | 接受 pipelineSnapshot 参数 |
| `src/proxy/proxy-logging.ts` | Modify | 传递 pipelineSnapshot |
| `src/db/logs.ts` | Modify | RequestLogInsert 添加 pipeline_snapshot |
| `tests/pipeline-snapshot.test.ts` | Create | PipelineSnapshot 单元测试 |
| `tests/response-transform.test.ts` | Create | maybeInjectModelInfoTag 单元测试 |
| `tests/patch.test.ts` | Modify | 适配新 applyProviderPatches 返回值 |
| `tests/response-cleaner.test.ts` | Modify | 验证不修改输入 |
| `tests/directive-parser.test.ts` | Modify | 验证不修改输入 |
| `tests/integration.test.ts` | Modify | 端到端验证 pipeline_snapshot |
| `frontend/src/views/Logs.vue` | Modify | 展示 pipeline_snapshot |

---

### Task 1: PipelineSnapshot 类 + StageRecord 类型

**Files:**
- Create: `src/proxy/pipeline-snapshot.ts`
- Create: `tests/pipeline-snapshot.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// tests/pipeline-snapshot.test.ts
import { describe, it, expect } from "vitest";
import { PipelineSnapshot, type StageRecord } from "../src/proxy/pipeline-snapshot.js";

describe("PipelineSnapshot", () => {
  it("add + toJSON 生成有序 JSON 数组", () => {
    const snap = new PipelineSnapshot();
    snap.add({ stage: "enhancement", router_tags_stripped: 1, directive: null });
    snap.add({ stage: "routing", client_model: "a", backend_model: "b", provider_id: "p1", strategy: "failover" });
    const parsed = JSON.parse(snap.toJSON());
    expect(parsed).toHaveLength(2);
    expect(parsed[0].stage).toBe("enhancement");
    expect(parsed[1].stage).toBe("routing");
  });

  it("空 snapshot 返回空数组", () => {
    const snap = new PipelineSnapshot();
    expect(JSON.parse(snap.toJSON())).toEqual([]);
  });

  it("构造函数接受初始 stages 并深拷贝", () => {
    const initial: StageRecord[] = [{ stage: "enhancement", router_tags_stripped: 1, directive: null }];
    const snap = new PipelineSnapshot(initial);
    snap.add({ stage: "routing", client_model: "a", backend_model: "b", provider_id: "p1", strategy: "failover" });
    // 初始数组不被修改
    expect(initial).toHaveLength(1);
    const parsed = JSON.parse(snap.toJSON());
    expect(parsed).toHaveLength(2);
  });

  it("StageRecord 各变体类型正确", () => {
    const records: StageRecord[] = [
      { stage: "enhancement", router_tags_stripped: 0, directive: { type: "select_model", value: "x" } },
      { stage: "tool_guard", action: "inject_break_prompt", tool: "read_file" },
      { stage: "routing", client_model: "a", backend_model: "b", provider_id: "p1", strategy: "round_robin" },
      { stage: "overflow", triggered: false },
      { stage: "provider_patch", types: ["deepseek_tool_use_to_text"] },
      { stage: "response_transform", model_info_tag_injected: true },
    ];
    // 类型检查通过即测试通过
    expect(records).toHaveLength(6);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/zhushanwen/Code/llm-simple-router-workspace/.bare/refactor-request-log-pipeline && npx vitest run tests/pipeline-snapshot.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现最小代码**

```typescript
// src/proxy/pipeline-snapshot.ts
export interface DirectiveMeta {
  type: "select_model" | "router_model" | "router_command";
  value: string;
}

export type StageRecord =
  | { stage: "enhancement"; router_tags_stripped: number; directive: DirectiveMeta | null }
  | { stage: "tool_guard"; action: string; tool: string }
  | { stage: "routing"; client_model: string; backend_model: string; provider_id: string; strategy: string }
  | { stage: "overflow"; triggered: boolean; redirect_to?: string; redirect_provider?: string }
  | { stage: "provider_patch"; types: string[] }
  | { stage: "response_transform"; model_info_tag_injected: boolean };

export class PipelineSnapshot {
  private readonly stages: StageRecord[];
  constructor(initial?: StageRecord[]) { this.stages = initial ? [...initial] : []; }
  add(record: StageRecord): void { this.stages.push(record); }
  toJSON(): string { return JSON.stringify(this.stages); }
  getStages(): readonly StageRecord[] { return this.stages; }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/pipeline-snapshot.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/proxy/pipeline-snapshot.ts tests/pipeline-snapshot.test.ts
git commit -m "feat: add PipelineSnapshot class and StageRecord types"
```

---

### Task 2: DB 迁移 — 添加 pipeline_snapshot 列

**Files:**
- Create: `src/db/migrations/033_add_pipeline_snapshot.sql`

- [ ] **Step 1: 创建迁移文件**

```sql
-- src/db/migrations/033_add_pipeline_snapshot.sql
ALTER TABLE request_logs ADD COLUMN pipeline_snapshot TEXT;
```

- [ ] **Step 2: 验证迁移在测试中生效**

Run: `npx vitest run tests/db.test.ts`
Expected: PASS（现有测试应通过，新列不影响旧逻辑）

- [ ] **Step 3: Commit**

```bash
git add src/db/migrations/033_add_pipeline_snapshot.sql
git commit -m "feat: add pipeline_snapshot column to request_logs"
```

---

### Task 3: 重构 applyProviderPatches — 返回新 body + meta

**Files:**
- Modify: `src/proxy/patch/index.ts`
- Modify: `tests/patch.test.ts`

- [ ] **Step 1: 更新 applyProviderPatches 的测试**

在 `tests/patch.test.ts` 的 `describe("applyProviderPatches")` 中（第 364 行起），修改两个测试用例：

```typescript
describe("applyProviderPatches", () => {
  it("DeepSeek provider 时将非 DeepSeek 的 tool_use 转为 text", () => {
    const body = {
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "read", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "ok" }] },
      ],
    };
    const original = JSON.stringify(body);
    const result = applyProviderPatches(body, { base_url: "https://api.deepseek.com/anthropic" });
    // 返回新 body，不修改原 body
    expect(JSON.stringify(body)).toBe(original);
    const assistant = result.body.messages[1] as { content: unknown[] };
    expect((assistant.content[0] as { type: string }).type).toBe("text");
    // meta 记录 patch 类型
    expect(result.meta.types).toContain("deepseek_tool_use_to_text");
  });

  it("非 DeepSeek provider 时不修改", () => {
    const body = {
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "read", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "ok" }] },
      ],
    };
    const result = applyProviderPatches(body, { base_url: "https://open.bigmodel.cn/api/anthropic" });
    expect(result.body).toBe(body); // 同一引用，未克隆
    expect(result.meta.types).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/patch.test.ts -t "applyProviderPatches"`
Expected: FAIL — void is not assignable to `{ body, meta }`

- [ ] **Step 3: 实现**

修改 `src/proxy/patch/index.ts`：

```typescript
import { applyDeepSeekPatches } from "./deepseek/index.js";

interface ProviderInfo {
  base_url: string;
}

export interface ProviderPatchMeta {
  types: string[];
}

export function applyProviderPatches(
  body: Record<string, unknown>,
  provider: ProviderInfo,
): { body: Record<string, unknown>; meta: ProviderPatchMeta } {
  if (!needsDeepSeekPatch(body, provider)) {
    return { body, meta: { types: [] } };
  }
  const cloned = JSON.parse(JSON.stringify(body));
  applyDeepSeekPatches(cloned);
  return { body: cloned, meta: { types: ["deepseek_tool_use_to_text"] } };
}

function needsDeepSeekPatch(body: Record<string, unknown>, provider: ProviderInfo): boolean {
  if (provider.base_url.includes("deepseek")) return true;
  const model = (body.model as string) ?? "";
  return model.includes("deepseek");
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/patch.test.ts`
Expected: PASS（所有 patch 测试，包括内部函数测试）

- [ ] **Step 5: Commit**

```bash
git add src/proxy/patch/index.ts tests/patch.test.ts
git commit -m "refactor: applyProviderPatches returns new body + meta instead of in-place mutation"
```

---

### Task 4: 重构 injectLoopBreakPrompt — 返回新 body

**Files:**
- Modify: `src/proxy/loop-prevention/tool-loop-guard.ts`

- [ ] **Step 1: 修改 injectLoopBreakPrompt 签名和实现**

在 `src/proxy/loop-prevention/tool-loop-guard.ts` 第 45 行起，将 `injectLoopBreakPrompt` 改为返回新 body：

```typescript
injectLoopBreakPrompt(
  body: Record<string, unknown>,
  apiType: "openai" | "anthropic",
  toolName: string,
): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(body));
  const prompt = `[系统提醒] 检测到你可能陷入了反复调用 "${toolName}" 工具的循环。请停下来，总结当前进展，直接告知用户。`;

  if (apiType === "anthropic") {
    const system = cloned.system;
    if (Array.isArray(system)) {
      system.push({ type: "text", text: prompt });
    } else if (typeof system === "string") {
      cloned.system = [{ type: "text", text: system }, { type: "text", text: prompt }];
    } else {
      cloned.system = [{ type: "text", text: prompt }];
    }
  } else {
    const messages = (cloned.messages as unknown[]) ?? [];
    messages.unshift({ role: "system", content: prompt });
    cloned.messages = messages;
  }
  return cloned;
}
```

- [ ] **Step 2: 运行测试确认通过**

Run: `npx vitest run`
Expected: PASS（当前没有专门测试 injectLoopBreakPrompt，但 proxy-handler 中的集成测试会覆盖）

如果发现调用方仍期望 void 返回导致编译错误，先不修改调用方（Task 8 统一处理）。

- [ ] **Step 3: Commit**

```bash
git add src/proxy/loop-prevention/tool-loop-guard.ts
git commit -m "refactor: injectLoopBreakPrompt returns new body instead of in-place mutation"
```

---

### Task 5: 重构 applyEnhancement — 接收 body 参数，返回新 body + meta

**Files:**
- Modify: `src/proxy/enhancement/enhancement-handler.ts`
- Modify: `tests/response-cleaner.test.ts`（添加输入不变性断言）
- Modify: `tests/directive-parser.test.ts`（添加输入不变性断言）

这是最复杂的单个函数重构。核心变更：

1. 签名从 `(db, request, clientModel, sessionId)` 改为 `(db, body, clientModel, sessionId)`
2. 不再修改 `request.body`，而是返回新的 body
3. 返回值增加 `meta` 字段

- [ ] **Step 1: 更新 EnhancementResult 接口**

在 `src/proxy/enhancement/enhancement-handler.ts` 顶部，修改接口：

```typescript
export interface EnhancementMeta {
  router_tags_stripped: number;
  directive: { type: "select_model" | "router_model" | "router_command"; value: string } | null;
}

export interface EnhancementResult {
  body: Record<string, unknown>;
  effectiveModel: string;
  originalModel: string | null;
  interceptResponse: InterceptResponse | null;
  meta: EnhancementMeta;
}
```

- [ ] **Step 2: 修改 applyEnhancement 函数签名和内部逻辑**

关键变更点（按行号）：

- 函数签名：`request: FastifyRequest` → `body: Record<string, unknown>`，删除 FastifyRequest import（如果只用于此处）
- 第 95 行：`parseToolResult(request.body as ...)` → `parseToolResult(body)`
- 第 175 行：`cleanRouterResponses(request.body as ...)` → `cleanRouterResponses(body)`
- 第 176 行：删除 `(request.body as ...).messages = cleaned.messages` 这行 in-place mutation
- 第 178 行：`parseDirective(request.body as ...)` → `parseDirective(body)`
- 第 282 行：删除 `(request.body as ...).messages = directive.cleanedBody.messages` 这行 in-place mutation
- 在函数内部，追踪 body 的变换链：
  - 初始 body → cleanRouterResponses → cleaned body
  - cleaned body → parseDirective → directive-cleaned body
  - 最终返回最后变换后的 body
- 计算 `router_tags_stripped`：比较 clean 前后 messages 数量差异或 router-response 标签匹配数
- 构建 `meta` 对象并返回

- [ ] **Step 3: 更新调用方（临时兼容）**

在 `src/proxy/proxy-handler.ts` 第 151 行，临时修改调用方式：

```typescript
// 临时：解构新返回值，但 body 暂时不使用（Task 8 统一替换）
const { effectiveModel, originalModel, interceptResponse } = applyEnhancement(
  deps.db, request.body as Record<string, unknown>, clientModel, sessionId,
);
```

同时更新 `src/proxy/proxy-logging.ts` 中 `handleIntercept` 函数（第 32 行）中对 `applyEnhancement` 的任何调用。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/proxy/enhancement/ src/proxy/proxy-handler.ts src/proxy/proxy-logging.ts
git commit -m "refactor: applyEnhancement accepts body param, returns new body + meta"
```

---

### Task 6: 提取 maybeInjectModelInfoTag + 清理 transport-fn.ts

**Files:**
- Create: `src/proxy/response-transform.ts`
- Create: `tests/response-transform.test.ts`
- Modify: `src/proxy/transport-fn.ts`（删除第 108-116 行的 model-info 注入）

- [ ] **Step 1: 写失败测试**

```typescript
// tests/response-transform.test.ts
import { describe, it, expect } from "vitest";
import { maybeInjectModelInfoTag } from "../src/proxy/response-transform.js";

describe("maybeInjectModelInfoTag", () => {
  const anthropicSuccessBody = JSON.stringify({
    content: [{ type: "text", text: "Hello" }],
  });

  it("originalModel 存在时注入 model-info 标签", () => {
    const result = maybeInjectModelInfoTag(anthropicSuccessBody, "original-model", "effective-model");
    expect(result.body).not.toBe(anthropicSuccessBody);
    const parsed = JSON.parse(result.body);
    expect(parsed.content[0].text).toContain("effective-model");
    expect(result.meta.model_info_tag_injected).toBe(true);
  });

  it("originalModel 为 null 时不注入", () => {
    const result = maybeInjectModelInfoTag(anthropicSuccessBody, null, "effective-model");
    expect(result.body).toBe(anthropicSuccessBody);
    expect(result.meta.model_info_tag_injected).toBe(false);
  });

  it("非 JSON body 不崩溃，返回原 body", () => {
    const result = maybeInjectModelInfoTag("not json", "orig", "eff");
    expect(result.body).toBe("not json");
    expect(result.meta.model_info_tag_injected).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/response-transform.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现**

```typescript
// src/proxy/response-transform.ts
import { buildModelInfoTag } from "./enhancement/enhancement-handler.js";

export interface ResponseTransformMeta {
  model_info_tag_injected: boolean;
}

export function maybeInjectModelInfoTag(
  responseBody: string,
  originalModel: string | null,
  effectiveModel: string,
): { body: string; meta: ResponseTransformMeta } {
  if (!originalModel) {
    return { body: responseBody, meta: { model_info_tag_injected: false } };
  }
  try {
    const bodyObj = JSON.parse(responseBody);
    if (bodyObj.content?.[0]?.text) {
      bodyObj.content[0].text += `\n\n${buildModelInfoTag(effectiveModel)}`;
      return { body: JSON.stringify(bodyObj), meta: { model_info_tag_injected: true } };
    }
  } catch { /* non-JSON response, skip injection */ }
  return { body: responseBody, meta: { model_info_tag_injected: false } };
}
```

- [ ] **Step 4: 删除 transport-fn.ts 中的 model-info 注入**

在 `src/proxy/transport-fn.ts` 中，删除第 108-116 行的 model-info 注入逻辑。该段代码是：

```typescript
if (p.originalModel && result.kind === "success" && result.statusCode === UPSTREAM_SUCCESS) {
  try {
    const bodyObj = JSON.parse(result.body);
    if (bodyObj.content?.[0]?.text) {
      bodyObj.content[0].text += `\n\n${buildModelInfoTag(p.effectiveModel)}`;
      return { ...result, body: JSON.stringify(bodyObj) };
    }
  } catch { p.request.log.debug("Failed to inject model-info tag into non-JSON response"); }
}
```

删除这段代码，以及顶部对 `buildModelInfoTag` 的 import（如不再需要）。

- [ ] **Step 5: 运行所有测试确认通过**

Run: `npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/proxy/response-transform.ts src/proxy/transport-fn.ts tests/response-transform.test.ts
git commit -m "refactor: extract maybeInjectModelInfoTag, remove model-info injection from transport layer"
```

---

### Task 7: 更新日志层 — 支持 pipeline_snapshot

**Files:**
- Modify: `src/db/logs.ts`（RequestLogInsert + insertRequestLog + 新增 updateLogPipelineSnapshot）
- Modify: `src/proxy/log-helpers.ts`
- Modify: `src/proxy/proxy-logging.ts`

- [ ] **Step 1: 更新 RequestLogInsert 接口**

在 `src/db/logs.ts` 的 `RequestLogInsert` 接口中添加：

```typescript
pipeline_snapshot?: string | null;
```

在 `insertRequestLog` 函数中，将 `pipeline_snapshot` 加入 INSERT 语句的列列表和 VALUES：

```sql
... pipeline_snapshot) VALUES (... ?)
```

值为 `log.pipeline_snapshot ?? null`。

新增 `updateLogPipelineSnapshot` 函数（用于 response_transform stage 的后置更新）：

```typescript
export function updateLogPipelineSnapshot(db: Database.Database, logId: string, snapshot: string): void {
  db.prepare("UPDATE request_logs SET pipeline_snapshot = ? WHERE id = ?").run(snapshot, logId);
}
```

- [ ] **Step 2: 更新 insertSuccessLog**

在 `src/proxy/log-helpers.ts` 的 `RequestLogParams` 接口中添加：

```typescript
pipelineSnapshot?: string | null;
```

在 `insertSuccessLog` 函数调用 `insertRequestLog` 时传入 `pipeline_snapshot: pipelineSnapshot ?? null`。

- [ ] **Step 3: 更新 insertRejectedLog**

在 `RejectedLogParams` 接口中添加 `pipelineSnapshot?: string | null`，同样传入 `insertRequestLog`。

- [ ] **Step 4: 更新 logResilienceResult**

在 `src/proxy/proxy-logging.ts` 的 `logResilienceResult` 参数中添加 `pipelineSnapshot?: string`，传递给所有 `insertRequestLog` 和 `insertSuccessLog` 调用。

对 `handleIntercept` 函数同样添加 `pipelineSnapshot` 参数支持。

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run`
Expected: PASS（pipeline_snapshot 为可选参数，不影响现有测试）

- [ ] **Step 6: Commit**

```bash
git add src/db/logs.ts src/proxy/log-helpers.ts src/proxy/proxy-logging.ts
git commit -m "feat: logging layer accepts pipeline_snapshot parameter"
```

---

### Task 8: 重构 proxy-handler.ts — 函数式数据流 + snapshot 收集

**Files:**
- Modify: `src/proxy/proxy-handler.ts`

这是最核心的变更。将 handleProxyRequest 和 executeFailoverLoop 中的 in-place mutation 替换为函数式数据流。

- [ ] **Step 1: 修改 handleProxyRequest 中的管线流程**

关键变更（`proxy-handler.ts` 第 142-199 行）：

```typescript
// 第 148 行：从 request.body 读取 clientModel（只读）
const clientModel = ((request.body as Record<string, unknown>).model as string) || "unknown";
const sessionId = (request.headers as RawHeaders)["x-claude-code-session-id"] as string | undefined;

// 捕获原始 body（所有加工之前）
const rawBody = JSON.parse(JSON.stringify(request.body as Record<string, unknown>));
const clientReq = null; // 后面在 executeFailoverLoop 中重新构建

const snapshot = new PipelineSnapshot();

// 第 151 行：applyEnhancement 接收 body 参数
const { body: enhancedBody, effectiveModel, originalModel, interceptResponse, meta: enhMeta } = applyEnhancement(
  deps.db, request.body as Record<string, unknown>, clientModel, sessionId,
);
snapshot.add({ stage: "enhancement", router_tags_stripped: enhMeta.router_tags_stripped, directive: enhMeta.directive });

// 第 153-189 行：tool guard
let guardedBody = enhancedBody;
if (deps.sessionTracker && sessionId) {
  const routerKeyId = (request.routerKey as { id?: string } | undefined)?.id ?? null;
  const sessionKey = routerKeyId ? `${routerKeyId}:${sessionId}` : sessionId;
  const lastToolUse = extractLastToolUse(enhancedBody);
  if (lastToolUse) {
    const toolGuard = new ToolLoopGuard(deps.sessionTracker, { enabled: true, minConsecutiveCount: 3, detectorConfig: { n: 6, windowSize: 500, repeatThreshold: 5 } });
    const checkResult = toolGuard.check(sessionKey, lastToolUse);
    if (checkResult.detected) {
      const loopCount = deps.sessionTracker.getLoopCount(sessionKey);
      if (loopCount === 1) {
        guardedBody = toolGuard.injectLoopBreakPrompt(enhancedBody, apiType, lastToolUse.toolName);
        snapshot.add({ stage: "tool_guard", action: "inject_break_prompt", tool: lastToolUse.toolName });
        request.log.warn({ sessionId, toolName: lastToolUse.toolName, loopCount }, "Tool call loop detected, injecting break prompt");
      } else if (loopCount === TIER2_LOOP_THRESHOLD) {
        // ... 不变
      }
    }
  }
}

// 第 192 行：intercept check
if (interceptResponse) return handleIntercept(deps.db, apiType, request, reply, interceptResponse, clientModel, sessionId);

// 第 194 行：传入 guardedBody（而非 request.body）
return executeFailoverLoop({
  request, reply, apiType, upstreamPath, errors, deps, options,
  effectiveModel, originalModel,
  pipelineBody: guardedBody,     // 替代 originalBody
  rawBody,                       // 原始 body 用于 client_request
  snapshot,
  sessionId,
});
```

- [ ] **Step 2: 修改 executeFailoverLoop 的参数和内部逻辑**

修改 `FailoverContext` 接口，将 `originalBody` 替换为 `pipelineBody` 和 `rawBody`：

```typescript
interface FailoverContext {
  // ... 其他字段不变
  pipelineBody: Record<string, unknown>;  // 经过 enhancement + toolGuard 后的 body
  rawBody: Record<string, unknown>;       // 原始 client body
  snapshot: PipelineSnapshot;
}
```

在 `executeFailoverLoop` 内部（第 204 行起），关键变更：

1. **第 214 行**：不再用 `body = request.body`，改用 `ctx.pipelineBody` 作为起点
2. **第 263 行**：`body.model = resolved.backend_model` → `body = { ...body, model: resolved.backend_model }`（或 `let currentBody = ...` 可变变量追踪）
3. **第 266-274 行**：overflow 结果更新 currentBody
4. **第 276 行**：`applyProviderPatches(body, provider)` → `const { body: patchedBody, meta: patchMeta } = applyProviderPatches(currentBody, provider); snapshot.add(...)`
5. **第 280-286 行**：`clientReq` 使用 `rawBody`（真正的原始请求），`upstreamReqBase` 使用 `patchedBody`
6. **第 288-292 行**：`buildTransportFn` 使用 `patchedBody`
7. **日志调用**：传入 `snapshot.toJSON()` 作为 `pipelineSnapshot` 参数
8. **响应注入**：在 `logResilienceResult` 之后、`reply.send` 之前调用 `maybeInjectModelInfoTag`

建议用一个 `let currentBody` 变量在 while 循环内追踪 body 的变换：

**关于 failover 循环中 snapshot 的处理：** 每次 failover 迭代的 routing/overflow/patch stages 可能不同，但不应无限累积。使用两个 snapshot：
- `baseSnapshot`：包含 enhancement + tool_guard stages（循环外创建，只添加一次）
- 每次迭代创建 `iterationSnapshot`，克隆 `baseSnapshot` 的 stages，追加当前迭代的 stages

```typescript
// handleProxyRequest 中
const baseSnapshot = new PipelineSnapshot();
baseSnapshot.add({ stage: "enhancement", ... });
if (toolGuard triggered) baseSnapshot.add({ stage: "tool_guard", ... });

// executeFailoverLoop 内
while (true) {
  const iterationSnapshot = new PipelineSnapshot();
  // 复制 base stages
  for (const s of baseSnapshotStages) iterationSnapshot.add(s);

  let currentBody = JSON.parse(JSON.stringify(pipelineBody));
  // routing
  currentBody = { ...currentBody, model: resolved.backend_model };
  iterationSnapshot.add({ stage: "routing", ... });
  // overflow
  // ...
  iterationSnapshot.add({ stage: "overflow", ... });
  // provider patches
  const { body: patchedBody, meta: patchMeta } = applyProviderPatches(currentBody, provider);
  iterationSnapshot.add({ stage: "provider_patch", types: patchMeta.types });
  // beforeSendProxy
  options?.beforeSendProxy?.(patchedBody, isStream);
  // logging — 此时不含 response_transform stage
  const lastLogId = logResilienceResult(deps.db, { ..., pipelineSnapshot: iterationSnapshot.toJSON() }, ...);
  // response transform — 日志记录之后
  if (!reply.raw.headersSent && resilienceResult.result.kind === "success") {
    const { body: finalBody, meta: respMeta } = maybeInjectModelInfoTag(
      resilienceResult.result.body, originalModel, effectiveModel,
    );
    iterationSnapshot.add({ stage: "response_transform", model_info_tag_injected: respMeta.model_info_tag_injected });
    updateLogPipelineSnapshot(deps.db, lastLogId, iterationSnapshot.toJSON());
    reply.code(resilienceResult.result.statusCode).send(finalBody);
  }
  // ...
}
```

PipelineSnapshot 需要一个 `stages` getter 或构造函数接受初始 stages 数组，以支持克隆：

```typescript
export class PipelineSnapshot {
  private readonly stages: StageRecord[];
  constructor(initial?: StageRecord[]) { this.stages = initial ? [...initial] : []; }
  add(record: StageRecord): void { this.stages.push(record); }
  toJSON(): string { return JSON.stringify(this.stages); }
  getStages(): readonly StageRecord[] { return this.stages; }
}
```

- [ ] **Step 3: 处理 handleIntercept 的 snapshot**

在 `proxy-logging.ts` 的 `handleIntercept` 中，构建一个只含 enhancement stage 的 snapshot：

```typescript
const interceptSnapshot = new PipelineSnapshot();
interceptSnapshot.add({ stage: "enhancement", ...enhMeta });
```

传递给 `insertRequestLog` 的 `pipeline_snapshot` 字段。

- [ ] **Step 4: 运行测试**

Run: `npx vitest run`
Expected: 可能有少量测试需要适配。重点关注 `tests/proxy-handler.test.ts`、`tests/integration.test.ts`、`tests/openai-proxy.test.ts`、`tests/anthropic-proxy.test.ts`。

- [ ] **Step 5: 修复失败的测试**

主要适配点：
- `applyEnhancement` 调用方式变更
- `applyProviderPatches` 返回值变更
- `injectLoopBreakPrompt` 返回值变更
- `logResilienceResult` 参数增加 `pipelineSnapshot`

- [ ] **Step 6: Commit**

```bash
git add src/proxy/proxy-handler.ts
git commit -m "refactor: proxy-handler uses functional data flow with PipelineSnapshot"
```

---

### Task 9: 集成测试 — 端到端验证

**Files:**
- Modify: `tests/integration.test.ts`（或 `tests/logging.test.ts`）

- [ ] **Step 1: 写集成测试验证 pipeline_snapshot**

在合适的测试文件中添加：

```typescript
describe("pipeline_snapshot 端到端", () => {
  it("记录 enhancement + routing stages", async () => {
    // 构造带 $SELECT-MODEL 指令的请求
    // 发送请求
    // 查询 request_logs 表
    // 验证 client_request 包含原始 $SELECT-MODEL
    // 验证 pipeline_snapshot JSON 包含 enhancement 和 routing stages
  });

  it("client_request 是真正的原始请求（未被加工）", async () => {
    // 构造带 <router-response> 标签的请求
    // 发送请求
    // 验证 client_request.body 仍包含 <router-response> 标签
  });

  it("upstream_response 不含 model-info 标签", async () => {
    // 构造触发 model-info 注入的请求（originalModel 存在）
    // 发送请求
    // 验证 upstream_response.body 不含 <router-response type="model-info">
    // 验证客户端实际收到的响应含 model-info 标签
  });

  it("DeepSeek provider 记录 provider_patch stage", async () => {
    // 构造 DeepSeek provider 的请求
    // 发送请求
    // 验证 pipeline_snapshot 包含 { stage: "provider_patch", types: ["deepseek_tool_use_to_text"] }
  });
});
```

- [ ] **Step 2: 运行测试确认通过**

Run: `npx vitest run tests/integration.test.ts -t "pipeline_snapshot"`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/integration.test.ts
git commit -m "test: add end-to-end pipeline_snapshot integration tests"
```

---

### Task 10: 前端 — 展示 pipeline_snapshot

**Files:**
- Modify: `frontend/src/views/Logs.vue`（或日志详情组件）

- [ ] **Step 1: 在日志详情弹窗/面板中添加 pipeline_snapshot 展示**

当 `pipeline_snapshot` 不为 null 时，解析 JSON 数组，以时间线/步骤列表形式展示每个 stage。使用 shadcn-vue 的 `Badge` 组件标识 stage 类型，简洁文本展示每个 stage 的关键信息。

- [ ] **Step 2: 验证前端展示**

Run: `cd frontend && npm run build`
Expected: 无类型错误

- [ ] **Step 3: Commit**

```bash
git add frontend/
git commit -m "feat: display pipeline_snapshot in log detail view"
```

---

### Task 11: 最终验证 — 全量测试 + Lint

- [ ] **Step 1: 运行全量测试**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 2: 运行 Lint**

Run: `npm run lint`
Expected: 无警告

- [ ] **Step 3: 运行前端构建**

Run: `cd frontend && npm run build`
Expected: 成功

- [ ] **Step 4: Final commit (如有 lint 修复)**

```bash
git add -A
git commit -m "chore: final lint and test cleanup"
```
