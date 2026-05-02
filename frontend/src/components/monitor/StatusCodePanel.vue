<template>
  <div v-if="total === 0" class="text-sm text-muted-foreground">{{ t('monitor.statusCodes.noData') }}</div>
  <div v-else class="space-y-2">
    <div v-for="group in groups" :key="group.label" class="space-y-1">
      <div class="flex items-center justify-between text-sm">
        <span :class="group.textClass">{{ group.label }}</span>
        <span class="text-muted-foreground">
          {{ group.count }} ({{ group.percent }}%)
        </span>
      </div>
      <div class="h-2 bg-muted rounded-full overflow-hidden">
        <div
          class="h-full rounded-full transition-all duration-300"
          :class="group.barClass"
          :style="{ width: `${group.percent}%` }"
        />
      </div>
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
  barClass: string
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
      label: t('monitor.statusCodes.success'),
      count: count2xx,
      percent: ((count2xx / totalVal) * 100).toFixed(1),
      textClass: 'text-green-600 dark:text-green-400',
      barClass: 'bg-green-500',
    },
    {
      label: t('monitor.statusCodes.clientError'),
      count: count4xx,
      percent: ((count4xx / totalVal) * 100).toFixed(1),
      textClass: 'text-yellow-600 dark:text-yellow-400',
      barClass: 'bg-yellow-500',
    },
    {
      label: t('monitor.statusCodes.rateLimited'),
      count: count429,
      percent: ((count429 / totalVal) * 100).toFixed(1),
      textClass: 'text-orange-600 dark:text-orange-400',
      barClass: 'bg-orange-500',
    },
    {
      label: t('monitor.statusCodes.serverError'),
      count: count5xx,
      percent: ((count5xx / totalVal) * 100).toFixed(1),
      textClass: 'text-red-600 dark:text-red-400',
      barClass: 'bg-red-500',
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
