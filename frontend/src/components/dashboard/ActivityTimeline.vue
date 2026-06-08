<script setup lang="ts">
import { computed } from "vue";
import { TIMELINE_INTENSITY_COLORS } from "@/styles/design-tokens";
import type { ActivityBucket } from "@/composables/useTimeSelector";

// --- Props & emits ---

const props = defineProps<{
  buckets: ActivityBucket[];
  selectionStart: Date;
  selectionEnd: Date;
  totalRangeDays: number;
  detailDays: number;
  rangeStart: Date;
}>();

const emit = defineEmits<{
  (e: "update:selection", value: { start: Date; end: Date }): void;
}>();

// --- Constants ---

const HOURS_PER_DAY = 24;
const MS_PER_HOUR = 3600_000;
const DAY_MS = HOURS_PER_DAY * MS_PER_HOUR;
const TRACK_HEIGHT = 40;
const MIN_BAR_HEIGHT = 4;
const TICK_INTERVAL_DAYS = 3;
const PIXEL_PER_BUCKET = 2;
const GAP_BUCKETS = 1;
const PAD_WIDTH = 2;
const PERCENT_MAX = 100;
const CLICK_SELECTION_HALF_DAYS = 3.5;
const INTENSITY_HIGH = 0.75;
const INTENSITY_MID = 0.5;
const INTENSITY_LOW = 0.25;
const OPACITY_HIGHLIGHTED = 0.9;
const OPACITY_DIMMED = 0.5;

const monthFormatter = new Intl.DateTimeFormat(undefined, { month: "short" });

// --- Helpers ---

function pad(n: number): string {
  return n.toString().padStart(PAD_WIDTH, "0");
}

function parseBucketTime(s: string): number {
  // backend returns ISO-like "YYYY-MM-DD HH:MM:SS" (UTC). Treat as UTC ms.
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s);
  if (!m) return new Date(s).getTime();
  return Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
  );
}

// --- Computed ---

const totalRangeMs = computed(
  () => props.totalRangeDays * HOURS_PER_DAY * MS_PER_HOUR,
);

const rangeEnd = computed(() => new Date());

interface BarLayout {
  left: number; // 0..100 (%)
  height: number; // px
  bucket: ActivityBucket;
  highlighted: boolean;
}

const bars = computed<BarLayout[]>(() => {
  const start = props.rangeStart.getTime();
  const total = totalRangeMs.value;
  if (total <= 0 || props.buckets.length === 0) return [];
  const maxCount = Math.max(
    1,
    ...props.buckets.map((b) => b.request_count ?? 0),
  );
  const selStart = props.selectionStart.getTime();
  const selEnd = props.selectionEnd.getTime();
  return props.buckets.map((b) => {
    const t = parseBucketTime(b.bucket_time);
    const pct = ((t - start) / total) * PERCENT_MAX;
    const intensity = (b.request_count ?? 0) / maxCount;
    const heightPx =
      MIN_BAR_HEIGHT + intensity * (TRACK_HEIGHT - MIN_BAR_HEIGHT);
    return {
      left: pct,
      height: heightPx,
      bucket: b,
      highlighted: t >= selStart && t <= selEnd,
    };
  });
});

const selectionStyle = computed(() => {
  const start = props.rangeStart.getTime();
  const total = totalRangeMs.value;
  const left = ((props.selectionStart.getTime() - start) / total) * PERCENT_MAX;
  const right = ((props.selectionEnd.getTime() - start) / total) * PERCENT_MAX;
  return {
    left: Math.max(0, Math.min(PERCENT_MAX, left)) + "%",
    width: Math.max(0, Math.min(PERCENT_MAX, right - left)) + "%",
  };
});

const aggregationZoneStyle = computed(() => {
  const start = props.rangeStart.getTime();
  const total = totalRangeMs.value;
  const detailStart = rangeEnd.value.getTime() - props.detailDays * DAY_MS;
  const left = 0;
  const width = Math.max(0, ((detailStart - start) / total) * PERCENT_MAX);
  return { left: left + "%", width: width + "%" };
});

