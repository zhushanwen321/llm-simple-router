<template>
  <div class="p-6 space-y-3">
    <!-- Header -->
    <div>
      <h2 class="text-lg font-semibold text-foreground">{{ t('schedules.title') }}</h2>
      <p class="text-sm text-muted-foreground mt-1">{{ t('schedules.description') }}</p>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-16 text-muted-foreground text-sm">
      {{ t('common.loading') }}
    </div>

    <template v-if="!loading">
      <!-- Mapping Group Cards Grid -->
      <div class="grid grid-cols-3 gap-3">
        <div
          v-for="group in groups"
          :key="group.id"
          class="rounded-lg border transition-colors"
          :class="[
            expandedGroupId === group.id ? 'col-span-3 border-primary/30 shadow-sm shadow-primary/5' : 'border-border hover:border-border/80',
          ]"
        >
          <!-- Collapsed header -->
          <div
            class="flex items-center gap-3 px-4 py-3 cursor-pointer"
            @click="toggleExpand(group.id)"
          >
            <span class="font-mono text-sm font-semibold text-foreground shrink-0">{{ group.client_model }}</span>
            <Badge v-if="schedulesByGroup[group.id]?.length" variant="secondary" class="text-[10px]">
              {{ t('schedules.ruleCount', { count: schedulesByGroup[group.id].length }) }}
            </Badge>
            <Badge v-else variant="outline" class="text-[10px] text-muted-foreground/50">
              {{ t('schedules.noRules') }}
            </Badge>
            <div class="flex-1 flex flex-wrap gap-1 min-w-0">
              <Badge
                v-for="s in (schedulesByGroup[group.id] ?? []).slice(0, 3)"
                :key="s.id"
                :variant="s.enabled ? 'default' : 'secondary'"
                class="text-[10px] font-normal"
              >
                {{ s.name }}
                <span class="ml-1 text-muted-foreground/60 font-mono">{{ formatHour(s.start_hour) }}-{{ formatHour(s.end_hour) }}</span>
              </Badge>
              <span v-if="(schedulesByGroup[group.id]?.length ?? 0) > 3" class="text-[10px] text-muted-foreground/50 self-center">
                +{{ schedulesByGroup[group.id].length - 3 }}
              </span>
            </div>
            <ChevronDown class="size-4 text-muted-foreground/40 shrink-0 transition-transform" :class="{ 'rotate-180': expandedGroupId === group.id }" />
          </div>

          <!-- Expanded: Rules Table -->
          <div v-if="expandedGroupId === group.id" class="border-t">
            <div class="flex items-center justify-between px-4 py-2 bg-muted/30">
              <span class="text-xs font-medium text-muted-foreground">{{ t('schedules.scheduleRules') }}</span>
              <Button size="sm" variant="outline" class="h-7 text-xs" @click="openCreate(group.id)">
                <Plus class="w-3 h-3 mr-1" />
                {{ t('schedules.createSchedule') }}
              </Button>
            </div>
            <Table>
              <TableHeader>
                <TableRow class="bg-muted/50">
                  <TableHead class="text-muted-foreground text-xs h-8">{{ t('schedules.tableHeaders.name') }}</TableHead>
                  <TableHead class="text-muted-foreground text-xs h-8">{{ t('schedules.tableHeaders.status') }}</TableHead>
                  <TableHead class="text-muted-foreground text-xs h-8">{{ t('schedules.tableHeaders.week') }}</TableHead>
                  <TableHead class="text-muted-foreground text-xs h-8">{{ t('schedules.tableHeaders.timeRange') }}</TableHead>
                  <TableHead class="text-right text-muted-foreground text-xs h-8">{{ t('schedules.tableHeaders.actions') }}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="s in (schedulesByGroup[group.id] ?? [])" :key="s.id">
                  <TableCell class="font-medium text-sm">{{ s.name }}</TableCell>
                  <TableCell>
                    <Badge :variant="s.enabled ? 'default' : 'secondary'" class="text-xs">
                      {{ s.enabled ? t('schedules.enabled') : t('schedules.disabled') }}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div class="flex flex-wrap gap-1">
                      <Badge v-for="day in parseWeek(s.week)" :key="day" variant="outline" class="text-xs">{{ day }}</Badge>
                    </div>
                  </TableCell>
                  <TableCell class="font-mono text-sm">{{ formatHour(s.start_hour) }}-{{ formatHour(s.end_hour) }}</TableCell>
                  <TableCell class="text-right">
                    <div class="flex items-center justify-end gap-1">
                      <Switch
                        :model-value="!!s.enabled"
                        class="scale-75"
                        @click.stop="handleToggle(s)"
                      />
                      <Button variant="ghost" size="sm" @click="openEdit(s)">{{ t('common.edit') }}</Button>
                      <Button variant="ghost" size="sm" class="text-destructive hover:text-destructive" @click="deleteTarget = s">{{ t('common.delete') }}</Button>
                    </div>
                  </TableCell>
                </TableRow>
                <TableRow v-if="!schedulesByGroup[group.id]?.length">
                  <TableCell colspan="5" class="text-center text-muted-foreground py-6 text-xs">{{ t('schedules.emptyRules') }}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </div>
      </div>

      <p v-if="groups.length === 0" class="py-12 text-center text-xs text-muted-foreground">{{ t('schedules.noGroups') }}</p>
    </template>

    <!-- Create/Edit Dialog -->
    <Dialog v-model:open="dialogOpen">
      <DialogContent class="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{{ editingId ? t('schedules.editSchedule') : t('schedules.createSchedule') }}</DialogTitle>
        </DialogHeader>
        <form @submit.prevent="handleSave" class="space-y-4">
          <div v-if="formError" class="bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2 text-sm text-destructive">
            {{ formError }}
          </div>

          <!-- Top: Name + Week + Time -->
          <div class="grid grid-cols-2 gap-3">
            <div>
              <Label class="text-xs text-muted-foreground">{{ t('schedules.form.name') }}</Label>
              <Input v-model="form.name" class="mt-1" :placeholder="t('schedules.form.namePlaceholder')" @input="delete errors.name" />
              <p v-if="errors.name" class="text-xs text-destructive mt-0.5">{{ errors.name }}</p>
            </div>
            <div>
              <Label class="text-xs text-muted-foreground mb-1.5 block">{{ t('schedules.form.week') }}</Label>
              <div class="flex flex-wrap gap-1.5">
                <Button
                  v-for="(label, idx) in WEEK_LABELS"
                  :key="idx"
                  type="button"
                  :variant="(form.week ?? []).includes(idx) ? 'default' : 'outline'"
                  size="sm"
                  class="h-7 text-xs"
                  @click="toggleWeekDay(idx)"
                >{{ label }}</Button>
              </div>
              <p v-if="errors.week" class="text-xs text-destructive mt-0.5">{{ errors.week }}</p>
            </div>
          </div>

          <!-- Time presets + range -->
          <div>
            <div class="flex items-center gap-2 mb-2">
              <Label class="text-xs text-muted-foreground">{{ t('schedules.timePresets.label') }}</Label>
              <div class="flex gap-1.5">
                <Button type="button" variant="outline" size="sm" class="text-xs h-6" @click="applyTimePreset(9, 12)">{{ t('schedules.timePresets.morning') }}</Button>
                <Button type="button" variant="outline" size="sm" class="text-xs h-6" @click="applyTimePreset(14, 18)">{{ t('schedules.timePresets.afternoon') }}</Button>
                <Button type="button" variant="outline" size="sm" class="text-xs h-6" @click="applyTimePreset(19, 21)">{{ t('schedules.timePresets.evening') }}</Button>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <Label class="text-xs text-muted-foreground">{{ t('schedules.form.startTime') }}</Label>
                <Select v-model="form.start_hour" class="mt-1" @update:model-value="(v: unknown) => { form.start_hour = Number(v); delete errors.time }">
                  <SelectTrigger><SelectValue :placeholder="t('schedules.form.selectHour')" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="h in 24" :key="h - 1" :value="h - 1">{{ String(h - 1).padStart(2, '0') }}:00</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label class="text-xs text-muted-foreground">{{ t('schedules.form.endTime') }}</Label>
                <Select v-model="form.end_hour" class="mt-1" @update:model-value="(v: unknown) => { form.end_hour = Number(v); delete errors.time }">
                  <SelectTrigger><SelectValue :placeholder="t('schedules.form.selectHour')" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="h in 24" :key="h" :value="h">{{ String(h).padStart(2, '0') }}:00</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p v-if="errors.time" class="text-xs text-destructive mt-0.5">{{ errors.time }}</p>
          </div>

          <!-- Mapping targets: client model name = group name -->
          <div>
            <Label class="text-xs text-muted-foreground mb-1 block">{{ t('schedules.form.targets') }}</Label>
            <MappingEntryEditor
              :entry="mappingEntry"
              :provider-groups="providerGroups"
              :expanded="true"
              :editable="true"
              @update:targets="handleTargetsUpdate"
            />
            <p v-if="errors.targets" class="text-xs text-destructive mt-0.5">{{ errors.targets }}</p>
          </div>

          <!-- Bottom: Concurrency + Transform Rules side by side -->
          <div class="grid grid-cols-2 gap-4">
            <div class="border rounded-md p-3 space-y-3">
              <div class="text-xs font-medium text-muted-foreground">{{ t('schedules.form.concurrencyTitle') }}</div>
              <ConcurrencyControl
                :mode="form.concurrency_mode"
                :max-concurrency="form.max_concurrency"
                :queue-timeout-ms="form.queue_timeout_ms"
                :max-queue-size="form.max_queue_size"
                compact
                @update:mode="(v: ConcurrencyMode) => form.concurrency_mode = v"
                @update:max-concurrency="(v: number) => form.max_concurrency = v"
                @update:queue-timeout-ms="(v: number) => form.queue_timeout_ms = v"
                @update:max-queue-size="(v: number) => form.max_queue_size = v"
              />
            </div>
            <div class="border rounded-md p-3 space-y-3">
              <div class="text-xs font-medium text-muted-foreground">{{ t('providers.transform.title') }}</div>
              <TransformRulesForm
                :inject-headers="transformForm.injectHeadersInput"
                :drop-fields="transformForm.dropFieldsInput"
                :request-defaults="transformForm.requestDefaultsInput"
                compact
                @update:inject-headers="transformForm.injectHeadersInput = $event"
                @update:drop-fields="transformForm.dropFieldsInput = $event"
                @update:request-defaults="transformForm.requestDefaultsInput = $event"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" @click="dialogOpen = false">{{ t('common.cancel') }}</Button>
            <Button type="submit">{{ t('common.save') }}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <!-- Delete confirm -->
    <AlertDialog :open="!!deleteTarget" @update:open="(val: boolean) => { if (!val) deleteTarget = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{ t('schedules.confirmDeleteTitle') }}</AlertDialogTitle>
          <AlertDialogDescription>{{ t('schedules.confirmDeleteMessage', { name: deleteTarget?.name ?? '' }) }}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t('common.cancel') }}</AlertDialogCancel>
          <Button variant="destructive" @click="handleDelete">{{ t('common.delete') }}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Plus, ChevronDown } from 'lucide-vue-next'
