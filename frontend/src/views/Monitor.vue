<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="page">
    <!-- Page Header -->
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-base font-semibold text-foreground">
        {{ t("monitor.title") }}
      </h2>
      <Badge :variant="connected ? 'default' : 'destructive'">
        {{ connected ? t("monitor.connected") : t("monitor.disconnected") }}
      </Badge>
    </div>

    <!-- Primary Strip: Active count + Provider concurrency -->
    <MonitorHeader
      :stats="stats"
      :active-count="activeRequests.length"
      :stream-count="streamCount"
      :queued-count="queuedRequests.length"
      :concurrency="concurrency"
    />

    <!-- Request Panel with Tabs -->
    <div class="bg-card border border-border rounded-lg overflow-hidden mb-3">
      <!-- Tab bar -->
      <div
        class="flex items-center border-b border-border px-3 bg-muted/30 dark:bg-muted/50"
      >
        <Button
          v-for="tab in requestTabs"
          :key="tab.key"
          variant="ghost"
          class="relative px-3.5 py-2 text-[13px] font-medium transition-colors flex items-center gap-2 h-auto rounded-none"
          :class="
            activeTab === tab.key
              ? 'text-primary'
              : 'text-muted-foreground hover:text-foreground'
          "
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
          <span
            class="font-mono text-[11px] font-semibold px-1.5 py-px rounded-full"
            :class="
              activeTab === tab.key
                ? 'bg-primary/15 text-primary'
                : 'bg-foreground/5 text-muted-foreground'
            "
          >
            {{ tab.count }}
          </span>
          <span
            v-if="activeTab === tab.key"
            class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-sm"
          />
        </Button>
      </div>

      <!-- Table content -->
      <ScrollArea class="h-[252px]">
        <Table>
          <TableHeader>
            <TableRow class="border-b-0 hover:bg-transparent">
              <TableHead
                class="w-9 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-1.5 px-3"
              />
              <TableHead
                class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-1.5 px-3"
                >Model</TableHead
              >
              <TableHead
                class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-1.5 px-3"
                >Provider</TableHead
              >
              <TableHead
                class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-1.5 px-3 w-16"
                >Type</TableHead
              >
              <TableHead
                class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-1.5 px-3 text-right w-20"
                >Elapsed</TableHead
              >
              <TableHead
                class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-1.5 px-3 text-right w-20"
                >Speed</TableHead
              >
              <TableHead
                class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-1.5 px-3 text-right w-20"
                >Output</TableHead
              >
              <TableHead
                class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider py-1.5 px-3 w-14"
              />
            </TableRow>
          </TableHeader>
          <TableBody>
            <template v-if="currentRequests.length === 0">
              <TableRow class="border-b-0 h-[220px]">
                <TableCell
                  colspan="8"
                  class="text-center text-[13px] text-muted-foreground align-middle"
                >
                  {{ emptyMessage }}
                </TableCell>
              </TableRow>
            </template>
            <template v-for="req in currentRequests" :key="req.id">
              <TableRow
                class="cursor-pointer transition-colors border-b border-foreground/[0.04] hover:bg-muted/40"
                :class="[
                  selectedRequestId === req.id ? 'bg-primary/10' : '',
                  activeTab === 'recent' ? 'opacity-60 hover:opacity-80' : '',
                ]"
                @click="selectRequest(req.id)"
              >
                <!-- Status dot -->
                <TableCell class="px-3 py-1">
                  <span
                    class="inline-block size-2 rounded-full shrink-0"
                    :class="statusDotClass(req)"
                  />
                </TableCell>
                <TableCell
                  class="px-3 py-1 text-[13px] font-medium truncate max-w-[200px]"
                >
                  {{ req.model }}
                </TableCell>
                <TableCell
                  class="px-3 py-1 font-mono text-[11px] text-muted-foreground"
                >
                  {{ req.providerName }}
                </TableCell>
                <TableCell class="px-3 py-1">
                  <span
                    v-if="req.isStream"
                    class="inline-flex items-center px-1.5 py-px rounded-full font-mono text-[10px] font-semibold bg-primary/15 text-primary"
                  >
                    SSE
                  </span>
                  <span
                    v-else
                    class="inline-flex items-center px-1.5 py-px rounded-full font-mono text-[10px] font-semibold bg-foreground/5 text-muted-foreground"
                  >
                    Sync
                  </span>
                </TableCell>
                <TableCell
                  class="px-3 py-1 text-right font-mono text-[12px] text-muted-foreground"
                >
                  {{ rowElapsed(req) }}
                </TableCell>
                <TableCell
                  class="px-3 py-1 text-right font-mono text-[12px] text-muted-foreground"
                >
                  {{ rowTps(req) }}
                </TableCell>
                <TableCell
                  class="px-3 py-1 text-right font-mono text-[12px] text-muted-foreground"
                >
                  {{ rowOutputTokens(req) }}
                </TableCell>
                <TableCell class="px-3 py-1">
                  <div
                    class="flex items-center gap-0.5 justify-end"
                    @click.stop
                  >
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          class="shrink-0 h-6 w-6"
                          @click.stop="copyId(req.id)"
                        >
                          <CheckIcon
                            v-if="copiedId === req.id"
                            class="size-3 text-success"
                          />
                          <CopyIcon v-else class="size-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{{ t("monitor.copyId") }}</TooltipContent>
                    </Tooltip>
                    <Tooltip v-if="isKillable(req)">
                      <TooltipTrigger as-child>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          class="shrink-0 h-6 w-6 text-destructive hover:text-destructive"
                          @click.stop="openKillDialog(req.id)"
                        >
                          <XIcon class="size-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{{ t("monitor.kill") }}</TooltipContent>
                    </Tooltip>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      class="shrink-0 h-6 w-6"
                      @click.stop="toggleRowExpand(req.id)"
                    >
                      <ChevronDownIcon
                        class="size-3 transition-transform"
                        :class="{ 'rotate-180': expandedRowId === req.id }"
                      />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>

              <!-- Expanded detail row -->
              <TableRow
                v-if="expandedRowId === req.id"
                class="border-b border-foreground/[0.04] bg-foreground/[0.02]"
              >
                <TableCell colspan="8" class="px-3 py-2">
                  <div
                    class="bg-foreground/[0.03] rounded-md px-4 py-2 grid grid-cols-4 gap-x-6 gap-y-1.5"
                  >
                    <div>
                      <div
                        class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider"
                      >
                        Request ID
                      </div>
                      <div class="font-mono text-[12px] text-foreground">
                        {{ req.id }}
                      </div>
                    </div>
                    <div>
                      <div
                        class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider"
                      >
                        Input Tokens
                      </div>
                      <div class="font-mono text-[12px] text-foreground">
                        {{
                          req.streamMetrics?.inputTokens?.toLocaleString() ??
                          "--"
                        }}
                      </div>
                    </div>
                    <div>
                      <div
                        class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider"
                      >
                        Output Tokens
                      </div>
                      <div class="font-mono text-[12px] text-foreground">
                        {{
                          req.streamMetrics?.outputTokens?.toLocaleString() ??
                          "--"
                        }}
                      </div>
                    </div>
                    <div>
                      <div
                        class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider"
                      >
                        Cache Tokens
                      </div>
                      <div class="font-mono text-[12px] text-foreground">
                        {{
                          req.streamMetrics?.cacheReadTokens?.toLocaleString() ??
                          "--"
                        }}
                      </div>
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            </template>
          </TableBody>
        </Table>
      </ScrollArea>
    </div>

    <!-- Secondary Strip -->
    <div
      class="flex bg-card border border-border rounded-lg overflow-hidden mb-3 divide-x divide-border"
    >
      <div class="flex-1 px-3 py-2">
        <div
          class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider"
        >
          {{ t("monitor.completed") }}
        </div>
        <div class="text-[13px] font-mono font-semibold text-success">
          {{ stats?.successCount ?? 0 }}
        </div>
        <div class="text-[10px] font-mono text-muted-foreground">last 5h</div>
      </div>
      <div class="flex-1 px-3 py-2">
        <div
          class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider"
        >
          {{ t("monitor.header.errorRate") }}
        </div>
        <div
          class="text-[13px] font-mono font-semibold"
          :class="errorRateClass"
        >
          {{ errorRate }}%
        </div>
        <div class="text-[10px] font-mono text-muted-foreground">
          {{ stats?.errorCount ?? 0 }} / {{ stats?.totalRequests ?? 0 }}
        </div>
      </div>
      <div class="flex-1 px-3 py-2">
        <div
          class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider"
        >
          {{ t("monitor.header.p50Latency") }}
        </div>
        <div class="text-[13px] font-mono font-semibold text-foreground">
          {{ p50Latency }}ms
        </div>
        <div class="text-[10px] font-mono text-muted-foreground">
          avg {{ stats?.avgLatencyMs?.toFixed(1) ?? "--" }}s
        </div>
      </div>
      <div class="flex-1 px-3 py-2">
        <div
          class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider"
        >
          {{ t("monitor.header.retryRate") }}
        </div>
        <div class="text-[13px] font-mono font-semibold text-foreground">
          {{ retryRate }}%
        </div>
        <div class="text-[10px] font-mono text-muted-foreground">
          {{ stats?.retryCount ?? 0 }} / {{ stats?.totalRequests ?? 0 }}
        </div>
      </div>
      <div class="flex-1 px-3 py-2">
        <div
          class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider"
        >
          {{ t("monitor.runtimePanel.uptime") }}
        </div>
        <div class="text-[13px] font-mono font-semibold text-foreground">
          {{ uptimeText }}
        </div>
        <div class="text-[10px] font-mono text-muted-foreground">
          {{ uptimeSinceText }}
        </div>
      </div>
    </div>

    <!-- Provider Stats (collapsible) -->
    <div class="mb-3">
      <Collapsible v-model:open="providerStatsOpen">
        <div
          class="flex items-center justify-between bg-card border border-border rounded-t-lg px-4 py-1.5"
        >
          <span
            class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider"
            >{{ t("monitor.providerStats") }}</span
          >
          <CollapsibleTrigger as-child>
            <Button
              variant="ghost"
              size="xs"
              class="text-[11px] text-muted-foreground hover:text-foreground h-6 px-1.5"
            >
              {{
                providerStatsOpen
                  ? t("monitor.providerStatsHide")
                  : t("monitor.providerStatsShow")
              }}
            </Button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <div
            class="bg-card border border-border border-t-0 rounded-b-lg px-4 py-3"
          >
            <ProviderStatsTable :stats="stats" />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>

    <!-- Bottom Grid -->
    <div
      class="grid grid-cols-3 gap-px bg-border rounded-lg overflow-hidden border border-border"
    >
      <div class="bg-card">
        <div
          class="flex items-center px-3 py-1.5 border-b border-border bg-muted/30 dark:bg-muted/50"
        >
          <span
            class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider"
            >{{ t("monitor.statusCodeDistribution") }}</span
          >
        </div>
        <div class="p-3">
          <StatusCodePanel :by-status-code="stats?.byStatusCode ?? {}" />
        </div>
      </div>
      <div class="bg-card">
        <div
          class="flex items-center px-3 py-1.5 border-b border-border bg-muted/30 dark:bg-muted/50"
        >
          <span
            class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider"
            >{{ t("monitor.runtime") }}</span
          >
        </div>
        <div class="p-3">
          <RuntimePanel :runtime="runtime" />
        </div>
      </div>
      <!-- Global Concurrency (compact summary) -->
      <div class="bg-card">
        <div
          class="flex items-center px-3 py-1.5 border-b border-border bg-muted/30 dark:bg-muted/50"
        >
          <span
            class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider"
            >{{ t("monitor.concurrency") }}</span
          >
        </div>
        <div class="p-3">
          <div class="flex items-baseline gap-1.5 mb-2">
            <span class="text-xl font-mono font-bold text-primary">{{
              globalConcurrency.active
            }}</span>
            <span class="text-xs font-mono text-muted-foreground"
              >/ {{ globalConcurrency.total }}</span
            >
            <span class="text-xs font-mono text-muted-foreground ml-auto"
              >{{ globalConcurrency.pct }}%</span
            >
          </div>
          <div class="h-1 bg-foreground/10 rounded-full overflow-hidden mb-3">
            <div
              class="h-full rounded-full transition-all duration-300"
              :class="globalConcurrencyBarClass"
              :style="{ width: `${Math.min(100, globalConcurrency.pct)}%` }"
            />
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div>
              <div
                class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider"
              >
                P99
              </div>
              <div class="text-xs font-mono text-warning">
                {{ p99Latency }}ms
              </div>
            </div>
            <div>
              <div
                class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider"
              >
                QPS
              </div>
              <div class="text-xs font-mono text-primary">{{ qps }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Unified Request Detail Dialog -->
    <UnifiedRequestDialog
      v-model:open="requestDetailOpen"
      source="realtime"
      :request="selectedRequest"
      :stream-content="selectedStreamContent"
      :log-detail-data="logDetailData"
    />

    <!-- Kill Confirmation Dialog -->
    <AlertDialog v-model:open="killDialogOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{
            t("monitor.killConfirmTitle")
          }}</AlertDialogTitle>
          <AlertDialogDescription v-if="killTarget">
            {{
              t("monitor.killConfirm", {
                model: killTarget.model,
                provider: killTarget.providerName,
              })
            }}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t("monitor.killCancel") }}</AlertDialogCancel>
          <AlertDialogAction
            class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            @click="executeKill"
          >
            {{ t("monitor.kill") }}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CheckIcon, ChevronDownIcon, CopyIcon, XIcon } from "lucide-vue-next";
