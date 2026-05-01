<template>
  <div v-if="!stats" class="text-sm text-muted-foreground py-4 text-center">
    暂无数据
  </div>
  <div v-else-if="providerEntries.length === 0" class="text-sm text-muted-foreground py-4 text-center">
    暂无 Provider 统计
  </div>
  <Table v-else>
    <TableHeader>
      <TableRow>
        <TableHead>Provider</TableHead>
        <TableHead class="text-right">请求数</TableHead>
        <TableHead class="text-right">成功率</TableHead>
        <TableHead class="text-right">平均延迟</TableHead>
        <TableHead class="text-right">重试率</TableHead>
        <TableHead>Top Errors</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow v-for="entry in providerEntries" :key="entry.id">
        <TableCell class="font-medium">{{ entry.name }}</TableCell>
        <TableCell class="text-right">{{ entry.stats.totalRequests }}</TableCell>
        <TableCell class="text-right">
          <span :class="entry.successRate >= 95 ? 'text-green-600 dark:text-green-400' : entry.successRate >= 80 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-500 dark:text-red-400'">
            {{ entry.successRate.toFixed(1) }}%
          </span>
        </TableCell>
        <TableCell class="text-right">{{ entry.stats.avgLatencyMs.toFixed(0) }}ms</TableCell>
        <TableCell class="text-right">
          <span :class="entry.retryRate > 10 ? 'text-yellow-600 dark:text-yellow-400' : ''">
            {{ entry.retryRate.toFixed(1) }}%
          </span>
        </TableCell>
        <TableCell>
          <div class="flex flex-wrap gap-1">
            <Badge
              v-for="err in entry.stats.topErrors.slice(0, 3)"
              :key="err.code"
              variant="destructive"
              class="text-xs"
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
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import type { StatsSnapshot } from '@/types/monitor'

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
