---
verdict: "fail"
must_fix: 3
review_metrics:
  files_reviewed: 8
  issues_found: 11
  must_fix_count: 3
  low_count: 5
  info_count: 3
---

# TypeScript Taste Review v1 — Provider Multi-API-Type

审查范围：8 个变更文件，共 2887 行。
审查依据：`essence.md` 四条根本原则 + `ts/taste.md` 原则/偏好/反模式。

---

## 汇总

| 优先级 | 数量 | 说明 |
|--------|------|------|
| P0 MUST FIX | 3 | 跨文件重复类型定义、文件超限、eslint-disable 违规 |
| P1 LOW | 5 | 魔法数字、Record<string,unknown> 残留、重复 API key preview 逻辑 |
| P2 INFO | 3 | 已有代码的品味改进建议（非本次变更引入） |

---

## MUST FIX（3 项）

### M1. `ApiType` 跨文件重复定义 3 次 — 违反"消除一切重复"

| 文件 | 行号 | 定义 |
|------|------|------|
| `router/src/proxy/routing/resolve-endpoint.ts` | L6 | `export type ApiType = "openai" \| "openai-responses" \| "anthropic"` |
| `router/src/proxy/transform/types.ts` | L11 | `export type ApiType = "openai" \| "openai-responses" \| "anthropic"` |
| `router/src/proxy/hooks/plugin-bridge.ts` | L10 | `type ApiType = "openai" \| "openai-responses" \| "anthropic"` |

此外 `core/types.ts` 中 `ProviderEndpoint.api_type` 和 `ResolvedEndpoint.api_type` 也内联了相同的 union literal，未引用统一的 `ApiType`。

**taste.md 原文**："同一个数据结构（如 `AnthropicRequest`）在多个文件中以匿名类型或局部 interface 重复定义，维护时只改一处漏改另一处。必须提取到共享的 `types.ts` 中，禁止各文件重复定义同名接口。"

**建议**：在 `core/types.ts` 中定义 `export type ApiType = "openai" | "openai-responses" | "anthropic"`，所有消费方统一 import。`ProviderEndpoint.api_type`、`ResolvedEndpoint.api_type` 改用此类型。

---

### M2. `failover-loop.ts` 659 行 — 违反"结构先于一切"

`router/src/proxy/handler/failover-loop.ts` 当前 659 行，超过 500 行硬限。

虽然函数内部已经提取了 `applyPluginAdjustments()`、`rejectAndReply()`、`buildRejectCtx()`、`resolveUpstreamPath()` 等辅助函数，但 `executeFailoverLoop()` 本身仍超过 400 行，承载了路由决策 + 格式转换 + 日志构建 + 响应发送等多重职责。

**建议**：
- 将 while(true) 循环内的"单次迭代逻辑"（L280-L630）提取为 `executeSingleIteration()` 函数
- 将"预计算阶段"（L185-L270）提取为 `precomputeFailoverContext()` 函数
- 目标：主函数 ≤ 100 行，编排循环逻辑一目了然

---

### M3. `admin/providers.ts` 使用 `eslint-disable` 跳过 taste 规则 — 违反项目 githook 规范

| 文件 | 行号 | 内容 |
|------|------|------|
| `admin/providers.ts` | L44 | `// eslint-disable-next-line taste/no-deprecated-rule-format` |
| `admin/providers.ts` | L46 | `// eslint-disable-next-line taste/no-deprecated-rule-format` |

项目 CLAUDE.md 明确禁止 eslint-disable 注释，要求正面解决 lint 问题。`taste/no-deprecated-rule-format` 规则警告访问 `rule.default` / `rule.windows` 等废弃字段，应通过重构归一化逻辑来消除废弃字段访问，而非 suppress 警告。

**建议**：将归一化逻辑（`rule.default → rule.targets`）提升到 DB 读取层（`getAllMappingGroups` 或专门的 migration），确保 `cascadeProviderDisable` 收到的数据已经是新格式，删除归一化分支和 eslint-disable。

---

## LOW（5 项）

### L1. `applyPluginAdjustments` 参数 `clientApiType: string` 应为 `ApiType`

`failover-loop.ts` L95-L96：

```typescript
function applyPluginAdjustments(
  pluginRegistry: ...,
  body: Record<string, unknown>,
  clientApiType: string,  // ← 应为 ApiType
```

函数内部 L103 立即 `as ApiType` 断言，说明类型已知。参数声明为 `string` 丧失了编译期检查。

**建议**：参数改为 `clientApiType: ApiType`，删除内部 `as ApiType` 断言。

