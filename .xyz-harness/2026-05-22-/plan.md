---
verdict: pass
---

# AI 生成重试规则补齐 Provider 维度 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use xyz-harness-subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 AI 生成重试规则的完整路径（后端返回 → 前端类型 → 预览弹窗 → 提交保存）中补齐 `provider_id` 传递，使用户能在 AI 预览弹窗中选择将规则绑定到特定 provider 或保持通用。

**Architecture:** 后端在 `/admin/api/retry-rules/ai-generate` 返回值中追加 `provider_id` 字段（取自请求日志）。前端 `AiRulePreviewDialog` 增加 provider 下拉选择器，默认选中"通用"，用户可改为指定 provider。提交时通过已有的 `createRetryRule()` API 传递 `provider_id`。

**Tech Stack:** TypeScript (Fastify backend + Vue 3 frontend), shadcn-vue Select 组件

---

## File Structure

| File | Type | Group | Description |
|------|------|-------|-------------|
| `router/src/admin/retry-rules.ts` | modify | BG1 | AI generate 返回值增加 provider_id |
| `frontend/src/api/client.ts` | modify | FG1 | AiRetryGenerateResult.rule 类型增加 provider_id |
| `frontend/src/components/request-detail/AiRulePreviewDialog.vue` | modify | FG1 | 增加 provider 下拉选择器 + 加载 providers + 提交传 provider_id |
| `frontend/src/components/request-detail/UnifiedRequestDialog.vue` | modify | FG1 | generatedRule 类型 + 赋值增加 provider_id |

## Task List

| # | Task | Type | Depends on | Group |
|---|------|------|-----------|-------|
| 1 | 后端 AI generate 返回值增加 provider_id | backend | — | BG1 |
| 2 | 前端类型 + AiRulePreviewDialog + UnifiedRequestDialog | frontend | 1 | FG1 |

## Spec Metrics Traceability

| Spec 指标 | 采纳状态 | 对应 Task |
|-----------|---------|----------|
| AC1: 后端返回 provider_id | adopted | Task 1 |
| AC2: 前端类型含 provider_id | adopted | Task 2 |
| AC3: 弹窗显示 provider 下拉 | adopted | Task 2 |
| AC4: 默认选中"通用" | adopted | Task 2 |
| AC5: 选 provider 后保存正确 | adopted | Task 2 |
| AC6: 保持"通用"保存为 null | adopted | Task 2 |
| AC7: RetryRules 页面正确展示 | adopted | Task 2（已有功能验证） |
| AC8: getProviders 失败降级 | adopted | Task 2 |

---

### Task 1: 后端 AI generate 返回值增加 provider_id

**Type:** backend

**Files:**
- Modify: `router/src/admin/retry-rules.ts:483-492`

**Context:** `log` 变量是 `getRequestLogById()` 返回的 `RequestLogListRow`，已包含 `provider_id: string | null` 和 `provider_name: string | null` 字段（通过 LEFT JOIN providers 获取）。当前返回的 `rule` 对象缺少 `provider_id`。

- [ ] **Step 1:** 在 `reply.send()` 的 `rule` 对象中追加 `provider_id: log.provider_id ?? null`

  位置：`router/src/admin/retry-rules.ts` 第 483-492 行，在 `max_delay_ms` 之后追加一行。

  ```typescript
  return reply.send({
    success: true,
    rule: {
      name: parsed.name,
      status_code: parsed.status_code,
      body_pattern: parsed.body_pattern,
      retry_strategy: parsed.retry_strategy,
      retry_delay_ms: parsed.retry_delay_ms,
      max_retries: parsed.max_retries,
      max_delay_ms: parsed.max_delay_ms,
      provider_id: log.provider_id ?? null,
    },
    summary: parsed.summary,
  });
  ```

- [ ] **Step 2:** 验证已有测试不受影响

  Run: `cd /Users/zhushanwen/Code/llm-simple-router-workspace/fix-retry-provider/router && npx vitest run tests/admin-retry-rules-provider.test.ts`
  Expected: PASS

