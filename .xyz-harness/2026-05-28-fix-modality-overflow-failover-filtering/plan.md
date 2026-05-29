---
verdict: pass
complexity: L1
---

# Modality Constraint Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use xyz-harness-subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `computeModalityRedirectTargets()` 从 prepend 模式改为约束过滤模式，使 failover 循环只尝试支持当前模态的 targets。

**Architecture:** 改动集中在 Routing 层（modality-redirect.ts）和 Handler 层（failover-loop.ts 空列表处理），同时机械扩展 ErrorKind 机制（proxy-core.ts + format/types.ts + 两个 adapter 文件）。函数签名不变，新增 1 个 ErrorKind 枚举值。

**Tech Stack:** TypeScript, Vitest, better-sqlite3 (in-memory for tests), Fastify inject pattern

---

## File Structure

| File | Type | Group | Description |
|------|------|-------|-------------|
| `router/src/proxy/routing/modality-redirect.ts` | modify | BG1 | 核心逻辑：prepend → filter + replace |
| `router/src/proxy/handler/failover-loop.ts` | modify | BG1 | 空列表提前报错分支 |
| `router/src/proxy/proxy-core.ts` | modify | BG1 | ErrorKind 新增 unsupportedModality |
| `router/src/proxy/format/types.ts` | modify | BG1 | ErrorKind 类型同步更新 |
| `router/src/proxy/format/adapters/shared-error-meta.ts` | modify | BG1 | OPENAI_FAMILY_ERROR_META 新增条目 |
| `router/src/proxy/format/adapters/anthropic.ts` | modify | BG1 | ANTHROPIC_ERROR_META 新增条目 |
| `router/src/proxy/handler/create-proxy-handler.ts` | modify | BG1 | fallback errorMeta 新增 unsupportedModality 条目 |
| `router/tests/modality-redirect.test.ts` | modify | BG1 | 新增过滤行为测试 |
| `router/tests/failover-modality-filter.test.ts` | create | BG1 | 空列表 + 错误格式集成测试 |

## Interface Contracts

### Module: modality-redirect

#### Function: computeModalityRedirectTargets

| Method | Signature | Returns | Edge Cases | Spec Ref |
|--------|-----------|---------|------------|----------|
| computeModalityRedirectTargets | (db: Database.Database, targets: Target[], clientModel: string, body: Record<string, unknown>, snapshot: PipelineSnapshot) → Target[] | Target[] | 空列表输入 → 空列表输出；异常 → 原始 targets | AC-1~8 |

**行为变更说明**：返回值语义不变（Target[]），但内部逻辑从 "检测首 target → prepend fallback" 改为 "扫描所有 targets → 过滤不支持模态的 → 必要时替换为 fallback"。当返回空列表时，调用方（failover-loop.ts）需处理提前报错。

### Module: proxy-core

#### Type: ErrorKind

| Field | Change | Spec Ref |
|-------|--------|----------|
| ErrorKind union | 新增 `"unsupportedModality"` | FR-3 |

#### Function: createErrorFormatter

| Method | Signature | Returns | Spec Ref |
|--------|-----------|---------|----------|
| unsupportedModality | () → { statusCode: 400, body: ... } | ProxyErrorResponse | FR-2, FR-3 |

### Module: failover-loop

#### Function: executeFailoverLoop (modality 返回值处理)

| Location | Change | Spec Ref |
|----------|--------|----------|
| line ~220 modality 返回后 | 新增空列表检查 → rejectAndReply(errors.unsupportedModality()) | FR-2 |

## Spec Coverage Matrix

| Spec AC | Interface Method | Data Flow | Task |
|---------|-----------------|-----------|------|
| AC-1 (部分支持) | computeModalityRedirectTargets | detectModalities → filter by capabilities → snapshot | Task 1 |
| AC-2 (全部不支持+fallback) | computeModalityRedirectTargets | detectModalities → all filtered → replace with fallback → snapshot | Task 1 |
| AC-3 (全部不支持+无fallback) | computeModalityRedirectTargets | detectModalities → all filtered → no fallback → empty → snapshot | Task 1 |
| AC-4 (OpenAI 错误格式) | executeFailoverLoop + createErrorFormatter | empty list → errors.unsupportedModality() → reply | Task 2 |
| AC-5 (Anthropic 错误格式) | executeFailoverLoop + createErrorFormatter | empty list → errors.unsupportedModality() → reply | Task 2 |
| AC-6 (无多模态) | computeModalityRedirectTargets | detectModalities → empty → no-op → snapshot | Task 1 |
| AC-7 (全部支持) | computeModalityRedirectTargets | detectModalities → all support → no-op → snapshot | Task 1 |
| AC-8 (Overflow 叠加) | expandOverflowTargets (unchanged) | modality filter output → overflow input | Task 3 |
| AC-9 (promptTooLong 不变) | existing path | no change | Task 3 |