---

### L2. `admin/providers.ts` 629 行 — 接近 500 行硬限

`admin/providers.ts` 虽然未超 500 行硬限（629 行刚好超过），但已包含 7 个路由 handler + 2 个 schema + 多个辅助函数。随着 endpoints 功能扩展，增长趋势明显。

**建议**：考虑将 `validateAndEncryptEndpoints()` 和 `extractModelOverrides()` 提取到独立的 `admin/provider-utils.ts`，将 `handleCreateProvider` 提取到独立文件。目标 `providers.ts` ≤ 400 行。

---

### L3. API key preview 逻辑重复 — 违反 DRY

`admin/providers.ts` 中 API key preview 生成逻辑出现了 3 处几乎相同的代码：

| 位置 | 代码 |
|------|------|
| `handleCreateProvider` L267 | `legacyApiKeyPlain.length > API_KEY_PREVIEW_MIN_LENGTH ? \`${legacyApiKeyPlain.slice(0, API_KEY_PREVIEW_PREFIX_LEN)}...${legacyApiKeyPlain.slice(-API_KEY_PREVIEW_PREFIX_LEN)}\` : "****"` |
| PUT handler L311 | 同上 |
| PUT handler endpoints 处理 L347 | 同上 |

**建议**：提取为 `buildApiKeyPreview(key: string): string` 工具函数，消除 3 处重复。

---

### L4. `failover-loop.ts` 中 `ctx.metadata.get("session_id") as string | undefined` 重复 11 次

`ctx.metadata.get("session_id") as string | undefined` 在 `executeFailoverLoop` 中出现约 11 次。每次都重复相同的 key 和类型断言。

**建议**：在循环开始处提取 `const sessionId = ctx.metadata.get("session_id") as string | undefined`，后续直接使用 `sessionId`。同理 `client_type` 也可提取。

---

### L5. `resolve-endpoint.ts` endpoints 长度为 0 时的 fallback 逻辑生成不必要的 `endpoints` 序列化数据

`admin/providers.ts` create handler 中，当用户未提供 endpoints 时，仍然 `serializeEndpoints([primary endpoint])` 生成一个元素的数组写入 DB。这导致旧数据和新数据行为不一致——旧 provider 的 `endpoints` 字段为 `null`，新创建的即使是单 endpoint 也有 JSON 数组。

**建议**：保持一致——用户未提供 endpoints 时写入 `null`，让 `resolveEndpoint` 的 fallback 路径统一处理。只在用户显式配置多 endpoint 时写入 JSON 数组。

---

## INFO（3 项）

### I1. `parseEndpoints` 验证不够严格

`db/providers.ts` `parseEndpoints()` 只验证了"每个元素是非 null 对象"，未验证 `api_type` 和 `base_url` 的具体值。DB 中的数据可能因为 bug 或手动编辑包含无效 `api_type`（如 `"openra"`）。

当前验证在 Admin API 层通过 TypeBox schema 完成（`EndpointSchema`），这是合理的边界验证策略。但 `parseEndpoints` 作为"从 DB 读取"的路径，缺少运行时校验意味着 DB 中的脏数据会静默传播。

**建议**：长期可考虑在 `parseEndpoints` 中加入 `api_type` 白名单校验。当前优先级不高，因为写入路径已有 TypeBox 校验。

---

### I2. `EndpointEditor.vue` 中 `API_TYPE_SHORT` 映射可以国际化

`EndpointEditor.vue` L17-L21 硬编码了 `API_TYPE_SHORT` 映射，而 Providers.vue 中使用了 `API_TYPE_LABELS`（来自 composable）。两处维护 API 类型的显示名称。

**建议**：统一到 i18n 或 composable 中集中管理。

---

### I3. `useProviderForm.ts` 中 `isOfficialOpenai` 函数已定义但未在本次变更中使用

`useProviderForm.ts` L188 定义了 `isOfficialOpenai()`，exports 但在当前变更的文件中未见使用。非本次变更引入的问题，但标记为 info。

---

## 审查结论

**Verdict: FAIL** — 3 项 MUST FIX 需修复。

核心问题集中在：
1. **跨文件类型重复**（M1）— 新增 `ApiType` 时在 3 个文件中各定义一份，直接违反 taste.md 最强规则
2. **文件超限**（M2）— `failover-loop.ts` 已超过 500 行硬限，需拆分
3. **eslint-disable 违规**（M3）— 项目规范明确禁止，需正面解决

LOW 项建议在 MUST FIX 修复后跟进处理，不阻塞合并。
