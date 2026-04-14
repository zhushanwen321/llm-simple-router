<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold text-gray-900">请求日志</h2>
      <div class="flex items-center gap-2">
        <Select v-model="filterType" @update:model-value="loadLogs">
          <SelectTrigger class="w-[140px]">
            <SelectValue placeholder="全部类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">全部类型</SelectItem>
            <SelectItem value="openai">OpenAI</SelectItem>
            <SelectItem value="anthropic">Anthropic</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          class="text-red-600 border-red-300 hover:bg-red-50"
          @click="showCleanup = true"
        >
          清理日志
        </Button>
      </div>
    </div>

    <div class="bg-white rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow class="bg-gray-50">
            <TableHead class="text-gray-600">时间</TableHead>
            <TableHead class="text-gray-600">类型</TableHead>
            <TableHead class="text-gray-600">模型</TableHead>
            <TableHead class="text-gray-600">状态码</TableHead>
            <TableHead class="text-gray-600">延迟</TableHead>
            <TableHead class="text-gray-600">流式</TableHead>
            <TableHead class="text-gray-600">错误</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="log in logs" :key="log.id" :class="{ 'bg-red-50/50': log.status_code >= 400 }">
            <TableCell class="text-gray-500">{{ formatTime(log.created_at) }}</TableCell>
            <TableCell>
              <Badge :variant="log.api_type === 'openai' ? 'default' : 'secondary'">{{ log.api_type }}</Badge>
            </TableCell>
            <TableCell class="font-mono text-xs">{{ log.model || '-' }}</TableCell>
            <TableCell>
              <span :class="log.status_code < 400 ? 'text-green-600' : 'text-red-600'" class="font-medium">{{ log.status_code || '-' }}</span>
            </TableCell>
            <TableCell>{{ log.latency_ms ? log.latency_ms + 'ms' : '-' }}</TableCell>
            <TableCell>{{ log.is_stream ? 'Yes' : 'No' }}</TableCell>
            <TableCell class="text-red-500 text-xs">{{ log.error_message || '-' }}</TableCell>
          </TableRow>
          <TableRow v-if="logs.length === 0">
            <TableCell colspan="7" class="text-center text-gray-400 py-8">暂无日志</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <div class="flex items-center justify-between mt-4">
      <p class="text-sm text-gray-500">共 {{ total }} 条</p>
      <div class="flex gap-1">
        <Button variant="outline" size="sm" @click="prevPage" :disabled="page <= 1">上一页</Button>
        <span class="px-3 py-1 text-sm text-gray-600">第 {{ page }} 页</span>
        <Button variant="outline" size="sm" @click="nextPage" :disabled="logs.length < limit">下一页</Button>
      </div>
    </div>

    <!-- Cleanup Dialog -->
    <Dialog v-model:open="showCleanup">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>清理日志</DialogTitle>
        </DialogHeader>
        <p class="text-sm text-gray-600">删除指定天数之前的日志</p>
        <div class="mb-4">
          <Label class="block text-sm font-medium text-gray-700 mb-1">保留最近天数</Label>
          <Input v-model.number="cleanupDays" type="number" :min="1" />
        </div>
        <DialogFooter>
          <Button variant="outline" @click="showCleanup = false">取消</Button>
          <Button variant="destructive" @click="handleCleanup">确认清理</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

interface LogEntry {
  id: string
  api_type: string
  model: string | null
  status_code: number | null
  latency_ms: number | null
  is_stream: number
  error_message: string | null
  created_at: string
}

const logs = ref<LogEntry[]>([])
const total = ref(0)
const page = ref(1)
const limit = 20
const filterType = ref('')
const showCleanup = ref(false)
const cleanupDays = ref(30)

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN')
}

async function loadLogs() {
  try {
    const params: any = { page: page.value, limit }
    if (filterType.value) params.api_type = filterType.value
    const res = await api.getLogs(params)
    logs.value = res.data.data
    total.value = res.data.total
  } catch (e) {
    console.error('Failed to load logs:', e)
  }
}

function prevPage() {
  if (page.value > 1) {
    page.value--
    loadLogs()
  }
}

function nextPage() {
  page.value++
  loadLogs()
}

async function handleCleanup() {
  try {
    const before = new Date(Date.now() - cleanupDays.value * 86400000).toISOString()
    const res = await api.deleteLogsBefore(before)
    showCleanup.value = false
    page.value = 1
    await loadLogs()
    alert(`已清理 ${res.data.deleted} 条日志`)
  } catch (e) {
    console.error('Failed to cleanup logs:', e)
  }
}

onMounted(loadLogs)
</script>
