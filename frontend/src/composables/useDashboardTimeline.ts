import { ref, computed } from "vue";
import type { Ref } from "vue";
import { api, getApiMessage, type UsageWindowWithUsage } from "@/api/client";
import { toast } from "vue-sonner";
import { formatTokenCompact } from "@/utils/token-format";
import { formatTimeShort } from "@/utils/format";
import { TIMELINE_INTENSITY_COLORS } from "@/styles/design-tokens";

export type TimelineRange = "24h" | "3d" | "7d";

export interface DashboardTimelineInput {
  selectedProvider: Ref<string>;
  t: (key: string) => string;
}

// --- Constants ---

const HOURS_PER_DAY = 24;
const MS_PER_HOUR = 3600_000;
const DAY_MS = HOURS_PER_DAY * MS_PER_HOUR;
const DAYS_3 = 3;
const DAYS_7 = 7;
const PERCENT = 100;
const PAD_WIDTH = 2;
const MERGE_GAP_MS = 60000;

const INTENSITY_T4 = 3000000;
const INTENSITY_T3 = 1500000;
const INTENSITY_T2 = 500000;

const TIMELINE_DURATIONS: Record<TimelineRange, number> = {
  "24h": HOURS_PER_DAY * MS_PER_HOUR,
  "3d": DAYS_3 * HOURS_PER_DAY * MS_PER_HOUR,
  "7d": DAYS_7 * HOURS_PER_DAY * MS_PER_HOUR,
};

// --- Helpers ---

function toDateTimeStr(d: Date): string {
  const pad = (n: number) => n.toString().padStart(PAD_WIDTH, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function getTimelineTimeRange(range: TimelineRange): {
  start_time: string;
  end_time: string;
} {
  const now = new Date();
  const start = new Date(now.getTime() - TIMELINE_DURATIONS[range]);
  return {
    start_time: toDateTimeStr(start),
    end_time: toDateTimeStr(now),
  };
}

/** 将同一 provider 的重叠/相邻窗口合并为一个 block，聚合 usage */
function mergeTimelineWindows(
  windows: UsageWindowWithUsage[],
): UsageWindowWithUsage[] {
  const sorted = [...windows].sort(
    (a, b) =>
      new Date(a.window.start_time).getTime() -
      new Date(b.window.start_time).getTime(),
  );
  const merged: UsageWindowWithUsage[] = [];
  for (const w of sorted) {
    const prev = merged[merged.length - 1];
    const wStart = new Date(w.window.start_time).getTime();
    const prevEnd = prev ? new Date(prev.window.end_time).getTime() : -Infinity;
    if (
      prev &&
      prev.window.provider_id === w.window.provider_id &&
      wStart <= prevEnd + MERGE_GAP_MS
    ) {
      if (new Date(w.window.end_time).getTime() > prevEnd) {
        prev.window = { ...prev.window, end_time: w.window.end_time };
      }
      prev.usage = {
        request_count: prev.usage.request_count + w.usage.request_count,
        total_input_tokens:
          prev.usage.total_input_tokens + w.usage.total_input_tokens,
        total_output_tokens:
          prev.usage.total_output_tokens + w.usage.total_output_tokens,
      };
    } else {
      merged.push({ window: { ...w.window }, usage: { ...w.usage } });
    }
  }
  return merged;
}

// --- Composable ---

export function useDashboardTimeline({
  selectedProvider,
  t,
}: DashboardTimelineInput) {
  const timelineRange = ref<TimelineRange>("24h");
  const usageWindows = ref<UsageWindowWithUsage[]>([]);
  const selectedWindowId = ref<string | null>(null);

  const selectedWindow = computed<UsageWindowWithUsage | null>(() => {
    if (!selectedWindowId.value) return null;
    return (
      usageWindows.value.find((w) => w.window.id === selectedWindowId.value) ??
      null
    );
  });

  const timelineWindows = computed(() => {
    let windows = usageWindows.value.filter(
      (w) => w.window.provider_id !== null,
    );
    if (selectedProvider.value) {
      windows = windows.filter(
        (w) => w.window.provider_id === selectedProvider.value,
      );
    }
    return mergeTimelineWindows(windows);
  });

  // --- Timeline rendering computed ---

  const timelineDurationMs = computed(() => {
    return TIMELINE_DURATIONS[timelineRange.value] ?? TIMELINE_DURATIONS["24h"];
  });

  const timelineDurationHours = computed(() =>
    Math.round(timelineDurationMs.value / MS_PER_HOUR),
  );

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
    const pct = Math.min(
      (offset / timelineDurationMs.value) * PERCENT,
      PERCENT,
    );
    return pct + "%";
  }

  function getWindowWidth(w: UsageWindowWithUsage): string {
    if (!timelineStart.value) return "0%";
    const wStart = new Date(w.window.start_time).getTime();
    const wEnd = new Date(w.window.end_time).getTime();
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
    if (outputTokens >= INTENSITY_T4) bg = TIMELINE_INTENSITY_COLORS[3];
    else if (outputTokens >= INTENSITY_T3) bg = TIMELINE_INTENSITY_COLORS[2];
    else if (outputTokens >= INTENSITY_T2) bg = TIMELINE_INTENSITY_COLORS[1];
    else bg = TIMELINE_INTENSITY_COLORS[0];
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

  // --- Data loading ---

  async function loadUsageWindows() {
    try {
      const range = getTimelineTimeRange(timelineRange.value);
      usageWindows.value = await api.getUsageWindows(range);
    } catch (e: unknown) {
      console.error("useDashboardTimeline.loadUsageWindows:", e);
      /* 降级：无窗口数据时 dashboard 仍可用 */
      toast.error(getApiMessage(e, t("dashboard.loadDashboardFailed")));
    }
  }

  function autoSelectLatestWindow() {
    const sorted = timelineWindows.value;
    if (sorted.length > 0) {
      selectedWindowId.value = sorted[sorted.length - 1].window.id;
    } else {
      selectedWindowId.value = null;
    }
  }

  // --- Selected window time range text ---

  const windowTimeRange = computed(() => {
    const window = selectedWindow.value;
    if (!window) return "";
    try {
      return `${formatTimeShort(window.window.start_time)} ~ ${formatTimeShort(window.window.end_time)}`;
    } catch (e: unknown) {
      console.error("useDashboardTimeline.renderTimeline:", e);
      return "";
    }
  });

  return {
    timelineRange,
    usageWindows,
    selectedWindowId,
    selectedWindow,
    timelineWindows,
    timelineStart,
    timelineDurationMs,
    timelineDurationHours,
    timelineDayLabels,
    getWindowLeft,
    getWindowWidth,
    getWindowStyle,
    formatWindowTooltip,
    loadUsageWindows,
    autoSelectLatestWindow,
    windowTimeRange,
  };
}
