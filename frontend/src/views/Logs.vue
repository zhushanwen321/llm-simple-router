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

    <div class="bg-card rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow class="bg-muted">
            <TableHead class="w-10"></TableHead>
            <TableHead class="text-muted-foreground">ID</TableHead>
            <TableHead class="text-muted-foreground">时间</TableHead>
            <TableHead class="text-muted-foreground">类型</TableHead>
            <TableHead class="text-muted-foreground">模型</TableHead>
            <TableHead class="text-muted-foreground">实际转发</TableHead>
            <TableHead class="text-muted-foreground">状态码</TableHead>
            <TableHead class="text-muted-foreground">延迟</TableHead>
            <TableHead class="text-muted-foreground">流式</TableHead>
            <TableHead class="text-muted-foreground">重试</TableHead>
            <TableHead class="text-muted-foreground">故障转移</TableHead>
            <TableHead class="text-muted-foreground">错误</TableHead>
            <TableHead class="text-muted-foreground">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <template v-for="log in logs" :key="log.id">
            <TableRow :class="{ 'bg-destructive/10': (log.status_code ?? 0) >= 400 }">
              <TableCell class="w-10">
                <Button v-if="(log as any).child_count > 0" variant="ghost" size="xs" @click="toggleExpand(log)">
                  <span class="text-xs transition-transform" :class="expandedRows.has(log.id) ? '' : '-rotate-90'">&#9660;</span>
                </Button>
              </TableCell>
              <TableCell class="font-mono text-xs text-muted-foreground" :title="log.id">{{ log.id.slice(0, 8) }}</TableCell>
              <TableCell class="text-muted-foreground">{{ formatTime(log.created_at) }}</TableCell>
              <TableCell>
                <Badge :variant="log.api_type === 'openai' ? 'default' : 'secondary'">{{ log.api_type }}</Badge>
              </TableCell>
              <TableCell class="font-mono text-xs">
                {{ log.model || '-' }}
                <Badge v-if="log.original_model" variant="secondary" class="ml-1 text-xs">已替换</Badge>
              </TableCell>
              <TableCell class="text-xs">
                <template v-if="log.provider_id === 'router'">
                  <Badge variant="secondary" class="text-[10px] px-1 py-0">代理增强：{{ enhancementLabel(log.upstream_request) }}</Badge>
                </template>
                <template v-else-if="log.backend_model || log.provider_name">
                  <span class="font-mono">{{ log.backend_model || '-' }}</span>
                  <span class="text-muted-foreground"> @ </span>
                  <Badge variant="outline" class="text-[10px] px-1 py-0">{{ log.provider_name || log.provider_id || '-' }}</Badge>
                </template>
                <span v-else class="text-muted-foreground">-</span>
              </TableCell>
              <TableCell>
                <Badge :variant="(log.status_code ?? 0) < 400 ? 'default' : 'destructive'">{{ log.status_code || '-' }}</Badge>
              </TableCell>
              <TableCell>{{ log.latency_ms ? log.latency_ms + 'ms' : '-' }}</TableCell>
              <TableCell>{{ log.is_stream ? 'Yes' : 'No' }}</TableCell>
              <TableCell>
                <Badge v-if="log.is_retry" variant="outline" class="text-warning-dark border-warning">重试</Badge>
                <span v-else class="text-muted-foreground">-</span>
              </TableCell>
              <TableCell>
                <Badge v-if="log.is_failover" variant="outline" class="text-orange-500 border-orange-400">故障转移</Badge>
                <span v-else class="text-muted-foreground">-</span>
              </TableCell>
              <TableCell class="text-destructive text-xs">{{ log.error_message || '-' }}</TableCell>
              <TableCell>
                <Button variant="ghost" size="sm" @click="openLogDetail(log.id)">详情</Button>
              </TableCell>
            </TableRow>

            <!-- Expanded child rows -->
            <template v-if="expandedRows.has(log.id)">
              <TableRow v-if="childLoading[log.id]">
                <TableCell colspan="13" class="text-center py-2 pl-10">
                  <Skeleton class="h-4 w-32 mx-auto" />
                </TableCell>
              </TableRow>
              <template v-else-if="childLogs[log.id]?.length">
                <TableRow v-for="child in childLogs[log.id]" :key="child.id" class="bg-muted/20">
                  <TableCell class="w-10"><span class="ml-4 text-muted-foreground text-xs">└</span></TableCell>
                  <TableCell class="font-mono text-xs text-muted-foreground" :title="child.id">{{ child.id.slice(0, 8) }}</TableCell>
                  <TableCell class="text-muted-foreground">{{ formatTime(child.created_at) }}</TableCell>
                  <TableCell><Badge :variant="child.api_type === 'openai' ? 'default' : 'secondary'">{{ child.api_type }}</Badge></TableCell>
                  <TableCell class="font-mono text-xs">{{ child.model || '-' }}</TableCell>
                  <TableCell class="text-xs">
                    <template v-if="child.backend_model || child.provider_name">
                      <span class="font-mono">{{ child.backend_model || '-' }}</span>
                      <span class="text-muted-foreground"> @ </span>
                      <Badge variant="outline" class="text-[10px] px-1 py-0">{{ child.provider_name || child.provider_id || '-' }}</Badge>
                    </template>
                    <span v-else class="text-muted-foreground">-</span>
                  </TableCell>
                  <TableCell><Badge :variant="(child.status_code ?? 0) < 400 ? 'default' : 'destructive'">{{ child.status_code || '-' }}</Badge></TableCell>
                  <TableCell>{{ child.latency_ms ? child.latency_ms + 'ms' : '-' }}</TableCell>
                  <TableCell>{{ child.is_stream ? 'Yes' : 'No' }}</TableCell>
                  <TableCell>
                    <Badge v-if="child.is_retry" variant="outline" class="text-warning-dark border-warning">重试</Badge>
                    <span v-else class="text-muted-foreground">-</span>
                  </TableCell>
                  <TableCell>
                    <Badge v-if="child.is_failover" variant="outline" class="text-orange-500 border-orange-400">故障转移</Badge>
                    <span v-else class="text-muted-foreground">-</span>
                  </TableCell>
                  <TableCell class="text-destructive text-xs">{{ child.error_message || '-' }}</TableCell>
                  <TableCell><Button variant="ghost" size="sm" @click="openLogDetail(child.id)">详情</Button></TableCell>
                </TableRow>
              </template>
            </template>
          </template>

          <TableRow v-if="logs.length === 0">
            <TableCell colspan="13" class="text-center text-muted-foreground py-8">暂无日志</TableCell>
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

    <!-- Shared log detail dialog -->
    <LogDetailDialog ref="logDetailRef" v-model:open="logDetailOpen" />

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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import LogDetailDialog from '@/components/monitor/LogDetailDialog.vue'

