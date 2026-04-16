<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold text-gray-900">请求日志</h2>
      <div class="flex items-center gap-2">
        <Select v-model="filterType" @update:model-value="handleFilterChange">
          <SelectTrigger class="w-[140px]">
            <SelectValue placeholder="全部类型" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            <SelectItem value="openai">OpenAI</SelectItem>
            <SelectItem value="anthropic">Anthropic</SelectItem>
          </SelectContent>
        </Select>
        <Select v-model="filterRouterKey" @update:model-value="handleFilterChange">
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
            <TableHead class="text-gray-600">ID</TableHead>
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
          <TableRow v-for="log in logs" :key="log.id" :class="{ 'bg-red-50/50': (log.status_code ?? 0) >= 400 }">
            <TableCell class="font-mono text-xs text-gray-400" :title="log.id">{{ log.id.slice(0, 8) }}</TableCell>
            <TableCell class="text-gray-500">{{ formatTime(log.created_at) }}</TableCell>
            <TableCell>
              <Badge :variant="log.api_type === 'openai' ? 'default' : 'secondary'">{{ log.api_type }}</Badge>
            </TableCell>
            <TableCell class="font-mono text-xs">{{ log.model || '-' }}</TableCell>
            <TableCell>
              <Badge :variant="(log.status_code ?? 0) < 400 ? 'default' : 'destructive'">{{ log.status_code || '-' }}</Badge>
            </TableCell>
            <TableCell>{{ log.latency_ms ? log.latency_ms + 'ms' : '-' }}</TableCell>
            <TableCell>{{ log.is_stream ? 'Yes' : 'No' }}</TableCell>
            <TableCell class="text-red-500 text-xs">{{ log.error_message || '-' }}</TableCell>
            <TableCell>
              <Button variant="ghost" size="sm" @click="openDetail(log.id)">详情</Button>
            </TableCell>
          </TableRow>
          <TableRow v-if="logs.length === 0">
            <TableCell colspan="9" class="text-center text-gray-400 py-8">暂无日志</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <div class="flex items-center justify-between mt-4">
      <p class="text-sm text-gray-500">共 {{ total }} 条</p>
      <div class="flex gap-1">
        <Button variant="outline" size="sm" @click="prevPage" :disabled="page <= 1">上一页</Button>
        <span class="px-3 py-1 text-sm text-gray-600">第 {{ page }} 页</span>
        <Button variant="outline" size="sm" @click="nextPage" :disabled="logs.length < PAGE_SIZE">下一页</Button>
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
              <div class="col-span-3"><span class="text-gray-500">ID:</span> <span class="font-mono text-xs select-all">{{ detailData.id }}</span></div>
              <div><span class="text-gray-500">类型:</span> {{ detailData.api_type }}</div>
              <div><span class="text-gray-500">模型:</span> {{ detailData.model || '-' }}</div>
              <div><span class="text-gray-500">状态码:</span> {{ detailData.status_code || '-' }}</div>
              <div><span class="text-gray-500">延迟:</span> {{ detailData.latency_ms ? detailData.latency_ms + 'ms' : '-' }}</div>
              <div><span class="text-gray-500">流式:</span> {{ detailData.is_stream ? 'Yes' : 'No' }}</div>
              <div><span class="text-gray-500">时间:</span> {{ formatTime(detailData.created_at) }}</div>
            </div>
          </div>

          <!-- 四阶段请求链路 -->
          <Collapsible v-if="detailData.client_request" class="space-y-1">
            <CollapsibleTrigger class="text-sm font-medium text-gray-700 cursor-pointer select-none flex items-center gap-1">
              <span class="transition-transform data-[state=open]:rotate-90">&#9654;</span>
              客户端原始请求
            </CollapsibleTrigger>
            <CollapsibleContent class="mt-1">
              <LogRequestViewer :raw="detailData.client_request" :api-type="asApiType(detailData.api_type)" />
            </CollapsibleContent>
          </Collapsible>
          <Collapsible v-if="detailData.upstream_request" class="space-y-1">
            <CollapsibleTrigger class="text-sm font-medium text-gray-700 cursor-pointer select-none flex items-center gap-1">
              <span class="transition-transform data-[state=open]:rotate-90">&#9654;</span>
              代理发送给 LLM API 的请求
            </CollapsibleTrigger>
            <CollapsibleContent class="mt-1">
              <LogRequestViewer show-url :raw="detailData.upstream_request" :api-type="asApiType(detailData.api_type)" />
            </CollapsibleContent>
          </Collapsible>
          <Collapsible v-if="detailData.upstream_response" class="space-y-1">
            <CollapsibleTrigger class="text-sm font-medium text-gray-700 cursor-pointer select-none flex items-center gap-1">
              <span class="transition-transform data-[state=open]:rotate-90">&#9654;</span>
              LLM API 返回的原始响应
            </CollapsibleTrigger>
            <CollapsibleContent class="mt-1">
              <LogResponseViewer :raw="detailData.upstream_response" :api-type="asApiType(detailData.api_type)" :is-stream="!!detailData.is_stream" />
            </CollapsibleContent>
          </Collapsible>
          <Collapsible v-if="detailData.client_response" class="space-y-1">
            <CollapsibleTrigger class="text-sm font-medium text-gray-700 cursor-pointer select-none flex items-center gap-1">
              <span class="transition-transform data-[state=open]:rotate-90">&#9654;</span>
              代理返回给客户端的响应
            </CollapsibleTrigger>
            <CollapsibleContent class="mt-1">
              <LogResponseViewer :raw="detailData.client_response" :api-type="asApiType(detailData.api_type)" :is-stream="!!detailData.is_stream" />
            </CollapsibleContent>
          </Collapsible>

          <!-- 兼容旧日志（无四阶段数据时展示旧字段） -->
          <template v-if="!detailData.client_request">
            <div v-if="detailData.request_body">
              <h3 class="text-sm font-medium text-gray-700 mb-1">Request Body</h3>
              <LogRequestViewer :raw="detailData.request_body" :api-type="asApiType(detailData.api_type)" />
            </div>
            <div v-if="detailData.response_body">
              <h3 class="text-sm font-medium text-gray-700 mb-1">Response Body</h3>
              <LogResponseViewer :raw="detailData.response_body" :api-type="asApiType(detailData.api_type)" :is-stream="!!detailData.is_stream" />
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
import { toast } from 'vue-sonner'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Dialog, DialogContent, DialogScrollContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import LogRequestViewer from '@/components/logs/LogRequestViewer.vue'
import LogResponseViewer from '@/components/logs/LogResponseViewer.vue'

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
const PAGE_SIZE = 20
const filterType = ref('all')
const filterRouterKey = ref('all')
const routerKeys = ref<{ id: string; name: string }[]>([])
const showCleanup = ref(false)
const cleanupDays = ref(30) // eslint-disable-line no-magic-numbers
const showDetail = ref(false)
const detailLoading = ref(false)
const detailData = ref<LogEntry | null>(null)

