<template>
  <div class="p-6 max-w-[1440px] mx-auto">
    <!-- Zone 1: Header + Provider 按钮组 + Filters Popover -->
    <div class="flex items-center gap-4 mb-3">
      <h2 class="text-base font-semibold text-foreground shrink-0">
        {{ t("dashboard.title") }}
      </h2>
      <div class="flex-1 overflow-x-auto flex gap-1 scrollbar-none">
        <Button
          v-for="p in sortedProviders"
          :key="p.id"
          :variant="selectedProvider === p.id ? 'default' : 'ghost'"
          size="sm"
          class="h-[30px] px-3 text-[13px] gap-1.5 shrink-0"
          @click="selectedProvider = p.id"
        >
          {{ p.name }}
          <span
            v-if="providerTokenLabels.get(p.id)"
            class="font-mono text-[11px] font-medium"
            :class="
              selectedProvider === p.id
                ? 'text-primary-foreground/60'
                : 'text-muted-foreground'
            "
          >
            {{ providerTokenLabels.get(p.id) }}
          </span>
        </Button>
      </div>
      <Popover>
        <PopoverTrigger as-child>
          <Button
            variant="outline"
            size="sm"
            class="h-[30px] px-2.5 text-[13px] gap-1.5 shrink-0"
          >
            <Filter class="w-3.5 h-3.5" />
            {{ t("dashboard.filters.button") }}
            <Badge
              v-if="activeFilterCount > 0"
              class="h-4 min-w-4 px-1 text-[10px] font-mono font-semibold bg-primary text-primary-foreground"
            >
              {{ activeFilterCount }}
            </Badge>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" class="w-80 space-y-3">
          <div>
            <Label class="text-xs text-muted-foreground mb-1 block">{{
              t("dashboard.filters.model")
            }}</Label>
            <Select v-model="modelFilter">
              <SelectTrigger class="h-8 text-[13px]">
                <SelectValue :placeholder="t('common.allModels')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{{ t("common.allModels") }}</SelectItem>
                <SelectItem v-for="m in modelOptions" :key="m" :value="m">{{
                  m
                }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label class="text-xs text-muted-foreground mb-1 block">{{
              t("dashboard.filters.key")
            }}</Label>
            <Select v-model="keyFilter">
              <SelectTrigger class="h-8 text-[13px]">
                <SelectValue :placeholder="t('common.allKeys')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{{ t("common.allKeys") }}</SelectItem>
                <SelectItem
                  v-for="rk in keyOptions"
                  :key="rk.id"
                  :value="rk.id"
                  >{{ rk.name }}</SelectItem
                >
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label class="text-xs text-muted-foreground mb-1 block">{{
              t("dashboard.filters.clientType")
            }}</Label>
            <Select v-model="clientType">
              <SelectTrigger class="h-8 text-[13px]">
                <SelectValue :placeholder="t('dashboard.clientType.all')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{{
                  t("dashboard.clientType.all")
                }}</SelectItem>
                <SelectItem value="claude-code">{{
                  t("dashboard.clientType.claude-code")
                }}</SelectItem>
                <SelectItem value="codex">{{
                  t("dashboard.clientType.codex")
                }}</SelectItem>
                <SelectItem value="pi">{{
                  t("dashboard.clientType.pi")
                }}</SelectItem>
                <SelectItem value="openai-sdk">{{
                  t("dashboard.clientType.openai-sdk")
                }}</SelectItem>
                <SelectItem value="anthropic-sdk">{{
                  t("dashboard.clientType.anthropic-sdk")
                }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </PopoverContent>
      </Popover>
    </div>

    <!-- Error state -->
    <div v-if="loadError" class="text-center py-20">
      <p class="text-muted-foreground mb-3">{{ t("dashboard.loadError") }}</p>
      <Button variant="outline" size="sm" @click="retry">{{
        t("dashboard.retry")
      }}</Button>
    </div>

    <!-- Empty provider state -->
    <div
      v-else-if="providers.length === 0 && !loading"
      class="text-center py-16"
    >
      <p class="text-muted-foreground">{{ t("dashboard.empty.noProvider") }}</p>
      <Button variant="outline" size="sm" class="mt-3" as-child>
        <router-link to="/providers">{{
          t("dashboard.empty.goToProviders")
        }}</router-link>
      </Button>
    </div>

    <!-- Skeleton state -->
    <div v-else-if="loading" class="space-y-4">
      <div class="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-4">
        <div class="space-y-3">
          <Skeleton class="h-24 w-full rounded-lg" />
          <Skeleton class="h-24 w-full rounded-lg" />
          <div class="grid grid-cols-2 gap-2">
            <Skeleton class="h-16 rounded-lg" />
            <Skeleton class="h-16 rounded-lg" />
          </div>
        </div>
        <Skeleton class="h-64 rounded-lg" />
      </div>
    </div>

    <!-- Main content -->
    <div v-else>
      <!-- Zone 2: Metrics + Primary Chart -->
      <div class="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-4 mb-4">
        <!-- Left: metric cards -->
        <div class="flex flex-col gap-3">
          <!-- Input Token (large) -->
          <div class="bg-card rounded-lg ring-1 ring-foreground/10 px-5 py-4">
            <div class="text-xs text-muted-foreground">
              {{ t("dashboard.stats.inputTokens") }}
            </div>
            <div class="font-mono text-[32px] font-bold leading-none mt-1">
              {{ formatTokenCompact(stats.totalInputTokens) }}
            </div>
            <div
              v-if="deltaValues"
              class="font-mono text-[11px] mt-1.5"
              :class="
                deltaValues.totalInputTokens.startsWith('+')
                  ? 'text-success'
                  : deltaValues.totalInputTokens.startsWith('-')
                    ? 'text-danger'
                    : 'text-muted-foreground'
              "
            >
              {{ deltaValues.totalInputTokens }}
            </div>
            <div
              v-else
              class="font-mono text-[11px] mt-1.5 text-muted-foreground"
            >
              {{ t("dashboard.delta.noPrev") }}
            </div>
          </div>
          <!-- Output Token (large) -->
          <div class="bg-card rounded-lg ring-1 ring-foreground/10 px-5 py-4">
            <div class="text-xs text-muted-foreground">
              {{ t("dashboard.stats.outputTokens") }}
            </div>
            <div class="font-mono text-[32px] font-bold leading-none mt-1">
              {{ formatTokenCompact(stats.totalOutputTokens) }}
            </div>
            <div
              v-if="deltaValues"
              class="font-mono text-[11px] mt-1.5"
              :class="
                deltaValues.totalOutputTokens.startsWith('+')
                  ? 'text-success'
                  : deltaValues.totalOutputTokens.startsWith('-')
                    ? 'text-danger'
                    : 'text-muted-foreground'
              "
            >
              {{ deltaValues.totalOutputTokens }}
            </div>
            <div
              v-else
              class="font-mono text-[11px] mt-1.5 text-muted-foreground"
            >
              {{ t("dashboard.delta.noPrev") }}
            </div>
          </div>
          <!-- TPS + Cache Hit (secondary, grid 2-col) -->
          <div class="grid grid-cols-2 gap-2">
            <div
              class="bg-card rounded-lg ring-1 ring-foreground/10 px-3.5 py-2.5"
            >
              <div class="text-[11px] text-muted-foreground">
                {{ t("dashboard.stats.avgTps") }}
              </div>
              <div class="font-mono text-lg font-semibold leading-none mt-0.5">
                {{ stats.avgTps.toFixed(1)
                }}<span class="text-xs font-normal text-muted-foreground ml-0.5"
                  >t/s</span
                >
              </div>
            </div>
            <div
              class="bg-card rounded-lg ring-1 ring-foreground/10 px-3.5 py-2.5"
            >
              <div class="text-[11px] text-muted-foreground">
                {{ t("dashboard.stats.cacheHitRate") }}
              </div>
              <div class="font-mono text-lg font-semibold leading-none mt-0.5">
                {{ cacheHitRate.toFixed(1)
                }}<span class="text-xs font-normal text-muted-foreground ml-0.5"
                  >%</span
                >
              </div>
            </div>
          </div>
          <!-- Inline tertiary metrics -->
          <div class="flex gap-4 px-0.5">
            <span class="text-[11px] text-muted-foreground">
              {{ t("dashboard.stats.totalRequests") }}
              <span class="font-mono text-[13px] font-medium text-foreground">{{
                stats.totalRequests.toLocaleString()
              }}</span>
            </span>
            <span class="text-[11px] text-muted-foreground">
              {{ t("dashboard.stats.successRate") }}
              <span class="font-mono text-[13px] font-medium text-foreground"
                >{{ (stats.successRate * 100).toFixed(1) }}%</span
              >
            </span>
            <span class="text-[11px] text-muted-foreground">
              {{ t("dashboard.window.label") }}
              <span class="font-mono text-[13px] font-medium text-foreground">{{
                windowTimeRange
              }}</span>
            </span>
          </div>
        </div>

        <!-- Right: Token Throughput stacked area chart -->
        <div
          class="bg-card rounded-lg ring-1 ring-foreground/10 p-3.5 flex flex-col"
        >
          <div class="text-xs font-medium text-muted-foreground mb-2">
            {{ t("dashboard.charts.tokenThroughput") }}
          </div>
          <div class="flex-1 min-h-[180px]">
            <Line
              v-if="tokenThroughputChartData"
              :data="tokenThroughputChartData"
              :options="stackedAreaOpts"
            />
            <div
              v-else
              class="flex items-center justify-center h-full text-muted-foreground text-sm"
            >
              {{ t("common.noData") }}
            </div>
          </div>
        </div>
      </div>

      <!-- Zone 3: Secondary charts (TPS + Cache Hit) -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        <div class="bg-card rounded-lg ring-1 ring-foreground/10 p-3">
          <div class="text-xs font-medium text-muted-foreground mb-1.5">
            {{ t("dashboard.charts.tps") }}
          </div>
          <div class="h-[140px]">
            <Line
              v-if="tpsChartData"
              :data="tpsChartData"
              :options="chartOpts(tpsChartData.labels as string[])"
            />
            <div
              v-else
              class="flex items-center justify-center h-full text-muted-foreground text-sm"
            >
              {{ t("common.noData") }}
            </div>
          </div>
        </div>
        <div class="bg-card rounded-lg ring-1 ring-foreground/10 p-3">
          <div class="text-xs font-medium text-muted-foreground mb-1.5">
            {{ t("dashboard.charts.cacheHit") }}
          </div>
          <div class="h-[140px]">
            <Line
              v-if="cacheHitChartData"
              :data="cacheHitChartData"
              :options="chartOpts(cacheHitChartData.labels as string[])"
            />
            <div
              v-else
              class="flex items-center justify-center h-full text-muted-foreground text-sm"
            >
              {{ t("common.noData") }}
            </div>
          </div>
        </div>
      </div>

      <!-- Zone 4: Timeline window navigator -->
      <div class="bg-card rounded-lg ring-1 ring-foreground/10 px-4 py-2.5">
        <div class="flex items-center justify-between mb-1.5">
          <div class="flex items-center gap-3">
            <span class="font-mono text-xs font-medium text-foreground">{{
              windowTimeRange
            }}</span>
            <div class="flex gap-0.5">
              <Button
                v-for="opt in timelineZoomOptions"
                :key="opt.value"
                :variant="timelineRange === opt.value ? 'secondary' : 'ghost'"
                size="sm"
                class="h-5 px-1.5 text-[10px] font-mono"
                @click="timelineRange = opt.value"
              >
                {{ opt.label }}
              </Button>
            </div>
          </div>
          <span class="text-[11px] text-muted-foreground/60">{{
            t("dashboard.timeline.hint")
          }}</span>
        </div>
        <TooltipProvider v-if="usageWindows.length > 0">
          <div
            class="relative h-7 rounded overflow-hidden border border-border/50 bg-muted/20"
          >
            <div
              v-for="w in timelineWindows"
              :key="w.window.id"
              class="absolute top-0 bottom-0 rounded-sm cursor-pointer transition-[filter] duration-150 hover:brightness-125"
              :class="
                selectedWindowId === w.window.id
                  ? 'ring-2 ring-primary ring-inset brightness-130 z-[2]'
                  : ''
              "
              :style="getWindowStyle(w)"
              @click="selectedWindowId = w.window.id"
            >
              <Tooltip v-if="getWindowWidth(w) !== '0%'">
                <TooltipTrigger as-child>
                  <div class="w-full h-full" />
                </TooltipTrigger>
                <TooltipContent>
                  {{ formatWindowTooltip(w) }}
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </TooltipProvider>
        <div
          v-if="usageWindows.length === 0"
          class="h-7 flex items-center justify-center text-[11px] text-muted-foreground"
        >
          {{ t("dashboard.timeline.noData") }}
        </div>
        <!-- Day labels -->
        <div
          v-if="usageWindows.length > 0"
          class="relative h-4 mt-1 overflow-hidden"
        >
          <span
            v-for="d in timelineDayLabels"
            :key="d.label"
            class="absolute font-mono text-[10px] text-muted-foreground/50"
            :class="d.position === 0 ? '' : '-translate-x-1/2'"
            :style="{ left: d.position + '%' }"
          >
            {{ d.label }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip as ChartTooltip,
  Legend,
  Filler,
} from "chart.js";
import { Line } from "vue-chartjs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Filter } from "lucide-vue-next";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { lineOptions, stackedAreaOptions } from "./metrics-helpers";
import { useDashboard } from "@/composables/useDashboard";
import { formatTokenCompact } from "@/utils/token-format";
import type { UsageWindowWithUsage } from "@/api/client";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ChartTooltip,
  Legend,
  Filler,
);

