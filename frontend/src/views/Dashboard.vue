<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold text-gray-900">仪表盘</h2>
      <Select v-model="routerKeyFilter" @update:model-value="loadStats">
        <SelectTrigger class="w-48">
          <SelectValue placeholder="全部密钥" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部密钥</SelectItem>
          <SelectItem v-for="rk in routerKeys" :key="rk.id" :value="rk.id">
            {{ rk.name }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const stats = ref({
  totalRequests: 0,
  successRate: 0,
  avgLatency: 0,
  requestsByType: {} as Record<string, number>,
  recentRequests: 0,
})
const routerKeyFilter = ref('all')
const routerKeys = ref<{ id: string; name: string }[]>([])

function barHeight(count: number): number {
  const values = Object.values(stats.value.requestsByType)
  const max = Math.max(...values)
  const BAR_MAX_HEIGHT = 120
  return max > 0 ? (count / max) * BAR_MAX_HEIGHT : 0
}

async function loadStats() {
  try {
    const params: { router_key_id?: string } = {}
    if (routerKeyFilter.value !== 'all') params.router_key_id = routerKeyFilter.value
    const res = await api.getStats(params)
    stats.value = res.data
  } catch (e) {
    console.error('Failed to load stats:', e)
    stats.value = { totalRequests: 0, successRate: 0, avgLatency: 0, requestsByType: {}, recentRequests: 0 }
  }
}

async function loadRouterKeys() {
  try {
    const res = await api.getRouterKeys()
    routerKeys.value = res.data
  // eslint-disable-next-line taste/no-silent-catch
  } catch (e) {
    console.error('Failed to load router keys:', e)
  }
}

onMounted(() => {
  loadRouterKeys()
  loadStats()
})
</script>
