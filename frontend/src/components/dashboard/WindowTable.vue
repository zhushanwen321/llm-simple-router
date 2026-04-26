<template>
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>开始时间</TableHead>
        <TableHead>结束时间</TableHead>
        <TableHead>请求数</TableHead>
        <TableHead>输入 Tokens</TableHead>
        <TableHead>输出 Tokens</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow v-for="item in items" :key="item.window.id">
        <TableCell class="text-sm">{{ formatUsageTime(item.window.start_time) }}</TableCell>
        <TableCell class="text-sm">{{ formatUsageTime(item.window.end_time) }}</TableCell>
        <TableCell>{{ item.usage.request_count }}</TableCell>
        <TableCell>{{ item.usage.total_input_tokens.toLocaleString() }}</TableCell>
        <TableCell>{{ item.usage.total_output_tokens.toLocaleString() }}</TableCell>
      </TableRow>
    </TableBody>
  </Table>
</template>

<script setup lang="ts">
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatTimeShort } from '@/utils/format'
import type { UsageWindowWithUsage } from '@/api/client'

defineProps<{
  items: UsageWindowWithUsage[]
}>()

function formatUsageTime(iso: string): string {
  return formatTimeShort(iso)
}
</script>