const {
  providers,
  selectedProvider,
  sortedProviders,
  providerTokenLabels,
  usageWindows,
  selectedWindowId,
  modelFilter,
  keyFilter,
  clientType,
  modelOptions,
  keyOptions,
  stats,
  loading,
  loadError,
  cacheHitRate,
  tpsChartData,
  tokenThroughputChartData,
  inputTokensChartData,
  deltaValues,
  windowTimeRange,
  timelineWindows,
  timelineRange,
  retry,
} = useDashboard();

const { t } = useI18n();

// --- Filter active count ---
const activeFilterCount = computed(() => {
  let count = 0;
  if (modelFilter.value !== "all") count++;
  if (keyFilter.value !== "all") count++;
  if (clientType.value !== "all") count++;
  return count;
});

// --- Stacked area chart options ---
const stackedAreaOpts = computed(() => {
  if (!tokenThroughputChartData.value) return {};
  return stackedAreaOptions(tokenThroughputChartData.value.labels as string[]);
});

// --- Secondary chart options ---
function chartOpts(labels: string[]) {
  return lineOptions("", labels);
}

// --- Cache hit chart: reuse inputTokensChartData as a placeholder (no dedicated cache timeseries) ---
const cacheHitChartData = computed(() => inputTokensChartData.value);

