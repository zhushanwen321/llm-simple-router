---
verdict: pass
---

# Frontend Design — Provider Multi-API-Type

## §1 类型变更

### 1.1 ProviderEndpoint 前端类型

**文件：`frontend/src/types/mapping.ts`**

新增 `ProviderEndpoint` 接口，同步后端 `ProviderEndpoint` 结构：

```typescript
export interface ProviderEndpoint {
  api_type: "openai" | "openai-responses" | "anthropic";
  base_url: string;
  upstream_path: string | null;
  api_key: string | null;  // null = fallback 到共享 key
}
```

**`Provider` 接口扩展**（同文件）：

```typescript
// 新增字段
export interface Provider {
  // ...现有字段保留
  endpoints: ProviderEndpoint[];  // 新增，GET 响应必然包含
}
```

旧字段 `api_type`/`base_url`/`upstream_path`/`api_key` 保留在接口中（后端 deprecated 但仍返回），前端迁移后优先读 `endpoints`。

### 1.2 Provider FormState 变更

**文件：`frontend/src/composables/useProviderForm.ts`**

**FormState 接口变更**：

```typescript
interface EndpointFormState {
  api_type: "openai" | "openai-responses" | "anthropic";
  base_url: string;
  upstream_path: string;
  api_key: string;  // 空字符串 = fallback 到共享 key
}

interface FormState {
  name: string;
  shared_api_key: string;       // 原 api_key 改名，语义更明确
  endpoints: EndpointFormState[];  // 替代原 api_type/base_url/upstream_path/api_key
  // 以下保持不变
  models: ModelInfo[];
  is_active: boolean;
  max_concurrency: number;
  queue_timeout_ms: number;
  max_queue_size: number;
  adaptive_enabled: boolean;
  proxy_type: string;
  proxy_url: string;
  proxy_username: string;
  proxy_password: string;
}
```

**DEFAULT_FORM 变更**：

```typescript
const DEFAULT_FORM: FormState = {
  name: "",
  shared_api_key: "",
  endpoints: [
    {
      api_type: "openai",
      base_url: "",
      upstream_path: "",
      api_key: "",
    },
  ],
  // 其余不变...
};
```

### 1.3 API client 变更

**文件：`frontend/src/api/client.ts`**

**`ProviderPayload` 变更**：

```typescript
export interface EndpointPayload {
  api_type: "openai" | "openai-responses" | "anthropic";
  base_url: string;
  upstream_path?: string | null;
  api_key?: string | null;
}

export interface ProviderPayload {
  name: string;
  // 旧字段保留（向后兼容，有 endpoints 时忽略）
  api_type?: string;
  base_url?: string;
  upstream_path?: string;
  api_key?: string;
  // 新增
  endpoints?: EndpointPayload[];  // 新格式优先
  // 其余不变
  models?: Array<...>;
  is_active: number;
  max_concurrency?: number;
  // ...
}
```

**`QuickSetupPayload.provider` 变更**：

```typescript
export interface QuickSetupPayload {
  provider: {
    name: string;
    // 旧字段保留
    api_type: string;
    base_url: string;
    upstream_path?: string;
    api_key: string;
    // 新增
    endpoints?: EndpointPayload[];  // QuickSetup 也使用 endpoints 格式
    // 其余不变
    models: Array<...>;
    concurrency_mode?: ...;
    // ...
  };
  // ...
}
```

---

## §2 Provider 列表页

### 2.1 表格列重构（三列分离）

**文件：`frontend/src/views/Providers.vue`**

**当前状态**：Name 列包含 icon + name + api_type badge + full URL + proxy 标记，API Key 列单行展示。

**变更方案**：

将原来的 Name 单列拆分为 4 列：Name / API Type / Base URL / API Key。

**表头定义**：

```html
<TableHeader>
  <TableRow class="bg-muted">
    <TableHead class="text-muted-foreground">{{ t("providers.tableHeaders.name") }}</TableHead>
    <TableHead class="text-muted-foreground">{{ t("providers.tableHeaders.apiType") }}</TableHead>
    <TableHead class="text-muted-foreground">{{ t("providers.tableHeaders.baseUrl") }}</TableHead>
    <TableHead class="text-muted-foreground">{{ t("providers.tableHeaders.apiKey") }}</TableHead>
    <TableHead class="text-muted-foreground">{{ t("providers.tableHeaders.models") }}</TableHead>
    <TableHead class="text-muted-foreground">{{ t("providers.tableHeaders.concurrency") }}</TableHead>
    <TableHead class="text-muted-foreground">{{ t("providers.tableHeaders.status") }}</TableHead>
    <TableHead class="text-muted-foreground">{{ t("providers.tableHeaders.actions") }}</TableHead>
  </TableRow>
</TableHeader>
```

**Name 列**（简化，只保留 icon + name + proxy 标记）：

