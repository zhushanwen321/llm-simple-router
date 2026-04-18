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
            <TableHead class="text-muted-foreground">ID</TableHead>
            <TableHead class="text-muted-foreground">时间</TableHead>
            <TableHead class="text-muted-foreground">类型</TableHead>
            <TableHead class="text-muted-foreground">模型</TableHead>
            <TableHead class="text-muted-foreground">实际转发</TableHead>
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
          <DialogDescription class="sr-only">请求日志详情</DialogDescription>
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

          <!-- 基本信息 -->
          <div class="bg-muted/50 rounded-md p-3 text-sm grid grid-cols-3 gap-2">
            <div><span class="text-muted-foreground">类型:</span> <Badge :variant="detailData.api_type === 'openai' ? 'default' : 'secondary'" class="text-xs">{{ detailData.api_type }}</Badge></div>
            <div><span class="text-muted-foreground">模型:</span> <span class="font-medium font-mono">{{ detailData.model || '-' }}</span></div>
            <div v-if="detailData.original_model" class="col-span-3"><span class="text-muted-foreground">模型替换:</span> <span class="font-mono text-xs">{{ detailData.original_model }} → {{ detailData.backend_model || detailData.model }}</span></div>
            <div><span class="text-muted-foreground">状态码:</span> <Badge :variant="(detailData.status_code ?? 0) < 400 ? 'default' : 'destructive'" class="text-xs">{{ detailData.status_code || '-' }}</Badge></div>
            <div><span class="text-muted-foreground">延迟:</span> <span class="font-medium">{{ detailData.latency_ms ? detailData.latency_ms + 'ms' : '-' }}</span></div>
            <div><span class="text-muted-foreground">流式:</span> <span class="font-medium">{{ detailData.is_stream ? 'Yes' : 'No' }}</span></div>
            <div><span class="text-muted-foreground">时间:</span> <span class="font-medium">{{ formatTime(detailData.created_at) }}</span></div>
          </div>

          <!-- 客户端原始请求 -->
          <Collapsible v-model:open="requestOpen" class="border rounded-md">
            <CollapsibleTrigger as-child>
              <Button variant="ghost" class="w-full px-4 py-3 text-left text-sm font-medium text-foreground bg-muted/50 hover:bg-muted rounded-none rounded-t-md flex items-center gap-2">
                <span class="text-xs transition-transform" :class="requestOpen ? 'rotate-0' : '-rotate-90'">&#9660;</span>
                客户端原始请求
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div class="flex items-center justify-between px-4 py-2 border-b sticky top-0 z-10 bg-background">
                <div class="inline-flex h-8 items-center gap-1 rounded-md bg-muted p-1">
                  <Button variant="ghost" size="xs" :class="sectionModes.client_request === 'structured' ? 'bg-background shadow' : ''" @click="sectionModes.client_request = 'structured'">结构化</Button>
                  <Button variant="ghost" size="xs" :class="sectionModes.client_request === 'raw' ? 'bg-background shadow' : ''" @click="sectionModes.client_request = 'raw'">原始 JSON</Button>
                </div>
                <Button variant="ghost" size="xs" class="h-auto py-1" @click="copySection('client_request')">
                  {{ copiedSection === 'client_request' ? '已复制' : '复制' }}
                </Button>
              </div>
              <div class="p-4">
                <LogRequestViewer :raw="getClientRequestRaw(detailData)" :api-type="asApiType(detailData.api_type)" :mode="sectionModes.client_request" />
              </div>
            </CollapsibleContent>
          </Collapsible>

          <!-- Router→LLM API 请求 -->
          <Collapsible v-if="detailData.upstream_request && !isIntercepted(detailData)" v-model:open="upstreamRequestOpen" class="border rounded-md">
            <CollapsibleTrigger as-child>
              <Button variant="ghost" class="w-full px-4 py-3 text-left text-sm font-medium text-foreground bg-muted/50 hover:bg-muted rounded-none rounded-t-md flex items-center gap-2">
                <span class="text-xs transition-transform" :class="upstreamRequestOpen ? 'rotate-0' : '-rotate-90'">&#9660;</span>
                Router → LLM API 请求
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div class="flex items-center justify-between px-4 py-2 border-b sticky top-0 z-10 bg-background">
                <div class="inline-flex h-8 items-center gap-1 rounded-md bg-muted p-1">
                  <Button variant="ghost" size="xs" :class="sectionModes.upstream_request === 'structured' ? 'bg-background shadow' : ''" @click="sectionModes.upstream_request = 'structured'">结构化</Button>
                  <Button variant="ghost" size="xs" :class="sectionModes.upstream_request === 'raw' ? 'bg-background shadow' : ''" @click="sectionModes.upstream_request = 'raw'">原始 JSON</Button>
                </div>
                <Button variant="ghost" size="xs" class="h-auto py-1" @click="copySection('upstream_request')">
                  {{ copiedSection === 'upstream_request' ? '已复制' : '复制' }}
                </Button>
              </div>
              <div class="p-4">
                <LogRequestViewer :raw="detailData.upstream_request" :api-type="asApiType(detailData.api_type)" :show-url="true" :mode="sectionModes.upstream_request" />
              </div>
            </CollapsibleContent>
          </Collapsible>

          <!-- LLM API 返回的原始响应（拦截请求无上游调用，隐藏此栏） -->
          <Collapsible v-if="!isIntercepted(detailData)" v-model:open="responseOpen" class="border rounded-md">
            <CollapsibleTrigger as-child>
              <Button variant="ghost" class="w-full px-4 py-3 text-left text-sm font-medium text-foreground bg-muted/50 hover:bg-muted rounded-none rounded-t-md flex items-center gap-2">
                <span class="text-xs transition-transform" :class="responseOpen ? 'rotate-0' : '-rotate-90'">&#9660;</span>
                LLM API 返回的原始响应
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div class="flex items-center justify-between px-4 py-2 border-b sticky top-0 z-10 bg-background">
                <div class="inline-flex h-8 items-center gap-1 rounded-md bg-muted p-1">
                  <Button variant="ghost" size="xs" :class="sectionModes.upstream_response === 'structured' ? 'bg-background shadow' : ''" @click="sectionModes.upstream_response = 'structured'">结构化</Button>
                  <Button variant="ghost" size="xs" :class="sectionModes.upstream_response === 'raw' ? 'bg-background shadow' : ''" @click="sectionModes.upstream_response = 'raw'">{{ detailData.is_stream ? '原始 SSE 文本' : '原始 JSON' }}</Button>
                </div>
                <Button variant="ghost" size="xs" class="h-auto py-1" @click="copySection('upstream_response')">
                  {{ copiedSection === 'upstream_response' ? '已复制' : '复制' }}
                </Button>
              </div>
              <div class="p-4">
                <LogResponseViewer :raw="detailData.upstream_response || detailData.response_body || '{}'" :api-type="asApiType(detailData.api_type)" :is-stream="!!detailData.is_stream" :mode="sectionModes.upstream_response" />
              </div>
            </CollapsibleContent>
          </Collapsible>

          <!-- Router→客户端响应 -->
          <Collapsible v-if="getClientResponseRaw(detailData)" v-model:open="clientResponseOpen" class="border rounded-md">
            <CollapsibleTrigger as-child>
              <Button variant="ghost" class="w-full px-4 py-3 text-left text-sm font-medium text-foreground bg-muted/50 hover:bg-muted rounded-none rounded-t-md flex items-center gap-2">
                <span class="text-xs transition-transform" :class="clientResponseOpen ? 'rotate-0' : '-rotate-90'">&#9660;</span>
                Router → 客户端响应
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div class="flex items-center justify-between px-4 py-2 border-b sticky top-0 z-10 bg-background">
                <div class="inline-flex h-8 items-center gap-1 rounded-md bg-muted p-1">
                  <Button variant="ghost" size="xs" :class="sectionModes.client_response === 'structured' ? 'bg-background shadow' : ''" @click="sectionModes.client_response = 'structured'">结构化</Button>
                  <Button variant="ghost" size="xs" :class="sectionModes.client_response === 'raw' ? 'bg-background shadow' : ''" @click="sectionModes.client_response = 'raw'">{{ detailData.is_stream ? '原始 SSE 文本' : '原始 JSON' }}</Button>
                </div>
                <Button variant="ghost" size="xs" class="h-auto py-1" @click="copySection('client_response')">
                  {{ copiedSection === 'client_response' ? '已复制' : '复制' }}
                </Button>
              </div>
              <div class="p-4">
                <LogResponseViewer :raw="getClientResponseRaw(detailData)" :api-type="asApiType(detailData.api_type)" :is-stream="!!detailData.is_stream" :mode="sectionModes.client_response" />
              </div>
            </CollapsibleContent>
          </Collapsible>

          <!-- 错误信息 -->
          <Card v-if="detailData.error_message" class="bg-destructive/10 ring-destructive/20">
            <CardContent class="py-3 text-sm text-destructive">{{ detailData.error_message }}</CardContent>
          </Card>
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
import { ref, reactive, onMounted } from 'vue'
import { toast } from 'vue-sonner'
import { api } from '@/api/client'
import { useClipboard } from '@/composables/useClipboard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Dialog, DialogContent, DialogScrollContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Skeleton } from '@/components/ui/skeleton'
import LogRequestViewer from '@/components/log-viewer/LogRequestViewer.vue'
import LogResponseViewer from '@/components/log-viewer/LogResponseViewer.vue'

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
  request_body: string | null
  response_body: string | null
  client_request: string | null
  upstream_request: string | null
  upstream_response: string | null
  client_response: string | null
  is_retry: number
  original_request_id: string | null
  original_model: string | null
  backend_model: string | null
  provider_name: string | null
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