import { api, getApiMessage } from "@/api/client";
import { toast } from "vue-sonner";
import MonitorHeader from "@/components/monitor/MonitorHeader.vue";
import RuntimePanel from "@/components/monitor/RuntimePanel.vue";
import StatusCodePanel from "@/components/monitor/StatusCodePanel.vue";
import ProviderStatsTable from "@/components/monitor/ProviderStatsTable.vue";
import UnifiedRequestDialog from "@/components/request-detail/UnifiedRequestDialog.vue";
import { useMonitorSSE } from "@/composables/useMonitorSSE";
import { useMonitorData } from "@/composables/useMonitorData";
import { useClipboard } from "@/composables/useClipboard";
import type { ActiveRequest } from "@/types/monitor";

const { t } = useI18n();

// --- Data layer ---
const {
  activeRequests,
  recentCompleted,
  stats,
  concurrency,
  runtime,
  connected,
  streamCount,
  streamingRequests,
  queuedRequests,
  selectedRequestId,
  selectedRequest,
  requestDetailOpen,
  selectRequest,
  selectedStreamContent,
  logDetailData,
  handleSSEMessage,
  handleSSEOpen,
  handleSSEClose,
  loadInitialData,
} = useMonitorData();

// --- SSE lifecycle ---
const { connect } = useMonitorSSE(
  "/admin/api/monitor/stream",
  {
    request_start: handleSSEMessage,
    request_update: handleSSEMessage,
    request_complete: handleSSEMessage,
    concurrency_update: handleSSEMessage,
    stats_update: handleSSEMessage,
    runtime_update: handleSSEMessage,
    stream_content_update: handleSSEMessage,
  },
  { onOpen: handleSSEOpen, onClose: handleSSEClose },
);

