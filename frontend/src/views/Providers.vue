<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="page">
    <!-- Zone 1: Header + Anchor Bar -->
    <div class="mb-4">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-base font-semibold text-foreground">
          {{ t("providers.title") }}
        </h2>
        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            @click="handleReload"
            :disabled="reloading"
          >
            <RotateCw
              class="w-4 h-4 mr-1"
              :class="{ 'animate-spin': reloading }"
            />
            {{ t("providers.reloadPlugin") }}
          </Button>
        </div>
      </div>

      <!-- Anchor Bar: provider stats -->
      <div
        v-if="providers.length > 0"
        class="grid grid-cols-4 bg-card border-input border rounded-lg overflow-hidden"
      >
        <div
          class="flex flex-col gap-1 px-5 py-3.5 border-r border-input last:border-r-0"
        >
          <span
            class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider"
          >
            {{ t("providers.anchor.total") }}
          </span>
          <span class="font-mono text-[28px] font-bold leading-none mt-0.5">
            {{ providers.length }}
          </span>
        </div>
        <div
          class="flex flex-col gap-1 px-5 py-3.5 border-r border-input last:border-r-0 cursor-pointer transition-colors hover:bg-foreground/[0.02]"
          :class="{
            'bg-primary/5 shadow-[inset_0_2px_0_var(--primary)]':
              anchorFilter === 'enabled',
          }"
          @click="toggleAnchorFilter('enabled')"
        >
          <span
            class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider"
          >
            {{ t("providers.anchor.enabled") }}
          </span>
          <span
            class="font-mono text-[28px] font-bold leading-none mt-0.5 text-success"
          >
            {{ anchorEnabled }}
          </span>
        </div>
        <div
          class="flex flex-col gap-1 px-5 py-3.5 border-r border-input last:border-r-0 cursor-pointer transition-colors hover:bg-foreground/[0.02]"
          :class="{ 'bg-muted': anchorFilter === 'disabled' }"
          @click="toggleAnchorFilter('disabled')"
        >
          <span
            class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider"
          >
            {{ t("providers.anchor.disabled") }}
          </span>
          <span
            class="font-mono text-[28px] font-bold leading-none mt-0.5 text-muted-foreground"
          >
            {{ anchorDisabled }}
          </span>
        </div>
        <div class="flex flex-col gap-1 px-5 py-3.5">
          <span
            class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider"
          >
            {{ t("providers.anchor.models") }}
          </span>
          <span class="font-mono text-[28px] font-bold leading-none mt-0.5">
            {{ anchorTotalModels }}
          </span>
        </div>
      </div>
    </div>

    <!-- Zone 2: Filter Bar -->
    <div class="flex items-center gap-2 mb-4">
      <div class="relative flex-1 max-w-sm">
        <Search
          class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground"
        />
        <Input
          v-model="searchQuery"
          :placeholder="t('providers.filter.searchPlaceholder')"
          class="pl-8 h-8 text-[13px]"
        />
      </div>
      <Select v-model="statusFilter" @update:model-value="onStatusFilterChange">
        <SelectTrigger class="w-28 h-8 text-[13px]">
          <SelectValue :placeholder="t('providers.filter.status')" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{{ t("providers.filter.all") }}</SelectItem>
          <SelectItem value="enabled">{{
            t("providers.filter.enabled")
          }}</SelectItem>
          <SelectItem value="disabled">{{
            t("providers.filter.disabled")
          }}</SelectItem>
        </SelectContent>
      </Select>
      <span class="font-mono text-xs text-muted-foreground shrink-0">
        {{ filteredProviders.length }} {{ t("providers.filter.count") }}
      </span>
      <div class="flex-1" />
      <Button @click="openCreate" class="flex items-center gap-1.5 h-8">
        <svg
          class="w-3.5 h-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M12 4v16m8-8H4"
          />
        </svg>
        {{ t("providers.addProvider") }}
      </Button>
    </div>

    <!-- Zone 3: Table -->
    <Card v-if="providers.length > 0" flush class="border-input">
      <Table class="[&_td]:px-4 [&_th]:px-4">
        <TableHeader>
          <TableRow class="bg-muted/50 border-b border-input hover:bg-muted/50">
            <TableHead
              class="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider"
            >
              {{ t("providers.tableHeaders.name") }}
            </TableHead>
            <TableHead
              class="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider"
            >
              {{ t("providers.tableHeaders.apiKey") }}
            </TableHead>
            <TableHead
              class="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider"
            >
              {{ t("providers.tableHeaders.models") }}
            </TableHead>
            <TableHead
              class="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider"
            >
              {{ t("providers.tableHeaders.concurrency") }}
            </TableHead>
            <TableHead
              class="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider"
            >
              {{ t("providers.tableHeaders.status") }}
            </TableHead>
            <TableHead
              class="text-muted-foreground text-[11px] font-semibold uppercase tracking-wider"
            >
              {{ t("providers.tableHeaders.actions") }}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="p in filteredProviders"
            :key="p.id"
            class="border-b border-input"
            :class="{ 'opacity-55 hover:opacity-75': !p.is_active }"
          >
            <TableCell>
              <div class="flex items-center gap-2.5">
                <ProviderIcon :name="providerIconName(p.name)" :size="20" />
                <div class="flex flex-col gap-0.5 min-w-0">
                  <div class="flex items-center gap-1.5">
                    <span class="font-medium text-[13px] truncate">{{
                      p.name
                    }}</span>
                    <Badge
                      variant="secondary"
                      class="text-[11px] px-1.5 py-0 shrink-0"
                      >{{ API_TYPE_LABELS[p.api_type] ?? p.api_type }}</Badge
                    >
                  </div>
                  <span
                    class="font-mono text-[11px] text-muted-foreground truncate max-w-[260px]"
                  >
                    {{ buildFullUrl(p) }}
                    <Shield
                      v-if="p.proxy_type"
                      class="w-3 h-3 inline ml-1 text-muted-foreground"
                      :title="`Proxy: ${p.proxy_type.toUpperCase()}`"
                    />
                  </span>
                </div>
              </div>
            </TableCell>
            <TableCell>
              <div class="flex items-center gap-1">
                <span class="font-mono text-xs text-muted-foreground">{{
                  maskKey(p.api_key)
                }}</span>
                <Button
                  v-if="p.api_key"
                  variant="ghost"
                  size="sm"
                  class="h-6 w-6 p-0"
                  @click="copyKey(p.api_key, p.id)"
                >
                  <component
                    :is="copiedId === p.id ? Check : Copy"
                    class="w-3.5 h-3.5"
                    :class="{ 'text-success': copiedId === p.id }"
                  />
                </Button>
              </div>
            </TableCell>
            <TableCell>
              <div class="flex items-center gap-1.5">
                <span class="font-mono text-[13px] font-medium">
                  {{ p.models?.length ?? 0 }}
                </span>
                <span class="text-xs text-muted-foreground">models</span>
                <Badge
                  v-if="hasImageModels(p)"
                  variant="outline"
                  class="text-[10px] px-1 py-0 gap-0.5 text-primary/70 border-primary/20 h-4"
                >
                  <ImageIcon class="w-2.5 h-2.5" />
                </Badge>
              </div>
            </TableCell>
            <TableCell>
              <div class="flex items-center gap-1.5">
                <Badge
                  v-if="p.adaptive_enabled"
                  variant="outline"
                  class="text-[11px] h-5"
                >
                  {{ t("common.adaptive") }}
                </Badge>
                <Badge
                  v-else-if="p.max_concurrency > 0"
                  variant="secondary"
                  class="text-[11px] h-5 font-mono"
                >
                  {{ p.max_concurrency }}
                </Badge>
                <span v-else class="text-muted-foreground text-xs">-</span>
              </div>
            </TableCell>
            <TableCell>
              <div class="flex items-center gap-2">
                <Switch
                  :model-value="!!p.is_active"
                  @update:model-value="confirmToggle(p)"
                />
                <span
                  class="text-xs"
                  :class="
                    p.is_active ? 'text-foreground' : 'text-muted-foreground'
                  "
                >
                  {{ p.is_active ? t("common.enabled") : t("common.disabled") }}
                </span>
              </div>
            </TableCell>
            <TableCell>
              <div class="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 text-xs px-2 text-muted-foreground hover:text-primary"
                  @click="openEdit(p)"
                >
                  {{ t("common.edit") }}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-7 text-xs px-2 text-muted-foreground hover:text-destructive"
                  @click="confirmDelete(p)"
                >
                  {{ t("common.delete") }}
                </Button>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>

    <!-- Empty State -->
    <div
      v-if="providers.length === 0 && !reloading"
      class="flex flex-col items-center justify-center py-16 text-center bg-card border-input border rounded-lg"
    >
      <div
        class="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4"
      >
        <svg
          class="w-6 h-6 text-primary"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          stroke-width="2"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M12 8v8M8 12h8" />
        </svg>
      </div>
      <h3 class="text-[15px] font-semibold mb-1.5">
        {{ t("providers.empty.title") }}
      </h3>
      <p class="text-sm text-muted-foreground mb-5 max-w-sm">
        {{ t("providers.empty.description") }}
      </p>
      <Button @click="openCreate" class="flex items-center gap-1.5">
        <svg
          class="w-3.5 h-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          stroke-width="2"
        >
          <path d="M12 4v16m8-8H4" />
        </svg>
        {{ t("providers.empty.addFirst") }}
      </Button>
    </div>

    <!-- Filtered empty state (no results for search/filter) -->
    <div
      v-if="providers.length > 0 && filteredProviders.length === 0"
      class="flex flex-col items-center justify-center py-12 text-center bg-card border-input border rounded-lg"
    >
      <p class="text-sm text-muted-foreground">
        {{ t("providers.filter.noResults") }}
      </p>
    </div>

    <!-- Create/Edit Dialog -->
    <Dialog v-model:open="dialogOpen">
      <DialogContent class="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{{
            editingId ? t("providers.editProvider") : t("providers.addProvider")
          }}</DialogTitle>
        </DialogHeader>
        <form @submit.prevent="handleSave">
          <!-- 模板选择 (仅新建模式) -->
          <div
            v-if="!editingId"
            class="bg-card border-input border rounded-lg p-4 mb-4"
          >
            <div
              class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 pb-2 border-b border-input"
            >
              {{ t("providers.template.title") }}
            </div>
            <div class="flex items-center gap-2">
              <Select v-model="presetGroup" @update:model-value="onGroupChange">
                <SelectTrigger class="flex-1 h-8 text-[13px]"
                  ><SelectValue
                    :placeholder="t('providers.template.selectProvider')"
                /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__custom__">{{
                    t("providers.template.custom")
                  }}</SelectItem>
                  <SelectItem
                    v-for="g in providerPresets"
                    :key="g.group"
                    :value="g.group"
                    >{{ g.group }}</SelectItem
                  >
                </SelectContent>
              </Select>
              <Select
                v-if="presetGroup !== '__custom__'"
                v-model="presetPlan"
                @update:model-value="onPresetChange"
                :disabled="!presetGroup || presetGroup === '__custom__'"
              >
                <SelectTrigger class="flex-1 h-8 text-[13px]"
                  ><SelectValue
                    :placeholder="t('providers.template.selectPlan')"
                /></SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="p in availablePlans"
                    :key="p.plan"
                    :value="p.plan"
                    >{{ p.plan }}</SelectItem
                  >
                </SelectContent>
              </Select>
            </div>
          </div>

          <!-- Form: only show when preset selected or editing -->
          <template v-if="presetGroup || editingId">
            <ModelCapabilitiesEditor
              :name="form.name"
              :api-type="form.api_type"
              :base-url="form.base_url"
              :api-key="form.api_key"
              :upstream-path="form.upstream_path"
              :proxy-type="form.proxy_type"
              :proxy-url="form.proxy_url"
              :proxy-username="form.proxy_username"
              :proxy-password="form.proxy_password"
              :errors-name="errors.name ?? ''"
              :errors-base-url="errors.base_url ?? ''"
              :errors-api-key="errors.api_key ?? ''"
              :editing-id="editingId"
              :models="form.models"
              :fetching-models="fetchingModels"
              :model-input="modelInput"
              :context-window-select="contextWindowSelect"
              :has-models-endpoint="!!getCurrentModelsEndpoint()"
              :preset-group="presetGroup"
              :has-api-key="!!form.api_key"
              :concurrency-mode="concurrencyMode"
              :max-concurrency="form.max_concurrency"
              :queue-timeout-ms="form.queue_timeout_ms"
              :max-queue-size="form.max_queue_size"
              :transform-inject-headers="transformForm.injectHeadersInput"
              :transform-drop-fields="transformForm.dropFieldsInput"
              :transform-request-defaults="transformForm.requestDefaultsInput"
              @update:name="form.name = $event"
              @update:api-type="form.api_type = $event"
              @update:base-url="form.base_url = $event"
              @update:api-key="form.api_key = $event"
              @update:upstream-path="form.upstream_path = $event"
              @update:proxy-type="form.proxy_type = $event"
              @update:proxy-url="form.proxy_url = $event"
              @update:proxy-username="form.proxy_username = $event"
              @update:proxy-password="form.proxy_password = $event"
              @clear-errors="delete errors[$event]"
              @clear-proxy="
                form.proxy_url = '';
                form.proxy_username = '';
                form.proxy_password = '';
              "
              @update:model="updateModel"
              @remove-model="removeModel"
              @update:model-timeout="updateModelTimeout"
              @toggle-model-capability="toggleModelCapability"
              @fetch-upstream-models="fetchUpstreamModels"
              @add-model="(caps: string[]) => addModel(caps)"
              @update:model-input="modelInput = $event"
              @update:context-window-select="contextWindowSelect = $event"
              @update:concurrency-mode="onConcurrencyModeChange"
              @update:max-concurrency="form.max_concurrency = $event"
              @update:queue-timeout-ms="form.queue_timeout_ms = $event"
              @update:max-queue-size="form.max_queue_size = $event"
              @update:inject-headers="transformForm.injectHeadersInput = $event"
              @update:drop-fields="transformForm.dropFieldsInput = $event"
              @update:request-defaults="
                transformForm.requestDefaultsInput = $event
              "
            />
          </template>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              @click="dialogOpen = false"
              >{{ t("common.cancel") }}</Button
            >
            <Button type="submit">{{ t("common.save") }}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <!-- Delete Confirm AlertDialog -->
    <AlertDialog
      :open="!!deleteTarget"
      @update:open="
        (val) => {
          if (!val) deleteTarget = null;
        }
      "
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{
            t("providers.confirmDelete.title")
          }}</AlertDialogTitle>
          <AlertDialogDescription>{{
            t("providers.confirmDelete.message", { name: deleteTarget?.name })
          }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
          <Button variant="destructive" @click="handleDelete">{{
            t("common.delete")
          }}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <!-- Toggle Confirm AlertDialog -->
    <AlertDialog
      :open="!!toggleTarget"
      @update:open="
        (val: boolean) => {
          if (!val) toggleTarget = null;
        }
      "
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{
            toggleTarget?.is_active
              ? t("providers.confirmToggle.titleDisable")
              : t("providers.confirmToggle.titleEnable")
          }}</AlertDialogTitle>
          <AlertDialogDescription>
            {{
              toggleTarget?.is_active
                ? t("providers.confirmToggle.messageDisable", {
                    name: toggleTarget?.name,
                  })
                : t("providers.confirmToggle.messageEnable", {
                    name: toggleTarget?.name,
                  })
            }}
            <div v-if="toggleDependencies.length" class="mt-2 space-y-1">
              <div class="text-sm font-medium">
                {{ t("providers.confirmToggle.dependencyWarning") }}
              </div>
              <div
                v-for="ref in toggleDependencies"
                :key="ref"
                class="text-destructive text-sm"
              >
                {{ ref }}
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
          <AlertDialogAction @click="handleToggle">{{
            t("common.confirm")
          }}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { api, getApiMessage } from "@/api/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  RotateCw,
  Copy,
  Check,
  ImageIcon,
  Search,
  Shield,
} from "lucide-vue-next";
import ProviderIcon from "@/components/icons/ProviderIcon.vue";
import ModelCapabilitiesEditor from "@/components/providers/ModelCapabilitiesEditor.vue";
import {
  useProviderForm,
  API_TYPE_LABELS,
} from "@/composables/useProviderForm";
import { useProviderActions } from "@/composables/useProviderActions";
import { useFetchUpstreamModels } from "@/composables/useFetchUpstreamModels";

