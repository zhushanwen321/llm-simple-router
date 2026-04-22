<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold text-foreground">供应商</h2>
      <Button @click="openCreate" class="flex items-center gap-1">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
        添加供应商
      </Button>
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
                  <component :is="copiedId === p.id ? Check : Copy" class="w-3.5 h-3.5" :class="{ 'text-green-500': copiedId === p.id }" />
                </Button>
              </div>
            </TableCell>
            <TableCell>
              <div class="flex flex-wrap gap-1">
                <Badge v-for="m in (p.models || [])" :key="m" variant="secondary" class="text-xs">{{ m }}</Badge>
                <span v-if="!p.models?.length" class="text-muted-foreground text-xs">-</span>
              </div>
            </TableCell>
            <TableCell>
              <Badge v-if="p.max_concurrency > 0" variant="secondary">{{ p.max_concurrency }}</Badge>
              <span v-else class="text-muted-foreground">-</span>
            </TableCell>
            <TableCell>
              <Badge :variant="p.is_active ? 'default' : 'secondary'">{{ p.is_active ? '启用' : '禁用' }}</Badge>
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
                {{ m }}
                <Button type="button" variant="ghost" size="icon" class="h-4 w-4 rounded-full hover:bg-muted p-0 text-xs leading-none" @click="removeModel(i)">&times;</Button>
              </Badge>
            </div>
            <div class="flex gap-2">
              <Input v-model="modelInput" placeholder="输入模型名称，多个用逗号分隔" @keydown.enter.prevent="addModel" class="flex-1" />
              <Button type="button" variant="outline" size="sm" @click="addModel" :disabled="!modelInput.trim()">添加</Button>
            </div>
          </div>
          <div>
            <div class="flex items-center gap-2 mb-1">
              <Switch v-model="concurrencyEnabled" id="concurrency-switch" />
              <Label for="concurrency-switch" class="text-sm text-foreground">并发控制</Label>
            </div>
            <div v-if="concurrencyEnabled" class="mt-2 space-y-2">
              <div>
                <Label class="block text-sm font-medium text-foreground mb-1">最大并发数</Label>
                <Input v-model.number="form.max_concurrency" type="number" min="1" :max="MAX_CONCURRENCY" placeholder="3" @input="delete errors.max_concurrency" />
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
          <div class="flex items-center gap-2">
            <Checkbox v-model="form.is_active" id="svc-active" />
            <Label for="svc-active" class="text-sm text-foreground">启用</Label>
          </div>
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { toast } from 'vue-sonner'
import * as z from 'zod'
import { api, type ProviderPayload, type ProviderGroup } from '@/api/client'
import type { Provider } from '@/types/mapping'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '@/components/ui/alert-dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Copy, Check } from 'lucide-vue-next'

const DEFAULT_CONCURRENCY = 3
const DEFAULT_QUEUE_TIMEOUT_MS = 120_000
const DEFAULT_QUEUE_SIZE = 10
const MAX_CONCURRENCY = 100
const MAX_QUEUE_SIZE = 1000
const DEFAULT_FORM = { name: '', api_type: 'anthropic', base_url: '', api_key: '', models: [] as string[], is_active: true, max_concurrency: DEFAULT_CONCURRENCY, queue_timeout_ms: DEFAULT_QUEUE_TIMEOUT_MS, max_queue_size: DEFAULT_QUEUE_SIZE }
const modelInput = ref('')

const providers = ref<Provider[]>([])
const providerPresets = ref<ProviderGroup[]>([])
const dialogOpen = ref(false)
const editingId = ref<string | null>(null)
const deleteTarget = ref<Provider | null>(null)
const form = ref({ ...DEFAULT_FORM })
const errors = ref<Record<string, string>>({})
const concurrencyEnabled = ref(false)
const copiedId = ref<string | null>(null)

const MASK_VISIBLE_LEN = 7
const MASK_ASTERISK_COUNT = 7
const COPY_FEEDBACK_MS = 2000

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
  if (concurrencyEnabled.value) {
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

async function copyKey(key: string, id: string) {
  await navigator.clipboard.writeText(key)
  copiedId.value = id
  setTimeout(() => { copiedId.value = null }, COPY_FEEDBACK_MS)
}

// 预设级联状态
const presetGroup = ref('')
const presetPlan = ref('')

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
  form.value.api_type = 'anthropic'
  form.value.base_url = preset.baseUrl
  form.value.models = [...preset.models]
}

async function loadProviders() {
  try {
    const data = await api.getProviders()
    providers.value = data
  } catch (e) {
    console.error('Failed to load providers:', e)
    toast.error('加载供应商失败')
  }
}

function addModel() {
  const input = modelInput.value.trim()
  if (!input) return
  const names = input.split(/[,，]/).map(s => s.trim()).filter(Boolean)
  for (const name of names) {
    if (!form.value.models.includes(name)) {
      form.value.models.push(name)
    }
  }
  modelInput.value = ''
}

function removeModel(index: number) {
  form.value.models.splice(index, 1)
}

function openCreate() {
  editingId.value = null
  form.value = { ...DEFAULT_FORM }
  concurrencyEnabled.value = true
  modelInput.value = ''
  presetGroup.value = ''
  presetPlan.value = ''
  errors.value = {}
  dialogOpen.value = true
}

function openEdit(p: Provider) {
  editingId.value = p.id
  form.value = { name: p.name, api_type: 'anthropic', base_url: p.base_url, api_key: '', models: [...(p.models || [])], is_active: !!p.is_active, max_concurrency: p.max_concurrency ?? DEFAULT_CONCURRENCY, queue_timeout_ms: p.queue_timeout_ms ?? DEFAULT_QUEUE_TIMEOUT_MS, max_queue_size: p.max_queue_size ?? DEFAULT_QUEUE_SIZE }
  concurrencyEnabled.value = (p.max_concurrency ?? 0) > 0
  modelInput.value = ''
  presetGroup.value = ''
  presetPlan.value = ''
  errors.value = {}
  dialogOpen.value = true
}

type ProviderFormPayload = Pick<ProviderPayload, 'name' | 'api_type' | 'base_url' | 'models' | 'is_active' | 'max_concurrency' | 'queue_timeout_ms' | 'max_queue_size'> & { api_key?: string }

function buildPayload(): ProviderFormPayload {
  const payload: ProviderFormPayload = {
    name: form.value.name,
    api_type: 'anthropic',
    base_url: form.value.base_url,
    models: form.value.models,
    is_active: form.value.is_active ? 1 : 0,
    max_concurrency: concurrencyEnabled.value ? form.value.max_concurrency : 0,
    queue_timeout_ms: concurrencyEnabled.value ? form.value.queue_timeout_ms : 0,
    max_queue_size: concurrencyEnabled.value ? form.value.max_queue_size : DEFAULT_QUEUE_SIZE,
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
  } catch (e) {
    console.error('Failed to save provider:', e)
    toast.error('保存供应商失败')
  }
}

function confirmDelete(p: Provider) {
  deleteTarget.value = p
}

async function handleDelete() {
  const target = deleteTarget.value
  if (!target) return
  deleteTarget.value = null
  try {
    await api.deleteProvider(target.id)
    await loadProviders()
  } catch (e) {
    console.error('Failed to delete provider:', e)
    toast.error('删除供应商失败')
  }
}

onMounted(async () => {
  try { providerPresets.value = await api.recommended.getProviders() } catch { providerPresets.value = [] }
  await loadProviders()
})
</script>