// --- Tab state ---
type RequestTab = "active" | "queued" | "recent";
const activeTab = ref<RequestTab>("active");

const requestTabs = computed(() => [
  {
    key: "active" as RequestTab,
    label: t("monitor.activeRequests"),
    count: streamingRequests.value.length,
  },
  {
    key: "queued" as RequestTab,
    label: t("monitor.queuedRequests"),
    count: queuedRequests.value.length,
  },
  {
    key: "recent" as RequestTab,
    label: t("monitor.completed"),
    count: recentCompleted.value.length,
  },
]);

const TAB_DATA: Record<RequestTab, () => ActiveRequest[]> = {
  active: () => streamingRequests.value,
  queued: () => queuedRequests.value,
  recent: () => recentCompleted.value,
};

const TAB_EMPTY: Record<RequestTab, string> = {
  active: t("monitor.noActiveRequests"),
  queued: t("monitor.noQueuedRequests"),
  recent: t("monitor.noCompletedRequests"),
};

const currentRequests = computed(() => TAB_DATA[activeTab.value]());
const emptyMessage = computed(() => TAB_EMPTY[activeTab.value]);

// --- Row expand ---
const expandedRowId = ref<string | null>(null);

function toggleRowExpand(id: string) {
  expandedRowId.value = expandedRowId.value === id ? null : id;
}