// --- Timeline zoom options ---
const timelineZoomOptions = [
  { value: "24h" as const, label: "24h" },
  { value: "3d" as const, label: "3d" },
  { value: "7d" as const, label: "7d" },
];

// --- Timeline constants ---
const MS_PER_HOUR = 3600000;
const HOURS_PER_DAY = 24;
const DAY_MS = HOURS_PER_DAY * MS_PER_HOUR;
const DAYS_3 = 3;
const DAYS_7 = 7;
const PERCENT = 100;
const PAD_WIDTH = 2;

// Timeline duration based on current zoom level
const timelineDurationMs = computed(() => {
  const durations: Record<string, number> = {
    "24h": HOURS_PER_DAY * MS_PER_HOUR,
    "3d": DAYS_3 * DAY_MS,
    "7d": DAYS_7 * DAY_MS,
  };
  return durations[timelineRange.value] ?? durations["24h"];
});
const timelineDurationHours = computed(() =>
  Math.round(timelineDurationMs.value / MS_PER_HOUR),
);

// Intensity thresholds (output tokens)
const INTENSITY_T4 = 3000000;
const INTENSITY_T3 = 1500000;
const INTENSITY_T2 = 500000;

const timelineStart = computed(() => {
  const now = new Date();
  return new Date(now.getTime() - timelineDurationMs.value);
});