## Spec Metrics Traceability

| Spec 指标 | 采纳状态 | 对应 Task |
|-----------|---------|----------|
| AC-1 部分支持过滤 | adopted | Task 1 |
| AC-2 全部不支持+fallback | adopted | Task 1 |
| AC-3 全部不支持+无fallback | adopted | Task 1 |
| AC-4 OpenAI 错误格式 | adopted | Task 2 |
| AC-5 Anthropic 错误格式 | adopted | Task 2 |
| AC-6 无多模态不变 | adopted | Task 1 |
| AC-7 全部支持不变 | adopted | Task 1 |
| AC-8 Overflow 叠加 | adopted | Task 3 |
| AC-9 promptTooLong 不变 | adopted | Task 3 |
| FR-4 PipelineSnapshot reason | adopted | Task 1 |

---

## Task List

| # | Task | Type | Depends on | Group |
|---|------|------|-----------|-------|
| 1 | 重写 computeModalityRedirectTargets 核心逻辑 + 单元测试 | backend | — | BG1 |
| 2 | ErrorKind 扩展 + failover-loop 空列表处理 + 集成测试 | backend | Task 1 | BG1 |
| 3 | 回归验证：现有测试 + overflow 叠加 + promptTooLong | backend | Task 2 | BG1 |

---

### Task 1: 重写 computeModalityRedirectTargets 核心逻辑 + 单元测试

**Type:** backend

**Files:**
- Modify: `router/src/proxy/routing/modality-redirect.ts`
- Modify: `router/tests/modality-redirect.test.ts`

**依赖的已有代码：**
- `detectModalities()` — 不变，已覆盖三种 API 格式
- `supportsModality()` — 不变
- `PipelineSnapshot.add()` — 不变
- `getProviderById()` / `getMappingGroup()` / `parseModels()` — 不变

**核心变更：** 将 `computeModalityRedirectTargets()` 从"检测首 target → prepend fallback"改为"扫描所有 targets → 按模态能力过滤 → 必要时替换为 fallback"。

**新逻辑伪代码：**
```
function computeModalityRedirectTargets(db, targets, clientModel, body, snapshot):
  try:
    if targets.length === 0: return targets

    modalities = detectModalities(body)
    if modalities.size === 0:
      snapshot("no-multimodal-detected")
      return targets

    // 扫描所有 targets，过滤不支持模态的
    eligible = []
    for target in targets:
      provider = getProviderById(db, target.provider_id)
      if provider:
        entry = parseModels(provider.models).find(e => e.name === target.backend_model)
        caps = entry?.capabilities ?? []
        if all modalities supported by caps:
          eligible.push(target)
        // else: skip this target
      else:
        eligible.push(target)  // provider 不存在时不过滤，保持现有行为

    if eligible.length === targets.length:
      snapshot("all-targets-support-modalities")
      return targets

    if eligible.length > 0:
      snapshot("filtered-ineligible-targets")
      return eligible

    // 全部被过滤 → 尝试 fallback
    group = getMappingGroup(db, clientModel)
    if no group or no multimodal_fallback config:
      snapshot("no-eligible-targets")
      return []  // 空列表 → 调用方处理

    fbTarget = buildFallbackTarget(group.rule)
    if fbTarget provider inactive:
      snapshot("no-eligible-targets")
      return []

    if fbTarget doesn't cover missing modalities:
      snapshot("no-eligible-targets")
      return []

    snapshot("replaced-with-fallback")
    return [fbTarget]

  catch:
    snapshot("internal-error")
    return targets  // 异常安全
```

**测试用例（新增到 modality-redirect.test.ts）：**

- [ ] **Test: AC-1 部分支持过滤** — targets = [A(无image), B(有image), C(有image)]，body 含 image → 返回 [B, C]，reason = `filtered-ineligible-targets`

- [ ] **Test: AC-2 全部不支持 + fallback** — targets = [A(无image), B(无image)]，有 multimodal_fallback = C(有image) → 返回 [C]，reason = `replaced-with-fallback`

- [ ] **Test: AC-3 全部不支持 + 无 fallback** — targets = [A(无image)]，无 multimodal_fallback → 返回 []，reason = `no-eligible-targets`

- [ ] **Test: AC-6 无多模态** — targets = [A, B]，body 无 image/audio → 返回 [A, B]，reason = `no-multimodal-detected`

