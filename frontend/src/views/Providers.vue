<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold text-foreground">供应商</h2>
      <div class="flex items-center gap-2">
        <Button variant="outline" size="sm" @click="handleReload" :disabled="reloading">
          <RotateCw class="w-4 h-4 mr-1" :class="{ 'animate-spin': reloading }" />
          重载插件
        </Button>
        <Button @click="openCreate" class="flex items-center gap-1">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
          添加供应商
        </Button>
      </div>
    </div>
    <div class="bg-card rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow class="bg-muted">
            <TableHead class="text-muted-foreground">名称</TableHead>
            <TableHead class="text-muted-foreground">类型</TableHead>
            <TableHead class="text-muted-foreground">Base URL</TableHead>
            <TableHead class="text-muted-foreground">API Key</TableHead>
            <TableHead class="text-muted-foreground">模型</TableHead>
            <TableHead class="text-muted-foreground">并发</TableHead>
            <TableHead class="text-muted-foreground">状态</TableHead>
            <TableHead class="text-right text-muted-foreground">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="p in providers" :key="p.id" :class="{ 'opacity-60': !p.is_active }">
            <TableCell class="font-medium">{{ p.name }}</TableCell>
            <TableCell>
              <Badge variant="secondary">{{ p.api_type }}</Badge>
            </TableCell>
            <TableCell class="text-muted-foreground">{{ p.base_url }}</TableCell>
            <TableCell>
              <div class="flex items-center gap-1">
                <span class="font-mono text-xs text-muted-foreground">{{ maskKey(p.api_key) }}</span>
                <Button variant="ghost" size="sm" class="h-6 w-6 p-0" @click="copyKey(p.api_key, p.id)">
                  <component :is="copiedId === p.id ? Check : Copy" class="w-3.5 h-3.5" :class="{ 'text-success': copiedId === p.id }" />
                </Button>
              </div>
            </TableCell>
            <TableCell>
              <div class="flex flex-wrap gap-1">
                <Badge v-for="m in (p.models || [])" :key="m.name" variant="secondary" class="text-xs">
                  {{ m.name }}
                  <span v-if="m.context_window" class="ml-1 text-muted-foreground">({{ formatContextWindow(m.context_window) }})</span>
                </Badge>
                <span v-if="!p.models?.length" class="text-muted-foreground text-xs">-</span>
              </div>
            </TableCell>
            <TableCell>
              <Badge v-if="p.adaptive_enabled" variant="outline">自适应</Badge>
              <Badge v-else-if="p.max_concurrency > 0" variant="secondary">{{ p.max_concurrency }}</Badge>
              <span v-else class="text-muted-foreground">-</span>
            </TableCell>
            <TableCell>
              <Button variant="ghost" size="sm" class="gap-1.5" @click="confirmToggle(p)">
                <span
                  class="relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors"
                  :class="p.is_active ? 'bg-primary' : 'bg-input'"
                >
                  <span
                    class="inline-block h-3 w-3 rounded-full bg-background shadow-sm transition-transform"
                    :class="p.is_active ? 'translate-x-3.5' : 'translate-x-0.5'"
                  />
                </span>
                <Badge :variant="p.is_active ? 'default' : 'secondary'">
                  {{ p.is_active ? '启用' : '禁用' }}
                </Badge>
              </Button>
            </TableCell>
            <TableCell class="text-right">
              <Button variant="ghost" size="sm" @click="openEdit(p)" class="text-muted-foreground hover:text-primary mr-2">编辑</Button>
              <Button variant="ghost" size="sm" @click="confirmDelete(p)" class="text-muted-foreground hover:text-destructive">删除</Button>
            </TableCell>
          </TableRow>
          <TableRow v-if="providers.length === 0">
            <TableCell colspan="8" class="text-center text-muted-foreground py-8">暂无供应商</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
    <!-- Create/Edit Dialog -->
    <Dialog v-model:open="dialogOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ editingId ? '编辑供应商' : '添加供应商' }}</DialogTitle>
        </DialogHeader>
        <form @submit.prevent="handleSave" class="space-y-3">
          <!-- 快速配置 -->
          <div class="rounded-md border bg-muted/40 p-3 space-y-2">
            <div class="text-xs font-medium text-muted-foreground">快速配置</div>
            <div class="flex gap-2">
              <Select v-model="presetGroup" @update:model-value="onGroupChange">
                <SelectTrigger class="flex-1">
                  <SelectValue placeholder="选择供应商" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="g in providerPresets" :key="g.group" :value="g.group">{{ g.group }}</SelectItem>
                </SelectContent>
              </Select>
              <Select v-model="presetPlan" @update:model-value="onPresetChange" :disabled="!presetGroup">
                <SelectTrigger class="flex-1">
                  <SelectValue placeholder="选择套餐" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="p in availablePlans" :key="p.plan" :value="p.plan">{{ p.plan }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label class="block text-sm font-medium text-foreground mb-1">名称</Label>
            <Input v-model="form.name" type="text" required @input="delete errors.name" />
            <p v-if="errors.name" class="text-sm text-destructive mt-1">{{ errors.name }}</p>
          </div>
          <div>
            <Label class="block text-sm font-medium text-foreground mb-1">API 类型</Label>
            <Select v-model="form.api_type">
              <SelectTrigger>
                <SelectValue placeholder="选择 API 类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="anthropic">Anthropic</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label class="block text-sm font-medium text-foreground mb-1">Base URL</Label>
            <Input v-model="form.base_url" type="url" required @input="delete errors.base_url" />
            <p v-if="errors.base_url" class="text-sm text-destructive mt-1">{{ errors.base_url }}</p>
          </div>
          <div>
            <Label class="block text-sm font-medium text-foreground mb-1">API Key</Label>
            <Input v-model="form.api_key" type="text" :required="!editingId" :placeholder="editingId ? '留空则保持原密钥不变' : ''" @input="delete errors.api_key" />
            <p v-if="errors.api_key" class="text-sm text-destructive mt-1">{{ errors.api_key }}</p>
          </div>
          <div>
            <Label class="block text-sm font-medium text-foreground mb-1">可用模型</Label>
            <div class="flex flex-wrap gap-1.5 mb-1.5">
              <Badge v-for="(m, i) in form.models" :key="i" variant="secondary" class="gap-1 pr-1">
                {{ m.name }}
                <span class="text-muted-foreground">({{ formatContextWindow(m.context_window ?? DEFAULT_CONTEXT_WINDOW) }})</span>
                <Button type="button" variant="ghost" size="icon" class="h-4 w-4 rounded-full hover:bg-muted p-0 text-xs leading-none" @click="removeModel(i)">&times;</Button>
              </Badge>
            </div>
            <div class="flex gap-2">
              <Input v-model="modelInput" placeholder="输入模型名称，多个用逗号分隔" @keydown.enter.prevent="addModel" class="flex-1" />
              <Select v-model="contextWindowSelect">
                <SelectTrigger class="w-28">
                  <SelectValue placeholder="上下文" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="opt in CONTEXT_WINDOW_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</SelectItem>
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" size="sm" @click="addModel" :disabled="!modelInput.trim()">添加</Button>
            </div>
          </div>
          <!-- 并发控制 -->
          <div class="border-t pt-4 mt-4">
            <div class="text-sm font-medium text-foreground mb-3">并发控制</div>
            <div class="space-y-3">
              <div>
                <Label class="block text-sm font-medium text-foreground mb-1">模式</Label>
                <Select v-model="concurrencyMode" @update:model-value="(v: unknown) => onConcurrencyModeChange(v as 'auto' | 'manual' | 'none')">
                  <SelectTrigger>
                    <SelectValue placeholder="选择模式" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">自动（自适应）</SelectItem>
                    <SelectItem value="manual">手动</SelectItem>
                    <SelectItem value="none">无</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div v-if="concurrencyMode !== 'none'" class="space-y-2">
                <div>
                  <Label class="block text-sm font-medium text-foreground mb-1">最大并发度</Label>
                  <Input v-model.number="form.max_concurrency" type="number" min="1" :max="MAX_CONCURRENCY" :placeholder="concurrencyMode === 'auto' ? '10' : '3'" @input="delete errors.max_concurrency" />
                  <p v-if="errors.max_concurrency" class="text-sm text-destructive mt-1">{{ errors.max_concurrency }}</p>
                </div>
                <div>
                  <Label class="block text-sm font-medium text-foreground mb-1">队列超时 (ms)</Label>
                  <Input v-model.number="form.queue_timeout_ms" type="number" min="0" placeholder="0 = 无限等待" @input="delete errors.queue_timeout_ms" />
                  <p v-if="errors.queue_timeout_ms" class="text-sm text-destructive mt-1">{{ errors.queue_timeout_ms }}</p>
                </div>
                <div>
                  <Label class="block text-sm font-medium text-foreground mb-1">最大队列长度</Label>
                  <Input v-model.number="form.max_queue_size" type="number" min="1" :max="MAX_QUEUE_SIZE" :placeholder="DEFAULT_QUEUE_SIZE" @input="delete errors.max_queue_size" />
                  <p v-if="errors.max_queue_size" class="text-sm text-destructive mt-1">{{ errors.max_queue_size }}</p>
                </div>
              </div>
            </div>
          </div>
          <!-- 转换规则面板（仅在编辑现有 Provider 时显示） -->
          <Collapsible v-if="editingId" v-model:open="transformOpen" class="border rounded-md p-3 mt-2">
            <CollapsibleTrigger class="flex items-center justify-between w-full text-sm font-medium text-foreground">
              转换规则
              <ChevronDown class="w-4 h-4 transition-transform" :class="transformOpen ? 'rotate-180' : ''" />
            </CollapsibleTrigger>
            <CollapsibleContent class="mt-3 space-y-3">
              <div><Label class="text-xs text-muted-foreground">注入 Headers (JSON)</Label><Input v-model="transformForm.injectHeadersInput" placeholder='{"x-custom": "value"}' class="mt-1" /></div>
              <div><Label class="text-xs text-muted-foreground">丢弃字段（逗号分隔）</Label><Input v-model="transformForm.dropFieldsInput" placeholder="logprobs, frequency_penalty" class="mt-1" /></div>
              <div><Label class="text-xs text-muted-foreground">请求默认值 (JSON)</Label><Input v-model="transformForm.requestDefaultsInput" placeholder='{"max_tokens": 4096}' class="mt-1" /></div>
              <div class="flex gap-2"><Button type="button" variant="outline" size="sm" @click="saveTransformRules(editingId!)">保存规则</Button><Button type="button" variant="ghost" size="sm" @click="handleDeleteTransformRules(editingId!)" v-if="transformForm.exists">删除规则</Button></div>
            </CollapsibleContent>
          </Collapsible>
          <DialogFooter>
            <Button type="button" variant="outline" @click="dialogOpen = false">取消</Button>
            <Button type="submit">保存</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <!-- Delete Confirm AlertDialog -->
    <AlertDialog :open="!!deleteTarget" @update:open="(val) => { if (!val) deleteTarget = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除</AlertDialogTitle>
          <AlertDialogDescription>确定要删除供应商「{{ deleteTarget?.name }}」吗？此操作不可撤销。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <Button variant="destructive" @click="handleDelete">删除</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <!-- Toggle Confirm AlertDialog -->
    <AlertDialog :open="!!toggleTarget" @update:open="(val: boolean) => { if (!val) toggleTarget = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认{{ toggleTarget?.is_active ? '禁用' : '启用' }}</AlertDialogTitle>
          <AlertDialogDescription>
            确定要{{ toggleTarget?.is_active ? '禁用' : '启用' }}供应商「{{ toggleTarget?.name }}」吗？
            <div v-if="toggleDependencies.length" class="mt-2 space-y-1">
              <div class="text-sm font-medium">以下映射分组正在使用此供应商：</div>
              <div v-for="ref in toggleDependencies" :key="ref" class="text-destructive text-sm">{{ ref }}</div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction @click="handleToggle">确认</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { toast } from 'vue-sonner'
import * as z from 'zod'
import { api, getApiMessage, type ProviderPayload, type ProviderGroup } from '@/api/client'
import type { Provider, ModelInfo } from '@/types/mapping'
import { DEFAULT_CONTEXT_WINDOW } from '@/constants'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronDown, RotateCw, Copy, Check } from 'lucide-vue-next'
import { useTransformRules } from '@/composables/useTransformRules'
const DEFAULT_CONCURRENCY = 3
const DEFAULT_CONCURRENCY_AUTO = 10
const DEFAULT_QUEUE_TIMEOUT_MS = 120_000
const DEFAULT_QUEUE_SIZE = 10
const MAX_CONCURRENCY = 100
const MAX_QUEUE_SIZE = 1000
const CONTEXT_K = 1000
const CONTEXT_M = 1_000_000
const CONTEXT_WINDOW_OPTIONS = [
  { label: '8K', value: '8000' },
  { label: '16K', value: '16000' },
  { label: '32K', value: '32000' },
  { label: '64K', value: '64000' },
  { label: '128K', value: '128000' },
  { label: '160K', value: '160000' },
  { label: '200K', value: '200000' },
  { label: '256K', value: '256000' },
  { label: '1M', value: '1000000' },
] as const
const DEFAULT_FORM = { name: '', api_type: 'anthropic', base_url: '', api_key: '', models: [] as ModelInfo[], is_active: true, max_concurrency: DEFAULT_CONCURRENCY_AUTO, queue_timeout_ms: DEFAULT_QUEUE_TIMEOUT_MS, max_queue_size: DEFAULT_QUEUE_SIZE, adaptive_enabled: true }
const modelInput = ref('')
const modelContextWindow = ref(DEFAULT_CONTEXT_WINDOW)
const contextWindowSelect = computed({
  get: () => String(modelContextWindow.value),
  set: (val: string) => { modelContextWindow.value = Number(val) },
})
const providers = ref<Provider[]>([])
const providerPresets = ref<ProviderGroup[]>([])
const dialogOpen = ref(false)
const editingId = ref<string | null>(null)
const deleteTarget = ref<Provider | null>(null)
const toggleTarget = ref<Provider | null>(null)
const pendingToggleId = ref<string | null>(null)
const pendingToggleActive = ref<boolean>(false)
const toggleDependencies = ref<string[]>([])
const form = ref({ ...DEFAULT_FORM })
const errors = ref<Record<string, string>>({})
type ConcurrencyMode = 'auto' | 'manual' | 'none'
const concurrencyMode = ref<ConcurrencyMode>('auto')
// Transform rules state
const transformOpen = ref(false)
const { transformForm, loadTransformRules, saveTransformRules, handleDeleteTransformRules } = useTransformRules()
const copiedId = ref<string | null>(null)
const reloading = ref(false)
const MASK_VISIBLE_LEN = 7, MASK_ASTERISK_COUNT = 7, COPY_FEEDBACK_MS = 2000
const providerSchema = z.object({
  name: z.string().min(1, '请输入名称').regex(/^[a-zA-Z0-9_-]+$/, '仅允许英文、数字、横线和下划线'),
  base_url: z.string().min(1, '请输入 Base URL').url('请输入合法的 URL'),
})
function validate(): boolean {
  const errs: Record<string, string> = {}
  const result = providerSchema.safeParse({ name: form.value.name.trim(), base_url: form.value.base_url.trim() })
  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = issue.path[0] as string
      if (!errs[field]) errs[field] = issue.message
    }
  }
  if (!editingId.value && !form.value.api_key.trim()) errs.api_key = '请输入 API Key'
  if (concurrencyMode.value !== 'none') {
    const mc = form.value.max_concurrency
    if (!mc || mc < 1 || mc > MAX_CONCURRENCY) errs.max_concurrency = `范围 1-${MAX_CONCURRENCY}`
    if (form.value.queue_timeout_ms < 0) errs.queue_timeout_ms = '不能为负数'
    const qs = form.value.max_queue_size
    if (!qs || qs < 1 || qs > MAX_QUEUE_SIZE) errs.max_queue_size = `范围 1-${MAX_QUEUE_SIZE}`
  }
  errors.value = errs
  return Object.keys(errs).length === 0
}
function maskKey(key: string): string {
  if (!key) return ''
  const visible = key.slice(0, MASK_VISIBLE_LEN)
  return visible + '*'.repeat(MASK_ASTERISK_COUNT)
}
function formatContextWindow(tokens: number): string {
  if (tokens >= CONTEXT_M) return `${tokens / CONTEXT_M}M`
  if (tokens >= CONTEXT_K) return `${tokens / CONTEXT_K}K`
  return String(tokens)
}
async function copyKey(key: string, id: string) {
  await navigator.clipboard.writeText(key)
  copiedId.value = id
  setTimeout(() => { copiedId.value = null }, COPY_FEEDBACK_MS)
}
const presetGroup = ref(''), presetPlan = ref('')
const availablePlans = computed(() => {
  if (!presetGroup.value) return []
  return providerPresets.value.find(g => g.group === presetGroup.value)?.presets ?? []
})
function onGroupChange() {
  const plans = providerPresets.value.find(g => g.group === presetGroup.value)?.presets
  if (plans?.length) {
    presetPlan.value = plans[0].plan
    onPresetChange()
  } else {
    presetPlan.value = ''
  }
}
function onPresetChange() {
  const preset = availablePlans.value.find(p => p.plan === presetPlan.value)
  if (!preset) return
  form.value.name = preset.presetName
  form.value.api_type = preset.apiType
  form.value.base_url = preset.baseUrl
  form.value.models = preset.models.map(name => ({
    name,
    context_window: DEFAULT_CONTEXT_WINDOW,
  }))
}
async function loadProviders() {
  try {
    const data = await api.getProviders()
    providers.value = data
  } catch (e: unknown) {
    console.error('Failed to load providers:', e)
    toast.error(getApiMessage(e, '加载供应商失败'))
  }
}
function addModel() {
  const input = modelInput.value.trim()
  if (!input) return
  const names = input.split(/[,，]/).map(s => s.trim()).filter(Boolean)
  for (const name of names) {
    if (!form.value.models.some(m => m.name === name)) {
      form.value.models.push({ name, context_window: modelContextWindow.value || DEFAULT_CONTEXT_WINDOW })
    }
  }
  modelInput.value = ''
  modelContextWindow.value = DEFAULT_CONTEXT_WINDOW
}
function removeModel(index: number) {
  form.value.models.splice(index, 1)
}

