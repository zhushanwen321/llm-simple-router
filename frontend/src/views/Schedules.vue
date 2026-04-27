<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-4">
      <div>
        <h2 class="text-lg font-semibold text-foreground">调度管理</h2>
        <p class="text-sm text-muted-foreground mt-1">
          为映射组配置分时段调度规则，在不同时间段使用不同的模型和并发配置
        </p>
      </div>
    </div>

    <div v-if="loading" class="flex items-center justify-center py-16 text-muted-foreground text-sm">
      Loading...
    </div>

    <template v-if="!loading">
    <!-- 映射组选择器 -->
    <div class="mb-4">
      <Label class="block text-sm font-medium text-foreground mb-2">选择映射组</Label>
      <Select v-model="selectedGroupId" @update:model-value="handleGroupChange">
        <SelectTrigger class="w-80">
          <SelectValue placeholder="请选择映射组" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="g in groups" :key="g.id" :value="g.id">
            {{ g.client_model }}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>

    <!-- 调度列表 -->
    <template v-if="selectedGroupId">
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-medium text-foreground">调度规则</h3>
        <Button size="sm" @click="openCreate">
          <Plus class="w-4 h-4 mr-1" />
          新建调度
        </Button>
      </div>

      <div class="bg-card rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow class="bg-muted">
              <TableHead class="text-muted-foreground">名称</TableHead>
              <TableHead class="text-muted-foreground">状态</TableHead>
              <TableHead class="text-muted-foreground">星期</TableHead>
              <TableHead class="text-muted-foreground">时间段</TableHead>
              <TableHead class="text-right text-muted-foreground">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow v-for="s in schedules" :key="s.id">
              <TableCell class="font-medium">{{ s.name }}</TableCell>
              <TableCell>
                <Badge :variant="s.enabled ? 'default' : 'secondary'">
                  {{ s.enabled ? '启用' : '禁用' }}
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
                  <Button variant="ghost" size="sm" @click="openEdit(s)">编辑</Button>
                  <Button variant="ghost" size="sm" class="text-destructive hover:text-destructive" @click="deleteTarget = s">删除</Button>
                </div>
              </TableCell>
            </TableRow>
            <TableRow v-if="schedules.length === 0">
              <TableCell colspan="5" class="text-center text-muted-foreground py-8">
                暂无调度规则，点击「新建调度」添加
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </template>

    <div v-else class="text-center text-muted-foreground py-12 bg-card rounded-xl border">
      请先选择一个映射组
    </div>

    <!-- 创建/编辑弹窗 -->
    <Dialog v-model:open="dialogOpen">
      <DialogContent class="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{{ editingId ? '编辑调度' : '新建调度' }}</DialogTitle>
        </DialogHeader>
        <form @submit.prevent="handleSave" class="space-y-4">
          <!-- API 错误提示 -->
          <div v-if="formError" class="bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2 text-sm text-destructive">
            {{ formError }}
          </div>

          <!-- 名称 -->
          <div>
            <Label class="block text-sm font-medium text-foreground mb-1">名称</Label>
            <Input v-model="form.name" placeholder="例如：工作日白天" @input="delete errors.name" />
            <p v-if="errors.name" class="text-sm text-destructive mt-1">{{ errors.name }}</p>
          </div>

          <!-- 星期选择 -->
          <div>
            <Label class="block text-sm font-medium text-foreground mb-1">适用星期</Label>
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

          <!-- 时间段 -->
          <div class="grid grid-cols-2 gap-4">
            <div>
              <Label class="text-sm font-medium text-foreground mb-1 block">开始时间</Label>
              <Select v-model="form.start_hour" @update:model-value="(v: unknown) => { form.start_hour = Number(v); delete errors.time }">
                <SelectTrigger><SelectValue placeholder="选择小时" /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="h in 24" :key="h - 1" :value="h - 1">
                    {{ String(h - 1).padStart(2, '0') }}:00
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label class="text-sm font-medium text-foreground mb-1 block">结束时间</Label>
              <Select v-model="form.end_hour" @update:model-value="(v: unknown) => { form.end_hour = Number(v); delete errors.time }">
                <SelectTrigger><SelectValue placeholder="选择小时" /></SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="h in 24" :key="h" :value="h">
                    {{ String(h).padStart(2, '0') }}:00
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <p v-if="errors.time" class="text-sm text-destructive">{{ errors.time }}</p>

          <!-- 映射目标列表 -->
          <div>
            <Label class="block text-sm font-medium text-foreground mb-1">映射目标</Label>
            <div class="space-y-2">
              <div
                v-for="(t, idx) in form.targets"
                :key="idx"
                class="flex items-center gap-2"
              >
                <div class="flex-1">
                  <CascadingModelSelect
                    :providers="providerGroups"
                    :model-value="t.provider_id && t.backend_model ? { provider_id: t.provider_id, model: t.backend_model } : undefined"
                    placeholder="选择模型..."
                    @update:model-value="(v: SelectedValue) => { t.provider_id = v.provider_id; t.backend_model = v.model; delete errors.targets }"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  :disabled="form.targets.length <= 1"
                  @click="removeTarget(idx)"
                >
                  <Trash2 class="w-4 h-4" />
                </Button>
              </div>
              <Button type="button" variant="outline" size="sm" @click="addTarget">
                <Plus class="w-3 h-3 mr-1" />
                添加目标
              </Button>
            </div>
            <p v-if="errors.targets" class="text-sm text-destructive mt-1">{{ errors.targets }}</p>
          </div>

          <!-- 并发配置（折叠面板） -->
          <Collapsible v-model:open="concurrencyOpen">
            <CollapsibleTrigger as-child>
              <Button type="button" variant="ghost" class="w-full justify-between px-0">
                <span class="text-sm font-medium">并发配置（可选）</span>
                <ChevronDown class="h-4 w-4 transition-transform" :class="{ 'rotate-180': concurrencyOpen }" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent class="space-y-3 pt-2">
              <div class="grid grid-cols-3 gap-3">
                <div>
                  <Label class="text-xs text-muted-foreground">最大并发</Label>
                  <Input v-model.number="form.max_concurrency" type="number" :min="1" placeholder="不限" />
                </div>
                <div>
                  <Label class="text-xs text-muted-foreground">队列超时 (ms)</Label>
                  <Input v-model.number="form.queue_timeout_ms" type="number" :min="1000" placeholder="默认" />
                </div>
                <div>
                  <Label class="text-xs text-muted-foreground">最大队列</Label>
                  <Input v-model.number="form.max_queue_size" type="number" :min="0" placeholder="默认" />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          <DialogFooter>
            <Button type="button" variant="outline" @click="dialogOpen = false">取消</Button>
            <Button type="submit">保存</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <!-- 删除确认弹窗 -->
    <AlertDialog :open="!!deleteTarget" @update:open="(val: boolean) => { if (!val) deleteTarget = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除</AlertDialogTitle>
          <AlertDialogDescription>
            确定要删除调度「{{ deleteTarget?.name }}」吗？此操作不可撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <Button variant="destructive" @click="handleDelete">删除</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { toast } from 'vue-sonner'
