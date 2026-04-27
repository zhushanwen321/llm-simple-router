<template>
  <div v-if="loading" class="text-center text-muted-foreground py-8">加载中...</div>
  <div v-else-if="providerIds.length === 0" class="text-center text-muted-foreground py-8">暂无窗口数据</div>
  <template v-else>
    <Tabs v-if="providerIds.length > 1" :model-value="activeTab" @update:model-value="activeTab = $event as string">
      <TabsList>
        <TabsTrigger v-for="pid in providerIds" :key="pid" :value="pid">
          {{ pid }}
        </TabsTrigger>
      </TabsList>

      <TabsContent v-for="pid in providerIds" :key="pid" :value="pid">
        <div class="grid grid-cols-3 gap-4 mt-4 mb-4">
          <Card>
            <CardContent class="p-3">
              <p class="text-sm text-muted-foreground">当前窗口</p>
              <p class="text-xl font-bold text-foreground">{{ grouped[pid].length }}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent class="p-3">
              <p class="text-sm text-muted-foreground">总请求数</p>
              <p class="text-xl font-bold text-foreground">{{ providerStats[pid].requests }}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent class="p-3">
              <p class="text-sm text-muted-foreground">总 Token</p>
              <p class="text-xl font-bold text-foreground">{{ providerStats[pid].tokensDisplay }}</p>
            </CardContent>
          </Card>
        </div>
        <WindowTable :items="grouped[pid]" />
      </TabsContent>
    </Tabs>

    <!-- 单个 provider：直接显示，无需 tab -->
    <template v-else>
      <div class="grid grid-cols-3 gap-4 mb-4">
        <Card>
          <CardContent class="p-3">
            <p class="text-sm text-muted-foreground">当前窗口</p>
            <p class="text-xl font-bold text-foreground">{{ grouped[providerIds[0]].length }}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent class="p-3">
            <p class="text-sm text-muted-foreground">总请求数</p>
            <p class="text-xl font-bold text-foreground">{{ providerStats[providerIds[0]].requests }}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent class="p-3">
            <p class="text-sm text-muted-foreground">总 Token</p>
            <p class="text-xl font-bold text-foreground">{{ providerStats[providerIds[0]].tokensDisplay }}</p>
          </CardContent>
        </Card>
      </div>
      <WindowTable :items="grouped[providerIds[0]]" />
    </template>
  </template>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent } from '@/components/ui/card'
import WindowTable from '@/components/dashboard/WindowTable.vue'
import type { UsageWindowWithUsage } from '@/api/client'

const props = defineProps<{
  windowsData: UsageWindowWithUsage[]
  loading: boolean
}>()

const grouped = computed(() => {
  const map: Record<string, UsageWindowWithUsage[]> = {}
  for (const item of props.windowsData) {
    const pid = item.window.provider_id
    if (!pid) continue
    ;(map[pid] ??= []).push(item)
  }
  return map
})

const providerStats = computed(() => {
  const stats: Record<string, { requests: number; outputTokens: number; tokensDisplay: string }> = {}
  for (const pid of Object.keys(grouped.value)) {
    const items = grouped.value[pid]
    const outputTokens = items.reduce((s, w) => s + w.usage.total_output_tokens, 0)
    const inputTokens = items.reduce((s, w) => s + w.usage.total_input_tokens, 0)
    stats[pid] = {
      requests: items.reduce((s, w) => s + w.usage.request_count, 0),
      outputTokens,
      tokensDisplay: (inputTokens + outputTokens).toLocaleString(),
    }
  }
  return stats
})

// 按输出 token 降序排列的 provider_id 列表
const providerIds = computed(() => {
  return Object.keys(grouped.value)
    .map((pid) => ({ pid, outputTokens: providerStats.value[pid].outputTokens }))
    .sort((a, b) => b.outputTokens - a.outputTokens)
    .map((e) => e.pid)
})

const activeTab = ref<string | undefined>(undefined)

// 当 providerIds 变化时，确保 activeTab 有效
watch(providerIds, (ids) => {
  if (ids.length === 0) {
    activeTab.value = undefined
  } else if (!activeTab.value || !ids.includes(activeTab.value)) {
    activeTab.value = ids[0]
  }
}, { immediate: true })
</script>