- [ ] **Test: AC-7 全部支持** — targets = [A(有image), B(有image)]，body 含 image → 返回 [A, B]，reason = `all-targets-support-modalities`

- [ ] **Test: provider 不存在时不过滤** — target 引用不存在的 provider_id → 保留该 target（保持现有异常安全行为）

- [ ] **Test: audio 模态过滤** — targets = [A(无audio), B(有audio)]，body 含 audio → 返回 [B]

- [ ] **Test: fallback target 不支持缺失模态 → 空列表** — 全部不支持 + fallback 也不支持 → 返回 []，reason = `no-eligible-targets`

**需要修改的现有测试：** 现有 `AC1: prepends fallback target` 测试需要更新，因为行为从 prepend 改为 filter。具体地：
- 原 "AC1 prepends" → 改为验证 "filter + fallback replace" 行为
- 原 "returns original when first target supports image" → 保持不变（AC-7）
- 原 "returns original when no multimodal_fallback" → 改为验证返回空列表

**注意：** `detectModalities()`、`supportsModality()` 函数不变，现有 `detectModalities` 测试套件不需要修改。

- [ ] **Step 1: 写失败测试** — 在 `modality-redirect.test.ts` 中新增上述测试用例，更新与旧行为冲突的测试

- [ ] **Step 2: 运行测试确认失败** — `npx vitest run router/tests/modality-redirect.test.ts`

- [ ] **Step 3: 实现核心逻辑变更** — 修改 `computeModalityRedirectTargets()` 函数体

- [ ] **Step 4: 运行测试确认通过** — `npx vitest run router/tests/modality-redirect.test.ts`

- [ ] **Step 5: Commit** — `feat: modality-redirect filter targets by modality capability`

---

### Task 2: ErrorKind 扩展 + failover-loop 空列表处理 + 集成测试

**Type:** backend

**Files:**
- Modify: `router/src/proxy/proxy-core.ts` — ErrorKind 新增 `unsupportedModality`
- Modify: `router/src/proxy/format/types.ts` — ErrorKind 类型同步
- Modify: `router/src/proxy/format/adapters/shared-error-meta.ts` — OPENAI_FAMILY_ERROR_META 新增
- Modify: `router/src/proxy/format/adapters/anthropic.ts` — ANTHROPIC_ERROR_META 新增
- Modify: `router/src/proxy/handler/create-proxy-handler.ts` — fallback errorMeta 新增
- Modify: `router/src/proxy/handler/failover-loop.ts` — modality 返回空列表后提前报错
- Create: `router/tests/failover-modality-filter.test.ts` — 集成测试

**依赖的已有代码：**
- `createErrorFormatter` 工厂函数 — 注册新的 error kind
- `rejectAndReply` 函数 — 用于提前返回错误响应
- `FormatAdapter.errorMeta` — 按 API 类型配置 type/code

**ErrorKind 扩展（7 处机械修改）：**

1. `proxy-core.ts` `ProxyErrorFormatter` 接口：新增 `unsupportedModality(): ProxyErrorResponse` 方法声明
2. `proxy-core.ts` `ErrorKind` union：新增 `"unsupportedModality"`
3. `proxy-core.ts` `createErrorFormatter`：新增 `unsupportedModality: () => ({ statusCode: 400, body: formatBody("unsupportedModality", message) })`
4. `format/types.ts` ErrorKind type import：同步新增
5. `shared-error-meta.ts`：新增 `unsupportedModality: { type: "invalid_request_error", code: "unsupported_modality" }`
6. `anthropic.ts`：新增 `unsupportedModality: { type: "invalid_request_error", code: "unsupported_modality" }`
7. `create-proxy-handler.ts` fallback errorMeta（L146-153）：新增 `unsupportedModality: { type: "invalid_request_error", code: "unsupported_modality" }`

**failover-loop.ts 变更：**

在 `allTargets = computeModalityRedirectTargets(...)` 之后（约 line 220），新增空列表检查：

```typescript
// modality-redirect 层返回空列表 → 提前报错（无 target 支持请求模态）
if (allTargets.length === 0) {
  const logId = randomUUID();
  const startTime = Date.now();
  const isStream = (ctx.body as Record<string, unknown>).stream === true;
  const rCtx: RejectParams = {
    db, logId, apiType: ctx.apiType, model: clientModel,
    startTime, isStream, routerKeyId: request.routerKey?.id ?? null,
    originalBody: rawBody, clientHeaders: cliHdrs,
    isFailover: false, originalRequestId: null,
    sessionId: ctx.metadata.get("session_id") as string | undefined,
    pipelineSnapshot: precomputeSnapshot.toJSON(),
    matcher, logFileWriter,
  };
  return rejectAndReply(reply, rCtx, errors.unsupportedModality(),
    `No eligible target: request modalities not supported by any available model`);
}
```

