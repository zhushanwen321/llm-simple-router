import { ref, computed } from "vue";
import type { Ref } from "vue";
import { api, getApiMessage } from "@/api/client";
import { toast } from "vue-sonner";

// --- Types ---

export type QuickRange = "5h" | "24h" | "7d" | "30d";

export interface ActivityBucket {
  bucket_time: string;
  request_count: number;
}

export interface ActivityResponse {
  buckets: ActivityBucket[];
}

export interface TimeSelection {
  startTime: Date;
  endTime: Date;
  source: QuickRange | "custom";
}

export interface UseTimeSelectorInput {
  selectedProvider: Ref<string>;
  t: (key: string) => string;
}

// --- Constants ---

const HOURS_PER_DAY = 24;
const MS_PER_HOUR = 3600_000;
const DAY_MS = HOURS_PER_DAY * MS_PER_HOUR;
const TOTAL_RANGE_DAYS = 30;
const DETAIL_DAYS = 7;
const PAD_WIDTH = 2;
const MIN_CUSTOM_DAYS = 1;
const MAX_CUSTOM_DAYS = 90;
const HOURS_IN_5H = 5;
const DAYS_IN_7D = 7;
const DAYS_IN_30D = 30;
const HOURS_IN_24H = 24;
const DAY_IN_24H = 1;
const MONTHS_PER_YEAR = 12;
const DAYS_PER_MONTH_MAX = 31;
const END_OF_DAY_HOUR = 23;
const END_OF_DAY_MINUTE = 59;
const END_OF_DAY_SECOND = 59;
const END_OF_DAY_MS = 999;

const QUICK_RANGE_MS: Record<QuickRange, number> = {
  "5h": HOURS_IN_5H * MS_PER_HOUR,
  "24h": HOURS_IN_24H * MS_PER_HOUR,
  "7d": DAYS_IN_7D * DAY_MS,
  "30d": DAYS_IN_30D * DAY_MS,
};

const QUICK_RANGE_DAYS: Record<QuickRange, number> = {
  "5h": 0,
  "24h": DAY_IN_24H,
  "7d": DAYS_IN_7D,
  "30d": DAYS_IN_30D,
};

const MIN_CUSTOM_MS = MIN_CUSTOM_DAYS * DAY_MS;
const MAX_CUSTOM_MS = MAX_CUSTOM_DAYS * DAY_MS;

// --- Helpers ---

function pad(n: number): string {
  return n.toString().padStart(PAD_WIDTH, "0");
}

function toDateTimeLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDateInput(value: string, isEnd: boolean): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  if (mo < 1 || mo > MONTHS_PER_YEAR || da < 1 || da > DAYS_PER_MONTH_MAX) {
    return null;
  }
  const d = new Date(y, mo - 1, da);
  if (Number.isNaN(d.getTime())) return null;
  if (isEnd) {
    d.setHours(
      END_OF_DAY_HOUR,
      END_OF_DAY_MINUTE,
      END_OF_DAY_SECOND,
      END_OF_DAY_MS,
    );
  } else {
    d.setHours(0, 0, 0, 0);
  }
  return d;
}

function formatRangeLabel(start: Date, end: Date): string {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const sm = months[start.getMonth()];
  const em = months[end.getMonth()];
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();
  if (sameDay) {
    return `${sm} ${start.getDate()} ${pad(start.getHours())}:${pad(start.getMinutes())} ~ ${pad(end.getHours())}:${pad(end.getMinutes())}`;
  }
  return `${sm} ${start.getDate()} ${pad(start.getHours())}:${pad(start.getMinutes())} ~ ${em} ${end.getDate()} ${pad(end.getHours())}:${pad(end.getMinutes())}`;
}

// --- Composable ---

