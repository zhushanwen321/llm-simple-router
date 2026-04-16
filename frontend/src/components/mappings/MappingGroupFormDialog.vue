<!-- eslint-disable vue/no-mutating-props -- form is a reactive object managed by parent component -->
<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-w-2xl">
      <DialogHeader>
        <DialogTitle>{{ editingId ? '编辑分组' : '添加分组' }}</DialogTitle>
        <DialogDescription>配置客户端模型到后端供应商模型的映射规则</DialogDescription>
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
              <Label class="block text-xs text-gray-500 mb-1">供应商</Label>
              <Select v-model="form.default.provider_id" @update:model-value="onDefaultProviderChange">
                <SelectTrigger>
                  <SelectValue placeholder="选择供应商" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div class="flex-1">
              <Label class="block text-xs text-gray-500 mb-1">后端模型</Label>
              <Input
                v-model="form.default.backend_model"
                type="text"
                list="datalist-default-model"
                required
              />
              <datalist id="datalist-default-model">
                <option v-for="m in defaultModels" :key="m" :value="m" />
              </datalist>
            </div>
          </div>
        </div>

        <div class="border rounded-lg p-3 space-y-3">
          <div class="flex items-center justify-between">
            <div class="text-sm font-medium text-gray-700">时间窗口</div>
            <Button type="button" variant="outline" size="sm" @click="emit('addWindow')">添加窗口</Button>
          </div>
          <div
            v-for="(w, idx) in form.windows"
            :key="idx"
            class="border rounded-md p-2 space-y-2"
          >
            <div class="flex items-end gap-2">
              <div class="w-24">
                <Label class="block text-xs text-gray-500 mb-1">开始</Label>
                <Input v-model="w.start" type="text" placeholder="HH:MM" required />
              </div>
              <span class="text-gray-400 pb-1.5">-</span>
              <div class="w-24">
                <Label class="block text-xs text-gray-500 mb-1">结束</Label>
                <Input v-model="w.end" type="text" placeholder="HH:MM" required />
              </div>
              <div class="flex-1" />
              <Button type="button" variant="ghost" size="sm" class="text-red-600 shrink-0" @click="emit('removeWindow', idx)">删除</Button>
            </div>
            <div class="flex gap-2">
              <div class="flex-1">
                <Label class="block text-xs text-gray-500 mb-1">供应商</Label>
                <Select v-model="w.provider_id" @update:model-value="onWindowProviderChange(idx, $event)">
                  <SelectTrigger>
                    <SelectValue placeholder="选择供应商" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div class="flex-1">
                <Label class="block text-xs text-gray-500 mb-1">后端模型</Label>
                <Input
                  v-model="w.backend_model"
                  type="text"
                  :list="`datalist-window-model-${idx}`"
                  required
                />
                <datalist :id="`datalist-window-model-${idx}`">
                  <option v-for="m in getWindowModels(idx)" :key="m" :value="m" />
                </datalist>
              </div>
            </div>
          </div>
          <div v-if="form.windows.length === 0" class="text-sm text-gray-400">暂无窗口</div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" @click="emit('update:open', false)">取消</Button>
          <Button type="submit">保存</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'

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

interface FormData {
  client_model: string
  strategy: string
  default: { backend_model: string; provider_id: string }
  windows: RuleWindow[]
}

const props = defineProps<{
  open: boolean
  editingId: string | null
  form: FormData
  providers: Provider[]
  providerModels: Map<string, string[]>
}>()

const emit = defineEmits<{
  (e: 'update:open', val: boolean): void
  (e: 'save'): void
  (e: 'addWindow'): void
  (e: 'removeWindow', idx: number): void
}>()

const defaultModels = computed(() =>
  props.providerModels.get(props.form.default.provider_id) || []
)

function getWindowModels(idx: number): string[] {
  const providerId = props.form.windows[idx]?.provider_id
  return providerId ? (props.providerModels.get(providerId) || []) : []
}

function onDefaultProviderChange() {
  // 供应商切换时，如果当前模型不在新供应商的列表中，清空模型
  const models = props.providerModels.get(props.form.default.provider_id) || []
  if (props.form.default.backend_model && models.length > 0 && !models.includes(props.form.default.backend_model)) {
    // eslint-disable-next-line vue/no-mutating-props
    props.form.default.backend_model = ''
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function onWindowProviderChange(idx: number, _providerId: string) {
  const models = props.providerModels.get(props.form.windows[idx]?.provider_id || '') || []
  if (props.form.windows[idx]?.backend_model && models.length > 0 && !models.includes(props.form.windows[idx].backend_model)) {
    // eslint-disable-next-line vue/no-mutating-props
    props.form.windows[idx].backend_model = ''
  }
}

function handleSave() {
  emit('save')
}
</script>
