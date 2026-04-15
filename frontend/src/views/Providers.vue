<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold text-gray-900">供应商</h2>
      <Button @click="openCreate" class="flex items-center gap-1">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
        添加供应商
      </Button>
    </div>

    <div class="bg-white rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow class="bg-gray-50">
            <TableHead class="text-gray-600">名称</TableHead>
            <TableHead class="text-gray-600">类型</TableHead>
            <TableHead class="text-gray-600">Base URL</TableHead>
            <TableHead class="text-gray-600">API Key</TableHead>
            <TableHead class="text-gray-600">状态</TableHead>
            <TableHead class="text-right text-gray-600">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="p in providers" :key="p.id" :class="{ 'opacity-60': !p.is_active }">
            <TableCell class="font-medium">{{ p.name }}</TableCell>
            <TableCell>
              <Badge :variant="p.api_type === 'openai' ? 'default' : 'secondary'">{{ p.api_type }}</Badge>
            </TableCell>
            <TableCell class="text-gray-500">{{ p.base_url }}</TableCell>
            <TableCell class="text-gray-500 font-mono text-xs">{{ p.api_key }}</TableCell>
            <TableCell>
              <Badge :variant="p.is_active ? 'default' : 'secondary'">{{ p.is_active ? '启用' : '禁用' }}</Badge>
            </TableCell>
            <TableCell class="text-right">
              <Button variant="ghost" size="sm" @click="openEdit(p)" class="text-gray-400 hover:text-blue-600 mr-2">编辑</Button>
              <Button variant="ghost" size="sm" @click="confirmDelete(p)" class="text-gray-400 hover:text-red-600">删除</Button>
            </TableCell>
          </TableRow>
          <TableRow v-if="providers.length === 0">
            <TableCell colspan="6" class="text-center text-gray-400 py-8">暂无供应商</TableCell>
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
          <div>
            <Label class="block text-sm font-medium text-gray-700 mb-1">名称</Label>
            <Input v-model="form.name" type="text" required />
          </div>
          <div>
            <Label class="block text-sm font-medium text-gray-700 mb-1">类型</Label>
            <Select v-model="form.api_type">
              <SelectTrigger>
                <SelectValue placeholder="选择类型" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="anthropic">Anthropic</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label class="block text-sm font-medium text-gray-700 mb-1">Base URL</Label>
            <Input v-model="form.base_url" type="url" required />
          </div>
          <div>
            <Label class="block text-sm font-medium text-gray-700 mb-1">API Key {{ editingId ? '(留空不修改)' : '' }}</Label>
            <Input v-model="form.api_key" :type="editingId ? 'password' : 'text'" :required="!editingId" />
          </div>
          <div class="flex items-center gap-2">
            <input v-model="form.is_active" type="checkbox" id="svc-active" class="rounded" />
            <Label for="svc-active" class="text-sm text-gray-700">启用</Label>
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
          <AlertDialogAction @click="handleDelete">删除</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from '@/components/ui/alert-dialog'

interface Provider {
  id: string
  name: string
  api_type: string
  base_url: string
  api_key: string
  is_active: number
}

const providers = ref<Provider[]>([])
const dialogOpen = ref(false)
const editingId = ref<string | null>(null)
const deleteTarget = ref<Provider | null>(null)
const form = ref({ name: '', api_type: 'openai', base_url: '', api_key: '', is_active: true })

async function loadProviders() {
  try {
    const res = await api.getProviders()
    providers.value = res.data
  } catch (e) {
    console.error('Failed to load providers:', e)
  }
}

function openCreate() {
  editingId.value = null
  form.value = { name: '', api_type: 'openai', base_url: '', api_key: '', is_active: true }
  dialogOpen.value = true
}

function openEdit(p: Provider) {
  editingId.value = p.id
  form.value = { name: p.name, api_type: p.api_type, base_url: p.base_url, api_key: '', is_active: !!p.is_active }
  dialogOpen.value = true
}

async function handleSave() {
  try {
    const data: any = {
      name: form.value.name,
      api_type: form.value.api_type,
      base_url: form.value.base_url,
      is_active: form.value.is_active ? 1 : 0,
    }
    if (form.value.api_key) data.api_key = form.value.api_key

    if (editingId.value) {
      await api.updateProvider(editingId.value, data)
    } else {
      data.api_key = form.value.api_key
      await api.createProvider(data)
    }
    dialogOpen.value = false
    await loadProviders()
  } catch (e) {
    console.error('Failed to save provider:', e)
  }
}

function confirmDelete(p: Provider) {
  deleteTarget.value = p
}

async function handleDelete() {
  if (!deleteTarget.value) return
  try {
    await api.deleteProvider(deleteTarget.value.id)
    deleteTarget.value = null
    await loadProviders()
  } catch (e) {
    console.error('Failed to delete provider:', e)
  }
}

onMounted(loadProviders)
</script>
