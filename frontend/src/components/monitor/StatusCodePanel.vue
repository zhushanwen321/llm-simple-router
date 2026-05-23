<template>
  <div v-if="total === 0" class="text-[13px] text-muted-foreground py-2">
    {{ t('monitor.statusCodes.noData') }}
  </div>
  <div v-else>
    <div
      v-for="group in groups"
      :key="group.label"
      class="flex items-center gap-1.5 py-[3px] border-t border-foreground/[0.04] first:border-t-0"
    >
      <span class="size-[5px] rounded-full shrink-0" :class="group.dotClass" />
      <span class="text-[11px] font-medium text-muted-foreground flex-1">{{ group.label }}</span>
      <span class="font-mono text-[11px]" :class="group.textClass">{{ group.count }}</span>
      <span class="font-mono text-[10px] text-muted-foreground w-9 text-right">{{ group.percent }}%</span>
    </div>
  </div>
</template>

<!-- eslint-disable no-magic-numbers -->
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const props = defineProps<{
  byStatusCode: Record<number, number>
}>()

interface StatusGroup {
  label: string
  count: number
  percent: string
  textClass: string
  dotClass: string
}

const total = computed(() => {
  return Object.values(props.byStatusCode).reduce((sum, c) => sum + c, 0)
})

const groups = computed<StatusGroup[]>(() => {
  const codes = props.byStatusCode
  const totalVal = total.value || 1

  const count2xx = sumRange(codes, 200, 299)
  const count4xx = sumRange(codes, 400, 499) - (codes[429] || 0)
  const count429 = codes[429] || 0
  const count5xx = sumRange(codes, 500, 599)

  return [
    {
      label: '2xx',
      count: count2xx,
      percent: ((count2xx / totalVal) * 100).toFixed(1),
      textClass: 'text-success',
      dotClass: 'bg-success',
    },
    {
      label: '4xx',
      count: count4xx,
      percent: ((count4xx / totalVal) * 100).toFixed(1),
      textClass: 'text-warning',
      dotClass: 'bg-warning',
    },
    {
      label: '429',
      count: count429,
      percent: ((count429 / totalVal) * 100).toFixed(1),
      textClass: 'text-info',
      dotClass: 'bg-info',
    },
    {
      label: '5xx',
      count: count5xx,
      percent: ((count5xx / totalVal) * 100).toFixed(1),
      textClass: 'text-danger',
      dotClass: 'bg-danger',
    },
  ].filter((g) => g.count > 0)
})

function sumRange(codes: Record<number, number>, from: number, to: number): number {
  let sum = 0
  for (const [code, count] of Object.entries(codes)) {
    const n = Number(code)
    if (n >= from && n <= to) sum += count
  }
  return sum
}
</script>
