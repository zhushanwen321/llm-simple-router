<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
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
                  <SelectItem v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }}</SelectItem>
                </SelectContent>
              </Select>
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
                  <SelectItem v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="button" variant="ghost" size="sm" class="text-red-600" @click="emit('removeWindow', idx)">删除</Button>
          </div>
          <div v-if="form.windows.length === 0" class="text-sm text-gray-400">暂无窗口</div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" @click="open = false">取消</Button>
          <Button type="submit">保存</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

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
}>()

const emit = defineEmits<{
  (e: 'update:open', val: boolean): void
  (e: 'save'): void
  (e: 'addWindow'): void
  (e: 'removeWindow', idx: number): void
}>()

function handleSave() {
  emit('save')
}
</script>
