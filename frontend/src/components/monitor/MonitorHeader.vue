<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div
    class="flex items-stretch bg-card border border-border rounded-lg overflow-hidden mb-3"
  >
    <!-- Left: Active count block -->
    <div
      class="flex items-center gap-3.5 px-5 py-3 border-r border-border min-w-[180px]"
      style="background: oklch(0.68 0.13 175 / 8%)"
    >
      <span class="text-[32px] font-bold text-primary font-mono leading-none">
        {{ activeCount }}
      </span>
      <div class="flex flex-col gap-0.5">
        <span
          class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider"
        >
          {{ t("monitor.header.activeRequests") }}
        </span>
        <span class="font-mono text-[11px] text-muted-foreground">
          {{
            t("monitor.header.streamNonStream", {
              stream: streamCount,
              nonStream: activeCount - streamCount,
            })
          }}
        </span>
      </div>
      <span
        v-if="queuedCount > 0"
        class="inline-flex items-center gap-1 ml-3 px-2 py-0.5 rounded-full font-mono text-[11px] font-semibold bg-warning/10 text-warning"
      >
        {{ queuedCount }} {{ t("monitor.queued") }}
      </span>
    </div>

    <!-- Right: Concurrency bars -->
    <div class="flex-1 px-4 py-2.5 flex flex-col gap-1 justify-center">
      <span
        class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-0.5"
      >
        {{ t("monitor.concurrency") }}
      </span>
      <div
        v-if="concurrency.length === 0"
        class="text-[11px] text-muted-foreground py-1"
      >
        {{ t("monitor.concurrencyPanel.noData") }}
      </div>
      <div
        v-for="provider in concurrency"
        :key="provider.providerId"
        class="flex items-center gap-1.5"
      >
        <span
          class="text-[11px] font-medium text-muted-foreground w-[130px] shrink-0 truncate"
          :title="provider.providerName"
        >
          {{ provider.providerName }}
        </span>
        <div class="flex-1 h-1 bg-foreground/[0.06] rounded-sm overflow-hidden">
          <div
            v-if="effectiveLimit(provider) > 0"
            class="h-full rounded-sm transition-all duration-300"
            :class="barClass(provider.active, effectiveLimit(provider))"
            :style="{
              width: `${Math.min(100, (provider.active / effectiveLimit(provider)) * 100)}%`,
            }"
          />
        </div>
        <span
          class="font-mono text-[11px] text-muted-foreground w-10 text-right shrink-0"
          :class="ratioClass(provider.active, effectiveLimit(provider))"
        >
          <template v-if="provider.adaptiveEnabled">
            {{ provider.active }}/{{
              provider.adaptiveLimit ?? provider.maxConcurrency
            }}
          </template>
          <template v-else-if="provider.maxConcurrency === 0">
            {{ t("monitor.concurrencyPanel.unlimited") }}
          </template>
          <template v-else>
            {{ provider.active }}/{{ provider.maxConcurrency }}
          </template>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { ProviderConcurrencySnapshot } from "@/types/monitor";

const { t } = useI18n();

defineProps<{
  stats: import("@/types/monitor").StatsSnapshot | null;
  activeCount: number;
  streamCount: number;
  queuedCount: number;
  concurrency: ProviderConcurrencySnapshot[];
}>();

function effectiveLimit(provider: ProviderConcurrencySnapshot): number {
  return provider.adaptiveLimit ?? provider.maxConcurrency;
}

const CONCURRENCY_WARNING_THRESHOLD = 0.5;
const CONCURRENCY_DANGER_THRESHOLD = 0.8;

function barClass(active: number, max: number): string {
  const ratio = max > 0 ? active / max : 0;
  if (ratio >= CONCURRENCY_DANGER_THRESHOLD) return "bg-danger";
  if (ratio >= CONCURRENCY_WARNING_THRESHOLD) return "bg-warning";
  return "bg-primary";
}

function ratioClass(active: number, max: number): string {
  const ratio = max > 0 ? active / max : 0;
  if (ratio >= CONCURRENCY_DANGER_THRESHOLD) return "text-danger";
  return "";
}
</script>
