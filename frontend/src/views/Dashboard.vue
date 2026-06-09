<template>
  <div class="page">
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
      <!-- Time Range Selector -->
      <TimeRangeSelector
        :time-range-label="timeRangeLabel"
        :active-range="activeRange"
        :show-custom="showCustom"
        :custom-start-date="customStartDate"
        :custom-end-date="customEndDate"
        :custom-error="customError"
        :select-quick-range="selectQuickRange"
        :toggle-custom="toggleCustom"
        :apply-custom="applyCustom"
        @update:custom-start-date="customStartDate = $event"
        @update:custom-end-date="customEndDate = $event"
      />

      <!-- Zone 2: Metrics + Primary Chart -->
      <div class="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-4 mb-4">
        <!-- Left: metric cards -->
        <div class="flex flex-col gap-4">
          <!-- Input Token (large) -->
          <div class="bg-card rounded-lg px-5 py-4">
            <div class="text-xs text-muted-foreground">
              {{ t("dashboard.stats.inputTokens") }}
            </div>
            <div
              class="font-mono text-[32px] font-bold leading-none mt-1 text-teal"
            >
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
          <div class="bg-card rounded-lg px-5 py-4">
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
          <div class="grid grid-cols-2 gap-3">
            <div class="bg-card rounded-lg px-3.5 py-2.5">
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
            <div class="bg-card rounded-lg px-3.5 py-2.5">
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
              <span class="font-mono text-[13px] font-medium text-foreground">{{
                stats.successRate !== null
                  ? (stats.successRate * 100).toFixed(1) + "%"
                  : "--"
              }}</span>
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
        <div class="bg-card rounded-lg p-3.5 flex flex-col">
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

      <!-- Zone 3: TPS chart -->
      <div class="grid grid-cols-1 gap-4 mb-4">
        <div class="bg-card rounded-lg p-3">
          <div class="text-xs font-medium text-muted-foreground mb-1.5">
            {{ t("dashboard.charts.tps") }}
          </div>
          <div class="h-[140px]">
            <Line
              v-if="tpsChartData"
              :data="tpsChartData"
              :options="miniChartOpts(tpsChartData.labels as string[])"
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
import { Filter } from "@lucide/vue";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { stackedAreaOptions, miniLineOptions } from "./metrics-helpers";
import { useDashboard } from "@/composables/useDashboard";
import { formatTokenCompact } from "@/utils/token-format";
import TimeRangeSelector from "@/components/dashboard/TimeRangeSelector.vue";

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
  deltaValues,
  windowTimeRange,
  activeRange,
  timeRangeLabel,
  showCustom,
  customStartDate,
  customEndDate,
  customError,
  selectQuickRange,
  toggleCustom,
  applyCustom,
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
function miniChartOpts(labels: string[]) {
  return miniLineOptions(labels);
}
</script>