```html
<TableCell>
  <div class="flex items-center gap-2 font-medium">
    <ProviderIcon :name="providerIconName(p.name)" :size="18" />
    <span>{{ p.name }}</span>
    <Shield v-if="p.proxy_type" class="w-3 h-3 text-muted-foreground"
      :title="`Proxy: ${p.proxy_type.toUpperCase()}`" />
  </div>
</TableCell>
```

**API Type 列**（多 Badge 虚线分隔）：

```html
<TableCell>
  <div class="ep-rows">
    <div v-for="ep in p.endpoints" :key="ep.api_type"
      class="ep-row">
      <Badge :variant="apiTypeBadgeVariant(ep.api_type)" class="text-[11px] px-1.5 py-0">
        {{ API_TYPE_SHORT_LABELS[ep.api_type] ?? ep.api_type }}
      </Badge>
    </div>
  </div>
</TableCell>
```

**Base URL 列**（多行 URL）：

```html
<TableCell>
  <div class="ep-rows">
    <div v-for="ep in p.endpoints" :key="ep.api_type"
      class="ep-row">
      <span class="font-mono text-xs text-muted-foreground truncate max-w-[260px]">
        {{ buildEndpointFullUrl(ep) }}
      </span>
    </div>
  </div>
</TableCell>
```

**API Key 列**（见 §2.2）。

**CSS 新增**（`<style scoped>` 内 `@apply`）：

```css
.ep-rows { @apply flex flex-col; }
.ep-rows > .ep-row + .ep-row { @apply border-t border-dashed border-border pt-1 mt-1; }
```

**新增辅助常量**（`<script setup>` 内）：

```typescript
const API_TYPE_SHORT_LABELS: Record<string, string> = {
  openai: "OpenAI",
  "openai-responses": "Responses",
  anthropic: "Anthropic",
};

function apiTypeBadgeVariant(apiType: string): "secondary" | "outline" {
  if (apiType === "openai") return "secondary";
  if (apiType === "anthropic") return "outline";
  return "outline";  // openai-responses 用 primary-tinted outline
}
```

**`buildFullUrl` 函数变更**：从接收 `provider` 改为接收单个 `endpoint`：

```typescript
function buildEndpointFullUrl(ep: ProviderEndpoint): string {
  const upstreamPath = ep.upstream_path ||
    DEFAULT_UPSTREAM_PATH[ep.api_type] || "/v1/chat/completions";
  try {
    const url = new URL(ep.base_url);
    const pathname = url.pathname.replace(/\/+$/, "");
    const normalized = upstreamPath.replace(/\/+$/, "");
    if (pathname.endsWith(normalized)) return `${url.origin}${pathname}`;
    return `${url.origin}${pathname}${normalized}`;
  } catch {
    return `${ep.base_url.replace(/\/+$/, "")}${upstreamPath}`;
  }
}
```

### 2.2 API Key 列多行展示 + 复制按钮

**文件：`frontend/src/views/Providers.vue`**

```html
<TableCell>
  <div class="ep-rows">
    <div v-for="ep in p.endpoints" :key="ep.api_type"
      class="ep-row h-5 flex items-center gap-1">
      <span v-if="ep.api_key" class="font-mono text-xs text-muted-foreground">
        {{ maskKey(ep.api_key) }}
      </span>
      <span v-else class="text-xs text-success">
        {{ t("providers.sharedKey") }}
      </span>
      <Button variant="ghost" size="sm" class="h-5 w-5 p-0"
        @click="copyKey(ep.api_key || p.api_key, `${p.id}-${ep.api_type}`)">
        <component :is="copiedId === `${p.id}-${ep.api_type}` ? Check : Copy"
          class="w-3 h-3" :class="{ 'text-success': copiedId === `${p.id}-${ep.api_type}` }" />
      </Button>
    </div>
  </div>
</TableCell>
```

**关键逻辑**：
- `ep.api_key` 非空 → 显示 masked key，复制该 key
- `ep.api_key` 为空/空字符串 → 显示 "shared" 标签（绿色），复制 provider 级 api_key
- `copiedId` 使用 `providerId-apiType` 复合 key 区分多行

---

## §3 Provider 编辑表单

### 3.1 EndpointEditor 新组件设计

**新建文件：`frontend/src/components/providers/EndpointEditor.vue`**

这是核心新组件，封装单个 endpoint 的紧凑两行编辑。

**Props / Emits**：

```typescript
const props = defineProps<{
  endpoint: {
    api_type: string;
    base_url: string;
    upstream_path: string;
    api_key: string;
  };
  /** 已配置的 api_type 集合（用于禁用添加按钮） */
  usedApiTypes: Set<string>;
  /** 是否为预设模板自动填充（readonly base_url + path） */
  readonly?: boolean;
  /** 是否可删除（至少保留 1 个 endpoint） */
  canRemove?: boolean;
  /** 校验错误 */
  errorsBaseUrl?: string;
}>();

const emit = defineEmits<{
  "update:endpoint": [value: typeof props.endpoint];
  remove: [];
}>();
```