- [ ] **Step 3:** Commit

  ```bash
  git add router/src/admin/retry-rules.ts
  git commit -m "feat: return provider_id in AI generate retry rule response"
  ```

---

### Task 2: 前端类型 + AiRulePreviewDialog + UnifiedRequestDialog

**Type:** frontend

**Depends on:** Task 1

**Files:**
- Modify: `frontend/src/api/client.ts:289-300` (AiRetryGenerateResult.rule)
- Modify: `frontend/src/components/request-detail/AiRulePreviewDialog.vue` (form + template + save)
- Modify: `frontend/src/components/request-detail/UnifiedRequestDialog.vue:200-247` (类型 + 赋值)

**Reference:** `frontend/src/views/RetryRules.vue` 中 provider 选择器模式（L141-155）：`Select` + `SelectItem value="__all__"` + `providers` ref + `loadProviders()` + `api.getProviders()`

#### 2a: 更新 AiRetryGenerateResult 类型

- [ ] **Step 1:** 在 `frontend/src/api/client.ts` 的 `AiRetryGenerateResult.rule` 中追加 `provider_id` 字段

  ```typescript
  export interface AiRetryGenerateResult {
    success: boolean;
    error?: string;
    rule?: {
      name: string;
      status_code: number;
      body_pattern: string;
      retry_strategy: "fixed" | "exponential";
      retry_delay_ms: number;
      max_retries: number;
      max_delay_ms: number;
      provider_id?: string | null;
    };
    summary?: string;
  }
  ```

#### 2b: 更新 UnifiedRequestDialog 中 generatedRule 类型和赋值

- [ ] **Step 2:** 在 `frontend/src/components/request-detail/UnifiedRequestDialog.vue` 中：

  a. `createDefaultRuleForm()` 返回值增加 `provider_id: null as string | null`
  b. `generatedRule` ref 类型增加 `provider_id?: string | null`
  c. `handleGenerateRule()` 中赋值增加 `provider_id: r.provider_id ?? null`

#### 2c: AiRulePreviewDialog 增加 provider 选择器

- [ ] **Step 3:** 更新 `RuleFormData` 接口，增加 `provider_id: string | null`

  注意：`RuleForm` extends `RuleFormData`，所以 `provider_id` 会自动继承到 `RuleForm`。

- [ ] **Step 4:** 更新 `createDefaultForm()` 返回值，增加 `provider_id: "__all__"`

  注意：必须用 `"__all__"` 而非 `null`，因为 `Select` 的 `v-model` 需要 match `<SelectItem value="__all__">` 才能正确显示选中状态。`null` 不会匹配任何选项，会 fallback 到 placeholder。

- [ ] **Step 5:** 在 template 中，name 字段的 `<div>` 之后、匹配条件区域的 `<div>` 之前，插入 provider 选择器

  复用 RetryRules.vue 的模式：
  - `Select v-model="form.provider_id"`
  - 第一个选项：`SelectItem value="__all__"`（通用）
  - 遍历 `providers` ref 显示所有 provider
  - 加载失败时 providers 为空数组，只显示"通用"选项

  ```html
  <div>
    <Label class="text-xs text-muted-foreground font-medium">
      {{ t("retryRules.provider") }}
    </Label>
    <Select v-model="form.provider_id">
      <SelectTrigger class="mt-1">
        <SelectValue :placeholder="t('retryRules.providerPlaceholder')" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">{{ t("retryRules.providerAll") }}</SelectItem>
        <SelectItem v-for="p in providers" :key="p.id" :value="p.id">
          {{ p.name }}
        </SelectItem>
      </SelectContent>
    </Select>
  </div>
  ```

