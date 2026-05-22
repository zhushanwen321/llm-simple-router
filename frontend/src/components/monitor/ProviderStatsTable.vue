<template>
  <div v-if="!stats" class="text-sm text-muted-foreground py-4 text-center">
    {{ t('monitor.providerTable.noData') }}
  </div>
  <div v-else-if="providerEntries.length === 0" class="text-sm text-muted-foreground py-4 text-center">
    {{ t('monitor.providerTable.noProviders') }}
  </div>
  <Table v-else>
    <TableHeader>
      <TableRow class="border-b-0">
        <TableHead class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider py-1.5">{{ t('monitor.providerTable.provider') }}</TableHead>
        <TableHead class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider py-1.5 text-right">{{ t('monitor.providerTable.requests') }}</TableHead>
        <TableHead class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider py-1.5 text-right">{{ t('monitor.providerTable.successRate') }}</TableHead>
        <TableHead class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider py-1.5 text-right">{{ t('monitor.providerTable.avgLatency') }}</TableHead>
        <TableHead class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider py-1.5 text-right">{{ t('monitor.providerTable.retryRate') }}</TableHead>
        <TableHead class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider py-1.5">{{ t('monitor.providerTable.topErrors') }}</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow v-for="entry in providerEntries" :key="entry.id" class="border-b-0 hover:bg-muted/50">
        <TableCell class="font-medium text-[13px] py-1">{{ entry.name }}</TableCell>
        <TableCell class="text-right font-mono text-xs py-1">{{ entry.stats.totalRequests }}</TableCell>
        <TableCell class="text-right font-mono text-xs py-1">
          <span :class="entry.successRate >= 95 ? 'text-success' : entry.successRate >= 80 ? 'text-warning' : 'text-danger'">
            {{ entry.successRate.toFixed(1) }}%
          </span>
        </TableCell>
        <TableCell class="text-right font-mono text-xs py-1">{{ entry.stats.avgLatencyMs.toFixed(0) }}ms</TableCell>
        <TableCell class="text-right font-mono text-xs py-1">
          <span :class="entry.retryRate > 10 ? 'text-warning' : ''">
            {{ entry.retryRate.toFixed(1) }}%
          </span>
        </TableCell>
        <TableCell class="py-1">
          <div class="flex flex-wrap gap-1">
            <Badge
              v-for="err in entry.stats.topErrors.slice(0, 3)"
              :key="err.code"
              variant="destructive"
              class="text-[10px] px-1.5 py-0"
            >
              {{ err.code }} ({{ err.count }})
            </Badge>
            <span v-if="entry.stats.topErrors.length === 0" class="text-xs text-muted-foreground">--</span>
          </div>
        </TableCell>
      </TableRow>
    </TableBody>
  </Table>
</template>

<!-- eslint-disable no-magic-numbers -->
<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import type { StatsSnapshot } from '@/types/monitor'

const { t } = useI18n()

const props = defineProps<{
  stats: StatsSnapshot | null
}>()

// byProvider 的 key 是后端 provider ID（字符串），不需要额外白名单
const providerEntries = computed(() => {
  if (!props.stats) return []
  return Object.entries(props.stats.byProvider)
    .filter(([k]) => typeof k === 'string')
    .map(([id, s]) => ({
      id,
      name: s.providerName,
      stats: s,
      successRate: s.totalRequests > 0 ? (s.successCount / s.totalRequests) * 100 : 0,
      retryRate: s.totalRequests > 0 ? (s.retryCount / s.totalRequests) * 100 : 0,
    }))
})
</script>