function asApiType(t: string): 'openai' | 'anthropic' {
  return t === 'openai' ? 'openai' : 'anthropic'
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
    toast.error('加载日志详情失败')
  } finally {
    detailLoading.value = false
  }
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN')
}

async function loadLogs() {
  try {
    const params: { page: number; limit: number; api_type?: string; router_key_id?: string } = { page: page.value, limit: PAGE_SIZE }
    if (filterType.value && filterType.value !== 'all') params.api_type = filterType.value
    if (filterRouterKey.value && filterRouterKey.value !== 'all') params.router_key_id = filterRouterKey.value
    const res = await api.getLogs(params)
    logs.value = res.data.data
    total.value = res.data.total
  } catch (e) {
    console.error('Failed to load logs:', e)
    toast.error('加载日志失败')
  }
}

function handleFilterChange() {
  page.value = 1
  loadLogs()
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
    const before = new Date(Date.now() - cleanupDays.value * 86400000).toISOString() // eslint-disable-line no-magic-numbers
    const res = await api.deleteLogsBefore(before)
    showCleanup.value = false
    page.value = 1
    await loadLogs()
    toast.success(`已清理 ${res.data.deleted} 条日志`)
  } catch (e) {
    console.error('Failed to cleanup logs:', e)
    toast.error('清理日志失败')
  }
}

async function loadRouterKeys() {
  try {
    const res = await api.getRouterKeys()
    routerKeys.value = res.data
  } catch (e) {
    console.error('Failed to load router keys:', e)
    toast.error('加载密钥列表失败')
  }
}

onMounted(() => {
  loadRouterKeys()
  loadLogs()
})
</script>
