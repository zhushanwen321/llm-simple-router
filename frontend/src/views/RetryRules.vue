<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold text-foreground">重试规则</h2>
      <Button @click="openCreate" class="flex items-center gap-1">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
        </svg>
        添加规则
      </Button>
    </div>

    <div class="bg-card rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow class="bg-muted">
            <TableHead class="text-muted-foreground">名称</TableHead>
            <TableHead class="text-muted-foreground">HTTP 状态码</TableHead>
            <TableHead class="text-muted-foreground">响应体匹配</TableHead>
            <TableHead class="text-muted-foreground">重试策略</TableHead>
            <TableHead class="text-muted-foreground">状态</TableHead>
            <TableHead class="text-right text-muted-foreground">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="r in rules" :key="r.id">
            <TableCell class="font-mono text-sm">{{ r.name }}</TableCell>
            <TableCell>{{ r.status_code }}</TableCell>
            <TableCell class="font-mono text-xs text-muted-foreground">{{ r.body_pattern }}</TableCell>
            <TableCell>
              <div class="flex items-center gap-2">
                <Badge variant="outline">{{ r.retry_strategy === 'fixed' ? '固定间隔' : '指数退避' }}</Badge>
                <span class="text-xs text-muted-foreground">
                  {{ r.retry_delay_ms / 1000 }}s · {{ r.max_retries }}次
                  <template v-if="r.retry_strategy === 'exponential'"> · 上限{{ r.max_delay_ms / 1000 }}s</template>
                </span>
              </div>
            </TableCell>
            <TableCell>
              <Badge :variant="r.is_active ? 'default' : 'secondary'">{{ r.is_active ? '启用' : '禁用' }}</Badge>
            </TableCell>
            <TableCell class="text-right">
              <Button variant="ghost" size="sm" @click="openEdit(r)" class="mr-2">编辑</Button>
              <Button variant="ghost" size="sm" class="text-destructive hover:text-destructive" @click="confirmDelete(r)">删除</Button>
            </TableCell>
          </TableRow>
          <TableRow v-if="rules.length === 0">
            <TableCell colspan="6" class="text-center text-muted-foreground py-8">暂无规则</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <!-- Create/Edit Dialog -->
    <Dialog v-model:open="dialogOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ editingId ? '编辑规则' : '添加规则' }}</DialogTitle>
        </DialogHeader>
        <form @submit.prevent="handleSave" class="space-y-3">
          <div>
            <Label class="block text-sm font-medium text-foreground mb-1">名称</Label>
            <Input v-model="form.name" type="text" required @input="delete errors.name" />
            <p v-if="errors.name" class="text-sm text-destructive mt-1">{{ errors.name }}</p>
          </div>
          <div>
            <Label class="block text-sm font-medium text-foreground mb-1">HTTP 状态码</Label>
            <Input v-model.number="form.status_code" type="number" required @input="delete errors.status_code" />
            <p v-if="errors.status_code" class="text-sm text-destructive mt-1">{{ errors.status_code }}</p>
          </div>
          <div>
            <Label class="block text-sm font-medium text-foreground mb-1">响应体匹配</Label>
            <Input v-model="form.body_pattern" type="text" placeholder="正则表达式，例如 .*rate_limit.*" required @input="delete errors.body_pattern" />
            <p v-if="errors.body_pattern" class="text-sm text-destructive mt-1">{{ errors.body_pattern }}</p>
          </div>
          <!-- 重试策略 -->
          <div>
            <Label class="block text-sm font-medium text-foreground mb-1">重试策略</Label>
            <Select v-model="form.retry_strategy">
              <SelectTrigger class="w-full">
                <SelectValue placeholder="选择策略" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="exponential">指数退避</SelectItem>
                <SelectItem value="fixed">固定间隔</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <Label class="block text-sm font-medium text-foreground mb-1">{{ form.retry_strategy === 'fixed' ? '间隔时间 (ms)' : '初始延迟 (ms)' }}</Label>
              <Input v-model.number="form.retry_delay_ms" type="number" :min="100" required @input="delete errors.retry_delay_ms" />
              <p v-if="errors.retry_delay_ms" class="text-sm text-destructive mt-1">{{ errors.retry_delay_ms }}</p>
            </div>
            <div>
              <Label class="block text-sm font-medium text-foreground mb-1">最大重试次数</Label>
              <Input v-model.number="form.max_retries" type="number" :min="0" :max="100" required @input="delete errors.max_retries" />
              <p v-if="errors.max_retries" class="text-sm text-destructive mt-1">{{ errors.max_retries }}</p>
            </div>
          </div>
          <div v-if="form.retry_strategy === 'exponential'">
            <Label class="block text-sm font-medium text-foreground mb-1">延迟上限 (ms)</Label>
            <Input v-model.number="form.max_delay_ms" type="number" :min="100" required @input="delete errors.max_delay_ms" />
            <p v-if="errors.max_delay_ms" class="text-sm text-destructive mt-1">{{ errors.max_delay_ms }}</p>
          </div>
          <div class="flex items-center gap-2">
            <Checkbox v-model="form.is_active" id="rule-active" />
            <Label for="rule-active" class="text-sm text-foreground">启用</Label>
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
          <AlertDialogDescription>确定要删除规则「{{ deleteTarget?.name }}」吗？</AlertDialogDescription>
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
import { ref, onMounted } from 'vue'
import { toast } from 'vue-sonner'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '@/components/ui/alert-dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

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
  if (!form.value.name.trim()) errs.name = '请输入名称'

  const sc = Number(form.value.status_code)
  if (!Number.isInteger(sc) || sc < MIN_STATUS_CODE || sc > MAX_STATUS_CODE) errs.status_code = `范围 ${MIN_STATUS_CODE}-${MAX_STATUS_CODE}`

  if (!form.value.body_pattern.trim()) errs.body_pattern = '请输入匹配规则'
  else {
    try { new RegExp(form.value.body_pattern) } catch { errs.body_pattern = '不是合法的正则表达式' }
  }

  const delay = Number(form.value.retry_delay_ms)
  if (!delay || delay < MIN_DELAY_MS) errs.retry_delay_ms = `不能小于 ${MIN_DELAY_MS}ms`

  const retries = Number(form.value.max_retries)
  if (!Number.isInteger(retries) || retries < 0 || retries > MAX_RETRIES) errs.max_retries = `范围 0-${MAX_RETRIES}`

  if (form.value.retry_strategy === 'exponential') {
    const maxDelay = Number(form.value.max_delay_ms)
    if (!maxDelay || maxDelay < MIN_DELAY_MS) errs.max_delay_ms = `不能小于 ${MIN_DELAY_MS}ms`
  }

  errors.value = errs
  return Object.keys(errs).length === 0
}

async function loadData() {
  try {
    const res = await api.getRetryRules()
    rules.value = res
  } catch (e) {
    console.error('Failed to load retry rules:', e)
    toast.error('加载数据失败')
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
  } catch (e) {
    console.error('Failed to save retry rule:', e)
    toast.error('保存规则失败')
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
  } catch (e) {
    console.error('Failed to delete retry rule:', e)
    toast.error('删除规则失败')
  }
}

onMounted(loadData)
</script>
