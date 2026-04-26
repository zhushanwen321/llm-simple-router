<template>
  <div v-if="loading" class="text-center text-muted-foreground py-8">加载中...</div>
  <div v-else-if="windowsData.length === 0" class="text-center text-muted-foreground py-8">暂无窗口数据</div>
  <Tabs v-else default-value="all">
    <TabsList>
      <TabsTrigger value="all">全部</TabsTrigger>
      <TabsTrigger v-for="pid in providerIds" :key="pid" :value="pid">{{ pid }}</TabsTrigger>
    </TabsList>

    <!-- 全部 -->
    <TabsContent value="all">
      <div class="grid grid-cols-3 gap-4 mt-4 mb-4">
        <div class="rounded-md border p-3">
          <p class="text-sm text-muted-foreground">当前窗口</p>
          <p class="text-xl font-bold text-foreground">{{ windowsData.length }}</p>
        </div>
        <div class="rounded-md border p-3">
          <p class="text-sm text-muted-foreground">总请求数</p>
          <p class="text-xl font-bold text-foreground">{{ allTotalRequests }}</p>
        </div>
        <div class="rounded-md border p-3">
          <p class="text-sm text-muted-foreground">总 Token</p>
          <p class="text-xl font-bold text-foreground">{{ allTotalTokens }}</p>
        </div>
      </div>
      <WindowTable :items="windowsData" />
    </TabsContent>

    <!-- Per-provider -->
    <TabsContent v-for="pid in providerIds" :key="pid" :value="pid">
      <WindowTable :items="grouped[pid]" />
    </TabsContent>
  </Tabs>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import WindowTable from '@/components/dashboard/WindowTable.vue'
import type { UsageWindowWithUsage } from '@/api/client'

const props = defineProps<{
  windowsData: UsageWindowWithUsage[]
  loading: boolean
}>()

const grouped = computed(() => {
  const map: Record<string, UsageWindowWithUsage[]> = {}
  for (const item of props.windowsData) {
    const pid = item.window.provider_id ?? '(unknown)'
    ;(map[pid] ??= []).push(item)
  }
  return map
})

// 按 token 总量降序排列的 provider_id 列表
const providerIds = computed(() => {
  const entries = Object.entries(grouped.value).map(([pid, items]) => ({
    pid,
    tokens: items.reduce((s, w) => s + w.usage.total_input_tokens + w.usage.total_output_tokens, 0),
  }))
  return entries.sort((a, b) => b.tokens - a.tokens).map((e) => e.pid)
})

const allTotalRequests = computed(() =>
  props.windowsData.reduce((s, w) => s + w.usage.request_count, 0),
)
const allTotalTokens = computed(() => {
  const total = props.windowsData.reduce((s, w) => s + w.usage.total_input_tokens + w.usage.total_output_tokens, 0)
  return total.toLocaleString()
})
</script>