function onConcurrencyModeChange(mode: ConcurrencyMode) {
  if (mode === 'auto') {
    if (!form.value.max_concurrency || form.value.max_concurrency < 1) form.value.max_concurrency = DEFAULT_CONCURRENCY_AUTO
    form.value.adaptive_enabled = true
  } else if (mode === 'manual') {
    if (!form.value.max_concurrency || form.value.max_concurrency < 1) form.value.max_concurrency = DEFAULT_CONCURRENCY
    form.value.adaptive_enabled = false
  }
}

function openCreate() {
  editingId.value = null
  form.value = { ...DEFAULT_FORM, models: [] }
  concurrencyMode.value = 'auto'
  modelInput.value = ''
  modelContextWindow.value = DEFAULT_CONTEXT_WINDOW
  presetGroup.value = ''
  presetPlan.value = ''
  errors.value = {}
  dialogOpen.value = true
}
function openEdit(p: Provider) {
  editingId.value = p.id
  const mc = p.max_concurrency ?? 0
  if (mc === 0) {
    concurrencyMode.value = 'none'
  } else if (p.adaptive_enabled) {
    concurrencyMode.value = 'auto'
  } else {
    concurrencyMode.value = 'manual'
  }
  form.value = { name: p.name, api_type: p.api_type, base_url: p.base_url, api_key: '', models: (p.models || []).map(m => ({ name: m.name, context_window: m.context_window ?? DEFAULT_CONTEXT_WINDOW })), is_active: !!p.is_active, max_concurrency: concurrencyMode.value === 'none' ? DEFAULT_CONCURRENCY_AUTO : mc, queue_timeout_ms: p.queue_timeout_ms ?? DEFAULT_QUEUE_TIMEOUT_MS, max_queue_size: p.max_queue_size ?? DEFAULT_QUEUE_SIZE, adaptive_enabled: concurrencyMode.value === 'auto' }
  modelInput.value = ''
  modelContextWindow.value = DEFAULT_CONTEXT_WINDOW
  presetGroup.value = ''
  presetPlan.value = ''
  errors.value = {}
  dialogOpen.value = true
  loadTransformRules(p.id)
}

