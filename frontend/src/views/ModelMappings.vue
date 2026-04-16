<template>
  <div class="p-6">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-semibold text-gray-900">模型映射</h2>
      <Button @click="openCreate" class="flex items-center gap-1">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
        </svg>
        添加分组
      </Button>
    </div>

    <div class="space-y-4">
      <Card v-for="g in groups" :key="g.id" class="bg-white">
        <Collapsible :default-open="false">
          <CardHeader class="flex flex-row items-center justify-between gap-4">
            <div class="flex items-center gap-3">
              <CardTitle class="font-mono text-sm">{{ g.client_model }}</CardTitle>
              <Badge variant="secondary">{{ g.strategy }}</Badge>
            </div>
            <div class="flex items-center gap-2">
              <CollapsibleTrigger as-child>
                <Button variant="ghost" size="sm">
                  展开
                </Button>
              </CollapsibleTrigger>
              <Button variant="ghost" size="sm" @click="openEdit(g)">编辑</Button>
              <Button variant="ghost" size="sm" class="text-red-600 hover:text-red-700" @click="confirmDelete(g)">删除</Button>
            </div>
          </CardHeader>
          <CollapsibleContent>
            <CardContent>
              <div class="space-y-3">
                <div class="flex items-center gap-2 text-sm">
                  <span class="text-gray-500">默认模型:</span>
                  <span class="font-mono">{{ parsedRule(g.rule).default?.backend_model || '-' }}</span>
                  <span class="text-gray-400">/</span>
                  <span>{{ providerNameMap.get(parsedRule(g.rule).default?.provider_id || '') || '-' }}</span>
                </div>
                <div v-if="parsedRule(g.rule).windows?.length" class="space-y-2">
                  <div class="text-sm text-gray-500">时间窗口</div>
                  <div
                    v-for="(w, idx) in parsedRule(g.rule).windows"
                    :key="idx"
                    class="flex items-center gap-2 text-sm"
                  >
                    <span class="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{{ w.start }} - {{ w.end }}</span>
                    <span class="font-mono">{{ w.backend_model }}</span>
                    <span class="text-gray-400">/</span>
                    <span>{{ providerNameMap.get(w.provider_id) || w.provider_id }}</span>
                  </div>
                </div>
                <div v-else class="text-sm text-gray-400">无时间窗口</div>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      <div v-if="groups.length === 0" class="text-center text-gray-400 py-12 bg-white rounded-xl border">
        暂无映射分组
      </div>
    </div>

    <!-- Create/Edit Dialog -->
    <Dialog v-model:open="dialogOpen">
      <DialogContent class="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{{ editingId ? '编辑分组' : '添加分组' }}</DialogTitle>
        </DialogHeader>
        <form @submit.prevent="handleSave" class="space-y-4">
          <div>
            <Label class="block text-sm font-medium text-gray-700 mb-1">客户端模型</Label>
            <Input v-model="form.client_model" type="text" required />
          </div>
          <div>
            <Label class="block text-sm font-medium text-gray-700 mb-1">策略</Label>
            <Select v-model="form.strategy">
              <SelectTrigger>
                <SelectValue placeholder="选择策略" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="scheduled">scheduled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div class="border rounded-lg p-3 space-y-3">
            <div class="text-sm font-medium text-gray-700">默认目标</div>
            <div class="flex gap-3">
              <div class="flex-1">
                <Label class="block text-xs text-gray-500 mb-1">后端模型</Label>
                <Input v-model="form.default.backend_model" type="text" required />
              </div>
              <div class="flex-1">
                <Label class="block text-xs text-gray-500 mb-1">供应商</Label>
                <Select v-model="form.default.provider_id">
                  <SelectTrigger>
                    <SelectValue placeholder="选择供应商" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="p in providersList" :key="p.id" :value="p.id">{{ p.name }}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div class="border rounded-lg p-3 space-y-3">
            <div class="flex items-center justify-between">
              <div class="text-sm font-medium text-gray-700">时间窗口</div>
              <Button type="button" variant="outline" size="sm" @click="addWindow">添加窗口</Button>
            </div>
            <div
              v-for="(w, idx) in form.windows"
              :key="idx"
              class="flex gap-3 items-end"
            >
              <div class="w-28">
                <Label class="block text-xs text-gray-500 mb-1">开始</Label>
                <Input v-model="w.start" type="text" placeholder="HH:MM" required />
              </div>
              <div class="w-28">
                <Label class="block text-xs text-gray-500 mb-1">结束</Label>
                <Input v-model="w.end" type="text" placeholder="HH:MM" required />
              </div>
              <div class="flex-1">
                <Label class="block text-xs text-gray-500 mb-1">后端模型</Label>
                <Input v-model="w.backend_model" type="text" required />
              </div>
              <div class="flex-1">
                <Label class="block text-xs text-gray-500 mb-1">供应商</Label>
                <Select v-model="w.provider_id">
                  <SelectTrigger>
                    <SelectValue placeholder="选择供应商" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="p in providersList" :key="p.id" :value="p.id">{{ p.name }}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="button" variant="ghost" size="sm" class="text-red-600" @click="removeWindow(idx)">删除</Button>
            </div>
            <div v-if="form.windows.length === 0" class="text-sm text-gray-400">暂无窗口</div>
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
          <AlertDialogDescription>确定要删除分组「{{ deleteTarget?.client_model }}」吗？</AlertDialogDescription>
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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '@/components/ui/alert-dialog'

