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
      <!-- Mapping Group Cards -->
      <div
        v-for="group in groups"
        :key="group.id"
        class="rounded-lg border transition-colors"
        :class="expandedGroupId === group.id ? 'border-primary/30 shadow-sm shadow-primary/5' : 'border-border hover:border-border/80'"
      >
        <!-- Collapsed / Header row -->
        <div
          class="flex items-center gap-3 px-4 py-3 cursor-pointer"
          @click="toggleExpand(group.id)"
        >
          <!-- Client model name -->
          <span class="font-mono text-sm font-semibold text-foreground shrink-0">{{ group.client_model }}</span>

          <!-- Rule count badge -->
          <Badge v-if="schedulesByGroup[group.id]?.length" variant="secondary" class="text-[10px]">
            {{ t('schedules.ruleCount', { count: schedulesByGroup[group.id].length }) }}
          </Badge>
          <Badge v-else variant="outline" class="text-[10px] text-muted-foreground/50">
            {{ t('schedules.noRules') }}
          </Badge>

          <!-- Rule names as tags -->
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

          <!-- Expand chevron -->
          <ChevronDown class="size-4 text-muted-foreground/40 shrink-0 transition-transform" :class="{ 'rotate-180': expandedGroupId === group.id }" />
        </div>

        <!-- Expanded: Rules Table -->
        <div v-if="expandedGroupId === group.id" class="border-t">
          <!-- Table header bar -->
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
                    <Badge
                      v-for="day in parseWeek(s.week)"
                      :key="day"
                      variant="outline"
                      class="text-xs"
                    >{{ day }}</Badge>
                  </div>
                </TableCell>
                <TableCell class="font-mono text-sm">
                  {{ formatHour(s.start_hour) }}-{{ formatHour(s.end_hour) }}
                </TableCell>
                <TableCell class="text-right">
                  <div class="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="sm" @click="handleToggle(s)">
                      <Switch :checked="!!s.enabled" size="sm" />
                    </Button>
                    <Button variant="ghost" size="sm" @click="openEdit(s)">{{ t('common.edit') }}</Button>
                    <Button variant="ghost" size="sm" class="text-destructive hover:text-destructive" @click="deleteTarget = s">{{ t('common.delete') }}</Button>
                  </div>
                </TableCell>
              </TableRow>
              <TableRow v-if="!schedulesByGroup[group.id]?.length">
                <TableCell colspan="5" class="text-center text-muted-foreground py-6 text-xs">
                  {{ t('schedules.emptyRules') }}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </div>

      <!-- No groups -->
      <p v-if="groups.length === 0" class="py-12 text-center text-xs text-muted-foreground">{{ t('schedules.noGroups') }}</p>
    </template>

    <!-- Create/Edit Dialog -->
    <Dialog v-model:open="dialogOpen">
      <DialogContent class="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{{ editingId ? t('schedules.editSchedule') : t('schedules.createSchedule') }}</DialogTitle>
        </DialogHeader>
        <form @submit.prevent="handleSave" class="space-y-4">
          <!-- API error -->
          <div v-if="formError" class="bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2 text-sm text-destructive">
            {{ formError }}
          </div>

          <!-- Name -->
          <div>
            <Label class="block text-sm font-medium text-foreground mb-1">{{ t('schedules.form.name') }}</Label>
            <Input v-model="form.name" :placeholder="t('schedules.form.namePlaceholder')" @input="delete errors.name" />
            <p v-if="errors.name" class="text-sm text-destructive mt-1">{{ errors.name }}</p>
          </div>

          <!-- Week -->
          <div>
            <Label class="block text-sm font-medium text-foreground mb-1">{{ t('schedules.form.week') }}</Label>
            <div class="flex flex-wrap gap-2">
              <Button
                v-for="(label, idx) in WEEK_LABELS"
                :key="idx"
                type="button"
                :variant="(form.week ?? []).includes(idx) ? 'default' : 'outline'"
                size="sm"
                @click="toggleWeekDay(idx)"
              >{{ label }}</Button>
            </div>
            <p v-if="errors.week" class="text-sm text-destructive mt-1">{{ errors.week }}</p>
          </div>

          <!-- Time presets + range -->
          <div>
            <div class="flex items-center gap-2 mb-2">
              <Label class="text-sm font-medium text-foreground">{{ t('schedules.timePresets.label') }}</Label>
              <div class="flex gap-1.5">
                <Button type="button" variant="outline" size="sm" class="text-xs h-6" @click="applyTimePreset(9, 12)">{{ t('schedules.timePresets.morning') }}</Button>
                <Button type="button" variant="outline" size="sm" class="text-xs h-6" @click="applyTimePreset(14, 18)">{{ t('schedules.timePresets.afternoon') }}</Button>
                <Button type="button" variant="outline" size="sm" class="text-xs h-6" @click="applyTimePreset(19, 21)">{{ t('schedules.timePresets.evening') }}</Button>
              </div>
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <Label class="text-sm font-medium text-foreground mb-1 block">{{ t('schedules.form.startTime') }}</Label>
                <Select v-model="form.start_hour" @update:model-value="(v: unknown) => { form.start_hour = Number(v); delete errors.time }">
                  <SelectTrigger><SelectValue :placeholder="t('schedules.form.selectHour')" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="h in 24" :key="h - 1" :value="h - 1">
                      {{ String(h - 1).padStart(2, '0') }}:00
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label class="text-sm font-medium text-foreground mb-1 block">{{ t('schedules.form.endTime') }}</Label>
                <Select v-model="form.end_hour" @update:model-value="(v: unknown) => { form.end_hour = Number(v); delete errors.time }">
                  <SelectTrigger><SelectValue :placeholder="t('schedules.form.selectHour')" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="h in 24" :key="h" :value="h">
                      {{ String(h).padStart(2, '0') }}:00
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p v-if="errors.time" class="text-sm text-destructive mt-1">{{ errors.time }}</p>
          </div>

          <!-- Mapping targets -->
          <div>
            <Label class="block text-sm font-medium text-foreground mb-1">{{ t('schedules.form.targets') }}</Label>
            <MappingEntryEditor
              :entry="mappingEntry"
              :provider-groups="providerGroups"
              :expanded="true"
              :editable="true"
              @update:targets="handleTargetsUpdate"
            />
            <p v-if="errors.targets" class="text-sm text-destructive mt-1">{{ errors.targets }}</p>
          </div>

          <!-- Concurrency -->
          <Collapsible v-model:open="concurrencyOpen">
            <CollapsibleTrigger as-child>
              <Button type="button" variant="ghost" class="w-full justify-between px-0">
                <span class="text-sm font-medium">{{ t('schedules.form.concurrencyTitle') }}</span>
                <ChevronDown class="h-4 w-4 transition-transform" :class="{ 'rotate-180': concurrencyOpen }" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent class="pt-2">
              <ConcurrencyControl
                :mode="form.concurrency_mode"
                :max-concurrency="form.max_concurrency"
                :queue-timeout-ms="form.queue_timeout_ms"
                :max-queue-size="form.max_queue_size"
                :compact="true"
                @update:mode="(v: ConcurrencyMode) => form.concurrency_mode = v"
                @update:max-concurrency="(v: number) => form.max_concurrency = v"
                @update:queue-timeout-ms="(v: number) => form.queue_timeout_ms = v"
                @update:max-queue-size="(v: number) => form.max_queue_size = v"
              />
            </CollapsibleContent>
          </Collapsible>

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
          <AlertDialogDescription>
            {{ t('schedules.confirmDeleteMessage', { name: deleteTarget?.name ?? '' }) }}
          </AlertDialogDescription>
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import MappingEntryEditor from '@/components/mappings/MappingEntryEditor.vue'
import ConcurrencyControl from '@/components/shared/ConcurrencyControl.vue'
import type { ConcurrencyMode } from '@/components/shared/ConcurrencyControl.vue'
import type { MappingTarget, MappingEntry } from '@/components/quick-setup/types'
import type { ProviderGroup } from '@/components/mappings/cascading-types'
import { DEFAULT_CONTEXT_WINDOW } from '@/constants'
import type { Schedule, SchedulePayload } from '@/types/schedule'
import type { MappingGroup, Provider } from '@/types/mapping'