import { Plus, Trash2, ChevronDown } from 'lucide-vue-next'
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
import CascadingModelSelect from '@/components/mappings/CascadingModelSelect.vue'
import type { SelectedValue, ProviderGroup } from '@/components/mappings/cascading-types'
import { DEFAULT_CONTEXT_WINDOW } from '@/constants'
import type { Schedule, SchedulePayload } from '@/types/schedule'
import type { MappingGroup, Provider } from '@/types/mapping'

const WEEK_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

interface TargetForm {
  backend_model: string
  provider_id: string
}

interface ScheduleForm {
  name: string
  week: number[]
  start_hour: number
  end_hour: number
  targets: TargetForm[]
  max_concurrency: number | undefined
  queue_timeout_ms: number | undefined
  max_queue_size: number | undefined
}

const DEFAULT_FORM = (): ScheduleForm => ({
  name: '',
  week: [1, 2, 3, 4, 5],
  start_hour: 0,
  end_hour: 24,
  targets: [{ backend_model: '', provider_id: '' }],
  max_concurrency: undefined,
  queue_timeout_ms: undefined,
  max_queue_size: undefined,
})

const loading = ref(false)
const groups = ref<MappingGroup[]>([])
const providers = ref<Provider[]>([])
const schedules = ref<Schedule[]>([])
const selectedGroupId = ref<string>('')
const dialogOpen = ref(false)
const editingId = ref<string | null>(null)
const deleteTarget = ref<Schedule | null>(null)
const form = ref<ScheduleForm>(DEFAULT_FORM())
const concurrencyOpen = ref(false)
const errors = ref<Record<string, string>>({})
const formError = ref('')

function parseWeek(weekStr: string): string[] {
  let arr: number[] = []
  try { arr = JSON.parse(weekStr) } catch (e) { console.warn('Failed to parse week JSON:', e); return [] }
  return arr.map(d => WEEK_LABELS[d] ?? String(d))
}

function formatHour(h: number): string {
  return String(h).padStart(2, '0') + ':00'
}

async function loadGroups() {
  try {
    groups.value = await api.getMappingGroups()
  } catch (e: unknown) {
    toast.error(getApiMessage(e, '加载映射组失败'))
  }
}