interface MappingGroup {
  id: string
  client_model: string
  strategy: string
  rule: string
  created_at: string
}

interface Provider {
  id: string
  name: string
}

interface RuleWindow {
  start: string
  end: string
  backend_model: string
  provider_id: string
}

interface Rule {
  default?: {
    backend_model: string
    provider_id: string
  }
  windows?: RuleWindow[]
}

const DEFAULT_FORM = {
  client_model: '',
  strategy: 'scheduled',
  default: { backend_model: '', provider_id: '' },
  windows: [] as RuleWindow[],
}

const groups = ref<MappingGroup[]>([])
const providersList = ref<Provider[]>([])
const dialogOpen = ref(false)
const editingId = ref<string | null>(null)
const deleteTarget = ref<MappingGroup | null>(null)
const form = ref({ ...DEFAULT_FORM })

const providerNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const p of providersList.value) map.set(p.id, p.name)
  return map
})

function parsedRule(ruleJson: string): Rule {
  try {
    return JSON.parse(ruleJson) as Rule
  } catch {
    return {}
  }
}

async function loadData() {
  try {
    const [groupRes, provRes] = await Promise.allSettled([
      api.getMappingGroups(),
      api.getProviders(),
    ])
    if (groupRes.status === 'fulfilled') groups.value = groupRes.value.data
    if (provRes.status === 'fulfilled') providersList.value = provRes.value.data
  } catch (e) {
    console.error('Failed to load data:', e)
    toast.error('加载数据失败')
  }
}

function openCreate() {
  editingId.value = null
  form.value = {
    ...DEFAULT_FORM,
    default: { backend_model: '', provider_id: providersList.value[0]?.id || '' },
  }
  dialogOpen.value = true
}

function openEdit(g: MappingGroup) {
  editingId.value = g.id
  const rule = parsedRule(g.rule)
  form.value = {
    client_model: g.client_model,
    strategy: g.strategy,
    default: {
      backend_model: rule.default?.backend_model || '',
      provider_id: rule.default?.provider_id || providersList.value[0]?.id || '',
    },
    windows: rule.windows ? JSON.parse(JSON.stringify(rule.windows)) : [],
  }
  dialogOpen.value = true
}

function addWindow() {
  form.value.windows.push({
    start: '',
    end: '',
    backend_model: '',
    provider_id: providersList.value[0]?.id || '',
  })
}

function removeWindow(idx: number) {
  form.value.windows.splice(idx, 1)
}

async function handleSave() {
  try {
    const payload = {
      client_model: form.value.client_model,
      strategy: form.value.strategy,
      rule: JSON.stringify({
        default: form.value.default,
        windows: form.value.windows,
      }),
    }
    if (editingId.value) {
      await api.updateMappingGroup(editingId.value, payload)
    } else {
      await api.createMappingGroup(payload)
    }
    dialogOpen.value = false
    await loadData()
  } catch (e) {
    console.error('Failed to save mapping group:', e)
    toast.error('保存分组失败')
  }
}

function confirmDelete(g: MappingGroup) {
  deleteTarget.value = g
}

async function handleDelete() {
  const target = deleteTarget.value
  if (!target) return
  deleteTarget.value = null
  try {
    await api.deleteMappingGroup(target.id)
    await loadData()
  } catch (e) {
    console.error('Failed to delete mapping group:', e)
    toast.error('删除分组失败')
  }
}

onMounted(loadData)
</script>
