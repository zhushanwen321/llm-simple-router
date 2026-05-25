<template>
  <div v-if="total === 0" class="text-[13px] text-muted-foreground py-2">
    {{ t("monitor.statusCodes.noData") }}
  </div>
  <div v-else>
    <div
      v-for="group in groups"
      :key="group.label"
      class="flex items-center gap-1.5 py-[3px] border-t border-foreground/[0.04] first:border-t-0"
    >
      <span class="size-[5px] rounded-full shrink-0" :class="group.dotClass" />
      <span class="text-[11px] font-medium text-muted-foreground flex-1">{{
        group.label
      }}</span>
      <span class="font-mono text-[11px]" :class="group.textClass">{{
        group.count
      }}</span>
      <span class="font-mono text-[10px] text-muted-foreground w-9 text-right"
        >{{ group.percent }}%</span
      >
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";

const { t } = useI18n();

const props = defineProps<{
  byStatusCode: Record<number, number>;
}>();

interface StatusGroup {
  label: string;
  count: number;
  percent: string;
  textClass: string;
  dotClass: string;
}

const total = computed(() => {
  return Object.values(props.byStatusCode).reduce((sum, c) => sum + c, 0);
});

const groups = computed<StatusGroup[]>(() => {
  const codes = props.byStatusCode;
  const totalVal = total.value || 1;

  const HTTP_2XX_START = 200;
  const HTTP_2XX_END = 299;
  const HTTP_4XX_START = 400;
  const HTTP_4XX_END = 499;
  const HTTP_429_CODE = 429;
  const HTTP_5XX_START = 500;
  const HTTP_5XX_END = 599;

  const count2xx = sumRange(codes, HTTP_2XX_START, HTTP_2XX_END);
  const count4xx =
    sumRange(codes, HTTP_4XX_START, HTTP_4XX_END) - (codes[HTTP_429_CODE] || 0);
  const count429 = codes[HTTP_429_CODE] || 0;
  const count5xx = sumRange(codes, HTTP_5XX_START, HTTP_5XX_END);

  const PERCENT_100 = 100;

  return [
    {
      label: "2xx",
      count: count2xx,
      percent: ((count2xx / totalVal) * PERCENT_100).toFixed(1),
      textClass: "text-success",
      dotClass: "bg-success",
    },
    {
      label: "4xx",
      count: count4xx,
      percent: ((count4xx / totalVal) * PERCENT_100).toFixed(1),
      textClass: "text-warning",
      dotClass: "bg-warning",
    },
    {
      label: "429",
      count: count429,
      percent: ((count429 / totalVal) * PERCENT_100).toFixed(1),
      textClass: "text-info",
      dotClass: "bg-info",
    },
    {
      label: "5xx",
      count: count5xx,
      percent: ((count5xx / totalVal) * PERCENT_100).toFixed(1),
      textClass: "text-danger",
      dotClass: "bg-danger",
    },
  ].filter((g) => g.count > 0);
});

function sumRange(
  codes: Record<number, number>,
  from: number,
  to: number,
): number {
  let sum = 0;
  for (const [code, count] of Object.entries(codes)) {
    const n = Number(code);
    if (n >= from && n <= to) sum += count;
  }
  return sum;
}
</script>