const { t } = useI18n()

const WEEK_LABELS = computed(() => [
  t('schedules.weekDays.sun'),
  t('schedules.weekDays.mon'),
  t('schedules.weekDays.tue'),
  t('schedules.weekDays.wed'),
  t('schedules.weekDays.thu'),
  t('schedules.weekDays.fri'),
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
  concurrency_mode: 'none',
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
const formGroupId = ref<string>('')
const deleteTarget = ref<Schedule | null>(null)
const form = ref<ScheduleForm>(DEFAULT_FORM())
const concurrencyOpen = ref(false)
const errors = ref<Record<string, string>>({})
const formError = ref('')

// Group schedules by mapping_group_id
const schedulesByGroup = computed<Record<string, Schedule[]>>(() => {
  const map: Record<string, Schedule[]> = {}
  for (const s of allSchedules.value) {
    if (!map[s.mapping_group_id]) map[s.mapping_group_id] = []
    map[s.mapping_group_id].push(s)
  }
  return map
})

// Adapter for MappingEntryEditor
const mappingEntry = computed<MappingEntry>(() => ({
  clientModel: '__schedule__',
  targets: form.value.targets,
  existing: false,
  tag: 'cust' as const,
  active: true,
}))

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
  try {
    groups.value = await api.getMappingGroups()
  } catch (e: unknown) {
    toast.error(getApiMessage(e, t('schedules.loadGroupsFailed')))
  }
}

async function loadProviders() {
  try {
    providers.value = await api.getProviders()
  } catch (e: unknown) {
    toast.error(getApiMessage(e, t('schedules.loadProvidersFailed')))
  }
}

async function loadAllSchedules() {
  try {
    allSchedules.value = await api.getSchedules()
  } catch (e: unknown) {
    toast.error(getApiMessage(e, t('schedules.loadSchedulesFailed')))
  }
}

const providerGroups = computed<ProviderGroup[]>(() =>
  providers.value.map(p => ({
    provider: { id: p.id, name: p.name },
    models: (p.models ?? []).map(m => ({
      name: m.name,
      contextWindow: m.context_window ?? DEFAULT_CONTEXT_WINDOW,
    })),
  })),
)

function toggleWeekDay(day: number) {
  const idx = form.value.week.indexOf(day)
  if (idx >= 0) {
    form.value.week.splice(idx, 1)
  } else {
    form.value.week.push(day)
  }
  delete errors.value.week
}

function openCreate(groupId: string) {
  editingId.value = null
  formGroupId.value = groupId
  form.value = DEFAULT_FORM()
  concurrencyOpen.value = false
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
  } catch { /* ignore */ }

  let week: number[] = [1, 2, 3, 4, 5]
  try { week = JSON.parse(s.week) } catch { /* ignore */ }

  let concurrencyMode: ConcurrencyMode = 'none'
  let maxConcurrency = 10
  let queueTimeoutMs = 120000
  let maxQueueSize = 100
  if (s.concurrency_rule) {
    try {
      const cr = JSON.parse(s.concurrency_rule) as Record<string, unknown>
      concurrencyMode = (cr.mode as ConcurrencyMode) || 'none'
      if (cr.max_concurrency) maxConcurrency = cr.max_concurrency as number
      if (cr.queue_timeout_ms) queueTimeoutMs = cr.queue_timeout_ms as number
      if (cr.max_queue_size) maxQueueSize = cr.max_queue_size as number
    } catch { /* ignore */ }
  }

  form.value = {
    name: s.name,
    week,
    start_hour: s.start_hour,
    end_hour: s.end_hour,
    targets,
    concurrency_mode: concurrencyMode,
    max_concurrency: maxConcurrency,
    queue_timeout_ms: queueTimeoutMs,
    max_queue_size: maxQueueSize,
  }
  concurrencyOpen.value = !!s.concurrency_rule
  dialogOpen.value = true
}

