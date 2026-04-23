<template>
  <div v-if="loading" class="text-center text-muted-foreground py-8">加载中...</div>
  <div v-else-if="data.length === 0" class="text-center text-muted-foreground py-8">{{ emptyText }}</div>
  <template v-else>
    <div class="grid grid-cols-3 gap-4 mt-4 mb-4">
      <div class="rounded-md border p-3">
        <p class="text-sm text-muted-foreground">统计天数</p>
        <p class="text-xl font-bold text-foreground">{{ data.length }}</p>
      </div>
      <div class="rounded-md border p-3">
        <p class="text-sm text-muted-foreground">{{ totalLabel }}</p>
        <p class="text-xl font-bold text-foreground">{{ totalRequests }}</p>
      </div>
      <div class="rounded-md border p-3">
        <p class="text-sm text-muted-foreground">{{ tokenLabel }}</p>
        <p class="text-xl font-bold text-foreground">{{ totalTokens }}</p>
      </div>
    </div>
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>日期</TableHead>
          <TableHead>请求数</TableHead>
          <TableHead>输入 Tokens</TableHead>
          <TableHead>输出 Tokens</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow v-for="row in data" :key="row.date">
          <TableCell class="text-sm">{{ row.date }}</TableCell>
          <TableCell>{{ row.request_count }}</TableCell>
          <TableCell>{{ row.total_input_tokens.toLocaleString() }}</TableCell>
          <TableCell>{{ row.total_output_tokens.toLocaleString() }}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  </template>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { DailyUsage } from '@/api/client'

const props = defineProps<{
  data: DailyUsage[]
  loading: boolean
  emptyText: string
  totalLabel: string
  tokenLabel: string
}>()

const totalRequests = computed(() => props.data.reduce((s, d) => s + d.request_count, 0))
const totalTokens = computed(() =>
  props.data.reduce((s, d) => s + d.total_input_tokens + d.total_output_tokens, 0).toLocaleString(),
)
</script>