import { api, getApiMessage } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '@/components/ui/alert-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import MappingEntryEditor from '@/components/mappings/MappingEntryEditor.vue'
import ConcurrencyControl from '@/components/shared/ConcurrencyControl.vue'
import TransformRulesForm from '@/components/shared/TransformRulesForm.vue'
import type { ConcurrencyMode } from '@/components/shared/ConcurrencyControl.vue'
import type { MappingTarget, MappingEntry } from '@/components/quick-setup/types'
import type { ProviderGroup } from '@/components/mappings/cascading-types'
import { DEFAULT_CONTEXT_WINDOW } from '@/constants'
import type { Schedule, SchedulePayload } from '@/types/schedule'
import type { MappingGroup, Provider } from '@/types/mapping'

const { t } = useI18n()

const WEEK_LABELS = computed(() => [
  t('schedules.weekDays.sun'), t('schedules.weekDays.mon'), t('schedules.weekDays.tue'),
  t('schedules.weekDays.wed'), t('schedules.weekDays.thu'), t('schedules.weekDays.fri'),
  t('schedules.weekDays.sat'),
])

interface ScheduleForm {
  name: string
  week: number[]
  start_hour: number
  end_hour: number
  targets: MappingTarget[]
  concurrency_mode: ConcurrencyMode
  max_concurrency: number
  queue_timeout_ms: number
  max_queue_size: number
}