// --- Clipboard ---
const { copy } = useClipboard();
const copiedId = ref<string | null>(null);
const COPY_FEEDBACK_MS = 2000;

function copyId(id: string) {
  copy(id);
  copiedId.value = id;
  setTimeout(() => {
    if (copiedId.value === id) copiedId.value = null;
  }, COPY_FEEDBACK_MS);
}

// --- Kill request ---
const killDialogOpen = ref(false);
const killTargetId = ref<string | null>(null);
const killTarget = computed(() => {
  if (!killTargetId.value) return null;
  return activeRequests.value.find((r) => r.id === killTargetId.value) ?? null;
});

function openKillDialog(id: string) {
  killTargetId.value = id;
  killDialogOpen.value = true;
}

async function executeKill() {
  if (!killTargetId.value) return;
  try {
    await api.killMonitorRequest(killTargetId.value);
    activeRequests.value = activeRequests.value.filter(
      (r) => r.id !== killTargetId.value,
    );
    toast.success(t("monitor.killSuccess"));
  } catch (e: unknown) {
    console.error("Monitor.killRequest:", e);
    toast.error(getApiMessage(e, t("monitor.killFailed")));
  }
  killDialogOpen.value = false;
}

// --- Provider stats collapsible ---
const providerStatsOpen = ref(true);

// --- Secondary strip computed ---
const MS_PER_SECOND = 1000;
const PERCENT_MULTIPLIER = 100;
const ERROR_RATE_WARNING_THRESHOLD = 5;
const ERROR_RATE_DANGER_THRESHOLD = 10;

