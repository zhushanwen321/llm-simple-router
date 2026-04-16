<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold text-gray-900">重试规则</h2>
      <Button @click="openCreate" class="flex items-center gap-1">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
        </svg>
        添加规则
      </Button>
    </div>

    <div class="bg-white rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow class="bg-gray-50">
            <TableHead class="text-gray-600">名称</TableHead>
            <TableHead class="text-gray-600">HTTP 状态码</TableHead>
            <TableHead class="text-gray-600">响应体匹配</TableHead>
            <TableHead class="text-gray-600">状态</TableHead>
            <TableHead class="text-right text-gray-600">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="r in rules" :key="r.id">
            <TableCell class="font-mono text-sm">{{ r.name }}</TableCell>
            <TableCell>{{ r.status_code }}</TableCell>
            <TableCell class="font-mono text-xs text-gray-500">{{ r.body_pattern }}</TableCell>
            <TableCell>
              <Badge :variant="r.is_active ? 'default' : 'secondary'">{{ r.is_active ? '启用' : '禁用' }}</Badge>
            </TableCell>
            <TableCell class="text-right">
              <Button variant="ghost" size="sm" @click="openEdit(r)" class="mr-2">编辑</Button>
              <Button variant="ghost" size="sm" class="text-red-600 hover:text-red-700" @click="confirmDelete(r)">删除</Button>
            </TableCell>
          </TableRow>
          <TableRow v-if="rules.length === 0">
            <TableCell colspan="5" class="text-center text-gray-400 py-8">暂无规则</TableCell>
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
            <Label class="block text-sm font-medium text-gray-700 mb-1">名称</Label>
            <Input v-model="form.name" type="text" required />
          </div>
          <div>
            <Label class="block text-sm font-medium text-gray-700 mb-1">HTTP 状态码</Label>
            <Input v-model.number="form.status_code" type="number" required />
          </div>
          <div>
            <Label class="block text-sm font-medium text-gray-700 mb-1">响应体匹配</Label>
            <Input v-model="form.body_pattern" type="text" placeholder="正则表达式，例如 .*rate_limit.*" required />
          </div>
          <div class="flex items-center gap-2">
            <input v-model="form.is_active" type="checkbox" id="rule-active" class="rounded" />
            <Label for="rule-active" class="text-sm text-gray-700">启用</Label>
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

interface RetryRule {
  id: string
  name: string
  status_code: number
  body_pattern: string
  is_active: number
  created_at: string
}

const DEFAULT_FORM = { name: '', status_code: 429, body_pattern: '', is_active: true }

const rules = ref<RetryRule[]>([])
const dialogOpen = ref(false)
const editingId = ref<string | null>(null)
const deleteTarget = ref<RetryRule | null>(null)
const form = ref({ ...DEFAULT_FORM })

async function loadData() {
  try {
    const res = await api.getRetryRules()
    rules.value = res.data
  } catch (e) {
    console.error('Failed to load retry rules:', e)
    toast.error('加载数据失败')
  }
}

function openCreate() {
  editingId.value = null
  form.value = { ...DEFAULT_FORM }
  dialogOpen.value = true
}

function openEdit(r: RetryRule) {
  editingId.value = r.id
  form.value = {
    name: r.name,
    status_code: r.status_code,
    body_pattern: r.body_pattern,
    is_active: !!r.is_active,
  }
  dialogOpen.value = true
}

async function handleSave() {
  try {
    const payload = {
      name: form.value.name,
      status_code: Number(form.value.status_code),
      body_pattern: form.value.body_pattern,
      is_active: form.value.is_active ? 1 : 0,
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
