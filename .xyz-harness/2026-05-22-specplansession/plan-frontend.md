# Retry Rules 前端设计方案 (FG1)

> 对应 spec.md §FR6 + AC6/AC7，plan.md FG1 group。

## 1. 组件架构

```
RetryRules.vue
├── 表格 (Table)
│   ├── "Provider" 列 ← 新增
│   └── "响应体匹配" 列展示逻辑升级
├── Dialog 编辑面板
│   ├── Provider 绑定 Select ← 新增
│   ├── 响应体匹配 Tabs (正则 / JSON) ← 升级
│   │   ├── 正则 Tab: Input (body_pattern) ← 不变
│   │   └── JSON Tab: BodyMatcherEditor ← 新增组件
│   └── 其他字段 (不变)
└── RecommendedRules (不变)
```

**文件变更：**

| 文件 | 操作 | 说明 |
|------|------|------|
| `frontend/src/views/RetryRules.vue` | modify | 新增 Provider 表格列、Provider 绑定 Select、响应体匹配 Tabs |
| `frontend/src/components/retry-rules/BodyMatcherEditor.vue` | create | JSON 字段匹配编辑器组件 |
| `frontend/src/views/__tests__/retry-rules-ac.test.ts` | modify | 补充验证 AC6/AC7 |
| `frontend/src/i18n/locales/zh-CN/retryRules.json` | modify | 新增 JSON 匹配相关 i18n key |
| `frontend/src/i18n/locales/en/retryRules.json` | modify | 新增 JSON 匹配相关 i18n key |

## 2. Provider 列 (表格)

### 2.1 列位置

插入在 "响应体匹配" 之后、"重试策略" 之前。

```html
<TableHead>{{ t("retryRules.tableHeaders.bodyPattern") }}</TableHead>
<TableHead>{{ t("retryRules.tableHeaders.provider") }}</TableHead>  <!-- ← 新增 -->
<TableHead>{{ t("retryRules.tableHeaders.retryStrategy") }}</TableHead>
```

### 2.2 展示逻辑

| `r.provider_id` | 渲染 |
|-----------------|------|
| `null` / 缺失 | `<Badge variant="secondary">通用</Badge>` |
| 有值 | `<span>{{ getProviderName(r.provider_id) }}</span>` |

`getProviderName(id)` 从 `providers` 列表中查找匹配的 Provider 显示 `name`，未找到时 fallback 显示 `id` 本身。

### 2.3 依赖数据

`providers` 列表需要在页面 `onMounted` 时加载，与 `rules`、`recommendedRules` 并行：

```typescript
onMounted(() => {
  Promise.allSettled([loadData(), loadRecommended(), loadProviders()]);
});
```

## 3. Dialog 编辑面板 — Provider 绑定

### 3.1 位置

放在 "名称" 和 "状态码" 之间。

### 3.2 Select 组件

```html
<Select v-model="form.provider_id">
  <SelectTrigger><SelectValue :placeholder="..." /></SelectTrigger>
  <SelectContent>
    <SelectItem value="">通用（所有 Provider）</SelectItem>
    <SelectItem v-for="p in providers" :key="p.id" :value="p.id">
      {{ p.name }}
    </SelectItem>
  </SelectContent>
</Select>
```

### 3.3 Form 数据模型

```typescript
interface FormData {
  // ... 现有字段
  provider_id: string;   // "" 表示通用（通用规则存储为 null）
  matchMode: "regex" | "json";
  bodyMatchers: BodyMatcher[];
}
```

## 4. Dialog 编辑面板 — 响应体匹配 Tab 切换

### 4.1 结构

用 `Tabs` 组件替换原有的单 Input：

```html
<Tabs v-model="form.matchMode">
  <TabsList>
    <TabsTrigger value="regex">{{ t("regexMatch") }}</TabsTrigger>
    <TabsTrigger value="json">{{ t("jsonMatch") }}</TabsTrigger>
  </TabsList>
  <TabsContent value="regex">
    <!-- 原有的 body_pattern Input -->
  </TabsContent>
  <TabsContent value="json">
    <BodyMatcherEditor v-model="form.bodyMatchers" />
  </TabsContent>
</Tabs>
```

### 4.2 编辑状态初始化

打开 Dialog 时根据 `r.body_matchers` 判断初始 tab：

```typescript
function openEdit(r: RetryRule) {
  let matchMode: "regex" | "json" = "regex";
  let bodyMatchers: BodyMatcher[] = [];
  if (r.body_matchers) {
    matchMode = "json";
    try { bodyMatchers = JSON.parse(r.body_matchers); }
    catch { bodyMatchers = []; }
  }
  form.value = { ...r, matchMode, bodyMatchers };
}
```

## 5. BodyMatcherEditor.vue 组件设计

### 5.1 Props / Events

```typescript
// BodyMatcherEditor.vue
defineProps<{
  modelValue: BodyMatcher[];
}>();
const emit = defineEmits<{
  "update:modelValue": [value: BodyMatcher[]];
}>();
```

### 5.2 内部结构

每行 = 三个控件 + 删除按钮：

