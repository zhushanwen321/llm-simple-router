<template>
  <div v-if="!runtime" class="text-[13px] text-muted-foreground py-2">
    {{ t("monitor.runtimePanel.noData") }}
  </div>
  <div v-else>
    <!-- Memory RSS -->
    <div class="flex items-center justify-between py-[3px]">
      <span class="text-[11px] text-muted-foreground">{{ t("monitor.runtimePanel.memoryRss") }}</span>
      <span class="font-mono text-[11px] text-foreground">{{ formatBytes(runtime.memoryUsage.rss) }}</span>
    </div>
    <!-- Event Loop -->
    <div class="flex items-center justify-between py-[3px] border-t border-foreground/[0.04]">
      <span class="text-[11px] text-muted-foreground">{{ t("monitor.runtimePanel.eventLoopDelay") }}</span>
      <span class="font-mono text-[11px] text-success">{{ runtime.eventLoopDelayMs.toFixed(1) }}ms</span>
    </div>
    <!-- Handles -->
    <div class="flex items-center justify-between py-[3px] border-t border-foreground/[0.04]">
      <span class="text-[11px] text-muted-foreground">{{ t("monitor.runtimePanel.activeHandles") }}</span>
      <span class="font-mono text-[11px] text-foreground">{{ runtime.activeHandles }}</span>
    </div>
    <!-- Heap bar -->
    <div class="mt-1 pt-1 border-t border-foreground/[0.04]">
      <div class="flex justify-between mb-[3px]">
        <span class="text-[11px] text-muted-foreground">{{ t("monitor.runtimePanel.heapUsage") }}</span>
        <span class="font-mono text-[10px] text-muted-foreground">
          {{ formatBytes(runtime.memoryUsage.heapUsed) }} / {{ formatBytes(runtime.memoryUsage.heapTotal) }}
        </span>
      </div>
      <div class="h-[3px] bg-foreground/[0.06] rounded-sm overflow-hidden">
        <div
          class="h-full bg-primary rounded-sm transition-all duration-300"
          :style="{ width: `${heapPercent}%` }"
        />
      </div>
    </div>
  </div>
</template>

<!-- eslint-disable no-magic-numbers -->
<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { RuntimeMetrics } from "@/types/monitor";
import { formatBytes } from "@/utils/format";

const { t } = useI18n();

const props = defineProps<{
  runtime: RuntimeMetrics | null;
}>();

const heapPercent = computed(() => {
  if (!props.runtime || props.runtime.memoryUsage.heapTotal === 0) return 0;
  return Math.min(
    100,
    (props.runtime.memoryUsage.heapUsed / props.runtime.memoryUsage.heapTotal) * 100,
  );
});
</script>