type ProviderFormPayload = Pick<ProviderPayload, 'name' | 'api_type' | 'base_url' | 'models' | 'is_active' | 'max_concurrency' | 'queue_timeout_ms' | 'max_queue_size' | 'adaptive_enabled'> & { api_key?: string }

function buildPayload(): ProviderFormPayload {
  const payload: ProviderFormPayload = {
    name: form.value.name,
    api_type: form.value.api_type,
    base_url: form.value.base_url,
    models: form.value.models.map(m => ({ name: m.name, context_window: m.context_window ?? undefined })),
    is_active: form.value.is_active ? 1 : 0,
    max_concurrency: concurrencyMode.value === 'none' ? 0 : form.value.max_concurrency,
    queue_timeout_ms: concurrencyMode.value === 'none' ? 0 : form.value.queue_timeout_ms,
    max_queue_size: concurrencyMode.value === 'none' ? DEFAULT_QUEUE_SIZE : form.value.max_queue_size,
    adaptive_enabled: concurrencyMode.value === 'auto' ? 1 : 0,
  }
  if (form.value.api_key) payload.api_key = form.value.api_key
  return payload
}
async function handleSave() {
  if (!validate()) return
  try {
    const payload = buildPayload()
    payload.name = form.value.name.trim()
    if (editingId.value) {
      await api.updateProvider(editingId.value, payload)
    } else {
      payload.api_key = form.value.api_key
      await api.createProvider(payload)
    }
    dialogOpen.value = false
    await loadProviders()
  } catch (e: unknown) {
    console.error('Failed to save provider:', e)
    toast.error(getApiMessage(e, '保存供应商失败'))
  }
}
function confirmDelete(p: Provider) {
  deleteTarget.value = p
}
async function confirmToggle(p: Provider) {
  toggleTarget.value = p
  pendingToggleId.value = p.id
  pendingToggleActive.value = !!p.is_active
  toggleDependencies.value = []
  if (p.is_active) {
    try {
      const result = await api.getProviderDependencies(p.id)
      toggleDependencies.value = result.references
    } catch { /* eslint-disable-line taste/no-silent-catch -- 依赖查询失败不阻塞 toggle 弹框 */ }
  }
}
async function handleToggle() {
  const id = pendingToggleId.value
  if (!id) return
  const wasActive = pendingToggleActive.value
  toggleTarget.value = null
  pendingToggleId.value = null
  try {
    const res = await api.updateProvider(id, { is_active: wasActive ? 0 : 1 })
    if (res.cascadedGroups?.length) {
      const disabled = res.cascadedGroups.filter((g: { disabled: boolean }) => g.disabled).length
      const cleaned = res.cascadedGroups.length - disabled
      const parts: string[] = []
      if (cleaned > 0) parts.push(`清理 ${cleaned} 个分组的引用`)
      if (disabled > 0) parts.push(`禁用 ${disabled} 个分组`)
      toast.warning(`已自动${parts.join('、')}`)
    }
    await loadProviders()
  } catch (e: unknown) {
    console.error('Failed to toggle provider:', e)
    toast.error(getApiMessage(e, '切换状态失败'))
  }
}
async function handleDelete() {
  const target = deleteTarget.value
  if (!target) return
  deleteTarget.value = null
  try {
    await api.deleteProvider(target.id)
    await loadProviders()
  } catch (e: unknown) {
    console.error('Failed to delete provider:', e)
    toast.error(getApiMessage(e, '删除供应商失败'))
  }
}
async function handleReload() {
  reloading.value = true
  try {
    const result = await api.reloadTransformRules()
    toast.success(`插件重载完成：${result.loadedPlugins.length} 个插件，${result.rulesCount} 条规则`)
  } catch (e: unknown) {
    toast.error(getApiMessage(e, '重载失败'))
  } finally {
    reloading.value = false
  }
}
onMounted(async () => {
  const [presetsResult] = await Promise.allSettled([api.recommended.getProviders(), loadProviders()])
  if (presetsResult.status === 'fulfilled') {
    providerPresets.value = presetsResult.value
  } else {
    providerPresets.value = []
    console.error('Failed to load provider presets:', presetsResult.reason)
  }
})
</script>