const { t } = useI18n();
const {
  form,
  errors,
  concurrencyMode,
  dialogOpen,
  editingId,
  modelInput,
  contextWindowSelect,
  transformForm,
  presetHook,
  validate,
  buildPayload,
  addModel,
  removeModel,
  updateModel,
  updateModelTimeout,
  toggleModelCapability,
  onConcurrencyModeChange,
  openCreate,
  openEdit,
  saveTransformRules,
} = useProviderForm();
const {
  providerPresets,
  presetGroup,
  presetPlan,
  availablePlans,
  onGroupChange,
  onPresetChange,
  loadPresets,
  getCurrentModelsEndpoint,
  getCurrentPresetModels,
} = presetHook;
const {
  providers,
  reloading,
  copiedId,
  deleteTarget,
  toggleTarget,
  toggleDependencies,
  maskKey,
  copyKey,
  loadProviders,
  confirmDelete,
  confirmToggle,
  handleToggle,
  handleDelete,
  handleReload,
} = useProviderActions();
const { fetchingModels, fetchUpstreamModels } = useFetchUpstreamModels(
  form,
  getCurrentModelsEndpoint,
  getCurrentPresetModels,
);

// --- Search & Filter ---
const searchQuery = ref("");
const statusFilter = ref("all");
const anchorFilter = ref("");