const DEFAULT_FORM = (): ScheduleForm => ({
  name: '',
  week: [1, 2, 3, 4, 5],
  start_hour: 0,
  end_hour: 24,
  targets: [{ backend_model: '', provider_id: '' }],
  concurrency_mode: 'auto' as ConcurrencyMode,
  max_concurrency: 10,
  queue_timeout_ms: 120000,
  max_queue_size: 100,
})

const loading = ref(false)
const groups = ref<MappingGroup[]>([])
const providers = ref<Provider[]>([])
const allSchedules = ref<Schedule[]>([])
const expandedGroupId = ref<string | null>(null)
const dialogOpen = ref(false)
const editingId = ref<string | null>(null)
const formGroupId = ref('')
const deleteTarget = ref<Schedule | null>(null)
const form = ref<ScheduleForm>(DEFAULT_FORM())
const errors = ref<Record<string, string>>({})
const formError = ref('')

// Transform rules form state
const transformForm = ref({
  injectHeadersInput: '',
  dropFieldsInput: '',
  requestDefaultsInput: '',
})

const schedulesByGroup = computed<Record<string, Schedule[]>>(() => {
  const map: Record<string, Schedule[]> = {}
  for (const s of allSchedules.value) {
    if (!map[s.mapping_group_id]) map[s.mapping_group_id] = []
    map[s.mapping_group_id].push(s)
  }
  return map
})