- [ ] **Step 6:** 在 script 中增加 providers ref + loadProviders 函数

  ```typescript
  import { api } from "@/api/client";
  import type { Provider } from "@/types/mapping";

  const providers = ref<Provider[]>([]);

  async function loadProviders() {
    try {
      providers.value = await api.getProviders();
    } catch (e: unknown) {
      console.error("AiRulePreviewDialog.loadProviders:", e);
      toast.error(getApiMessage(e, t("logs.messages.loadProvidersFailed")));
    }
  }
  ```

  在 watch 中（弹窗打开时）调用 `loadProviders()`：

  ```typescript
  watch(
    [() => props.open, () => props.rule],
    ([open, rule]) => {
      if (open && rule) {
        form.value = { ...rule, provider_id: "__all__", is_active: true };
        loadProviders();
        saving.value = false;
      }
    },
    { immediate: true },
  );
  ```

  注意：`provider_id: "__all__"` 强制覆盖为通用（即使用户从 rule 继承了 provider_id），符合 FR4 "默认通用"。必须用 `"__all__"` 而非 `null`，因为 Select v-model 需要匹配 `<SelectItem value="__all__">`。

- [ ] **Step 7:** 更新 `handleSave()` 中 `api.createRetryRule()` 调用，传递 `provider_id`

  提交时将 `"__all__"` 映射为 `null`（与 RetryRules.vue 一致）：

  ```typescript
  await api.createRetryRule({
    // ...existing fields...
    provider_id: form.value.provider_id === "__all__" ? null : (form.value.provider_id || null),
  });
  ```

  映射逻辑：`"__all__"` → `null`（通用），其他字符串 → provider ID，空字符串/falsy → `null`。

- [ ] **Step 8:** 添加 i18n key（如缺少 `retryRules.provider`、`retryRules.providerPlaceholder`、`retryRules.providerAll`）

  已验证：`zh-CN/retryRules.json` 中已有这些 key。检查 `en/retryRules.json` 是否也有。

- [ ] **Step 9:** 验证前端类型检查通过

  Run: `cd /Users/zhushanwen/Code/llm-simple-router-workspace/fix-retry-provider/frontend && npx vue-tsc -b --noEmit`
  Expected: 0 errors

- [ ] **Step 10:** 验证后端测试仍通过

  Run: `cd /Users/zhushanwen/Code/llm-simple-router-workspace/fix-retry-provider/router && npx vitest run`
  Expected: all PASS

- [ ] **Step 11:** Commit

  ```bash
  git add frontend/src/api/client.ts frontend/src/components/request-detail/AiRulePreviewDialog.vue frontend/src/components/request-detail/UnifiedRequestDialog.vue
  git commit -m "feat: add provider selector to AI retry rule preview dialog"
  ```

---

## Execution Groups

#### BG1: 后端 provider_id 返回

**Description:** 后端 AI generate 接口返回值增加 provider_id 字段

**Tasks:** Task 1

**Files (预估):** 1 个文件（1 modify）

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| Agent | general-purpose |
| Model | taskComplexity: low |
| 注入上下文 | spec FR1 + AC1 + Task 1 描述 |
| 读取文件 | `router/src/admin/retry-rules.ts` |
| 修改文件 | `router/src/admin/retry-rules.ts` |

**Dependencies:** 无

#### FG1: 前端类型 + 弹窗 + 调用方

**Description:** 前端三处改动——类型定义、预览弹窗 provider 选择器、调用方传递 provider_id

**Tasks:** Task 2

**Files (预估):** 3 个文件（3 modify）

**Subagent 配置:**

| 配置项 | 值 |
|--------|---|
| Agent | general-purpose |
| Model | taskComplexity: medium |
| 注入上下文 | spec FR2-FR5 + AC2-AC8 + Task 2 描述 + RetryRules.vue provider 选择器模式 |
| 读取文件 | `frontend/src/api/client.ts`, `frontend/src/components/request-detail/AiRulePreviewDialog.vue`, `frontend/src/components/request-detail/UnifiedRequestDialog.vue`, `frontend/src/views/RetryRules.vue`（参考）, `frontend/src/i18n/locales/zh-CN/retryRules.json` |
| 修改文件 | 上述前 3 个文件 |

**Dependencies:** BG1（后端返回 provider_id 后前端才能正确测试端到端）

## Dependency Graph & Wave Schedule

```
BG1 (后端) ──→ FG1 (前端)

| Wave | Groups | 说明 |
|------|--------|------|
| Wave 1 | BG1 | 后端返回值改动，无依赖 |
| Wave 2 | FG1 | 前端改动，依赖 BG1 完成验证 |
```
