<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold text-gray-900">模型映射</h2>
      <Button @click="openCreate" class="flex items-center gap-1">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
        添加映射
      </Button>
    </div>

    <div class="bg-white rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow class="bg-gray-50">
            <TableHead class="text-gray-600">客户端模型</TableHead>
            <TableHead class="text-center text-gray-600"></TableHead>
            <TableHead class="text-gray-600">后端模型</TableHead>
            <TableHead class="text-gray-600">关联供应商</TableHead>
            <TableHead class="text-gray-600">状态</TableHead>
            <TableHead class="text-right text-gray-600">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="m in mappings" :key="m.id">
            <TableCell class="font-mono text-sm">{{ m.client_model }}</TableCell>
            <TableCell class="text-center text-gray-400">&rarr;</TableCell>
            <TableCell class="font-mono text-sm">{{ m.backend_model }}</TableCell>
            <TableCell class="text-gray-500">{{ getProviderName(m.provider_id) }}</TableCell>
            <TableCell>
              <Badge :variant="m.is_active ? 'default' : 'secondary'">{{ m.is_active ? '启用' : '禁用' }}</Badge>
            </TableCell>
            <TableCell class="text-right">
              <Button variant="ghost" size="sm" @click="openEdit(m)" class="text-gray-400 hover:text-blue-600 mr-2">编辑</Button>
              <Button variant="ghost" size="sm" @click="confirmDelete(m)" class="text-gray-400 hover:text-red-600">删除</Button>
            </TableCell>
          </TableRow>
          <TableRow v-if="mappings.length === 0">
            <TableCell colspan="6" class="text-center text-gray-400 py-8">暂无映射</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <!-- Create/Edit Dialog -->
    <Dialog v-model:open="dialogOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{{ editingId ? '编辑映射' : '添加映射' }}</DialogTitle>
        </DialogHeader>
        <form @submit.prevent="handleSave" class="space-y-3">
          <div>
            <Label class="block text-sm font-medium text-gray-700 mb-1">客户端模型</Label>
            <Input v-model="form.client_model" type="text" required />
          </div>
          <div>
            <Label class="block text-sm font-medium text-gray-700 mb-1">后端模型</Label>
            <Input v-model="form.backend_model" type="text" required />
          </div>
          <div>
            <Label class="block text-sm font-medium text-gray-700 mb-1">关联供应商</Label>
            <Select v-model="form.provider_id">
              <SelectTrigger>
                <SelectValue placeholder="选择供应商" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="p in providersList" :key="p.id" :value="p.id">{{ p.name }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div class="flex items-center gap-2">
            <input v-model="form.is_active" type="checkbox" id="map-active" class="rounded" />
            <Label for="map-active" class="text-sm text-gray-700">启用</Label>
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
          <AlertDialogDescription>确定要删除映射「{{ deleteTarget?.client_model }} &rarr; {{ deleteTarget?.backend_model }}」吗？</AlertDialogDescription>
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

interface Mapping {
  id: string
  client_model: string
  backend_model: string
  provider_id: string
  is_active: number
}

interface Provider {
  id: string
  name: string
}

const mappings = ref<Mapping[]>([])
const providersList = ref<Provider[]>([])
const dialogOpen = ref(false)
const editingId = ref<string | null>(null)
const deleteTarget = ref<Mapping | null>(null)
const form = ref({ client_model: '', backend_model: '', provider_id: '', is_active: true })

function getProviderName(id: string): string {
  return providersList.value.find(p => p.id === id)?.name || id
}

async function loadData() {
  try {
    const [mapRes, provRes] = await Promise.all([api.getMappings(), api.getProviders()])
    mappings.value = mapRes.data
    providersList.value = provRes.data
  } catch (e) {
    console.error('Failed to load data:', e)
  }
}

function openCreate() {
  editingId.value = null
  form.value = { client_model: '', backend_model: '', provider_id: providersList.value[0]?.id || '', is_active: true }
  dialogOpen.value = true
}

function openEdit(m: Mapping) {
  editingId.value = m.id
  form.value = { client_model: m.client_model, backend_model: m.backend_model, provider_id: m.provider_id, is_active: !!m.is_active }
  dialogOpen.value = true
}

async function handleSave() {
  try {
    const data = {
      client_model: form.value.client_model,
      backend_model: form.value.backend_model,
      provider_id: form.value.provider_id,
      is_active: form.value.is_active ? 1 : 0,
    }
    if (editingId.value) {
      await api.updateMapping(editingId.value, data)
    } else {
      await api.createMapping(data)
    }
    dialogOpen.value = false
    await loadData()
  } catch (e) {
    console.error('Failed to save mapping:', e)
  }
}

function confirmDelete(m: Mapping) {
  deleteTarget.value = m
}

async function handleDelete() {
  if (!deleteTarget.value) return
  try {
    await api.deleteMapping(deleteTarget.value.id)
    deleteTarget.value = null
    await loadData()
  } catch (e) {
    console.error('Failed to delete mapping:', e)
  }
}

onMounted(loadData)
</script>