function validate(): boolean {
  const errs: Record<string, string> = {}
  if (!form.value.name.trim()) errs.name = t('schedules.form.nameRequired')
  if (form.value.week.length === 0) errs.week = t('schedules.form.weekRequired')
  if (form.value.start_hour >= form.value.end_hour) errs.time = t('schedules.form.timeInvalid')

  for (const tgt of form.value.targets) {
    if (!tgt.provider_id || !tgt.backend_model) {
      errs.targets = t('schedules.form.targetRequired')
      break
    }
  }

  errors.value = errs
  return Object.keys(errs).length === 0
}

async function handleSave() {
  formError.value = ''
  if (!validate()) return

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
    }

    if (editingId.value) {
      await api.updateSchedule(editingId.value, payload)
    } else {
      await api.createSchedule(payload)
    }
    dialogOpen.value = false
    await loadAllSchedules()
  } catch (e: unknown) {
    formError.value = getApiMessage(e, t('schedules.saveFailed'))
  }
}

async function handleToggle(s: Schedule) {
  try {
    await api.toggleSchedule(s.id)
    await loadAllSchedules()
  } catch (e: unknown) {
    toast.error(getApiMessage(e, t('schedules.toggleFailed')))
  }
}

async function handleDelete() {
  const target = deleteTarget.value
  if (!target) return
  deleteTarget.value = null
  try {
    await api.deleteSchedule(target.id)
    await loadAllSchedules()
  } catch (e: unknown) {
    toast.error(getApiMessage(e, t('schedules.deleteFailed')))
  }
}

onMounted(async () => {
  loading.value = true
  await Promise.allSettled([loadGroups(), loadProviders(), loadAllSchedules()])
  loading.value = false
})
</script>
