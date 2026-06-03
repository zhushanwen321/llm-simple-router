<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { WEEKDAYS_MON_FRI, SATURDAY, SUNDAY } from "@/utils/schedule-domain";

export interface TimelineRule {
  name: string;
  days: number[];
  startHour: number;
  endHour: number;
  enabled: boolean;
}

const props = defineProps<{
  rules: TimelineRule[];
}>();

const { t, te } = useI18n();

const HOURS_IN_DAY = 24;
const NARROW_THRESHOLD = 5;
const HOUR_LABEL_STEP = 3;
const PERCENT = 100;
const DAYS_IN_WEEK = 7;
const MAX_DAY_INDEX = DAYS_IN_WEEK - 1;
const DOUBLE_DIGIT_THRESHOLD = 10;

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

// 数据约定: 0=Sun, 1=Mon, ..., 6=Sat; 显示顺序: Mon-Sun
const DISPLAY_ORDER = [...WEEKDAYS_MON_FRI, SATURDAY, SUNDAY];

const BLOCK_COLORS = [
  "oklch(0.68 0.13 175 / 70%)",
  "oklch(0.68 0.13 175 / 50%)",
  "oklch(0.68 0.13 175 / 35%)",
  "oklch(0.68 0.13 175 / 25%)",
];

const dayIndices = Array.from({ length: DAYS_IN_WEEK }, (_, i) => i);

const hourLabels = Array.from(
  { length: Math.ceil(HOURS_IN_DAY / HOUR_LABEL_STEP) },
  (_, i) => i * HOUR_LABEL_STEP,
);

const hourMarks = Array.from({ length: HOURS_IN_DAY }, (_, i) => i);

const dayRules = computed((): TimelineRule[][] => {
  const result: TimelineRule[][] = [[], [], [], [], [], [], []];
  for (const rule of props.rules) {
    for (const day of rule.days) {
      if (day >= 0 && day <= MAX_DAY_INDEX) {
        result[DISPLAY_ORDER.indexOf(day)].push(rule);
      }
    }
  }
  return result;
});

function dayLabel(index: number): string {
  const key = `schedules.weekDays.${DAY_KEYS[index]}`;
  if (te(key)) return t(key);
  const fallback: Record<string, string> = {
    mon: "周一",
    tue: "周二",
    wed: "周三",
    thu: "周四",
    fri: "周五",
    sat: "周六",
    sun: "周日",
  };
  return fallback[DAY_KEYS[index]] ?? "";
}

function hasRules(dayIndex: number): boolean {
  return dayRules.value[dayIndex].length > 0;
}

function blockStyle(rule: TimelineRule): Record<string, string> {
  const startPct = (rule.startHour / HOURS_IN_DAY) * PERCENT;
  const widthPct = ((rule.endHour - rule.startHour) / HOURS_IN_DAY) * PERCENT;
  return {
    left: `${startPct}%`,
    width: `${widthPct}%`,
  };
}

function blockColor(rule: TimelineRule): string {
  const idx = props.rules.indexOf(rule);
  return BLOCK_COLORS[idx % BLOCK_COLORS.length];
}

function isNarrow(rule: TimelineRule): boolean {
  return rule.endHour - rule.startHour < NARROW_THRESHOLD;
}

function timeLabel(hour: number): string {
  return hour < DOUBLE_DIGIT_THRESHOLD ? `0${hour}:00` : `${hour}:00`;
}
</script>

<template>
  <div class="flex flex-col">
    <div
      v-for="dayIndex in dayIndices"
      :key="dayIndex"
      class="flex items-center gap-2 h-6"
      :class="{ 'opacity-35': !hasRules(dayIndex) }"
    >
      <div
        class="w-7 shrink-0 text-[11px] font-medium text-muted-foreground text-right select-none"
      >
        {{ dayLabel(dayIndex) }}
      </div>
      <div
        class="flex-1 relative h-full rounded-sm overflow-visible"
        :class="
          hasRules(dayIndex)
            ? 'bg-black/[0.06] dark:bg-white/[0.07]'
            : 'bg-black/[0.03] dark:bg-white/[0.03]'
        "
      >
        <div
          class="absolute inset-0 grid"
          :style="{ gridTemplateColumns: 'repeat(24, 1fr)' }"
        >
          <div
            v-for="h in hourMarks"
            :key="h"
            class="border-r border-border/30 dark:border-white/10 last:border-r-0"
          />
        </div>
        <div
          v-for="rule in dayRules[dayIndex]"
          :key="rule.name + dayIndex"
          class="absolute top-0.5 bottom-0.5 rounded-sm flex items-center px-1 text-[10px] font-semibold overflow-hidden whitespace-nowrap cursor-default z-10 transition-[filter] duration-100 hover:z-20 hover:brightness-[1.15] group"
          :class="[
            !rule.enabled
              ? 'bg-transparent !border-dashed border-[1.5px] border-muted-foreground/50 text-muted-foreground/60'
              : '',
          ]"
          :style="{
            ...blockStyle(rule),
            ...(rule.enabled
              ? { background: blockColor(rule), color: 'oklch(0.145 0 0)' }
              : {}),
          }"
        >
          <span v-if="!isNarrow(rule)" class="truncate">{{ rule.name }}</span>
          <div
            v-if="isNarrow(rule)"
            class="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 bg-popover text-popover-foreground border rounded-md shadow-lg px-2.5 py-1.5 z-30 whitespace-nowrap text-[11px]"
          >
            <div class="font-semibold whitespace-nowrap">{{ rule.name }}</div>
            <div
              class="font-mono text-[11px] text-muted-foreground whitespace-nowrap"
            >
              {{ timeLabel(rule.startHour) }} - {{ timeLabel(rule.endHour) }}
            </div>
          </div>
        </div>
      </div>
    </div>
    <!-- Bottom hour labels -->
    <div class="flex items-center gap-2 mt-0.5">
      <div class="w-7 shrink-0" />
      <div
        class="flex-1 grid"
        :style="{ gridTemplateColumns: 'repeat(24, 1fr)' }"
      >
        <div
          v-for="h in hourLabels"
          :key="h"
          class="font-mono text-[10px] text-muted-foreground text-left pl-0.5 leading-4"
          :style="{ gridColumn: `${h + 1} / span 3` }"
        >
          {{ timeLabel(h) }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped></style>
