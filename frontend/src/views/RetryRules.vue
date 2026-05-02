<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold text-foreground">{{ t('retryRules.title') }}</h2>
      <Button @click="openCreate" class="flex items-center gap-1">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
        </svg>
        {{ t('retryRules.addRule') }}
      </Button>
    </div>

    <div class="bg-card rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow class="bg-muted">
            <TableHead class="text-muted-foreground">{{ t('retryRules.tableHeaders.name') }}</TableHead>
            <TableHead class="text-muted-foreground">{{ t('retryRules.tableHeaders.statusCode') }}</TableHead>
            <TableHead class="text-muted-foreground">{{ t('retryRules.tableHeaders.bodyPattern') }}</TableHead>
            <TableHead class="text-muted-foreground">{{ t('retryRules.tableHeaders.retryStrategy') }}</TableHead>
            <TableHead class="text-muted-foreground">{{ t('retryRules.tableHeaders.status') }}</TableHead>
            <TableHead class="text-right text-muted-foreground">{{ t('retryRules.tableHeaders.actions') }}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="r in rules" :key="r.id">
            <TableCell class="font-mono text-sm">{{ r.name }}</TableCell>
            <TableCell>{{ r.status_code }}</TableCell>
            <TableCell class="font-mono text-xs text-muted-foreground">{{ r.body_pattern }}</TableCell>
            <TableCell>
              <div class="flex items-center gap-2">
                <Badge variant="outline">{{ r.retry_strategy === 'fixed' ? t('retryRules.strategy.fixed') : t('retryRules.strategy.exponential') }}</Badge>
                <span class="text-xs text-muted-foreground">
                  {{ r.retry_delay_ms / 1000 }}s · {{ t('retryRules.times', { count: r.max_retries }) }}
                  <template v-if="r.retry_strategy === 'exponential'"> · {{ t('retryRules.upperLimit', { value: r.max_delay_ms / 1000 }) }}</template>
                </span>
              </div>
            </TableCell>
            <TableCell>
              <Badge :variant="r.is_active ? 'default' : 'secondary'">{{ r.is_active ? t('common.enabled') : t('common.disabled') }}</Badge>
            </TableCell>
            <TableCell class="text-right">
              <Button variant="ghost" size="sm" @click="openEdit(r)" class="mr-2">{{ t('common.edit') }}</Button>
              <Button variant="ghost" size="sm" class="text-destructive hover:text-destructive" @click="confirmDelete(r)">{{ t('common.delete') }}</Button>
            </TableCell>
          </TableRow>
          <TableRow v-if="rules.length === 0">
            <TableCell colspan="6" class="text-center text-muted-foreground py-8">{{ t('retryRules.noRules') }}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <!-- Create/Edit Dialog -->
    <Dialog v-model:open="dialogOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ editingId ? t('retryRules.dialog.editRule') : t('retryRules.dialog.addRule') }}</DialogTitle>
        </DialogHeader>
        <form @submit.prevent="handleSave" class="space-y-3">
          <div>
            <Label class="block text-sm font-medium text-foreground mb-1">{{ t('retryRules.dialog.name') }}</Label>
            <Input v-model="form.name" type="text" required @input="delete errors.name" />
            <p v-if="errors.name" class="text-sm text-destructive mt-1">{{ errors.name }}</p>
          </div>
          <div>
            <Label class="block text-sm font-medium text-foreground mb-1">{{ t('retryRules.dialog.statusCode') }}</Label>
            <Input v-model.number="form.status_code" type="number" required @input="delete errors.status_code" />
            <p v-if="errors.status_code" class="text-sm text-destructive mt-1">{{ errors.status_code }}</p>
          </div>
          <div>
            <Label class="block text-sm font-medium text-foreground mb-1">{{ t('retryRules.dialog.bodyPattern') }}</Label>
            <Input v-model="form.body_pattern" type="text" :placeholder="t('retryRules.dialog.bodyPatternPlaceholder')" required @input="delete errors.body_pattern" />
            <p v-if="errors.body_pattern" class="text-sm text-destructive mt-1">{{ errors.body_pattern }}</p>
          </div>
          <!-- 重试策略 -->
          <div>
            <Label class="block text-sm font-medium text-foreground mb-1">{{ t('retryRules.dialog.retryStrategy') }}</Label>
            <Select v-model="form.retry_strategy">
              <SelectTrigger class="w-full">
                <SelectValue :placeholder="t('retryRules.dialog.selectStrategy')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="exponential">{{ t('retryRules.strategy.exponential') }}</SelectItem>
                <SelectItem value="fixed">{{ t('retryRules.strategy.fixed') }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <Label class="block text-sm font-medium text-foreground mb-1">{{ form.retry_strategy === 'fixed' ? t('retryRules.dialog.intervalMs') : t('retryRules.dialog.initialDelayMs') }}</Label>
              <Input v-model.number="form.retry_delay_ms" type="number" :min="100" required @input="delete errors.retry_delay_ms" />
              <p v-if="errors.retry_delay_ms" class="text-sm text-destructive mt-1">{{ errors.retry_delay_ms }}</p>
            </div>
            <div>
              <Label class="block text-sm font-medium text-foreground mb-1">{{ t('retryRules.dialog.maxRetries') }}</Label>
              <Input v-model.number="form.max_retries" type="number" :min="0" :max="100" required @input="delete errors.max_retries" />
              <p v-if="errors.max_retries" class="text-sm text-destructive mt-1">{{ errors.max_retries }}</p>
            </div>
          </div>
          <div v-if="form.retry_strategy === 'exponential'">
            <Label class="block text-sm font-medium text-foreground mb-1">{{ t('retryRules.dialog.maxDelayMs') }}</Label>
            <Input v-model.number="form.max_delay_ms" type="number" :min="100" required @input="delete errors.max_delay_ms" />
            <p v-if="errors.max_delay_ms" class="text-sm text-destructive mt-1">{{ errors.max_delay_ms }}</p>
          </div>
          <div class="flex items-center gap-2">
            <Checkbox v-model="form.is_active" id="rule-active" />
            <Label for="rule-active" class="text-sm text-foreground">{{ t('retryRules.dialog.enable') }}</Label>
          </div>
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
          <AlertDialogTitle>{{ t('retryRules.deleteConfirm.title') }}</AlertDialogTitle>
          <AlertDialogDescription>{{ t('retryRules.deleteConfirm.description', { name: deleteTarget?.name }) }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
          <Button variant="destructive" @click="handleDelete">{{ t('common.delete') }}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <!-- 推荐重试规则 -->
    <Card v-if="recommendedRules.length > 0" class="mt-6">
      <Collapsible v-model:open="recOpen">
        <CollapsibleTrigger as-child>
          <CardHeader class="cursor-pointer hover:bg-muted/50 transition-colors">
            <div class="flex items-center justify-between">
              <CardTitle class="text-sm font-medium">{{ t('retryRules.recommended.title', { count: recommendedRules.length }) }}</CardTitle>
              <ChevronDown class="h-4 w-4 text-muted-foreground transition-transform" :class="{ 'rotate-180': recOpen }" />
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent>
            <div class="flex items-center justify-between mb-3">
              <div class="flex items-center gap-2">
                <Checkbox :model-value="recAllChecked" @update:model-value="toggleRecAll" />
                <span class="text-sm text-muted-foreground">{{ t('retryRules.recommended.selectAll') }}</span>
              </div>
              <Button size="sm" :disabled="recSelected.size === 0" @click="addRecRules">
                {{ t('retryRules.recommended.addSelected', { count: recSelected.size }) }}
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead class="w-10"></TableHead>
                  <TableHead>{{ t('retryRules.recommended.headers.name') }}</TableHead>
                  <TableHead>{{ t('retryRules.recommended.headers.statusCode') }}</TableHead>
                  <TableHead>{{ t('retryRules.recommended.headers.pattern') }}</TableHead>
                  <TableHead>{{ t('retryRules.recommended.headers.strategy') }}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="rule in recommendedRules" :key="rule.name">
                  <TableCell>
                    <Checkbox :model-value="recSelected.has(rule.name)" @update:model-value="() => toggleRec(rule.name)" />
                  </TableCell>
                  <TableCell>{{ rule.name }}</TableCell>
                  <TableCell>{{ rule.status_code }}</TableCell>
                  <TableCell class="font-mono text-xs max-w-[200px] truncate">{{ rule.body_pattern }}</TableCell>
                  <TableCell>{{ rule.retry_strategy === 'fixed' ? t('retryRules.strategy.fixed') : t('retryRules.strategy.exponential') }}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { api, getApiMessage, type RecommendedRetryRule } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '@/components/ui/alert-dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ChevronDown } from 'lucide-vue-next'

const { t } = useI18n()

interface RetryRule {
  id: string
  name: string
  status_code: number
  body_pattern: string
  is_active: number
  created_at: string
  retry_strategy: "fixed" | "exponential"
  retry_delay_ms: number
  max_retries: number
  max_delay_ms: number
}

const DEFAULT_FORM = {
  name: '', status_code: 429, body_pattern: '', is_active: true,
  retry_strategy: 'exponential' as "fixed" | "exponential",
  retry_delay_ms: 5000,
  max_retries: 10,
  max_delay_ms: 60000,
}

const rules = ref<RetryRule[]>([])
const dialogOpen = ref(false)
const editingId = ref<string | null>(null)
const deleteTarget = ref<RetryRule | null>(null)
const form = ref({ ...DEFAULT_FORM })
const errors = ref<Record<string, string>>({})

const MIN_STATUS_CODE = 100
const MAX_STATUS_CODE = 599
const MIN_DELAY_MS = 100
const MAX_RETRIES = 100

function validate(): boolean {
  const errs: Record<string, string> = {}
  if (!form.value.name.trim()) errs.name = t('retryRules.validation.nameRequired')

  const sc = Number(form.value.status_code)
  if (!Number.isInteger(sc) || sc < MIN_STATUS_CODE || sc > MAX_STATUS_CODE) errs.status_code = t('retryRules.validation.statusCodeRange', { min: MIN_STATUS_CODE, max: MAX_STATUS_CODE })

  if (!form.value.body_pattern.trim()) errs.body_pattern = t('retryRules.validation.bodyPatternRequired')
  else {
    try { new RegExp(form.value.body_pattern) } catch { errs.body_pattern = t('retryRules.validation.bodyPatternInvalid') }
  }

  const delay = Number(form.value.retry_delay_ms)
  if (!delay || delay < MIN_DELAY_MS) errs.retry_delay_ms = t('retryRules.validation.delayMin', { min: MIN_DELAY_MS })

  const retries = Number(form.value.max_retries)
  if (!Number.isInteger(retries) || retries < 0 || retries > MAX_RETRIES) errs.max_retries = t('retryRules.validation.retriesRange', { max: MAX_RETRIES })

  if (form.value.retry_strategy === 'exponential') {
    const maxDelay = Number(form.value.max_delay_ms)
    if (!maxDelay || maxDelay < MIN_DELAY_MS) errs.max_delay_ms = t('retryRules.validation.delayMin', { min: MIN_DELAY_MS })
  }

  errors.value = errs
  return Object.keys(errs).length === 0
}

async function loadData() {
  try {
    const res = await api.getRetryRules()
    rules.value = res
  } catch (e: unknown) {
    console.error('Failed to load retry rules:', e)
    toast.error(getApiMessage(e, t('retryRules.messages.loadFailed')))
  }
}

function openCreate() {
  editingId.value = null
  form.value = { ...DEFAULT_FORM }
  errors.value = {}
  dialogOpen.value = true
}

function openEdit(r: RetryRule) {
  editingId.value = r.id
  form.value = {
    name: r.name,
    status_code: r.status_code,
    body_pattern: r.body_pattern,
    is_active: !!r.is_active,
    retry_strategy: r.retry_strategy,
    retry_delay_ms: r.retry_delay_ms,
    max_retries: r.max_retries,
    max_delay_ms: r.max_delay_ms,
  }
  errors.value = {}
  dialogOpen.value = true
}

async function handleSave() {
  if (!validate()) return
  try {
    const payload = {
      name: form.value.name,
      status_code: Number(form.value.status_code),
      body_pattern: form.value.body_pattern,
      is_active: form.value.is_active ? 1 : 0,
      retry_strategy: form.value.retry_strategy,
      retry_delay_ms: Number(form.value.retry_delay_ms),
      max_retries: Number(form.value.max_retries),
      max_delay_ms: Number(form.value.max_delay_ms),
    }
    if (editingId.value) {
      await api.updateRetryRule(editingId.value, payload)
    } else {
      await api.createRetryRule(payload)
    }
    dialogOpen.value = false
    await loadData()
  } catch (e: unknown) {
    console.error('Failed to save retry rule:', e)
    toast.error(getApiMessage(e, t('retryRules.messages.saveFailed')))
  }
}

function confirmDelete(r: RetryRule) {
  deleteTarget.value = r
}

async function handleDelete() {
  const target = deleteTarget.value
  if (!target) return
  deleteTarget.value = null
  try {
    await api.deleteRetryRule(target.id)
    await loadData()
  } catch (e: unknown) {
    console.error('Failed to delete retry rule:', e)
    toast.error(getApiMessage(e, t('retryRules.messages.deleteFailed')))
  }
}

// 推荐规则
const recOpen = ref(false)
const recommendedRules = ref<RecommendedRetryRule[]>([])
const recSelected = ref(new Set<string>())

const recAllChecked = computed(() =>
  recommendedRules.value.length > 0 && recSelected.value.size === recommendedRules.value.length
)

async function loadRecommended() {
  try {
    recommendedRules.value = await api.recommended.getRetryRules()
  } catch { recommendedRules.value = [] }
}

function toggleRec(name: string) {
  const s = new Set(recSelected.value)
  if (s.has(name)) { s.delete(name) } else { s.add(name) }
  recSelected.value = s
}

function toggleRecAll(checked: boolean | string) {
  recSelected.value = checked === true ? new Set(recommendedRules.value.map(r => r.name)) : new Set()
}

async function addRecRules() {
  const toAdd = recommendedRules.value.filter(r => recSelected.value.has(r.name))
  for (const rule of toAdd) {
    await api.createRetryRule({
      name: rule.name,
      status_code: rule.status_code,
      body_pattern: rule.body_pattern,
      is_active: 1,
      retry_strategy: rule.retry_strategy,
      retry_delay_ms: rule.retry_delay_ms,
      max_retries: rule.max_retries,
      max_delay_ms: rule.max_delay_ms,
    })
  }
  toast.success(t('retryRules.messages.addedCount', { count: toAdd.length }))
  recSelected.value = new Set()
  await Promise.allSettled([loadRecommended(), loadData()])
}

onMounted(() => { loadData(); loadRecommended() })
</script>
