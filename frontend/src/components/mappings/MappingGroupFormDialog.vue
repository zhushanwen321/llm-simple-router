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
          <Label class="block text-sm font-medium text-foreground mb-1">客户端模型</Label>
          <Input v-model="form.client_model" type="text" required @input="delete errors.client_model" />
          <p v-if="errors.client_model" class="text-sm text-destructive mt-1">{{ errors.client_model }}</p>
        </div>
        <div>
          <Label class="block text-sm font-medium text-foreground mb-1">策略</Label>
          <Select v-model="form.strategy">
            <SelectTrigger>
              <SelectValue placeholder="选择策略" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="scheduled">定时切换 (scheduled)</SelectItem>
              <SelectItem value="round-robin">轮询 (round-robin)</SelectItem>
              <SelectItem value="random">随机 (random)</SelectItem>
              <SelectItem value="failover">故障转移 (failover)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <template v-if="form.strategy === 'scheduled'">
          <div class="border rounded-lg p-3 space-y-3">
            <div class="text-sm font-medium text-foreground">默认目标</div>
            <div class="flex gap-3">
              <div class="flex-1">
                <Label class="block text-xs text-muted-foreground mb-1">供应商</Label>
                <Select :model-value="form.default.provider_id" @update:model-value="onDefaultProviderChange">
                  <SelectTrigger>
                    <SelectValue placeholder="选择供应商" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }}</SelectItem>
                  </SelectContent>
                </Select>
                <p v-if="errors['default.provider_id']" class="text-sm text-destructive mt-1">{{ errors['default.provider_id'] }}</p>
              </div>
              <div class="flex-1">
                <Label class="block text-xs text-muted-foreground mb-1">后端模型</Label>
                <Select v-model="form.default.backend_model" :disabled="defaultModels.length === 0">
                  <SelectTrigger>
                    <SelectValue :placeholder="defaultModels.length === 0 ? '暂无可用模型' : '选择后端模型'" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="m in defaultModels" :key="m" :value="m">{{ m }}</SelectItem>
                  </SelectContent>
                </Select>
                <p v-if="errors['default.backend_model']" class="text-sm text-destructive mt-1">{{ errors['default.backend_model'] }}</p>
              </div>
            </div>
          </div>

          <div class="border rounded-lg p-3 space-y-3">
            <div class="flex items-center justify-between">
              <div class="text-sm font-medium text-foreground">时间窗口</div>
              <Button type="button" variant="outline" size="sm" @click="emit('addWindow')">添加窗口</Button>
            </div>
            <div
              v-for="(w, idx) in form.windows"
              :key="idx"
              class="border rounded-md p-2 space-y-2"
            >
              <div class="flex items-end gap-2">
                <div class="w-24">
                  <Label class="block text-xs text-muted-foreground mb-1">开始</Label>
                  <Input v-model="w.start" type="text" placeholder="HH:MM" required @input="delete errors[`window.${idx}.start`]" />
                  <p v-if="errors[`window.${idx}.start`]" class="text-sm text-destructive mt-1">{{ errors[`window.${idx}.start`] }}</p>
                </div>
                <span class="text-muted-foreground pb-1.5">-</span>
                <div class="w-24">
                  <Label class="block text-xs text-muted-foreground mb-1">结束</Label>
                  <Input v-model="w.end" type="text" placeholder="HH:MM" required @input="delete errors[`window.${idx}.end`]" />
                  <p v-if="errors[`window.${idx}.end`]" class="text-sm text-destructive mt-1">{{ errors[`window.${idx}.end`] }}</p>
                </div>
                <div class="flex-1" />
                <Button type="button" variant="ghost" size="sm" class="text-destructive shrink-0" @click="emit('removeWindow', idx)">删除</Button>
              </div>
              <div class="flex gap-3">
                <div class="flex-1">
                  <Label class="block text-xs text-muted-foreground mb-1">供应商</Label>
                  <Select :model-value="w.target.provider_id" @update:model-value="onWindowProviderChange(idx, $event)">
                    <SelectTrigger>
                      <SelectValue placeholder="选择供应商" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }}</SelectItem>
                    </SelectContent>
                  </Select>
                  <p v-if="errors[`window.${idx}.provider_id`]" class="text-sm text-destructive mt-1">{{ errors[`window.${idx}.provider_id`] }}</p>
                </div>
                <div class="flex-1">
                  <Label class="block text-xs text-muted-foreground mb-1">后端模型</Label>
                  <Select v-model="w.target.backend_model" :disabled="getWindowModels(idx).length === 0">
                    <SelectTrigger>
                      <SelectValue :placeholder="getWindowModels(idx).length === 0 ? '暂无可用模型' : '选择后端模型'" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem v-for="m in getWindowModels(idx)" :key="m" :value="m">{{ m }}</SelectItem>
                    </SelectContent>
                  </Select>
                  <p v-if="errors[`window.${idx}.backend_model`]" class="text-sm text-destructive mt-1">{{ errors[`window.${idx}.backend_model`] }}</p>
                </div>
              </div>
            </div>
            <div v-if="form.windows.length === 0" class="text-sm text-muted-foreground">暂无窗口</div>
          </div>
        </template>

        <div v-else class="border rounded-lg p-3 space-y-3">
          <div class="flex items-center justify-between">
            <div class="text-sm font-medium text-foreground">目标列表</div>
            <Button type="button" variant="outline" size="sm" @click="emit('addTarget')">添加目标</Button>
          </div>
          <p v-if="errors.targets" class="text-sm text-destructive">{{ errors.targets }}</p>
          <div v-for="(t, idx) in form.targets" :key="idx" class="border rounded-md p-2 space-y-2">
            <div class="flex gap-3">
              <div class="flex-1">
                <Label class="block text-xs text-muted-foreground mb-1">供应商</Label>
                <Select :model-value="t.provider_id" @update:model-value="onTargetProviderChange(idx, $event)">
                  <SelectTrigger>
                    <SelectValue placeholder="选择供应商" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="p in providers" :key="p.id" :value="p.id">{{ p.name }}</SelectItem>
                  </SelectContent>
                </Select>
                <p v-if="errors[`target.${idx}.provider_id`]" class="text-sm text-destructive mt-1">{{ errors[`target.${idx}.provider_id`] }}</p>
              </div>
              <div class="flex-1">
                <Label class="block text-xs text-muted-foreground mb-1">后端模型</Label>
                <Select v-model="t.backend_model" :disabled="getTargetModels(idx).length === 0">
                  <SelectTrigger>
                    <SelectValue :placeholder="getTargetModels(idx).length === 0 ? '暂无可用模型' : '选择后端模型'" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="m in getTargetModels(idx)" :key="m" :value="m">{{ m }}</SelectItem>
                  </SelectContent>
                </Select>
                <p v-if="errors[`target.${idx}.backend_model`]" class="text-sm text-destructive mt-1">{{ errors[`target.${idx}.backend_model`] }}</p>
              </div>
            </div>
            <div class="flex justify-end gap-1">
              <Button v-if="form.strategy === 'failover'" type="button" variant="ghost" size="sm" :disabled="idx === 0" @click="emit('moveTargetUp', idx)">↑</Button>
              <Button v-if="form.strategy === 'failover'" type="button" variant="ghost" size="sm" :disabled="idx === form.targets.length - 1" @click="emit('moveTargetDown', idx)">↓</Button>
              <Button type="button" variant="ghost" size="sm" class="text-destructive shrink-0" @click="emit('removeTarget', idx)">删除</Button>
            </div>
          </div>
          <div v-if="form.targets.length === 0" class="text-sm text-muted-foreground">暂无目标</div>
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
import { computed, ref, watch } from 'vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import type { AcceptableValue } from 'reka-ui'
import type { ProviderSummary, RuleWindow, MappingTarget } from '@/types/mapping'