```
[ 字段路径 Input ] [ 操作符 Select ] [ 匹配值 Input ] [ × ]
                    ├─ equals
                    ├─ contains
                    └─ exists (→ 隐藏值 Input)
```

### 5.3 操作行为

| 操作 | 行为 |
|------|------|
| 行编辑 | 双向绑定 `modelValue`，emit `update:modelValue` |
| 添加行 | `push({ path: "", operator: "contains", value: "" })` |
| 删除行 | `splice(idx, 1)` |
| `operator` 切到 `exists` | 自动清除 `value`（前端仅隐藏，不清除也无害）|
| `operator` 切出 `exists` | 显示 `value` Input |

### 5.4 v-if 控制 exists 时隐藏 value

```html
<Input v-if="m.operator !== 'exists'" v-model="m.value" ... />
```

## 6. 表格"响应体匹配"列展示

### 6.1 展示逻辑

```typescript
function formatBodyMatch(r: RetryRule): string {
  // 优先展示 body_matchers
  if (r.body_matchers) {
    try {
      const matchers = JSON.parse(r.body_matchers);
      return matchers
        .map((m) => {
          if (m.operator === "exists") return `${m.path} 存在`;
          return `${m.path} ${operatorLabel(m.operator)} "${m.value}"`;
        })
        .join(", ");
    } catch {
      return r.body_matchers; // fallback: 显示原始 JSON
    }
  }
  // 无 body_matchers 时显示 body_pattern
  return r.body_pattern;
}
```

### 6.2 摘要示例

| body_matchers | 列展示 |
|---------------|--------|
| `[{"path":"error.type","operator":"contains","value":"rate_limit_error"}]` | `error.type 包含 "rate_limit_error"` |
| `[{"path":"error.code","operator":"exists"}]` | `error.code 存在` |
| `null` | `.*rate_limit.*` (body_pattern) |

## 7. save 时 body_matchers 序列化

### 7.1 构造 payload

```typescript
const body_matchers =
  form.value.matchMode === "json"
    ? JSON.stringify(
        form.value.bodyMatchers.filter(
          (m) => m.path.trim() && (m.operator === "exists" || m.value.trim()),
        ),
      )
    : null;
```

规则：
- `matchMode === "regex"` → `body_matchers = null`（不发送 JSON 匹配）
- `matchMode === "json"` → 过滤掉空行后 JSON.stringify
- 空数组（没有有效行）→ `JSON.stringify([])` → 空 JSON 数组（后端视作有 body_matchers，匹配时 body_matchers 不匹配任何条件 → false → fallback 到正则）

### 7.2 对比：编辑回填 vs 新建默认

```typescript
const DEFAULT_FORM = {
  body_pattern: "",
  provider_id: "",
  matchMode: "regex",
  bodyMatchers: [],
};
```

编辑时根据 `r.body_matchers` 决定初始 tab，新建时默认为 `regex` tab。

## 8. API 适配

### 8.1 TypeScript 类型 (client.ts)

```typescript
interface RetryRulePayload {
  name: string;
  status_code: number;
  body_pattern: string;
  provider_id?: string | null;     // ← 新增
  body_matchers?: string | null;   // ← 新增
  is_active?: number;
  retry_strategy?: "fixed" | "exponential";
  retry_delay_ms?: number;
  max_retries?: number;
  max_delay_ms?: number;
}
```

### 8.2 API 调用

现有 `api.createRetryRule(payload)` 和 `api.updateRetryRule(id, payload)` 在 `request<T>()` 泛型基础上工作，payload 中带新字段即可。后端 Admin API 从请求体读取 `provider_id` 和 `body_matchers`。

### 8.3 GET 响应中的新字段

`RetryRule` 接口已包含：

```typescript
interface RetryRule {
  // ... 现有字段
  provider_id: string | null;
  body_matchers: string | null;
}
```

`getRetryRules()` → `GET /admin/api/retry-rules` → 后端 `SELECT *` 自动返回新列 → `request<RetryRule[]>()` 解包。

## 9. i18n Key 设计

### 9.1 新增 key (zh-CN)