**模板结构**（紧凑两行）：

```html
<div class="ep-card border rounded-md p-2.5 space-y-1.5">
  <!-- Row 1: api_type badge + api_key input + remove -->
  <div class="flex items-center gap-2">
    <Badge :variant="apiTypeBadgeVariant(endpoint.api_type)"
      class="min-w-[68px] justify-center text-[11px]">
      {{ API_TYPE_SHORT_LABELS[endpoint.api_type] }}
    </Badge>
    <Input
      :model-value="endpoint.api_key"
      type="password"
      :placeholder="t('providers.endpoints.apiKeyPlaceholder')"
      class="flex-1 max-w-[170px] h-6 text-xs"
      @update:model-value="emit('update:endpoint', { ...endpoint, api_key: String($event) })"
    />
    <Button v-if="canRemove" variant="ghost" size="sm"
      class="text-destructive text-xs h-6 px-1.5"
      @click="emit('remove')">
      {{ t("providers.endpoints.remove") }}
    </Button>
  </div>
  <!-- Row 2: base_url + upstream_path -->
  <div class="flex items-center gap-2">
    <div class="flex-1">
      <Label class="text-[10px] text-muted-foreground">{{ t("providers.fields.baseUrl") }}</Label>
      <Input
        :model-value="endpoint.base_url"
        :readonly="readonly"
        type="url"
        required
        class="h-6 text-xs"
        :class="{ 'bg-muted text-muted-foreground': readonly }"
        @update:model-value="emit('update:endpoint', { ...endpoint, base_url: String($event) })"
        @input="emit('clear-errors', 'base_url')"
      />
      <p v-if="errorsBaseUrl" class="text-xs text-destructive mt-0.5">{{ errorsBaseUrl }}</p>
    </div>
    <div class="w-40">
      <Label class="text-[10px] text-muted-foreground">{{ t("providers.fields.upstreamPath") }}</Label>
      <Input
        :model-value="endpoint.upstream_path"
        :readonly="readonly"
        :placeholder="getDefaultPath(endpoint.api_type)"
        class="h-6 text-xs"
        :class="{ 'bg-muted text-muted-foreground': readonly }"
        @update:model-value="emit('update:endpoint', { ...endpoint, upstream_path: String($event) })"
      />
    </div>
  </div>
</div>
```

**辅助函数**：

```typescript
function getDefaultPath(apiType: string): string {
  return DEFAULT_UPSTREAM_PATH[apiType] ?? "/v1/chat/completions";
}
```

### 3.2 ModelCapabilitiesEditor 改造

**文件：`frontend/src/components/providers/ModelCapabilitiesEditor.vue`**

**重大变更**：移除原有的 `api-type`/`base-url`/`api-key`/`upstream-path` 单字段编辑区域，替换为：
1. Provider Name + Shared API Key 一行
2. EndpointEditor 列表
3. "Add Endpoint" 按钮

**Props 变更**（删除旧 props，新增）：

```typescript
// 删除的 props:
// apiType, baseUrl, apiKey, upstreamPath, errorsBaseUrl, errorsApiKey, hasApiKey

// 新增 props:
defineProps<{
  // ...保留 name, editingId, models, concurrency, transform 等
  sharedApiKey: string;                    // 新增
  endpoints: EndpointFormState[];          // 新增
  usedApiTypes: Set<string>;               // 新增
  presetGroup: string;                     // 保留
  errorsBaseUrl: string;                   // 保留（用于第一个 endpoint）
  // ...
}>();

// 删除的 emits:
// "update:api-type", "update:base-url", "update:api-key", "update:upstream-path"

// 新增 emits:
defineEmits<{
  // ...保留的 emits
  "update:shared-api-key": [value: string];
  "update:endpoints": [value: EndpointFormState[]];
  "add-endpoint": [apiType: string];
  "remove-endpoint": [index: number];
  // ...
}>();
```

**模板结构变更**（替换原来的 `grid grid-cols-2` 区域）：

