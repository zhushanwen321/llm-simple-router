---
verdict: fail
must_fix: 2
---

# AI 重试规则生成 — 编码评审 v1

**审查范围:** eeac50c..HEAD（16 files, +1518 / -34）
**质量门禁:** build PASS | test PASS (122/122, 1466 tests) | 后端 lint PASS | 前端 lint FAIL (2 warnings) | vue-tsc PASS

---

## MUST FIX

### MF-1: `proxy-enhancement.ts` GET 端点 `JSON.parse(aiConfigRaw)` 无 try-catch

**文件:** `router/src/admin/proxy-enhancement.ts:43`

```typescript
const aiConfigRaw = getSetting(db, "ai_retry_config");
const aiRetryConfig = aiConfigRaw ? JSON.parse(aiConfigRaw) : null;
```

`ai_retry_config` 是用户通过 API 写入的值。如果数据库中存了损坏的 JSON（写入被截断、手动 DB 编辑等），这行会抛异常导致 500。

同文件上方第 39 行对 `proxy_enhancement` 的 JSON.parse 有 try-catch 保护，`ai_retry_config` 应采用同样模式：

```typescript
let aiRetryConfig = null;
if (aiConfigRaw) {
  try {
    aiRetryConfig = JSON.parse(aiConfigRaw);
  } catch { /* 损坏值回退为 null */ }
}
```

**严重性:** P1 — 阻断整个 proxy-enhancement GET 请求，影响代理增强页面加载。

### MF-2: 前端 lint 未通过（2 warnings）

**文件:** `frontend/src/views/ProxyEnhancement.vue`

```
225:191  warning  No magic number: 128000        (no-magic-numbers)
226:5    warning  taste/no-silent-catch           (catch 块只有 console)
```

Spec AC5 要求前端 lint 零警告。

- `128000` → 提取为命名常量 `const DEFAULT_CONTEXT_WINDOW = 128000`
- `loadProviders` 的 catch 只有 `console.error`，缺 `toast` 提示用户。或者加注释说明为何静默是合理的（页面还有其他配置，provider 加载失败不应阻断整体页面）。

---

## NICE TO HAVE

### NH-1: `extractResponseText` 未过滤 stream_text_content 中的非 TEXT 部分

**文件:** `router/src/admin/retry-rules.ts:70-72`

Spec FR3 第 4 步要求"仅 TEXT 部分"。当前实现直接使用 `stream_text_content` 原始值。

`stream_text_content` 存储的是 `serializeBlocksForStorage()` 的输出，其格式为 JSON 字符串（如 `{"choices":[{"message":{"content":"实际文本"}}]}` 或 Anthropic 的 `{"content":[{"type":"text","text":"..."},{"type":"thinking","thinking":"..."}]}`）。直接发给 AI 的是 JSON 包装而非纯文本。

实际影响不大（AI 能理解 JSON 结构），但与 spec 描述不一致。建议在 spec 中更新描述，或将 `extractResponseText` 改为解析 JSON 后只提取 text 内容。

### NH-2: `buildSystemPrompt` 使用英文而非中文 prompt

**文件:** `router/src/admin/retry-rules.ts:118-135`

Spec FR5 定义了详细的中文 system prompt，包含响应分析指南、错误标识优先级、body_pattern 构造规范等。实际实现使用简短的英文 prompt，丢失了 spec 中的：
- 错误标识优先级指导（error.code > error.message 固定短语）
- 正则构造规范（`\b` 词边界、避免 `.*`）
- 命名格式规范（`{Provider名} {状态码} {错误类型简述} 重试`）

这会影响 AI 生成规则的质量（正则过于宽泛、命名不统一等）。建议对齐 spec 中的完整中文 prompt，或将 spec 更新为实际使用的精简版。

### NH-3: `ProxyEnhancement.vue` 中 `loadProviders` 和 `loadConfig` 串行执行

**文件:** `frontend/src/views/ProxyEnhancement.vue:294-295`

```typescript
onMounted(() => {
  loadConfig()
  loadProviders()
})
```

两个独立的异步请求可以用 `Promise.allSettled` 并行（项目 taste 规则 `prefer-allsettled` 实际要求独立数据源并行）。当前写法不会报 lint（因为 eslint-disable 注释已在第 263 行），但两个函数各自 fire-and-forget，实际效果是并行的。不过明确用 `Promise.allSettled` 更符合项目规范。

### NH-4: 测试中使用 `as any` 类型断言

