<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Trash2Icon } from "lucide-vue-next";
import type { ProviderEndpoint } from "@/types/mapping";

const { t } = useI18n();

const ALL_API_TYPES: Array<ProviderEndpoint["api_type"]> = [
  "openai",
  "openai-responses",
  "anthropic",
];

const API_TYPE_SHORT: Record<string, string> = {
  openai: "OpenAI",
  "openai-responses": "Responses",
  anthropic: "Anthropic",
};

const props = defineProps<{
  modelValue: ProviderEndpoint[];
  sharedKey?: string;
  readonly?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: ProviderEndpoint[]];
}>();

const usedApiTypes = computed(
  () => new Set(props.modelValue.map((e) => e.api_type)),
);

// availableApiTypes removed — add buttons iterate ALL_API_TYPES directly

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
    <div class="flex items-center justify-between">
      <Label class="text-xs text-muted-foreground">{{
        t("providers.endpoints.title")
      }}</Label>
      <template v-if="!readonly">
        <Button
          v-for="at in ALL_API_TYPES"
          :key="at"
          type="button"
          variant="ghost"
          size="sm"
          class="h-6 text-[10px] gap-0.5 px-2"
          :disabled="usedApiTypes.has(at)"
          @click="addEndpoint(at)"
        >
          <template v-if="usedApiTypes.has(at)">&#10003;</template>
          <template v-else>+</template>
          {{ API_TYPE_SHORT[at] ?? at }}
        </Button>
      </template>
    </div>
    <div
      v-for="(ep, i) in modelValue"
      :key="i"
      class="rounded-md border bg-muted/30 p-2.5 space-y-2"
    >
      <!-- Row 1: api_type badge + api_key + remove -->
      <div class="flex items-center gap-2">
        <Badge variant="secondary" class="text-[11px] px-1.5 py-0 shrink-0">
          {{ API_TYPE_SHORT[ep.api_type] ?? ep.api_type }}
        </Badge>
        <div class="flex-1 min-w-0">
          <Input
            :model-value="ep.api_key ?? ''"
            type="password"
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
        <div class="flex-1 min-w-0 space-y-0.5">
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
        <div class="w-48 space-y-0.5">
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
