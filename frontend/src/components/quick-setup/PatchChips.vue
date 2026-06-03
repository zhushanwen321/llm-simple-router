<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { PATCH_GROUPS } from "./types";
import type { PatchGroup } from "./types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const { t } = useI18n();

/** 后端 normalizePatchName 将连字符转下划线存储，前端比较时需统一格式 */
function toStorageKey(id: string): string {
  return id.replace(/-/g, "_");
}

const props = defineProps<{
  apiType: string;
  isDeepSeek: boolean;
  isNonOpenaiEndpoint: boolean;
  modelValue: string[];
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string[]];
}>();

const visibleGroups = computed<PatchGroup[]>(() => {
  return PATCH_GROUPS.filter((g) => {
    if (g.key === "deepseek_anthropic")
      return props.isDeepSeek && props.apiType === "anthropic";
    if (g.key === "deepseek_openai")
      return props.isDeepSeek && props.apiType === "openai";
    if (g.key === "general")
      return props.apiType === "openai" && props.isNonOpenaiEndpoint;
    return true;
  });
});

function toggle(patchId: string) {
  const key = toStorageKey(patchId);
  const next = props.modelValue.includes(key)
    ? props.modelValue.filter((id) => id !== key)
    : [...props.modelValue, key];
  emit("update:modelValue", next);
}

function isActive(patchId: string): boolean {
  return props.modelValue.includes(toStorageKey(patchId));
}
</script>

<template>
  <div class="space-y-3">
    <div v-for="group in visibleGroups" :key="group.key">
      <p class="mb-1.5 text-xs font-medium text-muted-foreground">
        {{ t(group.labelKey) }}
      </p>
      <div class="flex flex-wrap gap-1.5">
        <Button
          v-for="item in group.items"
          :key="item.id"
          type="button"
          variant="outline"
          size="sm"
          :aria-pressed="isActive(item.id)"
          :title="t(item.descKey)"
          :class="
            cn(
              'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-all cursor-pointer select-none',
              isActive(item.id)
                ? 'border-ring bg-primary/10 text-primary'
                : 'border-border bg-transparent text-muted-foreground hover:border-muted-foreground hover:text-foreground',
            )
          "
          @click="toggle(item.id)"
        >
          <span
            :class="
              cn(
                'size-1.5 rounded-full transition-colors',
                isActive(item.id) ? 'bg-primary' : 'bg-border',
              )
            "
          />
          {{ t(item.nameKey) }}
        </Button>
      </div>
    </div>
  </div>
</template>
