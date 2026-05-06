<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold text-foreground">{{ t('providers.title') }}</h2>
      <div class="flex items-center gap-2">
        <Button variant="outline" size="sm" @click="handleReload" :disabled="reloading">
          <RotateCw class="w-4 h-4 mr-1" :class="{ 'animate-spin': reloading }" />
          {{ t('providers.reloadPlugin') }}
        </Button>
        <Button @click="openCreate" class="flex items-center gap-1">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
          {{ t('providers.addProvider') }}
        </Button>
      </div>
    </div>
    <div class="bg-card rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow class="bg-muted">
            <TableHead class="text-muted-foreground">{{ t('providers.tableHeaders.name') }}</TableHead>
            <TableHead class="text-muted-foreground">{{ t('providers.tableHeaders.type') }}</TableHead>
            <TableHead class="text-muted-foreground">{{ t('providers.tableHeaders.baseUrl') }}</TableHead>
            <TableHead class="text-xs">Path</TableHead>
            <TableHead class="text-muted-foreground">{{ t('providers.tableHeaders.apiKey') }}</TableHead>
            <TableHead class="text-muted-foreground">{{ t('providers.tableHeaders.models') }}</TableHead>
            <TableHead class="text-muted-foreground">{{ t('providers.tableHeaders.concurrency') }}</TableHead>
            <TableHead class="text-muted-foreground">{{ t('providers.tableHeaders.status') }}</TableHead>
            <TableHead class="text-right text-muted-foreground">{{ t('providers.tableHeaders.actions') }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="p in providers" :key="p.id" :class="{ 'opacity-60': !p.is_active }">
            <TableCell class="font-medium">{{ p.name }}</TableCell>
            <TableCell>
              <Badge variant="secondary">{{ API_TYPE_LABELS[p.api_type] ?? p.api_type }}</Badge>
            </TableCell>
            <TableCell>
              <div class="flex items-center gap-1">
                <span class="text-muted-foreground">{{ p.base_url }}</span>
                <Shield v-if="p.proxy_type" class="w-3 h-3 text-muted-foreground" :title="`Proxy: ${p.proxy_type.toUpperCase()}`" />
              </div>
            </TableCell>
            <TableCell class="text-muted-foreground text-xs">{{ p.upstream_path || (p.api_type === 'anthropic' ? '/v1/messages' : '/v1/chat/completions') }}</TableCell>
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
              <Badge v-if="p.adaptive_enabled" variant="outline">{{ t('common.adaptive') }}</Badge>
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
                  {{ p.is_active ? t('common.enabled') : t('common.disabled') }}
                </Badge>
              </Button>
            </TableCell>
            <TableCell class="text-right">
              <Button variant="ghost" size="sm" @click="openEdit(p)" class="text-muted-foreground hover:text-primary mr-2">{{ t('common.edit') }}</Button>
              <Button variant="ghost" size="sm" @click="confirmDelete(p)" class="text-muted-foreground hover:text-destructive">{{ t('common.delete') }}</Button>
            </TableCell>
          </TableRow>
          <TableRow v-if="providers.length === 0">
            <TableCell colspan="9" class="text-center text-muted-foreground py-8">{{ t('providers.noProviders') }}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
    <!-- Create/Edit Dialog -->
    <Dialog v-model:open="dialogOpen">
      <DialogContent class="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{{ editingId ? t('providers.editProvider') : t('providers.addProvider') }}</DialogTitle>
        </DialogHeader>
        <form @submit.prevent="handleSave" class="space-y-4">
          <!-- 模板选择 (仅新建模式) -->
          <div v-if="!editingId" class="rounded-md border-2 border-primary/30 bg-primary/5 p-3 space-y-2">
            <div class="flex items-center gap-1.5 text-xs font-semibold text-primary">
              <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
              {{ t('providers.template.title') }}
            </div>
            <div class="flex gap-2">
              <Select v-model="presetGroup" @update:model-value="onGroupChange">
                <SelectTrigger class="flex-1 border-primary/40"><SelectValue :placeholder="t('providers.template.selectProvider')" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__custom__">{{ t('providers.template.custom') }}</SelectItem>
                  <SelectItem v-for="g in providerPresets" :key="g.group" :value="g.group">{{ g.group }}</SelectItem>
                </SelectContent>
              </Select>
              <Select v-if="presetGroup !== '__custom__'" v-model="presetPlan" @update:model-value="onPresetChange" :disabled="!presetGroup || presetGroup === '__custom__'">
                <SelectTrigger class="flex-1 border-primary/40"><SelectValue :placeholder="t('providers.template.selectPlan')" /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="p in availablePlans" :key="p.plan" :value="p.plan">{{ p.plan }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <!-- 未选模板提示 (仅新建模式) -->
          <div v-if="!presetGroup && !editingId" class="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <svg class="w-10 h-10 mb-3 opacity-30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 12l2 2 4-4"/></svg>
            <span class="text-sm">{{ t('providers.template.selectFirst') }}</span>
          </div>

          <template v-if="presetGroup || editingId">
          <!-- 基本信息 2x2 -->
          <div class="grid grid-cols-2 gap-3">
            <div>
              <Label class="text-xs text-muted-foreground">{{ t('providers.fields.name') }}</Label>
              <Input v-model="form.name" type="text" required class="mt-1" @input="delete errors.name" />
              <p v-if="errors.name" class="text-xs text-destructive mt-0.5">{{ errors.name }}</p>
            </div>
            <div>
              <Label class="text-xs text-muted-foreground">{{ t('providers.fields.apiType') }}</Label>
              <Select v-model="form.api_type" class="mt-1">
                <SelectTrigger><SelectValue :placeholder="t('common.pleaseSelect')" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI Chat Completions</SelectItem>
                  <SelectItem value="openai-responses">OpenAI Responses</SelectItem>
                  <SelectItem value="anthropic">Anthropic Messages</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label class="text-xs text-muted-foreground">{{ t('providers.fields.baseUrl') }}</Label>
              <Input v-model="form.base_url" type="url" required class="mt-1 font-mono text-xs" @input="delete errors.base_url" />
              <p v-if="errors.base_url" class="text-xs text-destructive mt-0.5">{{ errors.base_url }}</p>
            </div>
            <div>
              <Label class="text-xs text-muted-foreground">{{ t('providers.fields.apiKey') }}</Label>
              <Input v-model="form.api_key" type="text" :required="!editingId" :placeholder="editingId ? t('providers.fields.apiKeyPlaceholder') : ''" class="mt-1" @input="delete errors.api_key" />
              <p v-if="errors.api_key" class="text-xs text-destructive mt-0.5">{{ errors.api_key }}</p>
            </div>
          </div>
          <!-- Upstream Path -->
          <div>
            <Label class="text-xs">Upstream Path</Label>
            <Input v-model="form.upstream_path" placeholder="默认: /v1/chat/completions 或 /v1/messages" class="mt-1 font-mono text-xs" />
            <p class="text-xs text-muted-foreground mt-0.5">留空使用 API 类型默认路径</p>
          </div>

          <!-- Proxy Configuration -->
          <div class="border rounded-md p-3 space-y-3">
            <div class="text-xs font-medium text-muted-foreground">{{ t('providers.fields.proxyTitle') }}</div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <Label class="text-xs text-muted-foreground">{{ t('providers.fields.proxyType') }}</Label>
                <Select v-model="form.proxy_type" class="mt-1" @update:model-value="onProxyTypeChange">
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">{{ t('providers.fields.proxyNoProxy') }}</SelectItem>
                    <SelectItem value="http">{{ t('providers.fields.proxyHttp') }}</SelectItem>
                    <SelectItem value="socks5">{{ t('providers.fields.proxySocks5') }}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div v-if="form.proxy_type">
                <Label class="text-xs text-muted-foreground">{{ t('providers.fields.proxyUrl') }}</Label>
                <Input v-model="form.proxy_url" type="text" class="mt-1 font-mono text-xs" :placeholder="form.proxy_type === 'socks5' ? t('providers.fields.proxyUrlPlaceholderSocks5') : t('providers.fields.proxyUrlPlaceholderHttp')" />
              </div>
            </div>
            <div v-if="form.proxy_type" class="grid grid-cols-2 gap-3">
              <div>
                <Label class="text-xs text-muted-foreground">{{ t('providers.fields.proxyUsername') }}</Label>
                <Input v-model="form.proxy_username" type="text" class="mt-1" :placeholder="t('providers.fields.proxyAuthOptional')" />
              </div>
              <div>
                <Label class="text-xs text-muted-foreground">{{ t('providers.fields.proxyPassword') }}</Label>
                <Input v-model="form.proxy_password" type="password" class="mt-1" :placeholder="t('providers.fields.proxyAuthOptional')" />
              </div>
            </div>
          </div>

          <!-- 可用模型 -->
          <div>
            <Label class="text-xs text-muted-foreground mb-2">{{ t('providers.fields.availableModels') }}</Label>
            <div class="grid grid-cols-3 gap-2 mb-3">
              <div v-for="(m, i) in form.models" :key="i">
                <ModelCard
                  :model="{ name: m.name, contextWindow: m.context_window ?? 200000, enabled: true, patches: m.patches ?? [] }"
                  :api-type="form.api_type"
                  :is-deep-seek="m.name.toLowerCase().includes('deepseek')"
                  :is-non-openai-endpoint="!isOfficialOpenai(form.base_url)"
                  @update:model="updateModel(i, $event)"
                  @remove="removeModel(i)"
                />
                <div class="flex items-center gap-1.5 mt-1.5">
                  <Label class="text-xs text-muted-foreground whitespace-nowrap">Timeout(s)</Label>
                  <Input
                    type="number"
                    :model-value="m.stream_timeout_ms ? Math.round(m.stream_timeout_ms / 1000) : ''"
                    @update:model-value="updateModelTimeout(i, $event)"
                    placeholder="默认"
                    class="h-7 text-xs"
                    min="1"
                  />
                </div>
              </div>
            </div>
            <div class="flex gap-2">
              <Input v-model="modelInput" :placeholder="t('providers.fields.modelInputPlaceholder')" @keydown.enter.prevent="addModel" class="flex-1" />
              <Select v-model="contextWindowSelect">
                <SelectTrigger class="w-28"><SelectValue :placeholder="t('providers.fields.context')" /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="opt in CONTEXT_WINDOW_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</SelectItem>
                </SelectContent>
              </Select>
              <Button type="button" variant="outline" size="sm" @click="addModel" :disabled="!modelInput.trim()">{{ t('providers.fields.addModel') }}</Button>
            </div>
          </div>

          <!-- 并发控制 + 转换规则 2 columns -->
          <div class="grid grid-cols-2 gap-4">
            <!-- 并发控制 -->
            <div class="border rounded-md p-3 space-y-3">
              <div class="text-xs font-medium text-muted-foreground">{{ t('providers.concurrency.title') }}</div>
              <ConcurrencyControl
                :mode="concurrencyMode"
                :max-concurrency="form.max_concurrency"
                :queue-timeout-ms="form.queue_timeout_ms"
                :max-queue-size="form.max_queue_size"
                compact
                @update:mode="(v: unknown) => onConcurrencyModeChange(v as 'auto' | 'manual' | 'none')"
                @update:max-concurrency="form.max_concurrency = $event"
                @update:queue-timeout-ms="form.queue_timeout_ms = $event"
                @update:max-queue-size="form.max_queue_size = $event"
              />
            </div>

            <!-- 转换规则 -->
            <div class="border rounded-md p-3 space-y-3">
              <div class="text-xs font-medium text-muted-foreground">{{ t('providers.transform.title') }}</div>
              <TransformRulesForm
                :inject-headers="transformForm.injectHeadersInput"
                :drop-fields="transformForm.dropFieldsInput"
                :request-defaults="transformForm.requestDefaultsInput"
                @update:inject-headers="transformForm.injectHeadersInput = $event"
                @update:drop-fields="transformForm.dropFieldsInput = $event"
                @update:request-defaults="transformForm.requestDefaultsInput = $event"
              />
            </div>
          </div>

          </template>

          <DialogFooter>
            <Button type="button" variant="outline" @click="dialogOpen = false">{{ t('common.cancel') }}</Button>
            <Button type="submit">{{ t('common.save') }}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <!-- Delete Confirm AlertDialog -->
    <AlertDialog :open="!!deleteTarget" @update:open="(val) => { if (!val) deleteTarget = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('providers.confirmDelete.title') }}</AlertDialogTitle>
          <AlertDialogDescription>{{ t('providers.confirmDelete.message', { name: deleteTarget?.name }) }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
          <Button variant="destructive" @click="handleDelete">{{ t('common.delete') }}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <!-- Toggle Confirm AlertDialog -->
    <AlertDialog :open="!!toggleTarget" @update:open="(val: boolean) => { if (!val) toggleTarget = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ toggleTarget?.is_active ? t('providers.confirmToggle.titleDisable') : t('providers.confirmToggle.titleEnable') }}</AlertDialogTitle>
          <AlertDialogDescription>
            {{ toggleTarget?.is_active ? t('providers.confirmToggle.messageDisable', { name: toggleTarget?.name }) : t('providers.confirmToggle.messageEnable', { name: toggleTarget?.name }) }}
            <div v-if="toggleDependencies.length" class="mt-2 space-y-1">
              <div class="text-sm font-medium">{{ t('providers.confirmToggle.dependencyWarning') }}</div>
              <div v-for="ref in toggleDependencies" :key="ref" class="text-destructive text-sm">{{ ref }}</div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
          <AlertDialogAction @click="handleToggle">{{ t('common.confirm') }}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import * as z from 'zod'
import { api, getApiMessage, type ProviderPayload, type ProviderGroup } from '@/api/client'
import type { Provider, ModelInfo } from '@/types/mapping'
import { DEFAULT_CONTEXT_WINDOW } from '@/constants'
import { getDefaultContextWindow } from '@/components/quick-setup/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog'
import { RotateCw, Copy, Check, Shield } from 'lucide-vue-next'
import ConcurrencyControl from '@/components/shared/ConcurrencyControl.vue'
import TransformRulesForm from '@/components/shared/TransformRulesForm.vue'
import ModelCard from '@/components/quick-setup/ModelCard.vue'
import type { ModelConfig } from '@/components/quick-setup/types'
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
const API_TYPE_LABELS: Record<string, string> = { openai: 'OpenAI Chat Completions', 'openai-responses': 'OpenAI Responses', anthropic: 'Anthropic Messages' }
const DEFAULT_FORM = { name: '', api_type: 'anthropic', base_url: '', upstream_path: '' as string, api_key: '', models: [] as ModelInfo[], is_active: true, max_concurrency: DEFAULT_CONCURRENCY_AUTO, queue_timeout_ms: DEFAULT_QUEUE_TIMEOUT_MS, max_queue_size: DEFAULT_QUEUE_SIZE, adaptive_enabled: true, proxy_type: '' as string, proxy_url: '', proxy_username: '', proxy_password: '' }
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
const { t } = useI18n()
const { transformForm, loadTransformRules, saveTransformRules } = useTransformRules()
const copiedId = ref<string | null>(null)
const reloading = ref(false)
const MASK_VISIBLE_LEN = 7, MASK_ASTERISK_COUNT = 7, COPY_FEEDBACK_MS = 2000
function validate(): boolean {
  const providerSchema = z.object({
    name: z.string().min(1, t('providers.validation.nameRequired')).regex(/^[a-zA-Z0-9_-]+$/, t('providers.validation.namePattern')),
    base_url: z.string().min(1, t('providers.validation.baseUrlRequired')).url(t('providers.validation.baseUrlInvalid')),
  })
  const errs: Record<string, string> = {}
  const result = providerSchema.safeParse({ name: form.value.name.trim(), base_url: form.value.base_url.trim() })
  if (!result.success) {
    for (const issue of result.error.issues) {
      const field = issue.path[0] as string
      if (!errs[field]) errs[field] = issue.message
    }
  }
  if (!editingId.value && !form.value.api_key.trim()) errs.api_key = t('providers.validation.apiKeyRequired')
  if (concurrencyMode.value !== 'none') {
    const mc = form.value.max_concurrency
    if (!mc || mc < 1 || mc > MAX_CONCURRENCY) errs.max_concurrency = t('providers.validation.concurrencyRange', { min: 1, max: MAX_CONCURRENCY })
    if (form.value.queue_timeout_ms < 0) errs.queue_timeout_ms = t('providers.validation.negativeNotAllowed')
    const qs = form.value.max_queue_size
    if (!qs || qs < 1 || qs > MAX_QUEUE_SIZE) errs.max_queue_size = t('providers.validation.queueSizeRange', { min: 1, max: MAX_QUEUE_SIZE })
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
  if (presetGroup.value === '__custom__') {
    presetPlan.value = ''
    form.value.name = ''
    form.value.api_type = 'openai'
    form.value.base_url = ''
    form.value.models = []
    return
  }
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
    context_window: getDefaultContextWindow(name),
    patches: getDefaultPatches(name, preset.apiType),
  }))
}
async function loadProviders() {
  try {
    const data = await api.getProviders()
    providers.value = data
  } catch (e: unknown) {
    console.error('Failed to load providers:', e)
    toast.error(getApiMessage(e, t('providers.toast.loadFailed')))
  }
}
function addModel() {
  const input = modelInput.value.trim()
  if (!input) return
  const names = input.split(/[,，]/).map(s => s.trim()).filter(Boolean)
  for (const name of names) {
    if (!form.value.models.some(m => m.name === name)) {
      form.value.models.push({ name, context_window: modelContextWindow.value || DEFAULT_CONTEXT_WINDOW, patches: [] })
    }
  }
  modelInput.value = ''
  modelContextWindow.value = DEFAULT_CONTEXT_WINDOW
}
function removeModel(index: number) {
  form.value.models.splice(index, 1)
}

function isOfficialOpenai(url: string): boolean {
  return url.includes('api.openai.com')
}

function updateModel(index: number, updated: ModelConfig) {
  form.value.models[index].context_window = updated.contextWindow
  form.value.models[index].patches = updated.patches
}

function updateModelTimeout(index: number, seconds: string | number) {
  const val = Number(seconds)
  if (val > 0) {
    form.value.models[index].stream_timeout_ms = val * 1000
  } else {
    form.value.models[index].stream_timeout_ms = null
  }
}

function getDefaultPatches(modelName: string, apiType: string): string[] {
  const patches: string[] = []
  if (modelName.toLowerCase().includes('deepseek')) {
    if (apiType === 'anthropic') {
      patches.push('thinking-param', 'cache-control', 'thinking-blocks', 'orphan-tool-results')
    } else {
      patches.push('non-ds-tools', 'orphan-tool-results-oa')
    }
  }
  return patches
}

function onConcurrencyModeChange(mode: ConcurrencyMode) {
  concurrencyMode.value = mode
  if (mode === 'auto') {
    if (!form.value.max_concurrency || form.value.max_concurrency < 1) form.value.max_concurrency = DEFAULT_CONCURRENCY_AUTO
    form.value.adaptive_enabled = true
  } else if (mode === 'manual') {
    if (!form.value.max_concurrency || form.value.max_concurrency < 1) form.value.max_concurrency = DEFAULT_CONCURRENCY
    form.value.adaptive_enabled = false
  }
}

function onProxyTypeChange(val: unknown) {
  if (!val) {
    form.value.proxy_url = ''
    form.value.proxy_username = ''
    form.value.proxy_password = ''
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
  form.value = { name: p.name, api_type: p.api_type, base_url: p.base_url, upstream_path: p.upstream_path || '', api_key: '', models: (p.models || []).map(m => ({ name: m.name, context_window: m.context_window ?? DEFAULT_CONTEXT_WINDOW, patches: m.patches ?? [], stream_timeout_ms: m.stream_timeout_ms ?? null })), is_active: !!p.is_active, max_concurrency: concurrencyMode.value === 'none' ? DEFAULT_CONCURRENCY_AUTO : mc, queue_timeout_ms: p.queue_timeout_ms ?? DEFAULT_QUEUE_TIMEOUT_MS, max_queue_size: p.max_queue_size ?? DEFAULT_QUEUE_SIZE, adaptive_enabled: concurrencyMode.value === 'auto', proxy_type: p.proxy_type || '', proxy_url: p.proxy_url || '', proxy_username: p.proxy_username || '', proxy_password: '' }
  modelInput.value = ''
  modelContextWindow.value = DEFAULT_CONTEXT_WINDOW
  presetGroup.value = ''
  presetPlan.value = ''
  errors.value = {}
  dialogOpen.value = true
  loadTransformRules(p.id)
}

type ProviderFormPayload = Pick<ProviderPayload, 'name' | 'api_type' | 'base_url' | 'upstream_path' | 'models' | 'is_active' | 'max_concurrency' | 'queue_timeout_ms' | 'max_queue_size' | 'adaptive_enabled' | 'proxy_type' | 'proxy_url' | 'proxy_username' | 'proxy_password'> & { api_key?: string }

function buildPayload(): ProviderFormPayload {
  const payload: ProviderFormPayload = {
    name: form.value.name,
    api_type: form.value.api_type,
    base_url: form.value.base_url,
    upstream_path: form.value.upstream_path || undefined,
    models: form.value.models.map(m => ({ name: m.name, context_window: m.context_window ?? undefined, patches: m.patches ?? undefined, stream_timeout_ms: m.stream_timeout_ms ?? undefined })),
    is_active: form.value.is_active ? 1 : 0,
    max_concurrency: concurrencyMode.value === 'none' ? 0 : form.value.max_concurrency,
    queue_timeout_ms: concurrencyMode.value === 'none' ? 0 : form.value.queue_timeout_ms,
    max_queue_size: concurrencyMode.value === 'none' ? DEFAULT_QUEUE_SIZE : form.value.max_queue_size,
    adaptive_enabled: concurrencyMode.value === 'auto' ? 1 : 0,
    proxy_type: form.value.proxy_type || null,
    proxy_url: form.value.proxy_type ? form.value.proxy_url : null,
    proxy_username: form.value.proxy_type ? form.value.proxy_username : null,
    proxy_password: form.value.proxy_type && form.value.proxy_password ? form.value.proxy_password : null,
  }
  if (form.value.api_key) payload.api_key = form.value.api_key
  return payload
}
async function handleSave() {
  if (!validate()) return
  try {
    const payload = buildPayload()
    payload.name = form.value.name.trim()
    let providerId = editingId.value
    if (editingId.value) {
      await api.updateProvider(editingId.value, payload)
    } else {
      payload.api_key = form.value.api_key
      const result = await api.createProvider(payload)
      providerId = result.id
    }
    // Save transform rules along with the provider
    await saveTransformRules(providerId)
    dialogOpen.value = false
    await loadProviders()
  } catch (e: unknown) {
    console.error('Failed to save provider:', e)
    toast.error(getApiMessage(e, t('providers.toast.saveFailed')))
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
      if (cleaned > 0) parts.push(t('providers.toast.cascadeClean', { count: cleaned }))
      if (disabled > 0) parts.push(t('providers.toast.cascadeDisable', { count: disabled }))
      toast.warning(t('providers.toast.cascadeAuto', { actions: parts.join(', ') }))
    }
    await loadProviders()
  } catch (e: unknown) {
    console.error('Failed to toggle provider:', e)
    toast.error(getApiMessage(e, t('providers.toast.toggleFailed')))
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
    toast.error(getApiMessage(e, t('providers.toast.deleteFailed')))
  }
}
async function handleReload() {
  reloading.value = true
  try {
    const result = await api.reloadTransformRules()
    toast.success(t('providers.toast.reloadSuccess', { pluginCount: result.loadedPlugins.length, rulesCount: result.rulesCount }))
  } catch (e: unknown) {
    toast.error(getApiMessage(e, t('providers.toast.reloadFailed')))
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
