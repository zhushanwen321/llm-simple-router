<template>
  <div class="p-6">
    <h2 class="text-lg font-semibold text-gray-900 mb-4">仪表盘</h2>
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <Card>
        <CardContent class="p-4">
          <p class="text-sm text-gray-500">总请求数</p>
          <p class="text-2xl font-bold text-gray-900 mt-1">{{ stats.totalRequests }}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent class="p-4">
          <p class="text-sm text-gray-500">成功率</p>
          <p class="text-2xl font-bold text-green-600 mt-1">{{ (stats.successRate * 100).toFixed(1) }}%</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent class="p-4">
          <p class="text-sm text-gray-500">平均延迟</p>
          <p class="text-2xl font-bold text-gray-900 mt-1">{{ Math.round(stats.avgLatency) }}ms</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent class="p-4">
          <p class="text-sm text-gray-500">24h 请求数</p>
          <p class="text-2xl font-bold text-gray-900 mt-1">{{ stats.recentRequests }}</p>
        </CardContent>
      </Card>
    </div>
    <Card v-if="Object.keys(stats.requestsByType).length > 0">
      <CardHeader>
        <CardTitle class="text-sm font-medium text-gray-700">请求分布（按类型）</CardTitle>
      </CardHeader>
      <CardContent>
        <div class="flex items-end gap-6 h-40">
          <div v-for="(count, type) in stats.requestsByType" :key="type" class="flex flex-col items-center gap-1">
            <div
              :class="type === 'openai' ? 'bg-blue-500' : 'bg-purple-500'"
              class="rounded-t w-20"
              :style="{ height: barHeight(count) + 'px' }"
            ></div>
            <span class="text-xs text-gray-500">{{ type }}</span>
            <span class="text-xs font-medium">{{ count }}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api } from '@/api/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const stats = ref({
  totalRequests: 0,
  successRate: 0,
  avgLatency: 0,
  requestsByType: {} as Record<string, number>,
  recentRequests: 0,
})

function barHeight(count: number): number {
  const values = Object.values(stats.value.requestsByType)
  const max = Math.max(...values)
  return max > 0 ? (count / max) * 120 : 0
}

onMounted(async () => {
  try {
    const res = await api.getStats()
    stats.value = res.data
  } catch (e) {
    console.error('Failed to load stats:', e)
  }
})
</script>