const mappingEntry = computed<MappingEntry>(() => {
  const group = groups.value.find(g => g.id === formGroupId.value)
  return {
    clientModel: group?.client_model ?? '',
    targets: form.value.targets,
    existing: false,
    tag: 'cust' as const,
    active: true,
  }
})

function handleTargetsUpdate(targets: MappingTarget[]) {
  form.value.targets = targets
}

function parseWeek(weekStr: string): string[] {
  const labels = WEEK_LABELS.value
  let arr: number[] = []
  try { arr = JSON.parse(weekStr) } catch { return [] }
  return arr.map(d => labels[d] ?? String(d))
}

function formatHour(h: number): string {
  return String(h).padStart(2, '0') + ':00'
}

function applyTimePreset(start: number, end: number) {
  form.value.start_hour = start
  form.value.end_hour = end
  delete errors.value.time
}

function toggleExpand(groupId: string) {
  expandedGroupId.value = expandedGroupId.value === groupId ? null : groupId
}

async function loadGroups() {
  try { groups.value = await api.getMappingGroups() }
  catch (e: unknown) { console.error('schedules.loadGroups:', e); toast.error(getApiMessage(e, t('schedules.loadGroupsFailed'))) }
}

async function loadProviders() {
  try { providers.value = await api.getProviders() }
  catch (e: unknown) { console.error('schedules.loadProviders:', e); toast.error(getApiMessage(e, t('schedules.loadProvidersFailed'))) }
}

async function loadAllSchedules() {
  try { allSchedules.value = await api.getSchedules() }
  catch (e: unknown) { console.error('schedules.loadAll:', e); toast.error(getApiMessage(e, t('schedules.loadSchedulesFailed'))) }
}

const providerGroups = computed<ProviderGroup[]>(() =>
  providers.value.map(p => ({
    provider: { id: p.id, name: p.name },
    models: (p.models ?? []).map(m => ({ name: m.name, contextWindow: m.context_window ?? DEFAULT_CONTEXT_WINDOW })),
  })),
)

function toggleWeekDay(day: number) {
  const idx = form.value.week.indexOf(day)
  if (idx >= 0) form.value.week.splice(idx, 1)
  else form.value.week.push(day)
  delete errors.value.week
}

function openCreate(groupId: string) {
  editingId.value = null
  formGroupId.value = groupId
  form.value = DEFAULT_FORM()
  transformForm.value = { injectHeadersInput: '', dropFieldsInput: '', requestDefaultsInput: '' }
  errors.value = {}
  formError.value = ''
  dialogOpen.value = true
}

function openEdit(s: Schedule) {
  editingId.value = s.id
  formGroupId.value = s.mapping_group_id
  errors.value = {}
  formError.value = ''

  let targets: MappingTarget[] = [{ backend_model: '', provider_id: '' }]
  try {
    const rule = JSON.parse(s.mapping_rule) as { targets?: MappingTarget[] }
    if (rule.targets?.length) targets = rule.targets
  } catch (e) { console.warn('Failed to parse mapping_rule:', e) }

  let week: number[] = [1, 2, 3, 4, 5]
  try { week = JSON.parse(s.week) } catch (e) { console.warn('Failed to parse week:', e) }

  let concurrencyMode: ConcurrencyMode = 'auto'
  let maxConcurrency = 10
  let queueTimeoutMs = 120000
  let maxQueueSize = 100
  if (s.concurrency_rule) {
    try {
      const cr = JSON.parse(s.concurrency_rule) as Record<string, unknown>
      concurrencyMode = (cr.mode as ConcurrencyMode) || 'auto'
      if (cr.max_concurrency) maxConcurrency = cr.max_concurrency as number
      if (cr.queue_timeout_ms) queueTimeoutMs = cr.queue_timeout_ms as number
      if (cr.max_queue_size) maxQueueSize = cr.max_queue_size as number
    } catch (e) { console.warn('Failed to parse concurrency_rule:', e) }
  }

  let injectHeaders = ''
  let dropFields = ''
  let requestDefaults = ''
  if (s.transform_rule) {
    try {
      const tr = JSON.parse(s.transform_rule) as Record<string, unknown>
      dropFields = (tr.drop_fields as string[] || []).join(', ')
      requestDefaults = tr.request_defaults ? JSON.stringify(tr.request_defaults) : ''
      injectHeaders = tr.inject_headers ? JSON.stringify(tr.inject_headers) : ''
    } catch (e) { console.warn('Failed to parse transform_rule:', e) }
  }

  form.value = {
    name: s.name, week, start_hour: s.start_hour, end_hour: s.end_hour,
    targets, concurrency_mode: concurrencyMode, max_concurrency: maxConcurrency,
    queue_timeout_ms: queueTimeoutMs, max_queue_size: maxQueueSize,
  }
  transformForm.value = { injectHeadersInput: injectHeaders, dropFieldsInput: dropFields, requestDefaultsInput: requestDefaults }
  dialogOpen.value = true
}