**集成测试（failover-modality-filter.test.ts）：**

使用 `buildApp({ config, db })` + `app.inject()` 模拟真实 HTTP 请求：

- [ ] **Test: AC-4 OpenAI 格式错误** — 配置映射组（1 target 不支持 image，无 fallback），发送含图片的 OpenAI 格式请求 → 验证 HTTP 400 + body 包含 `unsupported_modality` code

- [ ] **Test: AC-5 Anthropic 格式错误** — 同上，但 apiType = anthropic → 验证 HTTP 400 + body 包含 `unsupported_modality` code

- [ ] **Test: 正常请求不被影响** — 配置映射组（target 支持 image），发送含图片请求 → 验证正常代理（200 或上游返回码）

- [ ] **Step 1: 写 ErrorKind 扩展** — 修改 5 个文件（proxy-core.ts、format/types.ts、shared-error-meta.ts、anthropic.ts）

- [ ] **Step 2: 写 failover-loop 空列表处理** — 在 modality 返回后新增空列表分支

- [ ] **Step 3: 写集成测试** — 创建 failover-modality-filter.test.ts

- [ ] **Step 4: 运行全部测试** — `npx vitest run router/tests/failover-modality-filter.test.ts`

- [ ] **Step 5: Commit** — `feat: add unsupportedModality error kind and failover early-return`

---

### Task 3: 回归验证

**Type:** backend

**Files:**
- 无新文件修改，只运行已有测试验证

**验证项：**

- [ ] **Step 1: 运行全部 modality 测试** — `npx vitest run router/tests/modality-redirect.test.ts` → 全部通过

- [ ] **Step 2: 运行全部 failover 测试** — `npx vitest run router/tests/failover*.test.ts` → 全部通过

- [ ] **Step 3: 运行 overflow 测试** — `npx vitest run router/tests/overflow*.test.ts` → AC-8 验证（overflow 对过滤后列表仍生效）

- [ ] **Step 4: 运行 promptTooLong 相关测试** — 确认 AC-9（promptTooLong 行为不变）

- [ ] **Step 5: 运行完整测试套件** — `npm test` → 0 failures

- [ ] **Step 6: 编译检查** — `npm run build` → 0 errors

- [ ] **Step 7: Lint 检查** — `npm run lint` → 0 errors, 0 warnings

---

## Execution Groups

#### BG1: Modality 约束过滤

**Description:** 包含核心逻辑重写、ErrorKind 扩展、failover 空列表处理、所有相关测试。

**Tasks:** Task 1, Task 2, Task 3

**Files (预估):** 9 个文件（1 create + 8 modify）

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| Agent | general-purpose → general-purpose → general-purpose |
| Model | 按 taskComplexity 自动选择（executor: high、tdd-coder: medium、reviewer: medium） |
| 注入上下文 | spec.md FR-1~FR-4 + AC 全部 + modality-redirect.ts 完整代码 + failover-loop.ts L185-L270 + proxy-core.ts ErrorKind 定义 + format adapter errorMeta 模式 |
| 读取文件 | modality-redirect.ts, failover-loop.ts, proxy-core.ts, format/types.ts, shared-error-meta.ts, anthropic.ts, tests/modality-redirect.test.ts |
| 修改/创建文件 | modality-redirect.ts, failover-loop.ts, proxy-core.ts, format/types.ts, shared-error-meta.ts, anthropic.ts, create-proxy-handler.ts, tests/modality-redirect.test.ts, tests/failover-modality-filter.test.ts |

**Execution Flow (BG1 内部):** 串行派遣。

  Task 1:
    1. general-purpose (read xyz-harness-test-driven-development + xyz-harness-backend-dev) → 写失败测试
    2. general-purpose (read xyz-harness-backend-dev) → 写实现代码
    3. general-purpose (read xyz-harness-expert-reviewer) → spec 合规检查

  Task 2 (depends on Task 1):
    1. general-purpose (read xyz-harness-test-driven-development + xyz-harness-backend-dev) → 写失败测试
    2. general-purpose (read xyz-harness-backend-dev) → 写实现代码
    3. general-purpose (read xyz-harness-expert-reviewer) → spec 合规检查

  Task 3 (depends on Task 2):
    1. general-purpose → 运行完整测试套件 + 编译 + lint

**Dependencies:** 无

## Dependency Graph & Wave Schedule

| Wave | Groups | 说明 |
|------|--------|------|
| Wave 1 | BG1 | 唯一的 Group，串行执行 3 个 Task |