```html
<!-- Row 1: Provider Name + Shared API Key -->
<div class="flex items-end gap-2">
  <div class="w-40">
    <Label class="text-xs text-muted-foreground">{{ t("providers.fields.name") }}</Label>
    <Input :model-value="name" required class="mt-1"
      @update:model-value="emit('update:name', String($event))"
      @input="emit('clear-errors', 'name')" />
    <p v-if="errorsName" class="text-xs text-destructive mt-0.5">{{ errorsName }}</p>
  </div>
  <div class="w-48">
    <Label class="text-xs text-muted-foreground">
      {{ t("providers.endpoints.sharedKey") }}
      <span class="text-[10px] opacity-60">{{ t("providers.endpoints.sharedKeyHint") }}</span>
    </Label>
    <Input :model-value="sharedApiKey" type="password"
      :placeholder="t('providers.endpoints.sharedKeyPlaceholder')"
      class="mt-1"
      @update:model-value="emit('update:shared-api-key', String($event))" />
  </div>
</div>

<!-- Endpoints Header -->
<div class="flex items-center justify-between mt-3 mb-1">
  <span class="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
    {{ t("providers.endpoints.title") }}
  </span>
  <Badge variant="secondary" class="text-[9px]">
    {{ endpoints.length }} / 3
  </Badge>
</div>

<!-- Endpoint List -->
<EndpointEditor
  v-for="(ep, i) in endpoints"
  :key="ep.api_type"
  :endpoint="ep"
  :used-api-types="usedApiTypes"
  :can-remove="endpoints.length > 1"
  :readonly="isPresetReadonly(i)"
  :errors-base-url="i === 0 ? errorsBaseUrl : ''"
  @update:endpoint="onUpdateEndpoint(i, $event)"
  @remove="emit('remove-endpoint', i)"
/>

<!-- Add Endpoint Chips -->
<div class="flex gap-1 pt-1">
  <span v-for="at in ALL_API_TYPES" :key="at"
    class="add-chip"
    :class="{ 'add-chip-off': usedApiTypes.has(at) }"
    @click="!usedApiTypes.has(at) && emit('add-endpoint', at)">
    {{ usedApiTypes.has(at) ? '✓' : '+' }} {{ API_TYPE_SHORT_LABELS[at] }}
  </span>
</div>
```

**CSS 新增**：

```css
.add-chip { @apply inline-flex items-center px-2 py-0.5 border border-dashed border-border rounded text-[10px] text-muted-foreground cursor-pointer; }
.add-chip:hover { @apply border-primary text-primary bg-primary/5; }
.add-chip-off { @apply opacity-35 cursor-not-allowed pointer-events-none; }
```

### 3.3 useProviderForm 重构（buildPayload + validate）

**文件：`frontend/src/composables/useProviderForm.ts`**

**FormState 变更**：见 §1.2。

**validate() 变更**：

```typescript
function validate(): boolean {
  const errs: Record<string, string> = {};

  // Name 校验不变
  const schema = z.object({
    name: z.string().min(1, t("providers.validation.nameRequired"))
      .regex(/^[a-zA-Z0-9_-]+$/, t("providers.validation.namePattern")),
  });
  const nameResult = schema.safeParse({ name: form.value.name.trim() });
  if (!nameResult.success) {
    for (const issue of nameResult.error.issues) {
      const field = issue.path[0] as string;
      if (!errs[field]) errs[field] = issue.message;
    }
  }

  // endpoints 校验（新增）
  if (form.value.endpoints.length === 0) {
    errs.endpoints = t("providers.validation.endpointsRequired");
  }

  // 每个 endpoint 的 base_url 校验
  for (let i = 0; i < form.value.endpoints.length; i++) {
    const ep = form.value.endpoints[i];
    if (!ep.base_url.trim()) {
      errs.base_url = t("providers.validation.baseUrlRequired");
    } else {
      try {
        new URL(ep.base_url.trim());
      } catch {
        errs.base_url = t("providers.validation.baseUrlInvalid");
      }
    }
  }

  // Shared key 校验（新建模式，至少有一个 endpoint 没有 api_key 则需要 shared key）
  if (!editingId.value) {
    const hasEndpointWithoutKey = form.value.endpoints.some(ep => !ep.api_key.trim());
    if (hasEndpointWithoutKey && !form.value.shared_api_key.trim()) {
      errs.api_key = t("providers.validation.apiKeyRequired");
    }
  }

  // Concurrency 校验不变...

  errors.value = errs;
  return Object.keys(errs).length === 0;
}
```

**buildPayload() 变更**：

```typescript
function buildPayload(): ProviderPayload {
  const endpoints: EndpointPayload[] = form.value.endpoints.map(ep => ({
    api_type: ep.api_type,
    base_url: ep.base_url.trim(),
    upstream_path: ep.upstream_path.trim() || null,
    api_key: ep.api_key.trim() || null,  // null = fallback 到共享 key
  }));

  return {
    name: form.value.name,
    endpoints,
    api_key: form.value.shared_api_key || undefined,  // 共享 key（向后兼容）
    // 旧字段从 endpoints[0] 派生（向后兼容）
    api_type: endpoints[0]?.api_type,
    base_url: endpoints[0]?.base_url,
    upstream_path: endpoints[0]?.upstream_path,
    models: form.value.models.map(m => ({...})),
    is_active: form.value.is_active ? 1 : 0,
    // 其余不变...
  };
}
```

**openEdit() 变更**：

```typescript
function openEdit(p: Provider) {
  editingId.value = p.id;
  // 从 endpoints 数组构建 form
  form.value = {
    name: p.name,
    shared_api_key: "",  // 编辑模式不回填 key
    endpoints: (p.endpoints || []).map(ep => ({
      api_type: ep.api_type,
      base_url: ep.base_url,
      upstream_path: ep.upstream_path || "",
      api_key: "",  // 编辑模式不回填 endpoint key
    })),
    // 如果后端没返回 endpoints（兼容旧版），从旧字段构建
    // ...（兜底逻辑）
    models: (p.models || []).map(m => ({...})),
    // 其余不变...
  };
}
```

