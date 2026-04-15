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
            <TableHead class="text-gray-600">操作</TableHead>
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
            <TableCell>
              <Button variant="ghost" size="sm" @click="openDetail(log.id)">详情</Button>
            </TableCell>
          </TableRow>
          <TableRow v-if="logs.length === 0">
            <TableCell colspan="8" class="text-center text-gray-400 py-8">暂无日志</TableCell>
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

    <!-- Detail Dialog -->
    <Dialog v-model:open="showDetail">
      <DialogScrollContent class="max-w-4xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>请求详情</DialogTitle>
        </DialogHeader>
        <div v-if="detailLoading" class="py-8 text-center text-gray-400">加载中...</div>
        <div v-else-if="detailData" class="space-y-4">
          <div>
            <h3 class="text-sm font-medium text-gray-700 mb-1">基本信息</h3>
            <div class="bg-gray-50 rounded-md p-3 text-sm grid grid-cols-3 gap-2">
              <div><span class="text-gray-500">类型:</span> {{ detailData.api_type }}</div>
              <div><span class="text-gray-500">模型:</span> {{ detailData.model || '-' }}</div>
              <div><span class="text-gray-500">状态码:</span> {{ detailData.status_code || '-' }}</div>
              <div><span class="text-gray-500">延迟:</span> {{ detailData.latency_ms ? detailData.latency_ms + 'ms' : '-' }}</div>
              <div><span class="text-gray-500">流式:</span> {{ detailData.is_stream ? 'Yes' : 'No' }}</div>
              <div><span class="text-gray-500">时间:</span> {{ formatTime(detailData.created_at) }}</div>
            </div>
          </div>

          <!-- 四阶段请求链路 -->
          <details v-if="detailData.client_request" class="group">
            <summary class="text-sm font-medium text-gray-700 cursor-pointer select-none flex items-center gap-1">
              <span class="transition-transform group-open:rotate-90">&#9654;</span>
              客户端原始请求
            </summary>
            <pre class="bg-gray-900 text-green-400 rounded-md p-3 text-xs overflow-auto max-h-[25vh] whitespace-pre-wrap break-all mt-1">{{ formatJson(detailData.client_request) }}</pre>
          </details>
          <details v-if="detailData.upstream_request" class="group">
            <summary class="text-sm font-medium text-gray-700 cursor-pointer select-none flex items-center gap-1">
              <span class="transition-transform group-open:rotate-90">&#9654;</span>
              代理发送给 LLM API 的请求
            </summary>
            <pre class="bg-gray-900 text-yellow-400 rounded-md p-3 text-xs overflow-auto max-h-[25vh] whitespace-pre-wrap break-all mt-1">{{ formatJson(detailData.upstream_request) }}</pre>
          </details>
          <details v-if="detailData.upstream_response" class="group">
            <summary class="text-sm font-medium text-gray-700 cursor-pointer select-none flex items-center gap-1">
              <span class="transition-transform group-open:rotate-90">&#9654;</span>
              LLM API 返回的原始响应
            </summary>
            <pre class="bg-gray-900 text-blue-400 rounded-md p-3 text-xs overflow-auto max-h-[25vh] whitespace-pre-wrap break-all mt-1">{{ formatJson(detailData.upstream_response) }}</pre>
          </details>
          <details v-if="detailData.client_response" class="group">
            <summary class="text-sm font-medium text-gray-700 cursor-pointer select-none flex items-center gap-1">
              <span class="transition-transform group-open:rotate-90">&#9654;</span>
              代理返回给客户端的响应
            </summary>
            <pre class="bg-gray-900 text-purple-400 rounded-md p-3 text-xs overflow-auto max-h-[25vh] whitespace-pre-wrap break-all mt-1">{{ formatJson(detailData.client_response) }}</pre>
          </details>

          <!-- 兼容旧日志（无四阶段数据时展示旧字段） -->
          <template v-if="!detailData.client_request">
            <div>
              <h3 class="text-sm font-medium text-gray-700 mb-1">Request Body</h3>
              <pre class="bg-gray-900 text-green-400 rounded-md p-3 text-xs overflow-auto max-h-[25vh] whitespace-pre-wrap break-all">{{ formatJson(detailData.request_body) }}</pre>
            </div>
            <div>
              <h3 class="text-sm font-medium text-gray-700 mb-1">Response Body</h3>
              <pre class="bg-gray-900 text-blue-400 rounded-md p-3 text-xs overflow-auto max-h-[25vh] whitespace-pre-wrap break-all">{{ formatJson(detailData.response_body) }}</pre>
            </div>
          </template>
          <div v-if="detailData.error_message">
            <h3 class="text-sm font-medium text-gray-700 mb-1">错误信息</h3>
            <pre class="bg-red-50 text-red-600 rounded-md p-3 text-xs overflow-auto max-h-[10vh] whitespace-pre-wrap">{{ detailData.error_message }}</pre>
          </div>
        </div>
        <div v-else class="py-8 text-center text-gray-400">未找到日志</div>
      </DialogScrollContent>
    </Dialog>

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
import { Dialog, DialogContent, DialogScrollContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

interface LogEntry {
  id: string
  api_type: string
  model: string | null
  status_code: number | null
  latency_ms: number | null
  is_stream: number
  error_message: string | null
  created_at: string
  request_body: string | null
  response_body: string | null
  client_request: string | null
  upstream_request: string | null
  upstream_response: string | null
  client_response: string | null
}

const logs = ref<LogEntry[]>([])
const total = ref(0)
const page = ref(1)
const limit = 20
const filterType = ref('')
const showCleanup = ref(false)
const cleanupDays = ref(30)
const showDetail = ref(false)
const detailLoading = ref(false)
const detailData = ref<LogEntry | null>(null)

function formatJson(raw: string | null): string {
  if (!raw) return '(无数据)'
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

async function openDetail(id: string) {
  showDetail.value = true
  detailLoading.value = true
  detailData.value = null
  try {
    const res = await api.getLogDetail(id)
    detailData.value = res.data
  } catch (e) {
    console.error('Failed to load log detail:', e)
  } finally {
    detailLoading.value = false
  }
}

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
