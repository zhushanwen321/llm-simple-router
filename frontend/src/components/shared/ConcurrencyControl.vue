<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ConcurrencyConfig } from "@/components/shared/types";
import { DEFAULT_CONCURRENCY_CONFIG } from "@/components/shared/types";

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    modelValue: ConcurrencyConfig;
    compact?: boolean;
  }>(),
  {
    compact: false,
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: ConcurrencyConfig];
}>();

function patch(partial: Partial<ConcurrencyConfig>) {
  emit("update:modelValue", { ...props.modelValue, ...partial });
}

const mode = computed(
  () => props.modelValue.mode ?? DEFAULT_CONCURRENCY_CONFIG.mode,
);
const maxConcurrency = computed(
  () =>
    props.modelValue.max_concurrency ??
    DEFAULT_CONCURRENCY_CONFIG.max_concurrency,
);
const queueTimeoutMs = computed(
  () =>
    props.modelValue.queue_timeout_ms ??
    DEFAULT_CONCURRENCY_CONFIG.queue_timeout_ms,
);
const maxQueueSize = computed(
  () =>
    props.modelValue.max_queue_size ??
    DEFAULT_CONCURRENCY_CONFIG.max_queue_size,
);
</script>

<template>
  <div :class="compact ? 'space-y-2' : 'flex items-end gap-2 flex-wrap'">
    <div :class="compact ? '' : 'w-36'" class="space-y-1">
      <Label class="text-xs text-muted-foreground">{{
        t("providers.concurrency.mode")
      }}</Label>
      <Select
        :model-value="mode"
        @update:model-value="
          (v: unknown) => patch({ mode: v as ConcurrencyConfig['mode'] })
        "
      >
        <SelectTrigger class="w-full text-xs data-[size=default]:h-7">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">{{
            t("providers.concurrency.autoAdaptive")
          }}</SelectItem>
          <SelectItem value="manual">{{
            t("providers.concurrency.manual")
          }}</SelectItem>
          <SelectItem value="none">{{
            t("providers.concurrency.none")
          }}</SelectItem>
        </SelectContent>
      </Select>
    </div>
    <template v-if="mode !== 'none'">
      <div :class="compact ? '' : 'w-24'" class="space-y-1">
        <Label class="text-xs text-muted-foreground">{{
          t("providers.concurrency.maxConcurrency")
        }}</Label>
        <Input
          :model-value="maxConcurrency"
          type="number"
          min="1"
          max="100"
          class="text-xs md:text-xs md:text-xs h-7"
          @update:model-value="patch({ max_concurrency: Number($event) })"
        />
      </div>
      <div :class="compact ? '' : 'w-30'" class="space-y-1">
        <Label class="text-xs text-muted-foreground">{{
          t("providers.concurrency.queueTimeout")
        }}</Label>
        <Input
          :model-value="queueTimeoutMs"
          type="number"
          min="0"
          :placeholder="t('providers.shared.queueTimeoutPlaceholder')"
          class="font-mono text-xs md:text-xs md:text-xs h-7"
          @update:model-value="patch({ queue_timeout_ms: Number($event) })"
        />
      </div>
      <div :class="compact ? '' : 'w-30'" class="space-y-1">
        <Label class="text-xs text-muted-foreground">{{
          t("providers.concurrency.maxQueueSize")
        }}</Label>
        <Input
          :model-value="maxQueueSize"
          type="number"
          min="1"
          max="1000"
          class="text-xs md:text-xs md:text-xs h-7"
          @update:model-value="patch({ max_queue_size: Number($event) })"
        />
      </div>
    </template>
    <div
      v-if="mode === 'auto' && !compact"
      class="text-[10px] text-muted-foreground leading-snug"
    >
      {{ t("providers.shared.autoHint") }}
    </div>
  </div>
</template>