**新增 endpoint 操作方法**：

```typescript
const usedApiTypes = computed(() =>
  new Set(form.value.endpoints.map(ep => ep.api_type))
);

function addEndpoint(apiType: "openai" | "openai-responses" | "anthropic") {
  form.value.endpoints.push({
    api_type: apiType,
    base_url: "",
    upstream_path: "",
    api_key: "",
  });
}

function removeEndpoint(index: number) {
  if (form.value.endpoints.length > 1) {
    form.value.endpoints.splice(index, 1);
  }
}

function updateEndpoint(index: number, updated: EndpointFormState) {
  form.value.endpoints[index] = updated;
}
```

### 3.4 预设模板适配

**文件：`frontend/src/composables/useProviderPresets.ts`**

**`onPresetChange()` 变更**：选择预设后，自动生成多个 endpoint（OpenAI + Anthropic），而非只设一个 api_type/base_url。

```typescript
function onPresetChange() {
  const preset = availablePlans.value.find(p => p.plan === presetPlan.value);
  if (!preset) return;

  form.value.name = preset.presetName;
  form.value.shared_api_key = "";

  // 新逻辑：根据预设生成 endpoints
  // 供应商同时支持 OpenAI + Anthropic 时生成两个 endpoint
  form.value.endpoints = buildEndpointsFromPreset(preset);
  form.value.models = preset.models.map(name => ({...}));
}

function buildEndpointsFromPreset(preset: ProviderPreset): EndpointFormState[] {
  const endpoints: EndpointFormState[] = [];

  // 主 endpoint（预设指定的 api_type）
  endpoints.push({
    api_type: preset.apiType,
    base_url: preset.baseUrl,
    upstream_path: preset.upstreamPath ?? "",
    api_key: "",  // 使用 shared key
  });

  // 如果供应商支持双协议，自动添加另一个 endpoint
  // 判断逻辑：base_url 中有特征（如 open.bigmodel.cn 支持 OpenAI + Anthropic）
  // 这个映射关系由后端 recommended providers 数据决定
  if (preset.dualProtocol) {
    const secondaryType = preset.apiType === "openai" ? "anthropic" : "openai";
    const defaultPath = secondaryType === "anthropic"
      ? "/v1/messages" : "/v1/chat/completions";
    endpoints.push({
      api_type: secondaryType,
      base_url: preset.baseUrl,
      upstream_path: defaultPath,
      api_key: "",
    });
  }

  return endpoints;
}
```

**`ProviderPreset` 接口扩展**（`frontend/src/api/client.ts`）：

```typescript
export interface ProviderPreset {
  // ...现有字段
  dualProtocol?: boolean;  // 新增：是否支持双协议
}
```

---

## §4 QuickSetup 页面

### 4.1 useQuickSetup buildProviderPayload 变更

**文件：`frontend/src/composables/useQuickSetup.ts`**

**`buildProviderPayload()` 变更**：改为构建 `endpoints` 数组格式。

```typescript
function buildProviderPayload(input: ProviderPayloadInput): QuickSetupPayload["provider"] {
  // 构建 endpoints 数组
  const endpoints: EndpointPayload[] = [{
    api_type: input.apiType,
    base_url: input.baseUrl,
    upstream_path: input.upstreamPath || null,
    api_key: null,  // 使用 shared key
  }];

  return {
    name: input.isCustom
      ? `custom-${Date.now()}`
      : `${toProviderName(input.selectedGroup)}-${toProviderName(input.selectedPlan)}`,
    // 新格式
    endpoints,
    api_key: input.apiKey,  // shared key
    // 旧字段保留（向后兼容）
    api_type: input.apiType,
    base_url: input.baseUrl,
    upstream_path: input.upstreamPath || undefined,
    models: input.models.map(m => ({...})),
    // 其余不变...
  };
}
```

**QuickSetup 中多 endpoint 场景**：当预设支持双协议时，`buildProviderPayload` 需要构建两个 endpoint。

这需要在 `useQuickSetup` 中引入 `endpoints` 状态：

```typescript
// 新增状态
const endpoints = ref<EndpointFormState[]>([]);

// onProviderChange 中初始化 endpoints
function onProviderChange(group: string) {
  // ...现有逻辑
  if (preset && preset.dualProtocol) {
    endpoints.value = buildEndpointsFromPreset(preset);
  } else {
    endpoints.value = [{
      api_type: apiType.value,
      base_url: baseUrl.value,
      upstream_path: upstreamPath.value,
      api_key: "",
    }];
  }
}
```

### 4.2 Provider Config 区域 UI 变更

**文件：`frontend/src/views/QuickSetup.vue`**