**文件:** `router/tests/ai-retry-rule.test.ts:60`

```typescript
const result = await buildApp({ config: makeConfig() as any, db });
```

测试文件不受 lint 约束，不影响质量门禁。但 `makeConfig()` 返回类型与 `AppOptions.config` 不完全匹配。长期来看可以让 `makeConfig()` 返回类型与 `Config` 兼容。

### NH-5: `AiRulePreviewDialog.vue` 魔法数字

**文件:** `frontend/src/components/request-detail/AiRulePreviewDialog.vue:91-94`

```typescript
const DELAY_MIN_MS = 100;
const MAX_RETRIES_LIMIT = 100;
```

`DELAY_MIN_MS = 100` 没有在任何 spec 中定义最小延迟要求。后端 `validateAIRule` 只要求 `retry_delay_ms > 0`。前端却要求 `>= 100`。这个差异可能导致：AI 生成了 `retry_delay_ms: 50` 的规则，后端通过，但前端编辑保存时被拒绝。

建议前后端使用一致的最小值，或在 spec 中明确前端校验可以更严格。

### NH-6: `ai_retry_config` 清除时存储空字符串

**文件:** `router/src/admin/proxy-enhancement.ts:61`

```typescript
setSetting(db, "ai_retry_config", ai_retry_config ? JSON.stringify(ai_retry_config) : "");
```

当用户清除配置时，存储的是空字符串 `""` 而非删除 key。`getSetting` 返回空字符串时，`ai-retry-rule` 端点第 236 行的 `if (!aiConfigRaw)` 会把空字符串视为 truthy（实际空字符串是 falsy，所以 `!aiConfigRaw` 为 `true`，正确返回未配置错误）。这段逻辑是对的，但如果未来有人用 `getSetting` 的返回值做 `JSON.parse` 而不检查空字符串，会出错。建议存 `null` 或在清除时用 `deleteSetting`。

---

## Spec 合规矩阵

| FR | 状态 | 说明 |
|----|------|------|
| FR1 | PASS | AI 配置在代理增强页面，使用 CascadingModelSelect，存 settings 表 |
| FR2 | PASS | `llm-client.ts` 实现完整，http/https 双协议，30s 超时（通过外部传入） |
| FR3 | PARTIAL | 端点实现完整，但 `extractResponseText` 未过滤 TEXT 部分（NH-1） |
| FR4 | PASS | 按钮位置、loading、配置提示 Dialog、预览 Dialog 均实现 |
| FR5 | PARTIAL | prompt 使用精简英文版，与 spec 的完整中文 prompt 有差距（NH-2） |
| FR6 | PASS | AiRulePreviewDialog 所有字段预填可编辑，保存后刷新缓存 |

| AC | 状态 |
|----|------|
| AC1 | PASS |
| AC2 | PASS |
| AC3 | PARTIAL（NH-1, NH-2） |
| AC4 | PASS |
| AC5 | FAIL（前端 lint 2 warnings, MF-2） |

---

## 文件统计

| 文件 | 行数 | 状态 |
|------|------|------|
| `router/src/admin/retry-rules.ts` | 345 | 修改，+230 行 |
| `router/src/utils/llm-client.ts` | 102 | 新建 |
| `router/tests/ai-retry-rule.test.ts` | 611 | 新建，7 个测试用例 |
| `router/tests/llm-client.test.ts` | 新建 | 8 个测试用例 |
| `frontend/src/components/request-detail/AiRulePreviewDialog.vue` | 239 | 新建 |
| `frontend/src/components/request-detail/UnifiedRequestDialog.vue` | 326 | 修改，+142 行 |
| `frontend/src/views/ProxyEnhancement.vue` | 297 | 修改 |
| `frontend/src/api/client.ts` | +23 行 | 新增类型和 API 方法 |

所有文件在 lint 限制内（后端 1000 行/文件、前端 800 行 template、600 行 script）。无 `any` 类型（测试文件除外）。无新增 `eslint-disable` 注释。

---

## 总结

实现完整度很高，测试覆盖充分（7 个集成测试 + 8 个单元测试），架构合规（settings 表、shadcn-vue、编辑-保存模式、API key 解密路径安全）。两个 MUST FIX 都是阻断性问题：JSON.parse 崩溃会导致页面无法加载，lint 告警不满足 AC5 门禁。NICE TO HAVE 项中，prompt 与 spec 的差距（NH-2）对 AI 生成质量有实际影响，建议优先处理。