```json
{
  "tableHeaders": {
    "provider": "供应商"
  },
  "provider": "供应商",
  "providerAll": "通用（所有供应商）",
  "providerPlaceholder": "选择供应商",
  "globalBadge": "通用",
  "regexMatch": "正则匹配",
  "jsonMatch": "JSON 字段匹配",
  "fieldPath": "字段路径",
  "operator": "操作符",
  "matchValue": "匹配值",
  "addCondition": "添加条件",
  "removeCondition": "删除条件",
  "operatorEquals": "等于",
  "operatorContains": "包含",
  "operatorExists": "存在"
}

### 9.2 新增 key (en) —— 与 zh-CN 同步新增，缺少将导致英文界面无法显示

```json
{
  "tableHeaders": {
    "provider": "Provider"
  },
  "provider": "Provider",
  "providerAll": "All Providers",
  "providerPlaceholder": "Select provider",
  "globalBadge": "Global",
  "regexMatch": "Regex",
  "jsonMatch": "JSON Field Match",
  "fieldPath": "Field Path",
  "operator": "Operator",
  "matchValue": "Match Value",
  "addCondition": "Add Condition",
  "removeCondition": "Remove Condition",
  "operatorEquals": "Equals",
  "operatorContains": "Contains",
  "operatorExists": "Exists"
}
```

### 9.2 对应 en 翻译

```json
{
  "tableHeaders": {
    "provider": "Provider"
  },
  "provider": "Provider",
  "providerAll": "All Providers",
  "providerPlaceholder": "Select Provider",
  "globalBadge": "All",
  "regexMatch": "Regex",
  "jsonMatch": "JSON Field",
  "fieldPath": "Field Path",
  "operator": "Operator",
  "matchValue": "Value",
  "addCondition": "Add Condition",
  "removeCondition": "Remove Condition",
  "operatorEquals": "Equals",
  "operatorContains": "Contains",
  "operatorExists": "Exists"
}
```

## 10. 测试方案

### 10.1 测试文件

`frontend/src/views/__tests__/retry-rules-ac.test.ts`

### 10.2 测试范围

| AC | 测试内容 | 测试类型 |
|----|---------|----------|
| AC6 | Provider 列展示：通用规则显示 Badge、"通用" | 纯函数（已实现） |
| AC6 | Provider 列展示：绑定规则显示 provider 名称 | 纯函数（已实现） |
| AC6 | Provider 列展示：未知 provider id fallback | 纯函数（已实现） |
| AC7 | body_matchers JSON.stringify → JSON.parse 往返 | 纯函数（已实现） |
| AC7 | exists 操作符无 value | 纯函数（已实现） |
| AC7 | isRegexMode 判断逻辑 | 纯函数（已实现） |

### 10.3 纯函数提取

从 `RetryRules.vue` 中提取可测试的纯函数（不与组件状态耦合）：

```typescript
// 已提取
getProviderName(id, providers) → string
shouldShowGlobalBadge(providerId) → boolean
isRegexMode(bodyMatchers) → boolean

// 可选扩展
formatBodyMatch(rule, operatorLabels) → string
shouldHideValueInput(operator) → boolean
```

### 10.4 测试运行

```bash
cd frontend && npx vitest run src/views/__tests__/retry-rules-ac.test.ts
```

## 11. 实现顺序（subagent 任务分解）

### Task 6.1: i18n 新增 key

- 修改 `zh-CN/retryRules.json` 和 `en/retryRules.json`
- 新增所有 section 9 中的 key
- **提醒：** en.json 缺少 `tableHeaders.provider`、`provider`、`providerAll`、`providerPlaceholder`、`globalBadge`、`regexMatch`、`jsonMatch`、`fieldPath`、`operator`、`matchValue`、`addCondition`、`removeCondition`、`operatorEquals`、`operatorContains`、`operatorExists` key

### Task 6.2: 表格新增 Provider 列

- 在 `RetryRules.vue` `<TableHeader>` 中 `bodyPattern` 列后插入 Provider `<TableHead>`
- 在 `<TableCell>` 行循环中对应位置添加 Provider cell:
  - `!r.provider_id` → `<Badge variant="secondary">通用</Badge>`
  - 有值 → `<span>{{ getProviderName(r.provider_id) }}</span>`
- 添加 `getProviderName()` 函数
- 空表格行 `colspan` 从 6 → 7
- `onMounted` 中添加 `loadProviders()` 并行加载

### Task 6.3: Dialog 新增 Provider 绑定 Select

- 在 Dialog form 中 "名称" 后插入 Provider 绑定 Select
- Select 选项："通用"（value=""）+ 各 provider（value=p.id）

### Task 6.4: Dialog 响应体匹配 Tab 切换 + BodyMatcherEditor

- 创建 `BodyMatcherEditor.vue` 组件
- 在 RetryRules.vue 中替换 body_pattern Input 为 Tabs（正则 / JSON）
- 正则 Tab：保持原有 Input
- JSON Tab：使用 BodyMatcherEditor
- `openEdit` / `openCreate` 中初始化 `matchMode` 和 `bodyMatchers`
- `handleSave` 中根据 `matchMode` 序列化 `body_matchers`
- `formatBodyMatch` 函数适配 body_matchers 展示

### Task 6.5: 补写测试

- 在 `retry-rules-ac.test.ts` 中补充 formatBodyMatch 测试
- 验证 body_matchers 摘要格式、body_pattern fallback、异常 JSON 处理

## 12. 边界情况与防御

| 场景 | 处理 |
|------|------|
| body_matchers JSON 非法 | `formatBodyMatch` 中 `try-catch`，fallback 显示原始字符串 |
| 编辑规则 → 正则 → JSON 切换 | 不自动迁移数据，用户切换 tab 时保留另一 tab 已输入内容 |
| provider 被删除后引用 | `getProviderName` fallback 显示 id |
| `bodyMatchers` 空数组 | `JSON.stringify([])` → `"[]"` → 后端 body_matchers 非 null → 逐条匹配（无匹配）→ false → fallback 到正则 |
| body_matchers + body_pattern 同时有值 | 保存时根据 `matchMode` 决定哪个写入 body_matchers，哪个写入 body_pattern。后端匹配优先级：body_matchers → body_pattern |
