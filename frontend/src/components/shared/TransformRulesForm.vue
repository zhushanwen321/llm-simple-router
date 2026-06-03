<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TransformConfig } from "@/components/shared/types";
import { DEFAULT_TRANSFORM_CONFIG } from "@/components/shared/types";

const props = defineProps<{
  modelValue: TransformConfig;
  compact?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: TransformConfig];
}>();

const { t } = useI18n();

function patch(partial: Partial<TransformConfig>) {
  emit("update:modelValue", { ...props.modelValue, ...partial });
}

const injectHeaders = computed(
  () =>
    props.modelValue.injectHeaders ?? DEFAULT_TRANSFORM_CONFIG.injectHeaders,
);
const dropFields = computed(
  () => props.modelValue.dropFields ?? DEFAULT_TRANSFORM_CONFIG.dropFields,
);
const requestDefaults = computed(
  () =>
    props.modelValue.requestDefaults ??
    DEFAULT_TRANSFORM_CONFIG.requestDefaults,
);
</script>

<template>
  <div :class="compact ? 'space-y-2' : 'space-y-3'">
    <div>
      <Label class="text-[11px] text-muted-foreground">{{
        t("providers.transform.injectHeaders")
      }}</Label>
      <Input
        :model-value="injectHeaders"
        placeholder='{"x-custom": "value"}'
        class="mt-0.5 md:text-xs font-mono"
        @update:model-value="patch({ injectHeaders: $event as string })"
      />
    </div>
    <div>
      <Label class="text-[11px] text-muted-foreground">{{
        t("providers.transform.dropFields")
      }}</Label>
      <Input
        :model-value="dropFields"
        placeholder="logprobs, frequency_penalty"
        class="mt-0.5 md:text-xs font-mono"
        @update:model-value="patch({ dropFields: $event as string })"
      />
    </div>
    <div>
      <Label class="text-[11px] text-muted-foreground">{{
        t("providers.transform.requestDefaults")
      }}</Label>
      <Input
        :model-value="requestDefaults"
        placeholder='{"max_tokens": 4096}'
        class="mt-0.5 md:text-xs font-mono"
        @update:model-value="patch({ requestDefaults: $event as string })"
      />
    </div>
  </div>
</template>
