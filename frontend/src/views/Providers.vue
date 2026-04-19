<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold text-foreground">供应商</h2>
      <Button @click="openCreate" class="flex items-center gap-1">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
        添加供应商
      </Button>
    </div>

    <div class="bg-card rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow class="bg-muted">
            <TableHead class="text-muted-foreground">名称</TableHead>
            <TableHead class="text-muted-foreground">类型</TableHead>
            <TableHead class="text-muted-foreground">Base URL</TableHead>
            <TableHead class="text-muted-foreground">API Key</TableHead>
            <TableHead class="text-muted-foreground">模型</TableHead>
            <TableHead class="text-muted-foreground">状态</TableHead>
            <TableHead class="text-right text-muted-foreground">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="p in providers" :key="p.id" :class="{ 'opacity-60': !p.is_active }">
            <TableCell class="font-medium">{{ p.name }}</TableCell>
            <TableCell>
              <Badge variant="secondary">{{ p.api_type }}</Badge>
            </TableCell>
            <TableCell class="text-muted-foreground">{{ p.base_url }}</TableCell>
            <TableCell class="text-muted-foreground font-mono text-xs">{{ p.api_key }}</TableCell>
            <TableCell>
              <div class="flex flex-wrap gap-1">
                <Badge v-for="m in (p.models || [])" :key="m" variant="secondary" class="text-xs">{{ m }}</Badge>
                <span v-if="!p.models?.length" class="text-muted-foreground text-xs">-</span>
              </div>
            </TableCell>
            <TableCell>
              <Badge :variant="p.is_active ? 'default' : 'secondary'">{{ p.is_active ? '启用' : '禁用' }}</Badge>
            </TableCell>
            <TableCell class="text-right">
              <Button variant="ghost" size="sm" @click="openEdit(p)" class="text-muted-foreground hover:text-primary mr-2">编辑</Button>
              <Button variant="ghost" size="sm" @click="confirmDelete(p)" class="text-muted-foreground hover:text-destructive">删除</Button>
            </TableCell>
          </TableRow>
          <TableRow v-if="providers.length === 0">
            <TableCell colspan="7" class="text-center text-muted-foreground py-8">暂无供应商</TableCell>
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
          <!-- 快速配置 -->
          <div class="rounded-md border bg-muted/40 p-3 space-y-2">
            <div class="text-xs font-medium text-muted-foreground">快速配置</div>
            <div class="flex gap-2">
              <Select v-model="presetGroup" @update:model-value="onGroupChange">
                <SelectTrigger class="flex-1">
                  <SelectValue placeholder="选择供应商" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="g in PROVIDER_PRESETS" :key="g.group" :value="g.group">{{ g.group }}</SelectItem>
                </SelectContent>
              </Select>
              <Select v-model="presetPlan" @update:model-value="onPresetChange" :disabled="!presetGroup">
                <SelectTrigger class="flex-1">
                  <SelectValue placeholder="选择套餐" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="p in availablePlans" :key="p.plan" :value="p.plan">{{ p.plan }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label class="block text-sm font-medium text-foreground mb-1">名称</Label>
            <Input v-model="form.name" type="text" required />
          </div>
          <div>
            <Label class="block text-sm font-medium text-foreground mb-1">Base URL</Label>
            <Input v-model="form.base_url" type="url" required />
          </div>
          <div>
            <Label class="block text-sm font-medium text-foreground mb-1">API Key</Label>
            <Input v-model="form.api_key" type="text" required />
          </div>
          <div>
            <Label class="block text-sm font-medium text-foreground mb-1">可用模型</Label>
            <div class="flex flex-wrap gap-1.5 mb-1.5">
              <Badge v-for="(m, i) in form.models" :key="i" variant="secondary" class="gap-1 pr-1">
                {{ m }}
                <Button type="button" variant="ghost" size="icon" class="h-4 w-4 rounded-full hover:bg-muted p-0 text-xs leading-none" @click="removeModel(i)">&times;</Button>
              </Badge>
            </div>
            <div class="flex gap-2">
              <Input v-model="modelInput" placeholder="输入模型名称，多个用逗号分隔" @keydown.enter.prevent="addModel" class="flex-1" />
              <Button type="button" variant="outline" size="sm" @click="addModel" :disabled="!modelInput.trim()">添加</Button>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <Checkbox v-model="form.is_active" id="svc-active" />
            <Label for="svc-active" class="text-sm text-foreground">启用</Label>
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
          <Button variant="destructive" @click="handleDelete">删除</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { toast } from 'vue-sonner'
import { api } from '@/api/client'
import { PROVIDER_PRESETS } from '@/data/provider-presets'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '@/components/ui/alert-dialog'
import { Checkbox } from '@/components/ui/checkbox'

interface Provider {
  id: string
  name: string
  api_type: string
  base_url: string
  api_key: string
  models: string[]
  is_active: number
}

const DEFAULT_FORM = { name: '', api_type: 'anthropic', base_url: '', api_key: '', models: [] as string[], is_active: true }
const modelInput = ref('')

const providers = ref<Provider[]>([])
const dialogOpen = ref(false)
const editingId = ref<string | null>(null)
const deleteTarget = ref<Provider | null>(null)
const form = ref({ ...DEFAULT_FORM })

// 预设级联状态
const presetGroup = ref('')
const presetPlan = ref('')

const availablePlans = computed(() => {
  if (!presetGroup.value) return []
  return PROVIDER_PRESETS.find(g => g.group === presetGroup.value)?.presets ?? []
})

function onGroupChange() {
  presetPlan.value = ''
}

function onPresetChange() {
  const preset = availablePlans.value.find(p => p.plan === presetPlan.value)
  if (!preset) return
  form.value.name = preset.presetName
  form.value.api_type = 'anthropic'
  form.value.base_url = preset.baseUrl
  form.value.models = [...preset.models]
}

async function loadProviders() {
  try {
    const data = await api.getProviders()
    providers.value = data as Provider[]
  } catch (e) {
    console.error('Failed to load providers:', e)
    toast.error('加载供应商失败')
  }
}

function addModel() {
  const input = modelInput.value.trim()
  if (!input) return
  const names = input.split(/[,，]/).map(s => s.trim()).filter(Boolean)
  for (const name of names) {
    if (!form.value.models.includes(name)) {
      form.value.models.push(name)
    }
  }
  modelInput.value = ''
}

function removeModel(index: number) {
  form.value.models.splice(index, 1)
}

function openCreate() {
  editingId.value = null
  form.value = { name: '', api_type: 'anthropic', base_url: '', api_key: '', models: [], is_active: true }
  modelInput.value = ''
  presetGroup.value = ''
  presetPlan.value = ''
  dialogOpen.value = true
}

function openEdit(p: Provider) {
  editingId.value = p.id
  form.value = { name: p.name, api_type: 'anthropic', base_url: p.base_url, api_key: p.api_key, models: [...(p.models || [])], is_active: !!p.is_active }
  modelInput.value = ''
  presetGroup.value = ''
  presetPlan.value = ''
  dialogOpen.value = true
}

function buildPayload(): { name: string; api_type: string; base_url: string; api_key?: string; models: string[]; is_active: number } {
  const payload: { name: string; api_type: string; base_url: string; api_key?: string; models: string[]; is_active: number } = {
    name: form.value.name,
    api_type: 'anthropic',
    base_url: form.value.base_url,
    models: form.value.models,
    is_active: form.value.is_active ? 1 : 0,
  }
  if (form.value.api_key) payload.api_key = form.value.api_key
  return payload
}

async function handleSave() {
  const name = form.value.name.trim()
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    toast.error('名称仅允许英文大小写字母、数字、横线和下划线')
    return
  }
  try {
    const payload = buildPayload()
    payload.name = name
    if (editingId.value) {
      await api.updateProvider(editingId.value, payload)
    } else {
      payload.api_key = form.value.api_key
      await api.createProvider(payload)
    }
    dialogOpen.value = false
    await loadProviders()
  } catch (e) {
    console.error('Failed to save provider:', e)
    toast.error('保存供应商失败')
  }
}

function confirmDelete(p: Provider) {
  deleteTarget.value = p
}

async function handleDelete() {
  const target = deleteTarget.value
  if (!target) return
  deleteTarget.value = null
  try {
    await api.deleteProvider(target.id)
    await loadProviders()
  } catch (e) {
    console.error('Failed to delete provider:', e)
    toast.error('删除供应商失败')
  }
}

onMounted(loadProviders)
</script>
