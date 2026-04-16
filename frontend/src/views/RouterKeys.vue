<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold text-gray-900">API 密钥</h2>
      <Button @click="openCreate" class="flex items-center gap-1">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
        创建密钥
      </Button>
    </div>

    <div class="bg-white rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow class="bg-gray-50">
            <TableHead class="text-gray-600">名称</TableHead>
            <TableHead class="text-gray-600">密钥</TableHead>
            <TableHead class="text-gray-600">白名单模型</TableHead>
            <TableHead class="text-gray-600">状态</TableHead>
            <TableHead class="text-gray-600">创建时间</TableHead>
            <TableHead class="text-right text-gray-600">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="k in keys" :key="k.id" :class="{ 'opacity-60': !k.is_active }">
            <TableCell class="font-medium">{{ k.name }}</TableCell>
            <TableCell>
              <div class="flex items-center gap-1">
                <span class="font-mono text-xs text-gray-500">{{ k.key_prefix }}...</span>
                <Button variant="ghost" size="sm" class="h-6 w-6 p-0" @click="copyPrefix(k.key_prefix)">
                  <svg v-if="copiedPrefix !== k.key_prefix" class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                  </svg>
                  <svg v-else class="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
                  </svg>
                </Button>
              </div>
            </TableCell>
            <TableCell>
              <template v-if="k.allowed_models && k.allowed_models.length > 0">
                <div class="flex flex-wrap gap-1">
                  <Badge v-for="m in k.allowed_models" :key="m" variant="outline" class="text-xs">{{ m }}</Badge>
                </div>
              </template>
              <Badge v-else variant="secondary">全部模型</Badge>
            </TableCell>
            <TableCell>
              <Badge :variant="k.is_active ? 'default' : 'secondary'">{{ k.is_active ? '启用' : '禁用' }}</Badge>
            </TableCell>
            <TableCell class="text-gray-500 text-sm">{{ formatDate(k.created_at) }}</TableCell>
            <TableCell class="text-right">
              <Button variant="ghost" size="sm" @click="openEdit(k)" class="text-gray-400 hover:text-blue-600 mr-2">编辑</Button>
              <Button variant="ghost" size="sm" @click="confirmDelete(k)" class="text-gray-400 hover:text-red-600">删除</Button>
            </TableCell>
          </TableRow>
          <TableRow v-if="keys.length === 0">
            <TableCell colspan="6" class="text-center text-gray-400 py-8">暂无密钥</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <!-- Create/Edit Dialog -->
    <Dialog v-model:open="dialogOpen">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{{ editingId ? '编辑密钥' : '创建密钥' }}</DialogTitle>
        </DialogHeader>
        <form @submit.prevent="handleSave" class="space-y-4">
          <div>
            <Label class="block text-sm font-medium text-gray-700 mb-1">名称</Label>
            <Input v-model="form.name" type="text" required placeholder="例如：生产环境" />
          </div>
          <div>
            <Label class="block text-sm font-medium text-gray-700 mb-1">白名单模型</Label>
            <div class="text-xs text-gray-400 mb-2">不选择 = 允许所有模型</div>
            <div class="border rounded-md p-3 max-h-48 overflow-y-auto space-y-2 bg-gray-50">
              <label
                v-for="model in availableModels"
                :key="model"
                class="flex items-center gap-2 cursor-pointer text-sm"
              >
                <input
                  type="checkbox"
                  :value="model"
                  :checked="form.allowed_models.includes(model)"
                  class="rounded"
                  @change="toggleModel(model)"
                />
                <span class="font-mono text-xs">{{ model }}</span>
              </label>
              <div v-if="availableModels.length === 0" class="text-gray-400 text-sm text-center py-2">
                暂无可用模型，请先配置模型映射
              </div>
            </div>
            <div v-if="form.allowed_models.length > 0" class="flex flex-wrap gap-1 mt-2">
              <Badge v-for="m in form.allowed_models" :key="m" variant="outline" class="text-xs">
                {{ m }}
                <button type="button" class="ml-1 text-gray-400 hover:text-red-500" @click="removeModel(m)">&times;</button>
              </Badge>
            </div>
          </div>
          <div v-if="editingId" class="flex items-center gap-2">
            <input v-model="form.is_active" type="checkbox" id="key-active" class="rounded" />
            <Label for="key-active" class="text-sm text-gray-700">启用</Label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" @click="dialogOpen = false">取消</Button>
            <Button type="submit">保存</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>

    <!-- Show Key Dialog (after creation) -->
    <Dialog v-model:open="showKeyDialog">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>密钥创建成功</DialogTitle>
        </DialogHeader>
        <div class="space-y-3">
          <p class="text-sm text-gray-600">请立即保存此密钥，关闭后将无法再次查看完整密钥。</p>
          <div class="bg-gray-100 rounded-md p-3 font-mono text-sm break-all select-all">{{ createdKey }}</div>
          <Button variant="outline" size="sm" @click="copyKey">{{ copied ? '已复制' : '复制密钥' }}</Button>
        </div>
        <DialogFooter>
          <Button @click="showKeyDialog = false">我已保存密钥</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <!-- Delete Confirm AlertDialog -->
    <AlertDialog :open="!!deleteTarget" @update:open="(val) => { if (!val) deleteTarget = null }">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除</AlertDialogTitle>
          <AlertDialogDescription>确定要删除密钥「{{ deleteTarget?.name }}」吗？使用此密钥的所有请求将被拒绝，此操作不可撤销。</AlertDialogDescription>
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
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel } from '@/components/ui/alert-dialog'