**Line 1 变更**：Shared key 紧跟 Provider/Plan 右侧。

```html
<!-- Line 1: Provider / Plan / Shared API Key / Test -->
<div class="flex items-end gap-2">
  <div class="w-40 space-y-1">
    <Label class="text-xs text-muted-foreground">{{ t("quickSetup.provider.label") }}</Label>
    <Select ...>
      <!-- 不变 -->
    </Select>
  </div>
  <!-- Preset mode: plan + format -->
  <template v-if="!isCustomProvider">
    <div class="w-28 space-y-1">
      <Label class="text-xs text-muted-foreground">{{ t("quickSetup.provider.plan") }}</Label>
      <Select ...>
        <!-- 不变 -->
      </Select>
    </div>
  </template>
  <!-- Shared API Key -->
  <div class="w-56 space-y-1">
    <Label class="text-xs text-muted-foreground">
      {{ t("quickSetup.provider.apiKey") }}
    </Label>
    <Input v-model="apiKey" type="password"
      :placeholder="t('quickSetup.provider.apiKeyPlaceholder')"
      class="md:text-xs h-7" />
  </div>
  <div class="shrink-0 space-y-1">
    <Label class="text-xs text-muted-foreground invisible">{{ t("quickSetup.provider.connect") }}</Label>
    <Button variant="outline" size="sm" @click="testConnection">...</Button>
  </div>
</div>
```

**Line 1.5 新增：Endpoint 列表**（预设模式下，显示自动生成的 endpoint）：

```html
<!-- Endpoints (仅 preset 模式) -->
<template v-if="!isCustomProvider && endpoints.length > 0">
  <div class="flex items-center justify-between mb-1">
    <span class="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">
      {{ t("providers.endpoints.title") }}
    </span>
    <Badge variant="secondary" class="text-[8px]">{{ endpoints.length }}</Badge>
  </div>
  <div v-for="ep in endpoints" :key="ep.api_type"
    class="border rounded-md p-1.5 mb-1.5 space-y-1">
    <div class="flex items-center gap-2">
      <Badge :variant="apiTypeBadgeVariant(ep.api_type)"
        class="min-w-[68px] justify-center text-[9px]">
        {{ API_TYPE_SHORT_LABELS[ep.api_type] }}
      </Badge>
      <Input :model-value="ep.api_key" type="password"
        :placeholder="t('providers.endpoints.apiKeyPlaceholder')"
        class="flex-1 max-w-[160px] h-5 text-[9px]"
        @update:model-value="ep.api_key = String($event)" />
    </div>
    <div class="flex items-center gap-2">
      <div class="flex-1">
        <Label class="text-[9px] text-muted-foreground">{{ t("providers.fields.baseUrl") }}</Label>
        <Input :model-value="ep.base_url" readonly class="h-5 text-[9px] bg-muted" />
      </div>
      <div class="w-36">
        <Label class="text-[9px] text-muted-foreground">{{ t("providers.fields.upstreamPath") }}</Label>
        <Input :model-value="ep.upstream_path" readonly class="h-5 text-[9px] bg-muted" />
      </div>
    </div>
  </div>
</template>
```

### 4.3 Shared key 处理

**设计决策**：QuickSetup 的 `apiKey` ref 语义变更：
- 之前：直接作为 Provider 的 `api_key`
- 之后：作为 Shared Key（`api_key`），endpoint 的 `api_key` 默认 `null`（fallback 到 shared）

**payload 构建**：

```typescript
endpoints: [{
  api_type: apiType.value,
  base_url: baseUrl.value,
  upstream_path: upstreamPath.value || null,
  api_key: null,  // 使用 shared key
}],
api_key: apiKey.value.trim(),  // shared key
```

**Custom 模式**：仍允许用户选 format，只生成一个 endpoint。base_url/upstream_path 可编辑。

---

## §5 请求日志

### 5.1 LogTableRow Tags 列（箭头展示）

**文件：`frontend/src/components/logs/LogTableRow.vue`**

**当前状态**：Tags 列显示 `api_type` badge + `status_code` badge + SSE badge 等。

**变更方案**：当 `upstream_api_type` 存在且不等于 `api_type` 时，显示 `api_type → upstream_api_type` 箭头。

**Props 变更**：无（`LogEntry` 接口扩展即可）。

**LogEntry 扩展**（`frontend/src/components/logs/types.ts`）：

```typescript
export interface LogEntry {
  // ...现有字段
  upstream_api_type: string | null;     // 新增
  upstream_base_url: string | null;     // 新增
}
```

**Tags 列模板变更**：