function validate(): boolean {
  const errs: Record<string, string> = {}
  if (!form.value.name.trim()) errs.name = t('schedules.form.nameRequired')
  if (form.value.week.length === 0) errs.week = t('schedules.form.weekRequired')
  if (form.value.start_hour >= form.value.end_hour) errs.time = t('schedules.form.timeInvalid')
  for (const tgt of form.value.targets) {
    if (!tgt.provider_id || !tgt.backend_model) { errs.targets = t('schedules.form.targetRequired'); break }
  }
  errors.value = errs
  return Object.keys(errs).length === 0
}

function buildTransformRule(): { rule: string | null; error: boolean } {
  const { injectHeadersInput, dropFieldsInput, requestDefaultsInput } = transformForm.value
  if (!injectHeadersInput.trim() && !dropFieldsInput.trim() && !requestDefaultsInput.trim()) return { rule: null, error: false }
  const dropFields = dropFieldsInput ? dropFieldsInput.split(',').map(s => s.trim()).filter(Boolean) : null
  let requestDefaults = null
  if (requestDefaultsInput.trim()) {
    try { requestDefaults = JSON.parse(requestDefaultsInput) }
    catch { toast.error(t('providers.transform.requestDefaultsJsonError')); return { rule: null, error: true } }
  }
  let injectHeaders = null
  if (injectHeadersInput.trim()) {
    try { injectHeaders = JSON.parse(injectHeadersInput) }
    catch { toast.error(t('providers.transform.injectHeadersJsonError')); return { rule: null, error: true } }
  }
  return { rule: JSON.stringify({ drop_fields: dropFields, request_defaults: requestDefaults, inject_headers: injectHeaders }), error: false }
}

async function handleSave() {
  formError.value = ''
  if (!validate()) return
  const { rule: transformRule, error: transformError } = buildTransformRule()
  if (transformError) return

  try {
    const mappingRule = JSON.stringify({ targets: form.value.targets })
    const concurrencyRule = form.value.concurrency_mode !== 'none'
      ? JSON.stringify({
        mode: form.value.concurrency_mode,
        max_concurrency: form.value.max_concurrency,
        queue_timeout_ms: form.value.queue_timeout_ms,
        max_queue_size: form.value.max_queue_size,
      })
      : null

    const payload: SchedulePayload = {
      mapping_group_id: formGroupId.value,
      name: form.value.name,
      week: JSON.stringify(form.value.week),
      start_hour: form.value.start_hour,
      end_hour: form.value.end_hour,
      mapping_rule: mappingRule,
      concurrency_rule: concurrencyRule,
      transform_rule: transformRule,
    }

    if (editingId.value) await api.updateSchedule(editingId.value, payload)
    else await api.createSchedule(payload)
    dialogOpen.value = false
    await loadAllSchedules()
  } catch (e: unknown) {
    formError.value = getApiMessage(e, t('schedules.saveFailed'))
  }
}

async function handleToggle(s: Schedule) {
  try { await api.toggleSchedule(s.id); await loadAllSchedules() }
  catch (e: unknown) { console.error('schedules.toggle:', e); toast.error(getApiMessage(e, t('schedules.toggleFailed'))) }
}

async function handleDelete() {
  const target = deleteTarget.value
  if (!target) return
  deleteTarget.value = null
  try { await api.deleteSchedule(target.id); await loadAllSchedules() }
  catch (e: unknown) { console.error('schedules.delete:', e); toast.error(getApiMessage(e, t('schedules.deleteFailed'))) }
}

onMounted(async () => {
  loading.value = true
  await Promise.allSettled([loadGroups(), loadProviders(), loadAllSchedules()])
  loading.value = false
})
</script>
