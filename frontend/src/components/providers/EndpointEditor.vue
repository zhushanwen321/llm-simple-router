<script setup lang="ts">
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Trash2Icon, CheckIcon, PlusIcon } from "lucide-vue-next";
import type { ProviderEndpoint } from "@/types/mapping";

const { t } = useI18n();

const ALL_API_TYPES: Array<ProviderEndpoint["api_type"]> = [
  "openai",
  "openai-responses",
  "anthropic",
];

const API_TYPE_COLOR: Record<string, string> = {
  openai:
    "bg-emerald-100 text-emerald-700 border-emerald-300 hover:bg-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-400 dark:border-emerald-700 dark:hover:bg-emerald-800/50",
  "openai-responses":
    "bg-blue-100 text-blue-700 border-blue-300 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-400 dark:border-blue-700 dark:hover:bg-blue-800/50",
  anthropic:
    "bg-amber-100 text-amber-700 border-amber-300 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-400 dark:border-amber-700 dark:hover:bg-amber-800/50",
};

const API_TYPE_SELECTED_COLOR: Record<string, string> = {
  openai:
    "bg-emerald-200 text-emerald-800 border-emerald-400 dark:bg-emerald-800/60 dark:text-emerald-300 dark:border-emerald-500",
  "openai-responses":
    "bg-blue-200 text-blue-800 border-blue-400 dark:bg-blue-800/60 dark:text-blue-300 dark:border-blue-500",
  anthropic:
    "bg-amber-200 text-amber-800 border-amber-400 dark:bg-amber-800/60 dark:text-amber-300 dark:border-amber-500",
};

const props = defineProps<{
  modelValue: ProviderEndpoint[];
  sharedKey?: string;
  readonly?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: ProviderEndpoint[]];
}>();

/** 是否有任一 endpoint 使用自定义 key */
const hasCustomKeys = computed(() =>
  props.modelValue.some(
    (ep) =>
      ep.api_key !== null && ep.api_key !== undefined && ep.api_key !== "",
  ),
);

/** 手动展开/收起控制 */
const manuallyExpanded = ref(false);

/** 是否展开 per-endpoint API Key 编辑（渐进式披露） */
const showPerEndpointKeys = computed(
  () => manuallyExpanded.value || hasCustomKeys.value,
);

const usedApiTypes = computed(
  () => new Set(props.modelValue.map((e) => e.api_type)),
);

function addEndpoint(apiType: ProviderEndpoint["api_type"]) {
  if (usedApiTypes.value.has(apiType)) return;
  const next = [
    ...props.modelValue,
    {
      api_type: apiType,
      base_url: "",
      upstream_path: null,
      api_key: null,
    },
  ];
  emit("update:modelValue", next);
}

function removeEndpoint(index: number) {
  const next = [...props.modelValue];
  next.splice(index, 1);
  emit("update:modelValue", next);
}

function updateField<K extends keyof ProviderEndpoint>(
  index: number,
  field: K,
  value: ProviderEndpoint[K],
) {
  const next = [...props.modelValue];
  next[index] = { ...next[index], [field]: value };
  emit("update:modelValue", next);
}
</script>