interface FormData {
  client_model: string
  strategy: string
  default: MappingTarget
  windows: RuleWindow[]
  targets: MappingTarget[]
}

const props = defineProps<{
  open: boolean
  editingId: string | null
  form: FormData
  providers: ProviderSummary[]
  providerModels: Map<string, string[]>
}>()

const emit = defineEmits<{
  (e: 'update:open', val: boolean): void
  (e: 'save'): void
  (e: 'addWindow'): void
  (e: 'removeWindow', idx: number): void
  (e: 'addTarget'): void
  (e: 'removeTarget', idx: number): void
  (e: 'moveTargetUp', idx: number): void
  (e: 'moveTargetDown', idx: number): void
}>()

const defaultModels = computed(() =>
  props.providerModels.get(props.form.default.provider_id) || []
)

function getWindowModels(idx: number): string[] {
  const providerId = props.form.windows[idx]?.target?.provider_id
  return providerId ? (props.providerModels.get(providerId) || []) : []
}

// Select @update:model-value emit 出 AcceptableValue（含 null），需要类型收窄
function onDefaultProviderChange(value: AcceptableValue) {
  if (typeof value !== 'string') return
  // eslint-disable-next-line vue/no-mutating-props
  props.form.default.provider_id = value
  const models = props.providerModels.get(value) || []
  // eslint-disable-next-line vue/no-mutating-props
  props.form.default.backend_model = models[0] || ''
}

