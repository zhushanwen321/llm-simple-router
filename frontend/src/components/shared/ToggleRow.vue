<script setup lang="ts">
import { Switch } from "@/components/ui/switch";

defineProps<{
  title: string;
  description: string;
  modelValue: boolean;
}>();

defineEmits<{
  "update:modelValue": [value: boolean];
}>();
</script>

<template>
  <div class="flex items-center justify-between py-4 first:pt-0 last:pb-0">
    <div class="flex-1 mr-4">
      <div class="text-sm font-medium">{{ title }}</div>
      <div class="text-xs text-muted-foreground mt-0.5">{{ description }}</div>
    </div>
    <Switch
      :model-value="modelValue"
      @update:model-value="$emit('update:modelValue', $event)"
    />
  </div>
</template>
