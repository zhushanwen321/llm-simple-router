---
verdict: pass
must_fix: 0
---

# Standards Review v1

**Reviewer:** standards-review-agent
**Date:** 2026-05-29
**Scope:** 代码变更是否符合项目编码规范

## 变更概览

涉及 3 个文件：

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `router/src/proxy/patch/deepseek/patch-orphan-tool-results.ts` | 修改 | `patchOrphanToolResultsOA()` 反向逻辑从"移除孤儿 tool_call"改为"补入合成 tool 消息"；移除不再需要的 Step 5（合并连续 assistant）和 Step 6（补充 reasoning_content） |
| `router/src/proxy/patch/index.ts` | 修改 | `needsDeepSeekPatch()` 移除 `opencode.ai` 检测分支 |
| `router/tests/patch.test.ts` | 修改 | 测试用例适配新行为 |

## ESLint 自定义规则合规（taste/* 规则）

| 规则 | 级别 | 检查结果 | 说明 |
|------|------|----------|------|
| `taste/no-explicit-any` | error | ✅ PASS | 两文件均无 `any` 类型。`Record<string, unknown>`、`unknown[]` 正确使用。 |
| `taste/no-silent-catch` | warn | ✅ N/A | 无 catch 块。 |
| `taste/prefer-allsettled` | warn | ✅ N/A | 无 Promise 使用。 |
| `taste/no-unsafe-object-entries` | warn | ✅ N/A | 无 `Object.entries()` 使用。 |
| `taste/no-unsafe-string-conversion` | warn | ✅ PASS | `JSON.stringify()` 用于 content 合并（其返回值始终为 string），非 `String()` 直接转换。 |
| `taste/no-raw-json-parse-models` | error | ✅ N/A | 无 DB JSON 字段裸解析。 |
| `taste/no-unbounded-while-true` | warn | ✅ N/A | 无 `while(true)`。 |
| `taste/no-inline-import-type` | warn | ✅ PASS | 行首统一 `import { type ... }`，无行内 `as import(...).Type`。 |
| `taste/no-eslint-disable` | githook | ✅ PASS | 无 eslint-disable 注释。 |
| `no-magic-numbers` (基础规则) | warn | ✅ PASS | `SCAN_LIMIT_EXTRA = 3`、`SCAN_SLOTS_PER_CALL = 2` 均为命名常量。 |

**结论：所有 ESLint 规则合规。**

## 代码品味原则审查

### 兜底响应

✅ 相关代码是消息修补函数（mutator），非 HTTP handler，无需发送 HTTP 响应。`patchOrphanToolResultsOA()` 在所有分支路径上都完成预期操作，无遗漏路径。

### 幂等注册

✅ N/A — 无 `register()` / `registerAdapter()` 模式。

### structuredClone 深拷贝

⚠️ **预存问题（非本次变更引入）**：`patch/index.ts` `ensureCloned()` 使用 `JSON.parse(JSON.stringify(body))` 替代 `structuredClone()`。代码品味原则要求使用 `structuredClone()`（Node 17+）。该行在本次 diff 中未被修改。建议在后续 PR 中统一清理。

### 完整错误提取

✅ N/A — 无错误解析代码。

### Hook 降级

✅ N/A — 无 PipelineHook 注册。

### 注释质量

✅ 移除的内联注释（如 `// 收集所有 assistant tool_calls IDs`、`// splice 后跳过已重排的区域`、`// Step 5: 合并连续的 assistant 消息`）均为"是什么"注释，代码本身已自解释。符合"注释解释为什么而非是什么"原则。

### 只动必须动的

✅ 变更集中于核心行为改变：
- 反向逻辑从 remove → insert synthetic tool message（核心变更）
- 移除空壳 assistant 清理（因不再产生空壳 assistant，逻辑耦合）
- 移除 Step 5 连续 assistant 合并（原与空壳清理耦合）
- 移除 Step 6 reasoning_content 补充（原与 orphan tool_calls 处理耦合）
- `opencode.ai` 检测移除（假阳性清理，与分支主题"fix-fallback-patch"一致）

所有变更可追溯到当前需求。无顺手重构或推测性功能。

## 类型安全规范（转换层规则参考）

**规则 1（使用结构化类型，禁止裸 `Record<string, unknown>`）：**
✅ Patch 层在 `Record<string, unknown>` 白名单中（`patch/*.ts` 处理上游结构不完全可控的数据），允许 `Record<string, unknown>`。未违反该规则。

**规则 4（Patch 层允许 `Record<string, unknown>`）：**
✅ 显式豁免。

**类型使用一致性：**
- `patch-orphan-tool-results.ts`：authropiic 版本使用 `Message`、`ContentBlock` 结构化类型；OpenAI 版本使用 `Record<string, unknown>`（属 patch 层豁免范围）。类型使用一致。
- `patch/index.ts`：导出接口使用 `ProviderInfo`、`ProviderPatchMeta` 结构化类型。

## 测试文件审查

✅ 测试期望值已完整适配新行为：
- "反向"方向各用例从验证"移除 tool_call + 清理空壳"改为验证"保留 tool_call + 插入合成 tool 消息"
- 测试断言精确验证 `syntheticTool.tool_call_id`、`syntheticTool.content`、roles 序列
- 测试覆盖了基础用例、边界用例（末尾 assistant 保持不动、部分配对、Claude Code 截断场景、空 messages 安全）和 Step 4 重排场景
- 测试用例命名同步更新（如 `移除非末尾 assistant 中无对应 tool 消息的 tool_call 条目` → `为非末尾 assistant 的孤儿 tool_call 补入合成 tool 消息`）

## 发现的问题

### MUST FIX（0）

无本变更引入的 MUST FIX 问题。

### 建议（SUGGEST）

1. **`structuredClone` 统一替换**（预存问题）：`patch/index.ts` `ensureCloned()` 使用 `JSON.parse(JSON.stringify(body))`，建议后续 PR 替换为 `structuredClone(body)`。

2. **`needsDeepSeekPatch` 逻辑变更确认**：移除 `opencode.ai` 检测分支意味着途经 opencode.ai 的请求将不再自动触发 DeepSeek 补丁。需确认这是否为有意行为（如 opencode.ai 已不再代理 DeepSeek 模型），以及是否已在 spec 或 issue 中记录此行为变动。

## 结论

**verdict: pass**

本次代码变更符合项目编码规范。ESLint 自定义规则全部合规，代码品味原则无新增违规，类型使用一致，测试适配完整。预存的 `structuredClone` 问题在本次变更范围内未恶化。
