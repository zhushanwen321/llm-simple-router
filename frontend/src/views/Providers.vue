<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold text-foreground">
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
        <Button @click="openCreate" class="flex items-center gap-1">
          <svg
            class="w-4 h-4"
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
    </div>
    <div class="bg-card rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow class="bg-muted">
            <TableHead class="text-muted-foreground">{{
              t("providers.tableHeaders.name")
            }}</TableHead>
            <TableHead class="text-muted-foreground">{{
              t("providers.tableHeaders.type")
            }}</TableHead>
            <TableHead class="text-muted-foreground">{{
              t("providers.tableHeaders.baseUrl")
            }}</TableHead>
            <TableHead class="text-xs">Path</TableHead>
            <TableHead class="text-muted-foreground">{{
              t("providers.tableHeaders.apiKey")
            }}</TableHead>
            <TableHead class="text-muted-foreground">{{
              t("providers.tableHeaders.models")
            }}</TableHead>
            <TableHead class="text-muted-foreground">{{
              t("providers.tableHeaders.concurrency")
            }}</TableHead>
            <TableHead class="text-muted-foreground">{{
              t("providers.tableHeaders.status")
            }}</TableHead>
            <TableHead class="text-right text-muted-foreground">{{
              t("providers.tableHeaders.actions")
            }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="p in providers"
            :key="p.id"
            :class="{ 'opacity-60': !p.is_active }"
          >
            <TableCell class="font-medium">
              <div class="flex items-center gap-2">
                <ProviderIcon :name="providerIconName(p.name)" :size="18" />
                <span>{{ p.name }}</span>
              </div>
            </TableCell>
            <TableCell>
              <Badge variant="secondary">{{
                API_TYPE_LABELS[p.api_type] ?? p.api_type
              }}</Badge>
            </TableCell>
            <TableCell>
              <div class="flex items-center gap-1">
                <span class="text-muted-foreground">{{ p.base_url }}</span>
                <Shield
                  v-if="p.proxy_type"
                  class="w-3 h-3 text-muted-foreground"
                  :title="`Proxy: ${p.proxy_type.toUpperCase()}`"
                />
              </div>
            </TableCell>
            <TableCell class="text-muted-foreground text-xs">{{
              p.upstream_path ||
              (p.api_type === "anthropic"
                ? "/v1/messages"
                : "/v1/chat/completions")
            }}</TableCell>
            <TableCell>
              <div class="flex items-center gap-1">
                <span class="font-mono text-xs text-muted-foreground">{{
                  maskKey(p.api_key)
                }}</span>
                <Button
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
              <div class="flex flex-wrap gap-1">
                <div
                  v-for="m in p.models || []"
                  :key="m.name"
                  class="flex items-center gap-1"
                >
                  <Badge variant="secondary" class="text-xs">
                    {{ m.name }}
                    <span
                      v-if="m.context_window"
                      class="ml-1 text-muted-foreground"
                      >({{ formatContextWindow(m.context_window) }})</span
                    >
                  </Badge>
                  <Badge
                    v-if="modelCapabilities(m).includes('image')"
                    variant="outline"
                    class="text-[10px] px-1 py-0 gap-0.5 text-primary/70 border-primary/20"
                  >
                    <ImageIcon class="w-2.5 h-2.5" />
                  </Badge>
                </div>
                <span
                  v-if="!p.models?.length"
                  class="text-muted-foreground text-xs"
                  >-</span
                >
              </div>
            </TableCell>
            <TableCell>
              <Badge v-if="p.adaptive_enabled" variant="outline">{{
                t("common.adaptive")
              }}</Badge>
              <Badge v-else-if="p.max_concurrency > 0" variant="secondary">{{
                p.max_concurrency
              }}</Badge>
              <span v-else class="text-muted-foreground">-</span>
            </TableCell>
            <TableCell>
              <Button
                variant="ghost"
                size="sm"
                class="gap-1.5"
                @click="confirmToggle(p)"
              >
                <span
                  class="relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors"
                  :class="p.is_active ? 'bg-primary' : 'bg-input'"
                >
                  <span
                    class="inline-block h-3 w-3 rounded-full bg-background shadow-sm transition-transform"
                    :class="p.is_active ? 'translate-x-3.5' : 'translate-x-0.5'"
                  />
                </span>
                <Badge :variant="p.is_active ? 'default' : 'secondary'">{{
                  p.is_active ? t("common.enabled") : t("common.disabled")
                }}</Badge>
              </Button>
            </TableCell>
            <TableCell class="text-right">
              <Button
                variant="ghost"
                size="sm"
                @click="openEdit(p)"
                class="text-muted-foreground hover:text-primary mr-2"
                >{{ t("common.edit") }}</Button
              >
              <Button
                variant="ghost"
                size="sm"
                @click="confirmDelete(p)"
                class="text-muted-foreground hover:text-destructive"
                >{{ t("common.delete") }}</Button
              >
            </TableCell>
          </TableRow>
          <TableRow v-if="providers.length === 0">
            <TableCell
              colspan="9"
              class="text-center text-muted-foreground py-8"
              >{{ t("providers.noProviders") }}</TableCell
            >
          </TableRow>
        </TableBody>
      </Table>
    </div>
    <!-- Create/Edit Dialog -->
    <Dialog v-model:open="dialogOpen">
      <DialogContent class="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{{
            editingId ? t("providers.editProvider") : t("providers.addProvider")
          }}</DialogTitle>
        </DialogHeader>
        <form @submit.prevent="handleSave" class="space-y-4">
          <!-- 模板选择 (仅新建模式) -->
          <div
            v-if="!editingId"
            class="rounded-md border-2 border-primary/30 bg-primary/5 p-3 space-y-2"
          >
            <div
              class="flex items-center gap-1.5 text-xs font-semibold text-primary"
            >
              <svg
                class="w-3.5 h-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                />
              </svg>
              {{ t("providers.template.title") }}
            </div>
            <div class="flex gap-2">
              <Select v-model="presetGroup" @update:model-value="onGroupChange">
                <SelectTrigger class="flex-1 border-primary/40"
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
                <SelectTrigger class="flex-1 border-primary/40"
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
          <!-- 未选模板提示 (仅新建模式) -->
          <div
            v-if="!presetGroup && !editingId"
            class="flex flex-col items-center justify-center py-10 text-muted-foreground"
          >
            <svg
              class="w-10 h-10 mb-3 opacity-30"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 12l2 2 4-4" />
            </svg>
            <span class="text-sm">{{
              t("providers.template.selectFirst")
            }}</span>
          </div>
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
              @add-model="addModel"
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
import { onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { api, getApiMessage } from "@/api/client";
import { Button } from "@/components/ui/button";
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
import { RotateCw, Copy, Check, Shield, ImageIcon } from "lucide-vue-next";
import ProviderIcon from "@/components/icons/ProviderIcon.vue";
import ModelCapabilitiesEditor from "@/components/providers/ModelCapabilitiesEditor.vue";
import {
  useProviderForm,
  API_TYPE_LABELS,
  CONTEXT_K,
  CONTEXT_M,
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

const PROVIDER_ICON_MAP: Record<string, string> = {
  deepseek: "deepseek",
  qianfan: "baidu",
  "\u767e\u5ea6\u5343\u5e06": "baidu",
  iflytek: "iflytek",
  "\u79d1\u5927\u8baf\u98de": "iflytek",
  siliconflow: "siliconcloud",
  "\u7845\u57fa\u6d41\u52a8": "siliconcloud",
  zhipu: "zhipu",
  "\u667a\u8c31": "zhipu",
  kimi: "moonshot",
  moonshot: "moonshot",
  "\u6708\u4e4b\u6697\u9762": "moonshot",
  minimax: "minimax",
  volcengine: "volcengine",
  "\u706b\u5c71\u5f15\u64ce": "volcengine",
  aliyun: "alibaba",
  alibaba: "alibaba",
  "\u963f\u91cc\u4e91": "alibaba",
  tencent: "tencentcloud",
  "\u817e\u8baf\u4e91": "tencentcloud",
  opencode: "opencode",
  stepfun: "stepfun",
  "\u9636\u8dc3\u661f\u8fb0": "stepfun",
};

function providerIconName(name: string): string {
  const lower = name.toLowerCase();
  for (const [key, icon] of Object.entries(PROVIDER_ICON_MAP)) {
    if (lower.includes(key)) return icon;
  }
  return lower;
}

function modelCapabilities(m: { capabilities?: string[] }): string[] {
  return m.capabilities ?? ["text"];
}

function formatContextWindow(tokens: number): string {
  if (tokens >= CONTEXT_M) return `${tokens / CONTEXT_M}M`;
  if (tokens >= CONTEXT_K) return `${tokens / CONTEXT_K}K`;
  return `${tokens}`;
}

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