function toggleAnchorFilter(f: string) {
  if (anchorFilter.value === f) {
    anchorFilter.value = "";
    statusFilter.value = "all";
  } else {
    anchorFilter.value = f;
    statusFilter.value = f;
  }
}

function onStatusFilterChange() {
  // sync anchor filter when user changes dropdown
  if (statusFilter.value === "all") {
    anchorFilter.value = "";
  } else {
    anchorFilter.value = statusFilter.value;
  }
}

// --- Anchor Bar stats ---
const anchorEnabled = computed(
  () => providers.value.filter((p) => p.is_active).length,
);
const anchorDisabled = computed(
  () => providers.value.filter((p) => !p.is_active).length,
);
const anchorTotalModels = computed(() =>
  providers.value.reduce((sum, p) => sum + (p.models?.length ?? 0), 0),
);

// --- Filtered providers ---
const filteredProviders = computed(() => {
  let list = providers.value;
  const q = searchQuery.value.toLowerCase().trim();
  if (q) {
    list = list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.base_url.toLowerCase().includes(q),
    );
  }
  if (statusFilter.value === "enabled") {
    list = list.filter((p) => p.is_active);
  } else if (statusFilter.value === "disabled") {
    list = list.filter((p) => !p.is_active);
  }
  return list;
});