<template>
  <div class="space-y-2">
    <!-- Header: title + add buttons -->
    <div class="flex items-center justify-between">
      <Label class="text-xs text-muted-foreground">{{
        t("providers.endpoints.title")
      }}</Label>
      <template v-if="!readonly">
        <div class="flex items-center gap-1.5">
          <Button
            v-for="at in ALL_API_TYPES"
            :key="at"
            type="button"
            :variant="'outline'"
            size="sm"
            class="h-6 text-[10px] gap-0.5 px-2.5 border font-medium transition-colors"
            :class="
              usedApiTypes.has(at)
                ? API_TYPE_SELECTED_COLOR[at]
                : API_TYPE_COLOR[at]
            "
            :disabled="usedApiTypes.has(at)"
            @click="addEndpoint(at)"
          >
            <CheckIcon v-if="usedApiTypes.has(at)" class="w-3 h-3" />
            <PlusIcon v-else class="w-3 h-3" />
            {{ t(`providers.endpoints.apiTypes.${at}`) }}
          </Button>
        </div>
      </template>
    </div>

    <!-- Per-endpoint toggle -->
    <div
      v-if="!readonly"
      class="flex items-center gap-2 text-[11px] text-muted-foreground"
    >
      <Button
        type="button"
        variant="link"
        size="sm"
        class="h-auto p-0 text-[11px] text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
        @click="manuallyExpanded = !manuallyExpanded"
      >
        {{
          showPerEndpointKeys
            ? t("providers.endpoints.hidePerEndpointKeys")
            : t("providers.endpoints.showPerEndpointKeys")
        }}
      </Button>
      <span v-if="sharedKey && !showPerEndpointKeys" class="opacity-70">
        {{ t("providers.endpoints.allUseSharedKey") }}
      </span>
    </div>

    <!-- Endpoint cards -->
    <div
      v-for="(ep, i) in modelValue"
      :key="i"
      class="rounded-md border bg-muted/30 p-2.5 space-y-2"
    >
      <!-- Row 1: badge + (optional) api_key + remove -->
      <div class="flex items-center gap-2">
        <Badge variant="secondary" class="text-[11px] px-1.5 py-0 shrink-0">
          {{ t(`providers.endpoints.apiTypes.${ep.api_type}`) }}
        </Badge>

        <!-- Per-endpoint API Key: only shown when toggled -->
        <div v-if="showPerEndpointKeys" class="flex-1 min-w-0">
          <Input
            :model-value="ep.api_key ?? ''"
            type="password"
            autocomplete="new-password"
            :disabled="readonly"
            :placeholder="
              sharedKey
                ? t('providers.endpoints.useSharedKey')
                : t('providers.endpoints.apiKeyPlaceholder')
            "
            class="h-6 text-xs font-mono"
            @update:model-value="
              updateField(i, 'api_key', String($event) || null)
            "
          />
        </div>
        <!-- When not expanded: show hint if custom key is set -->
        <div
          v-else-if="ep.api_key"
          class="flex-1 text-[10px] text-muted-foreground"
        >
          {{ t("providers.endpoints.customKeySet") }}
        </div>

        <Button
          v-if="!readonly"
          type="button"
          variant="ghost"
          size="sm"
          class="h-6 w-6 p-0 shrink-0 text-muted-foreground hover:text-destructive"
          :disabled="modelValue.length <= 1"
          @click="removeEndpoint(i)"
        >
          <Trash2Icon class="w-3.5 h-3.5" />
        </Button>
      </div>
      <!-- Row 2: base_url + upstream_path -->
      <div class="flex items-end gap-2">
        <div class="min-w-0 space-y-0.5" style="flex: 6">
          <Label class="text-[10px] text-muted-foreground">Base URL</Label>
          <Input
            :model-value="ep.base_url"
            type="url"
            required
            :disabled="readonly"
            placeholder="https://api.example.com/v1"
            class="h-6 text-xs font-mono"
            @update:model-value="updateField(i, 'base_url', String($event))"
          />
        </div>
        <div class="space-y-0.5" style="flex: 4">
          <Label class="text-[10px] text-muted-foreground">{{
            t("providers.fields.upstreamPath")
          }}</Label>
          <Input
            :model-value="ep.upstream_path ?? ''"
            :disabled="readonly"
            :placeholder="t('providers.fields.upstreamPathPlaceholder')"
            class="h-6 text-xs font-mono"
            @update:model-value="
              updateField(i, 'upstream_path', String($event) || null)
            "
          />
        </div>
      </div>
    </div>
    <p class="text-xs text-muted-foreground">
      {{ t("providers.endpoints.hint") }}
    </p>
  </div>
</template>