interface LogEntry {
  id: string
  api_type: string
  model: string | null
  provider_id: string | null
  status_code: number | null
  latency_ms: number | null
  is_stream: number
  error_message: string | null
  created_at: string
  is_retry: number
  is_failover: number
  original_request_id: string | null
  original_model: string | null
  upstream_request: string | null
  backend_model: string | null
  provider_name: string | null
  child_count?: number
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

const expandedRows = ref<Set<string>>(new Set())
const childLogs = ref<Record<string, LogEntry[]>>({})
const childLoading = ref<Record<string, boolean>>({})
const logDetailOpen = ref(false)
const logDetailRef = ref<InstanceType<typeof LogDetailDialog> | null>(null)

function enhancementLabel(raw: string | null): string {
  if (!raw) return '未知'
  try {
    const meta = JSON.parse(raw)
    if (meta.action) {
      return meta.detail ? `${meta.action}: ${meta.detail}` : meta.action
    }
    return raw
  } catch { return '未知' }
}

async function toggleExpand(log: LogEntry) {
  const id = log.id
  if (expandedRows.value.has(id)) {
    expandedRows.value.delete(id)
    return
  }
  expandedRows.value.add(id)
  if (!childLogs.value[id]) {
    childLoading.value[id] = true
    try {
      const res = await api.getLogChildren(id)
      childLogs.value[id] = res.data
    } catch (e) {
      console.error('Failed to load child logs:', e)
      toast.error('加载子请求失败')
    } finally {
      childLoading.value[id] = false
    }
  }
}

function openLogDetail(id: string) {
  logDetailOpen.value = true
  logDetailRef.value?.load(id)
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN')
}

async function loadLogs() {
  try {
    const params: { page: number; limit: number; api_type?: string; router_key_id?: string; view?: string } = { page: page.value, limit: PAGE_SIZE, view: 'grouped' }
    if (filterType.value && filterType.value !== 'all') params.api_type = filterType.value
    if (filterRouterKey.value && filterRouterKey.value !== 'all') params.router_key_id = filterRouterKey.value
    const res = await api.getLogs(params)
    logs.value = res.data.data
    total.value = res.data.total
    expandedRows.value.clear()
    childLogs.value = {}
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