function onWindowProviderChange(idx: number, value: AcceptableValue) {
  if (typeof value !== 'string') return
  // eslint-disable-next-line vue/no-mutating-props
  props.form.windows[idx].target.provider_id = value
  const models = props.providerModels.get(value) || []
  // eslint-disable-next-line vue/no-mutating-props
  props.form.windows[idx].target.backend_model = models[0] || ''
}

function getTargetModels(idx: number): string[] {
  const providerId = props.form.targets[idx]?.provider_id
  return providerId ? (props.providerModels.get(providerId) || []) : []
}

function onTargetProviderChange(idx: number, value: AcceptableValue) {
  if (typeof value !== 'string') return
  // eslint-disable-next-line vue/no-mutating-props
  props.form.targets[idx].provider_id = value
  const models = props.providerModels.get(value) || []
  // eslint-disable-next-line vue/no-mutating-props
  props.form.targets[idx].backend_model = models[0] || ''
}

function handleSave() {
  if (!validate()) return
  emit('save')
}

const TIME_REGEX = /^\d{2}:\d{2}$/
const errors = ref<Record<string, string>>({})

function validate(): boolean {
  const errs: Record<string, string> = {}
  if (!props.form.client_model.trim()) errs.client_model = '请输入客户端模型名称'

  if (props.form.strategy === 'scheduled') {
    if (!props.form.default.provider_id) errs['default.provider_id'] = '请选择供应商'
    if (!props.form.default.backend_model) errs['default.backend_model'] = '请选择后端模型'
    props.form.windows.forEach((w, i) => {
      if (!TIME_REGEX.test(w.start)) errs[`window.${i}.start`] = '格式：HH:MM'
      if (!TIME_REGEX.test(w.end)) errs[`window.${i}.end`] = '格式：HH:MM'
      if (!w.target.provider_id) errs[`window.${i}.provider_id`] = '请选择供应商'
      if (!w.target.backend_model) errs[`window.${i}.backend_model`] = '请选择后端模型'
    })
  } else {
    if (props.form.targets.length === 0) errs.targets = '至少添加一个目标'
    props.form.targets.forEach((t, i) => {
      if (!t.provider_id) errs[`target.${i}.provider_id`] = '请选择供应商'
      if (!t.backend_model) errs[`target.${i}.backend_model`] = '请选择后端模型'
    })
  }

  errors.value = errs
  return Object.keys(errs).length === 0
}

// dialog 打开时清除错误
watch(() => props.open, (v) => { if (v) errors.value = {} })
</script>