```html
<TableCell>
  <div class="flex flex-wrap gap-1">
    <!-- API Type: 有转换时显示箭头 -->
    <template v-if="log.upstream_api_type && log.upstream_api_type !== log.api_type">
      <Badge variant="default" class="text-[10px] px-1.5 py-0">
        {{ log.api_type }}
      </Badge>
      <span class="text-warning font-semibold text-[10px]">→</span>
      <Badge variant="outline" class="text-[10px] px-1.5 py-0">
        {{ log.upstream_api_type }}
      </Badge>
    </template>
    <template v-else>
      <Badge :variant="log.api_type === 'openai' ? 'default' : 'secondary'"
        class="text-[10px] px-1.5 py-0">
        {{ log.api_type }}
      </Badge>
    </template>
    <!-- Status code -->
    <Badge :variant="(log.status_code ?? 0) < 400 ? 'default' : 'destructive'"
      class="text-[10px] px-1.5 py-0">
      {{ log.status_code || "-" }}
    </Badge>
    <!-- 其余 badges 不变 -->
  </div>
</TableCell>
```

### 5.2 RequestOverviewPanel Metadata 新增字段

**文件：`frontend/src/components/request-detail/RequestOverviewPanel.vue`**

**Metadata 区域新增两行**：

```html
<!-- 在 Metadata 区域的 StatusCode 行之后新增 -->
<div v-if="overview.upstreamApiType && overview.upstreamApiType !== overview.apiType"
  class="flex items-center justify-between text-[11px] bg-warning/5 -mx-1.5 px-1.5 rounded">
  <span class="text-muted-foreground">{{ t("requestDetail.upstreamApiType") }}</span>
  <span class="font-mono text-warning">{{ overview.upstreamApiType }}</span>
</div>
<div v-if="overview.upstreamBaseUrl && overview.upstreamBaseUrl !== overview.providerName"
  class="flex items-center justify-between text-[11px] bg-warning/5 -mx-1.5 px-1.5 rounded">
  <span class="text-muted-foreground">{{ t("requestDetail.upstreamBaseUrl") }}</span>
  <span class="font-mono text-warning text-[10px] truncate max-w-[160px]">{{ overview.upstreamBaseUrl }}</span>
</div>
```

**Tags 区域同步箭头**（在 status + SSE + apiType badges 中）：

```html
<!-- Row 2: status + SSE + apiType (with arrow) -->
<div class="flex items-center gap-1.5">
  <!-- status badge 不变 -->
  <Badge variant="outline">{{ overview.isStream ? "SSE" : t("requestDetail.nonStream") }}</Badge>
  <!-- apiType: 有转换时显示箭头 -->
  <template v-if="overview.upstreamApiType && overview.upstreamApiType !== overview.apiType">
    <Badge variant="outline">{{ overview.apiType }}</Badge>
    <span class="text-warning font-semibold text-[10px]">→</span>
    <Badge variant="outline">{{ overview.upstreamApiType }}</Badge>
  </template>
  <template v-else>
    <Badge variant="outline">{{ overview.apiType }}</Badge>
  </template>
  <!-- thinking level badge 不变 -->
</div>
```

### 5.3 types.ts 类型扩展

**文件：`frontend/src/components/request-detail/types.ts`**

**`UnifiedRequestOverview` 接口扩展**：

```typescript
export interface UnifiedRequestOverview {
  // ...现有字段
  upstreamApiType: string | null;    // 新增：实际上游 api_type
  upstreamBaseUrl: string | null;    // 新增：实际上游 base_url
}
```

**`fromLogEntry()` 变更**：

```typescript
export function fromLogEntry(entry: LogEntry): UnifiedRequestOverview {
  return {
    // ...现有映射
    upstreamApiType: entry.upstream_api_type ?? null,
    upstreamBaseUrl: entry.upstream_base_url ?? null,
  };
}
```

**`fromActiveRequest()` 变更**：`ActiveRequest` 类型如果后续也携带 upstream_api_type，同步映射。当前阶段，实时请求的 `upstreamApiType` 先设为 `null`（实时 SSE 不携带该信息）。

---

## §6 文件影响矩阵