// --- Provider icon mapping ---
const PROVIDER_ICON_MAP: Record<string, string> = {
  deepseek: "deepseek",
  qianfan: "baidu",
  百度千帆: "baidu",
  iflytek: "iflytek",
  科大讯飞: "iflytek",
  siliconflow: "siliconcloud",
  硅基流动: "siliconcloud",
  zhipu: "zhipu",
  智谱: "zhipu",
  kimi: "moonshot",
  moonshot: "moonshot",
  月之暗面: "moonshot",
  minimax: "minimax",
  volcengine: "volcengine",
  火山引擎: "volcengine",
  aliyun: "alibaba",
  alibaba: "alibaba",
  阿里云: "alibaba",
  tencent: "tencentcloud",
  腾讯云: "tencentcloud",
  opencode: "opencode",
  stepfun: "stepfun",
  阶跃星辰: "stepfun",
};

function providerIconName(name: string): string {
  const lower = name.toLowerCase();
  for (const [key, icon] of Object.entries(PROVIDER_ICON_MAP)) {
    if (lower.includes(key)) return icon;
  }
  return lower;
}

// --- Model helpers ---
function hasImageModels(p: {
  models?: { capabilities?: string[] }[];
}): boolean {
  return (p.models ?? []).some((m) => m.capabilities?.includes("image"));
}