export function useTimeSelector({ selectedProvider, t }: UseTimeSelectorInput) {
  const activeRange = ref<QuickRange | "custom" | null>("7d");
  const showCustom = ref(false);
  const customStart = ref("");
  const customEnd = ref("");
  const customError = ref("");
  const activityBuckets = ref<ActivityBucket[]>([]);
  const detailDays = DETAIL_DAYS;

  // --- Range bounds ---
  const rangeStart = computed(() => {
    const now = new Date();
    return new Date(now.getTime() - TOTAL_RANGE_DAYS * DAY_MS);
  });
  const rangeEnd = computed(() => new Date());
  const totalRangeDays = TOTAL_RANGE_DAYS;

  // --- Current selection ---
  const timeSelection = computed<TimeSelection>(() => {
    const now = new Date();
    if (activeRange.value === "custom" && selectionFromCustom.value) {
      return {
        startTime: selectionFromCustom.value.start,
        endTime: selectionFromCustom.value.end,
        source: "custom",
      };
    }
    if (activeRange.value && activeRange.value !== "custom") {
      const range = activeRange.value as QuickRange;
      return {
        startTime: new Date(now.getTime() - QUICK_RANGE_MS[range]),
        endTime: now,
        source: range,
      };
    }
    // Default: last 7 days
    return {
      startTime: new Date(now.getTime() - QUICK_RANGE_MS["7d"]),
      endTime: now,
      source: "7d",
    };
  });

  const selectionFromCustom = ref<{ start: Date; end: Date } | null>(null);

  const timeRangeLabel = computed(() => {
    const sel = timeSelection.value;
    return formatRangeLabel(sel.startTime, sel.endTime);
  });

  // --- Activity data loading ---
  async function loadActivity() {
    try {
      const params: { provider_id?: string } = {};
      if (selectedProvider.value) params.provider_id = selectedProvider.value;
      const resp = await api.getMetricsActivity(params);
      activityBuckets.value = resp.buckets ?? [];
    } catch (e: unknown) {
      console.error("useTimeSelector.loadActivity:", e);
      activityBuckets.value = [];
      toast.error(getApiMessage(e, t("dashboard.loadDashboardFailed")));
    }
  }

  // --- Quick range selection ---
  function selectQuickRange(range: QuickRange) {
    activeRange.value = range;
    showCustom.value = false;
    customError.value = "";
  }

  // --- Custom range toggle ---
  function toggleCustom() {
    showCustom.value = !showCustom.value;
    if (showCustom.value) {
      const sel = timeSelection.value;
      customStart.value = toDateTimeLocalInput(sel.startTime);
      customEnd.value = toDateTimeLocalInput(sel.endTime);
      activeRange.value = "custom";
      customError.value = "";
    } else if (activeRange.value === "custom") {
      activeRange.value = "7d";
    }
  }

  function applyCustom() {
    customError.value = "";
    const start = parseDateInput(customStart.value, false);
    const end = parseDateInput(customEnd.value, true);
    if (!start || !end) {
      customError.value = t("dashboard.timeSelector.customError.format");
      return;
    }
    if (start.getTime() >= end.getTime()) {
      customError.value = t("dashboard.timeSelector.customError.order");
      return;
    }
    const span = end.getTime() - start.getTime();
    if (span < MIN_CUSTOM_MS) {
      customError.value = t("dashboard.timeSelector.customError.tooShort");
      return;
    }
    if (span > MAX_CUSTOM_MS) {
      customError.value = t("dashboard.timeSelector.customError.tooLong");
      return;
    }
    const now = Date.now();
    if (end.getTime() > now) {
      customError.value = t("dashboard.timeSelector.customError.future");
      return;
    }
    if (start.getTime() < rangeStart.value.getTime()) {
      customError.value = t("dashboard.timeSelector.customError.tooOld");
      return;
    }
    selectionFromCustom.value = { start, end };
    activeRange.value = "custom";
    showCustom.value = false;
  }

  /**
   * 直接设置自定义范围（用于 ActivityTimeline 点击事件）。
   * 跳过表单输入校验，但仍然夹紧到允许的范围内。
   */
  function setCustomRange(start: Date, end: Date) {
    const clampedEnd = new Date(Math.min(end.getTime(), Date.now()));
    const minStart = rangeStart.value.getTime();
    const clampedStart = new Date(Math.max(start.getTime(), minStart));
    if (clampedStart.getTime() >= clampedEnd.getTime()) return;
    const span = clampedEnd.getTime() - clampedStart.getTime();
    if (span < MIN_CUSTOM_MS || span > MAX_CUSTOM_MS) return;
    selectionFromCustom.value = { start: clampedStart, end: clampedEnd };
    activeRange.value = "custom";
    showCustom.value = false;
    customError.value = "";
  }

  return {
    activeRange,
    showCustom,
    customStart,
    customEnd,
    customError,
    activityBuckets,
    detailDays,
    rangeStart,
    rangeEnd,
    totalRangeDays,
    quickRangeDays: QUICK_RANGE_DAYS,
    timeSelection,
    timeRangeLabel,
    selectQuickRange,
    toggleCustom,
    applyCustom,
    setCustomRange,
    loadActivity,
  };
}