| 文件 | 变更类型 | 变更摘要 | 预估行数 |
|------|---------|---------|---------|
| `frontend/src/types/mapping.ts` | 新增接口 | 新增 `ProviderEndpoint` 接口，`Provider` 增加 `endpoints` 字段 | +10 |
| `frontend/src/api/client.ts` | 接口变更 | `ProviderPayload` 新增 `endpoints`，新增 `EndpointPayload` 接口，`QuickSetupPayload.provider` 新增 `endpoints` | +15 |
| `frontend/src/composables/useProviderForm.ts` | 重构 | `FormState` 新增 `shared_api_key` + `endpoints`，删除旧 `api_type/base_url/upstream_path/api_key`；`buildPayload()` 构建 endpoints 数组；`validate()` 校验 endpoints；`openEdit()` 从 endpoints 构建 form；新增 `addEndpoint/removeEndpoint/updateEndpoint` 方法 | ~120 行变更 |
| `frontend/src/composables/useProviderPresets.ts` | 适配 | `onPresetChange()` 生成多 endpoint；新增 `buildEndpointsFromPreset()` | +30 |
| `frontend/src/composables/useQuickSetup.ts` | 适配 | `buildProviderPayload()` 构建 endpoints 格式；新增 `endpoints` ref；`onProviderChange()` 初始化多 endpoint | +40 |
| `frontend/src/views/Providers.vue` | 重构 | 表格 4 列拆分（Name/API Type/Base URL/API Key），多行虚线分隔，`buildFullUrl` 改为 per-endpoint；Dialog 内表单绑定从单字段改为 endpoints 数组 | ~150 行变更 |
| `frontend/src/components/providers/EndpointEditor.vue` | **新建** | 紧凑两行 endpoint 编辑器组件 | ~80 |
| `frontend/src/components/providers/ModelCapabilitiesEditor.vue` | 重构 | 移除 api_type/base_url/api_key/upstream_path 单字段，替换为 Shared Key + EndpointEditor 列表 | ~80 行变更 |
| `frontend/src/views/QuickSetup.vue` | 适配 | Shared key 移至 Provider/Plan 同行，新增 endpoint 列表区域 | +40 |
| `frontend/src/components/logs/types.ts` | 扩展 | `LogEntry` 新增 `upstream_api_type`、`upstream_base_url` | +2 |
| `frontend/src/components/logs/LogTableRow.vue` | 增强 | Tags 列 api_type badge 增加箭头展示 | +15 |
| `frontend/src/components/request-detail/types.ts` | 扩展 | `UnifiedRequestOverview` 新增 `upstreamApiType`、`upstreamBaseUrl`；`fromLogEntry()` 映射 | +8 |
| `frontend/src/components/request-detail/RequestOverviewPanel.vue` | 增强 | Tags 区域箭头 + Metadata 区域高亮两行 | +25 |
| `frontend/src/i18n/locales/en/providers.json` | 新增 keys | 见下方 i18n 列表 | +15 |
| `frontend/src/i18n/locales/zh-CN/providers.json` | 新增 keys | 同步英文 keys | +15 |
| `frontend/src/i18n/locales/en/logs.json` | 新增 keys | 见下方 i18n 列表 | +0（无新增） |
| `frontend/src/i18n/locales/en/requestDetail.json` | 新增 keys | 见下方 i18n 列表 | +2 |
| `frontend/src/i18n/locales/zh-CN/requestDetail.json` | 新增 keys | 同步 | +2 |

**总计新增/变更**：~550 行，其中新建文件 1 个（EndpointEditor.vue ~80 行）。

---

## §7 i18n Key 新增列表

### providers namespace

| Key | English | 中文 |
|-----|---------|------|
| `providers.tableHeaders.apiType` | "API Type" | "API 类型" |
| `providers.tableHeaders.baseUrl` | "Base URL" | "接口地址" |
| `providers.sharedKey` | "shared" | "共享" |
| `providers.endpoints.title` | "Endpoints" | "端点" |
| `providers.endpoints.sharedKey` | "Shared API Key" | "共享密钥" |
| `providers.endpoints.sharedKeyHint` | "(fallback)" | "(兜底)" |
| `providers.endpoints.sharedKeyPlaceholder` | "Used when endpoint key is empty" | "端点密钥为空时使用" |
| `providers.endpoints.apiKeyPlaceholder` | "API Key (empty = shared)" | "密钥（留空使用共享）" |
| `providers.endpoints.remove` | "Remove" | "移除" |
| `providers.endpoints.add` | "+ {type}" | "+ {type}" |
| `providers.endpoints.configured` | "✓ {type}" | "✓ {type}" |
| `providers.validation.endpointsRequired` | "At least one endpoint is required" | "至少需要一个端点" |
| `providers.validation.duplicateApiType` | "API type '{type}' is already configured" | "API 类型 '{type}' 已配置" |

### requestDetail namespace

| Key | English | 中文 |
|-----|---------|------|
| `requestDetail.upstreamApiType` | "Upstream API Type" | "上游 API 类型" |
| `requestDetail.upstreamBaseUrl` | "Upstream Base URL" | "上游接口地址" |

### logs namespace

无新增 key（箭头符号直接硬编码为 `→`，api_type badge 值直接取自 `log.api_type` / `log.upstream_api_type`）。

### quickSetup namespace

无新增 key（复用 providers namespace 的 endpoints 相关 key）。

---

## §8 API 调用变更汇总

| 调用点 | 变更 |
|--------|------|
| `POST /admin/api/providers` | Payload 新增 `endpoints` 数组，保留旧字段向后兼容 |
| `PUT /admin/api/providers/:id` | 同上 |
| `GET /admin/api/providers` | 响应中每个 provider 新增 `endpoints` 数组 |
| `GET /admin/api/providers/:id` | 同上 |
| `POST /admin/api/quick-setup` | `provider` 子对象新增 `endpoints` 数组 |
| `GET /admin/api/logs` | 每条 log 新增 `upstream_api_type`、`upstream_base_url` 字段 |
| `GET /admin/api/logs/:id` | 同上 |