async function loadProviders() {
  try {
    providers.value = await api.getProviders()
  } catch (e: unknown) {
    toast.error(getApiMessage(e, '加载供应商失败'))
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

async function loadSchedules() {
  if (!selectedGroupId.value) { schedules.value = []; return }
  try {
    schedules.value = await api.getSchedulesByGroup(selectedGroupId.value)
  } catch (e: unknown) {
    toast.error(getApiMessage(e, '加载调度失败'))
  }
}

function handleGroupChange() {
  loadSchedules()
}

function toggleWeekDay(day: number) {
  const idx = form.value.week.indexOf(day)
  if (idx >= 0) {
    form.value.week.splice(idx, 1)
  } else {
    form.value.week.push(day)
  }
  delete errors.value.week
}

function addTarget() {
  form.value.targets.push({ backend_model: '', provider_id: '' })
}

function removeTarget(idx: number) {
  form.value.targets.splice(idx, 1)
}

function openCreate() {
  editingId.value = null
  form.value = DEFAULT_FORM()
  concurrencyOpen.value = false
  errors.value = {}
  formError.value = ''
  dialogOpen.value = true
}

function openEdit(s: Schedule) {
  editingId.value = s.id
  errors.value = {}
  formError.value = ''
  let targets: TargetForm[] = [{ backend_model: '', provider_id: '' }]
  try {
    const rule = JSON.parse(s.mapping_rule) as { targets?: TargetForm[] }
    if (rule.targets?.length) targets = rule.targets
  } catch (e) { console.warn('Failed to parse mapping_rule JSON:', e) }

  let week: number[] = [1, 2, 3, 4, 5]
  try { week = JSON.parse(s.week) } catch (e) { console.warn('Failed to parse week JSON:', e) }

  let max_concurrency: number | undefined
  let queue_timeout_ms: number | undefined
  let max_queue_size: number | undefined
  if (s.concurrency_rule) {
    try {
      const cr = JSON.parse(s.concurrency_rule) as Record<string, number>
      max_concurrency = cr.max_concurrency
      queue_timeout_ms = cr.queue_timeout_ms
      max_queue_size = cr.max_queue_size
    } catch (e) { console.warn('Failed to parse concurrency_rule JSON:', e) }
  }

  form.value = {
    name: s.name,
    week,
    start_hour: s.start_hour,
    end_hour: s.end_hour,
    targets,
    max_concurrency,
    queue_timeout_ms,
    max_queue_size,
  }
  concurrencyOpen.value = !!s.concurrency_rule
  dialogOpen.value = true
}

function validate(): boolean {
  const errs: Record<string, string> = {}
  if (!form.value.name.trim()) errs.name = '请输入名称'
  if (form.value.week.length === 0) errs.week = '至少选择一天'
  if (form.value.start_hour >= form.value.end_hour) errs.time = '开始时间必须小于结束时间'

  let targetErr = ''
  for (let i = 0; i < form.value.targets.length; i++) {
    const t = form.value.targets[i]
    if (!t.provider_id || !t.backend_model) {
      targetErr = '每个目标必须选择模型'
      break
    }
  }
  if (targetErr) errs.targets = targetErr

  errors.value = errs
  return Object.keys(errs).length === 0
}

async function handleSave() {
  formError.value = ''
  if (!validate()) return

  try {
    const mappingRule = JSON.stringify({ targets: form.value.targets })
    const hasConcurrency = form.value.max_concurrency || form.value.queue_timeout_ms || form.value.max_queue_size
    const concurrencyRule = hasConcurrency
      ? JSON.stringify({
        ...(form.value.max_concurrency ? { max_concurrency: form.value.max_concurrency } : {}),
        ...(form.value.queue_timeout_ms ? { queue_timeout_ms: form.value.queue_timeout_ms } : {}),
        ...(form.value.max_queue_size ? { max_queue_size: form.value.max_queue_size } : {}),
      })
      : null

    const payload: SchedulePayload = {
      mapping_group_id: selectedGroupId.value,
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
    await loadSchedules()
  } catch (e: unknown) {
    formError.value = getApiMessage(e, '保存调度失败')
  }
}

async function handleToggle(s: Schedule) {
  try {
    await api.toggleSchedule(s.id)
    await loadSchedules()
  } catch (e: unknown) {
    toast.error(getApiMessage(e, '切换状态失败'))
  }
}

async function handleDelete() {
  const target = deleteTarget.value
  if (!target) return
  deleteTarget.value = null
  try {
    await api.deleteSchedule(target.id)
    await loadSchedules()
  } catch (e: unknown) {
    toast.error(getApiMessage(e, '删除调度失败'))
  }
}

onMounted(async () => {
  loading.value = true
  await Promise.allSettled([loadGroups(), loadProviders()])
  if (groups.value.length > 0) {
    selectedGroupId.value = groups.value[0].id
    await loadSchedules()
  }
  loading.value = false
})
</script>