interface Tick {
  left: number;
  label: string;
  isNow: boolean;
}

const ticks = computed<Tick[]>(() => {
  const result: Tick[] = [];
  for (let d = 0; d <= props.totalRangeDays; d += TICK_INTERVAL_DAYS) {
    const date = new Date(props.rangeStart.getTime() + d * DAY_MS);
    const left = (d / props.totalRangeDays) * PERCENT_MAX;
    const isNow = d === props.totalRangeDays;
    result.push({
      left,
      label: isNow
        ? "now"
        : `${monthFormatter.format(date)}/${pad(date.getDate())}`,
      isNow,
    });
  }
  return result;
});

const barWidth = PIXEL_PER_BUCKET - GAP_BUCKETS;

// --- Event handlers ---

function onBarClick(b: BarLayout) {
  // Center a 7-day selection around clicked bar's bucket time
  const center = parseBucketTime(b.bucket.bucket_time);
  const start = center - CLICK_SELECTION_HALF_DAYS * DAY_MS;
  const end = center + CLICK_SELECTION_HALF_DAYS * DAY_MS;
  const rangeStart = props.rangeStart.getTime();
  const rangeEndMs = rangeStart + totalRangeMs.value;
  const clampedStart = Math.max(rangeStart, start);
  const clampedEnd = Math.min(rangeEndMs, end);
  emit("update:selection", {
    start: new Date(clampedStart),
    end: new Date(clampedEnd),
  });
}

function intensityColor(intensity: number): string {
  if (intensity >= INTENSITY_HIGH) return TIMELINE_INTENSITY_COLORS[3];
  if (intensity >= INTENSITY_MID) return TIMELINE_INTENSITY_COLORS[2];
  if (intensity >= INTENSITY_LOW) return TIMELINE_INTENSITY_COLORS[1];
  return TIMELINE_INTENSITY_COLORS[0];
}

function barStyle(b: BarLayout) {
  const intensity = b.height / TRACK_HEIGHT;
  return {
    left: b.left + "%",
    height: b.height + "px",
    width: barWidth + "px",
    backgroundColor: intensityColor(intensity),
    opacity: b.highlighted ? OPACITY_HIGHLIGHTED : OPACITY_DIMMED,
  };
}
</script>

<template>
  <div class="relative">
    <div
      class="relative overflow-hidden rounded bg-muted/30 border border-border/50 mx-5"
      :style="{ height: TRACK_HEIGHT + 'px' }"
    >
      <!-- Aggregation zone (left portion = older than detailDays) -->
      <div
        class="absolute top-0 bottom-0 pointer-events-none"
        :style="{
          ...aggregationZoneStyle,
          background:
            'repeating-linear-gradient(-45deg, oklch(0.68 0.13 175 / 0.05), oklch(0.68 0.13 175 / 0.05) 2px, transparent 2px, transparent 6px)',
        }"
      />
      <!-- Activity bars -->
      <div
        v-for="(b, i) in bars"
        :key="i"
        class="absolute bottom-0 cursor-pointer transition-opacity"
        :style="barStyle(b)"
        :title="`${b.bucket.bucket_time} · ${b.bucket.request_count} req`"
        @click="onBarClick(b)"
      />
      <!-- Selection overlay -->
      <div
        class="absolute top-0 bottom-0 rounded border-2 border-primary pointer-events-none bg-primary/15"
        :style="selectionStyle"
      />
    </div>
    <!-- Tick labels -->
    <div class="relative h-4 mt-1 mx-5">
      <span
        v-for="(t, i) in ticks"
        :key="i"
        class="absolute font-mono text-[10px] -translate-x-1/2"
        :class="
          t.isNow ? 'text-primary font-semibold' : 'text-muted-foreground/60'
        "
        :style="{ left: t.left + '%' }"
      >
        {{ t.label }}
      </span>
    </div>
  </div>
</template>