const requestOpen = ref(true)
const upstreamRequestOpen = ref(false)
const responseOpen = ref(false)
const clientResponseOpen = ref(false)

type SectionKey = 'client_request' | 'upstream_request' | 'upstream_response' | 'client_response'
const sectionModes = reactive<Record<SectionKey, 'structured' | 'raw'>>({
  client_request: 'structured',
  upstream_request: 'structured',
  upstream_response: 'structured',
  client_response: 'structured',
})
const copiedSection = ref<SectionKey | null>(null)
const { copy: clipboardCopy } = useClipboard()

function getSectionRaw(key: SectionKey): string {
  if (!detailData.value) return '{}'
  const map: Record<SectionKey, string> = {
    client_request: getClientRequestRaw(detailData.value),
    upstream_request: detailData.value.upstream_request || '{}',
    upstream_response: detailData.value.upstream_response || detailData.value.response_body || '{}',
    client_response: getClientResponseRaw(detailData.value),
  }
  return map[key]
}

async function copySection(key: SectionKey) {
  const ok = await clipboardCopy(getSectionRaw(key))
  if (ok) {
    copiedSection.value = key
    setTimeout(() => { copiedSection.value = null }, 2000) // eslint-disable-line no-magic-numbers
  } else {
    toast.error('复制失败')
  }
}