// --- URL display ---
const DEFAULT_UPSTREAM_PATH: Record<string, string> = {
  anthropic: "/v1/messages",
  openai: "/v1/chat/completions",
  "openai-responses": "/v1/responses",
};

function buildFullUrl(p: {
  base_url: string;
  upstream_path?: string | null;
  api_type: string;
}): string {
  const upstreamPath =
    p.upstream_path ||
    DEFAULT_UPSTREAM_PATH[p.api_type] ||
    "/v1/chat/completions";
  try {
    const url = new URL(p.base_url);
    const pathname = url.pathname.replace(/\/+$/, "");
    const normalizedUpstream = upstreamPath.replace(/\/+$/, "");
    if (pathname.endsWith(normalizedUpstream)) {
      return `${url.origin}${pathname}`;
    }
    return `${url.origin}${pathname}${upstreamPath}`;
  } catch {
    const normalized = p.base_url.replace(/\/+$/, "");
    return `${normalized}${upstreamPath}`;
  }
}

// --- Save ---
async function handleSave() {
  if (!validate()) return;
  try {
    const payload = buildPayload();
    payload.name = form.value.name.trim();
    let providerId = editingId.value;
    if (editingId.value) {
      await api.updateProvider(editingId.value, payload);
    } else {
      payload.api_key = form.value.api_key;
      const result = await api.createProvider(payload);
      providerId = result.id;
    }
    await saveTransformRules(providerId);
    dialogOpen.value = false;
    await loadProviders();
  } catch (e: unknown) {
    console.error("Failed to save provider:", e);
    toast.error(getApiMessage(e, t("providers.toast.saveFailed")));
  }
}

onMounted(async () => {
  await Promise.allSettled([loadPresets(), loadProviders()]);
});
</script>