/* eslint-disable @typescript-eslint/no-explicit-any */

interface RouterKey {
  id: string
  name: string
  key_prefix: string
  allowed_models: string[] | null
  is_active: number
  created_at: string
}

const keys = ref<RouterKey[]>([])
const availableModels = ref<string[]>([])
const dialogOpen = ref(false)
const editingId = ref<string | null>(null)
const deleteTarget = ref<RouterKey | null>(null)
const form = ref({ name: '', allowed_models: [] as string[], is_active: true })

const showKeyDialog = ref(false)
const createdKey = ref('')
const copied = ref(false)
const copiedPrefix = ref('')

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('zh-CN')
}

function toggleModel(model: string) {
  const idx = form.value.allowed_models.indexOf(model)
  if (idx >= 0) {
    form.value.allowed_models.splice(idx, 1)
  } else {
    form.value.allowed_models.push(model)
  }
}

function removeModel(model: string) {
  const idx = form.value.allowed_models.indexOf(model)
  if (idx >= 0) form.value.allowed_models.splice(idx, 1)
}

async function loadData() {
  try {
    const [keysRes, modelsRes] = await Promise.allSettled([
      api.getRouterKeys(),
      api.getAvailableModels(),
    ])
    if (keysRes.status === 'fulfilled') keys.value = keysRes.value.data
    if (modelsRes.status === 'fulfilled') availableModels.value = modelsRes.value.data
  } catch (e) {
    console.error('Failed to load data:', e)
    keys.value = []
    availableModels.value = []
  }
}

function openCreate() {
  editingId.value = null
  form.value = { name: '', allowed_models: [], is_active: true }
  dialogOpen.value = true
}

function openEdit(k: RouterKey) {
  editingId.value = k.id
  form.value = {
    name: k.name,
    allowed_models: k.allowed_models ? [...k.allowed_models] : [],
    is_active: !!k.is_active,
  }
  dialogOpen.value = true
}

async function handleSave() {
  try {
    if (editingId.value) {
      const data: any = {
        name: form.value.name,
        is_active: form.value.is_active ? 1 : 0,
      }
      data.allowed_models = form.value.allowed_models.length > 0 ? form.value.allowed_models : null
      await api.updateRouterKey(editingId.value, data)
    } else {
      const data: any = { name: form.value.name }
      data.allowed_models = form.value.allowed_models.length > 0 ? form.value.allowed_models : null
      const res = await api.createRouterKey(data)
      if (res.data?.key) {
        createdKey.value = res.data.key
        showKeyDialog.value = true
      }
    }
    dialogOpen.value = false
    await loadData()
  } catch (e) {
    console.error('Failed to save router key:', e)
    alert('保存失败，请重试')
  }
}

function confirmDelete(k: RouterKey) {
  deleteTarget.value = k
}

async function handleDelete() {
  const target = deleteTarget.value
  if (!target) return
  deleteTarget.value = null
  try {
    await api.deleteRouterKey(target.id)
    await loadData()
  } catch (e) {
    console.error('Failed to delete router key:', e)
    alert('删除失败，请重试')
  }
}

const COPY_FEEDBACK_MS = 2000

async function copyKey() {
  try {
    await navigator.clipboard.writeText(createdKey.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, COPY_FEEDBACK_MS)
  // eslint-disable-next-line taste/no-silent-catch
  } catch (e) {
    console.error('Failed to copy key:', e)
  }
}

async function copyPrefix(prefix: string) {
  try {
    await navigator.clipboard.writeText(prefix)
    copiedPrefix.value = prefix
    setTimeout(() => { copiedPrefix.value = '' }, COPY_FEEDBACK_MS)
  // eslint-disable-next-line taste/no-silent-catch
  } catch (e) {
    console.error('Failed to copy prefix:', e)
  }
}

onMounted(loadData)
</script>
