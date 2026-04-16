<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold text-foreground">请求日志</h2>
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
          class="text-destructive border-destructive hover:bg-destructive/10"
          @click="showCleanup = true"
        >
          清理日志
        </Button>
      </div>
    </div>

    <div class="bg-white rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow class="bg-muted">
            <TableHead class="text-muted-foreground">ID</TableHead>
            <TableHead class="text-muted-foreground">时间</TableHead>
            <TableHead class="text-muted-foreground">类型</TableHead>
            <TableHead class="text-muted-foreground">模型</TableHead>
            <TableHead class="text-muted-foreground">状态码</TableHead>
            <TableHead class="text-muted-foreground">延迟</TableHead>
            <TableHead class="text-muted-foreground">流式</TableHead>
            <TableHead class="text-muted-foreground">重试</TableHead>
            <TableHead class="text-muted-foreground">错误</TableHead>
            <TableHead class="text-muted-foreground">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="log in logs" :key="log.id" :class="{ 'bg-destructive/10': (log.status_code ?? 0) >= 400, 'bg-warning-light': log.is_retry }">
            <TableCell class="font-mono text-xs text-muted-foreground" :title="log.id">{{ log.id.slice(0, 8) }}</TableCell>
            <TableCell class="text-muted-foreground">{{ formatTime(log.created_at) }}</TableCell>
            <TableCell>
              <Badge :variant="log.api_type === 'openai' ? 'default' : 'secondary'">{{ log.api_type }}</Badge>
            </TableCell>
            <TableCell class="font-mono text-xs">{{ log.model || '-' }}</TableCell>
            <TableCell>
              <Badge :variant="(log.status_code ?? 0) < 400 ? 'default' : 'destructive'">{{ log.status_code || '-' }}</Badge>
            </TableCell>
            <TableCell>{{ log.latency_ms ? log.latency_ms + 'ms' : '-' }}</TableCell>
            <TableCell>{{ log.is_stream ? 'Yes' : 'No' }}</TableCell>
            <TableCell>
              <Badge v-if="log.is_retry" variant="outline" class="text-warning-dark border-warning">重试</Badge>
              <span v-else class="text-muted-foreground">-</span>
            </TableCell>
            <TableCell class="text-destructive text-xs">{{ log.error_message || '-' }}</TableCell>
            <TableCell>
              <Button variant="ghost" size="sm" @click="openDetail(log.id)">详情</Button>
            </TableCell>
          </TableRow>
          <TableRow v-if="logs.length === 0">
            <TableCell colspan="10" class="text-center text-muted-foreground py-8">暂无日志</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <div class="flex items-center justify-between mt-4">
      <p class="text-sm text-muted-foreground">共 {{ total }} 条</p>
      <div class="flex gap-1">
        <Button variant="outline" size="sm" @click="prevPage" :disabled="page <= 1">上一页</Button>
        <span class="px-3 py-1 text-sm text-muted-foreground">第 {{ page }} 页</span>
        <Button variant="outline" size="sm" @click="nextPage" :disabled="logs.length < PAGE_SIZE">下一页</Button>
      </div>
    </div>

    <!-- Detail Dialog -->
    <Dialog v-model:open="showDetail">
      <DialogScrollContent class="max-w-4xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle class="flex items-center gap-2">请求详情 <span v-if="detailData" class="font-mono text-xs text-muted-foreground font-normal select-all">{{ detailData.id }}</span></DialogTitle>
        </DialogHeader>
        <!-- 骨架屏加载状态 -->
        <template v-if="detailLoading">
          <div class="space-y-3 py-4">
            <div class="flex gap-2"><Skeleton class="h-6 w-16" /><Skeleton class="h-6 w-48" /><Skeleton class="h-6 w-12" /></div>
            <Skeleton class="h-12 w-full" v-for="n in 4" :key="n" />
          </div>
        </template>

        <template v-else-if="detailData">
          <!-- 重试关联信息 -->
          <div v-if="detailData.is_retry" class="flex items-center gap-2 mb-3 px-1">
            <Badge variant="outline" class="text-warning-dark border-warning">重试请求</Badge>
            <span class="text-xs text-muted-foreground">
              原始请求：
              <Button variant="link" class="h-auto p-0 text-xs font-mono text-primary underline" @click="jumpToRequest(detailData.original_request_id!)">
                {{ detailData.original_request_id?.slice(0, 8) }}
              </Button>
            </span>
          </div>
          <!-- 有四阶段数据：使用新组件 -->
          <template v-if="detailData.client_request">
            <LogDetailFlow
              v-if="viewState === 'timeline'"
              :log="detailData"
              :mode="globalMode"
              @select-stage="selectedStage = $event; viewState = 'detail'"
              @update:mode="globalMode = $event"
            />
            <LogStageDetail
              v-else
              :log="detailData"
              :stage="selectedStage"
              :mode="globalMode"
              @back="viewState = 'timeline'"
              @select-stage="selectedStage = $event"
              @update:mode="globalMode = $event"
            />
          </template>
          <!-- 旧日志兼容（无四阶段数据） -->
          <template v-else>
            <div v-if="detailData.request_body">
              <LogRequestViewer :raw="detailData.request_body" :api-type="asApiType(detailData.api_type)" />
            </div>
            <div v-if="detailData.response_body">
              <LogResponseViewer :raw="detailData.response_body" :api-type="asApiType(detailData.api_type)" :is-stream="!!detailData.is_stream" />
            </div>
          </template>
          <div v-if="detailData.error_message" class="mt-4 bg-danger-light text-danger-dark rounded-md p-3 text-sm">
            {{ detailData.error_message }}
          </div>
        </template>
        <div v-else class="py-8 text-center text-muted-foreground">未找到日志</div>
      </DialogScrollContent>
    </Dialog>

    <!-- Cleanup Dialog -->
    <Dialog v-model:open="showCleanup">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>清理日志</DialogTitle>
        </DialogHeader>
        <p class="text-sm text-muted-foreground">删除指定天数之前的日志</p>
        <div class="mb-4">
          <Label class="block text-sm font-medium text-foreground mb-1">保留最近天数</Label>
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
import { Skeleton } from '@/components/ui/skeleton'
import LogRequestViewer from '@/components/logs/LogRequestViewer.vue'
import LogResponseViewer from '@/components/logs/LogResponseViewer.vue'
import LogDetailFlow from '@/components/logs/LogDetailFlow.vue'
import LogStageDetail from '@/components/logs/LogStageDetail.vue'
import type { StageKey } from '@/components/logs/logColors'

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
  is_retry: number
  original_request_id: string | null
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

const viewState = ref<'timeline' | 'detail'>('timeline')
const selectedStage = ref<StageKey>('client_req')
const globalMode = ref<'structured' | 'raw'>('structured')

function asApiType(t: string): 'openai' | 'anthropic' {
  return t === 'openai' ? 'openai' : 'anthropic'
}

async function openDetail(id: string) {
  showDetail.value = true
  detailLoading.value = true
  detailData.value = null
  viewState.value = 'timeline'
  globalMode.value = 'structured'
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

function jumpToRequest(id: string) {
  openDetail(id)
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