function getWindowLeft(w: UsageWindowWithUsage): string {
  if (!timelineStart.value) return "0%";
  const start = Math.max(
    new Date(w.window.start_time).getTime(),
    timelineStart.value.getTime(),
  );
  const offset = start - timelineStart.value.getTime();
  const pct = Math.min((offset / timelineDurationMs.value) * PERCENT, PERCENT);
  return pct + "%";
}

function getWindowWidth(w: UsageWindowWithUsage): string {
  if (!timelineStart.value) return "0%";
  const wStart = new Date(w.window.start_time).getTime();
  const wEnd = new Date(w.window.end_time).getTime();
  // Clip to visible range
  const visStart = Math.max(wStart, timelineStart.value.getTime());
  const now = new Date().getTime();
  const visEnd = Math.min(wEnd, now);
  if (visEnd <= visStart) return "0%";
  const pct = ((visEnd - visStart) / timelineDurationMs.value) * PERCENT;
  return Math.min(pct, PERCENT) + "%";
}

function getWindowStyle(w: UsageWindowWithUsage): Record<string, string> {
  const outputTokens = w.usage.total_output_tokens;
  let bg: string;
  if (outputTokens >= INTENSITY_T4) bg = "oklch(0.48 0.10 175)";
  else if (outputTokens >= INTENSITY_T3) bg = "oklch(0.40 0.07 175)";
  else if (outputTokens >= INTENSITY_T2) bg = "oklch(0.33 0.04 175)";
  else bg = "oklch(0.28 0.02 175)";
  return {
    left: getWindowLeft(w),
    width: getWindowWidth(w),
    backgroundColor: bg,
  };
}

function formatWindowTooltip(w: UsageWindowWithUsage): string {
  const start = new Date(w.window.start_time);
  const end = new Date(w.window.end_time);
  const pad = (n: number) => n.toString().padStart(PAD_WIDTH, "0");
  const startStr = `${pad(start.getMonth() + 1)}/${pad(start.getDate())} ${pad(start.getHours())}:${pad(start.getMinutes())}`;
  const endStr = `${pad(end.getHours())}:${pad(end.getMinutes())}`;
  return `${startStr}-${endStr} | ${formatTokenCompact(w.usage.total_output_tokens)} out`;
}

const timelineDayLabels = computed(() => {
  if (!timelineStart.value) return [];
  const labels: { label: string; position: number }[] = [];
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const totalDays = Math.ceil(timelineDurationHours.value / HOURS_PER_DAY);
  for (let d = 0; d < totalDays; d++) {
    const dayStart = new Date(timelineStart.value.getTime() + d * DAY_MS);
    labels.push({
      label: `${weekdays[dayStart.getDay()]} ${dayStart.getMonth() + 1}/${dayStart.getDate()}`,
      position: ((d * HOURS_PER_DAY) / timelineDurationHours.value) * PERCENT,
    });
  }
  return labels;
});
</script>