function asApiType(t: string): 'openai' | 'anthropic' {
  return t === 'openai' ? 'openai' : 'anthropic'
}

function enhancementLabel(raw: string | null): string {
  if (!raw) return '未知'
  try {
    const meta = JSON.parse(raw)
    if (meta.action) {
      return meta.detail ? `${meta.action}: ${meta.detail}` : meta.action
    }
  } catch { /* ignore */ }
  return '未知'
}

function isIntercepted(log: LogEntry): boolean {
  return log.provider_id === 'router'
}

/** 组装客户端请求数据：当 client_request 缺少 body 时从 request_body 补充 */
function getClientRequestRaw(detail: LogEntry): string {
  if (!detail.client_request) return detail.request_body || '{}'
  try {
    const cr = JSON.parse(detail.client_request)
    if (cr.body != null) return detail.client_request
    if (detail.request_body) {
      try { cr.body = JSON.parse(detail.request_body) } catch { cr.body = detail.request_body }
      return JSON.stringify(cr)
    }
  } catch { /* 解析失败则原样返回 */ }
  return detail.client_request
}

/** 组装客户端响应数据：client_response 为空时从 response_body 构造 */
function getClientResponseRaw(detail: LogEntry): string {
  if (detail.client_response) return detail.client_response
  if (detail.response_body) {
    return JSON.stringify({ statusCode: detail.status_code, body: detail.response_body })
  }
  return ''
}

async function openDetail(id: string) {
  showDetail.value = true
  detailLoading.value = true
  detailData.value = null
  requestOpen.value = true
  upstreamRequestOpen.value = false
  responseOpen.value = false
  clientResponseOpen.value = false
  sectionModes.client_request = 'structured'
  sectionModes.upstream_request = 'structured'
  sectionModes.upstream_response = 'structured'
  sectionModes.client_response = 'structured'
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