const errorRate = computed(() => {
  if (!stats.value || stats.value.totalRequests === 0) return "0.0";
  return (
    (stats.value.errorCount / stats.value.totalRequests) *
    PERCENT_MULTIPLIER
  ).toFixed(1);
});

const errorRateClass = computed(() => {
  const rate = Number.parseFloat(errorRate.value);
  if (rate >= ERROR_RATE_DANGER_THRESHOLD) return "text-danger";
  if (rate >= ERROR_RATE_WARNING_THRESHOLD) return "text-warning";
  return "text-foreground";
});

const retryRate = computed(() => {
  if (!stats.value || stats.value.totalRequests === 0) return "0.0";
  return (
    (stats.value.retryCount / stats.value.totalRequests) *
    PERCENT_MULTIPLIER
  ).toFixed(1);
});

const p50Latency = computed(() => {
  if (!stats.value) return "--";
  return stats.value.p50LatencyMs.toFixed(0);
});

const p99Latency = computed(() => {
  if (!stats.value) return "--";
  return stats.value.p99LatencyMs.toFixed(0);
});

const qps = computed(() => {
  if (!stats.value || !runtime.value || runtime.value.uptimeMs === 0)
    return "--";
  const uptimeSec = runtime.value.uptimeMs / MS_PER_SECOND;
  return (stats.value.totalRequests / uptimeSec).toFixed(1);
});

const PERCENT_BASE = 100;
const CONCURRENCY_PCT_DANGER = 80;
const CONCURRENCY_PCT_WARNING = 50;

const globalConcurrency = computed(() => {
  const active = concurrency.value.reduce((sum, p) => sum + p.active, 0);
  const total = concurrency.value.reduce(
    (sum, p) => sum + (p.adaptiveLimit ?? p.maxConcurrency),
    0,
  );
  const pct = total > 0 ? Math.round((active / total) * PERCENT_BASE) : 0;
  return { active, total, pct };
});

const globalConcurrencyBarClass = computed(() => {
  const pct = globalConcurrency.value.pct;
  if (pct >= CONCURRENCY_PCT_DANGER) return "bg-danger";
  if (pct >= CONCURRENCY_PCT_WARNING) return "bg-warning";
  return "bg-primary";
});

const uptimeText = computed(() => {
  if (!runtime.value) return "--";
  return formatUptime(runtime.value.uptimeMs);
});

const uptimeSinceText = computed(() => {
  if (!runtime.value || !stats.value) return "--";
  return `${stats.value.totalRequests} req`;
});

const MS_PER_HOUR = 3_600_000;
const MS_PER_MINUTE = 60_000;
const DAY_MS = 86_400_000;

function formatUptime(ms: number): string {
  const days = Math.floor(ms / DAY_MS);
  const hours = Math.floor((ms % DAY_MS) / MS_PER_HOUR);
  const minutes = Math.floor((ms % MS_PER_HOUR) / MS_PER_MINUTE);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// --- Elapsed / row helpers ---
const NOW_TICK_INTERVAL = 3000;
const now = ref(Date.now());
let tickTimer: ReturnType<typeof setInterval> | null = null;

function startTick() {
  stopTick();
  tickTimer = setInterval(() => {
    now.value = Date.now();
  }, NOW_TICK_INTERVAL);
}

function stopTick() {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

function handleMonitorVisibility() {
  if (document.hidden) {
    stopTick();
  } else {
    now.value = Date.now();
    startTick();
  }
}

function rowElapsed(req: ActiveRequest): string {
  const end = req.completedAt ?? now.value;
  return `${((end - req.startTime) / MS_PER_SECOND).toFixed(1)}s`;
}

function rowTps(req: ActiveRequest): string {
  const tps = req.streamMetrics?.tokensPerSecond;
  if (tps == null) return "--";
  return `${tps.toFixed(0)} t/s`;
}

function rowOutputTokens(req: ActiveRequest): string {
  const tok = req.streamMetrics?.outputTokens;
  if (tok == null) return "--";
  return `${tok}`;
}

function statusDotClass(req: ActiveRequest): string {
  if (req.status === "failed") return "bg-danger";
  if (req.queued) return "bg-warning";
  if (req.status === "completed") return "bg-success";
  return "bg-primary";
}

function isKillable(req: ActiveRequest): boolean {
  return req.status === "pending";
}

// --- Lifecycle ---
onMounted(async () => {
  await loadInitialData();
  connect();
  startTick();
  document.addEventListener("visibilitychange", handleMonitorVisibility);
});

onUnmounted(() => {
  stopTick();
  document.removeEventListener("visibilitychange", handleMonitorVisibility);
});
</script>
