<!-- eslint-disable vue/no-mutating-props -- form is a reactive object managed by parent component -->
<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-w-2xl max-h-[85vh] overflow-y-auto">
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
                <div class="text-xs text-muted-foreground mb-1">默认模型</div>
                <CascadingModelSelect
                  :providers="providerGroups"
                  :model-value="{ provider_id: form.default.provider_id, model: form.default.backend_model }"
                  placeholder="选择模型..."
                  @update:model-value="(v: SelectedValue) => { form.default.provider_id = v.provider_id; form.default.backend_model = v.model }"
                />
                <p v-if="errors['default.provider_id'] || errors['default.backend_model']" class="text-sm text-destructive mt-1">
                  {{ errors['default.provider_id'] || errors['default.backend_model'] }}
                </p>
              </div>
              <div class="flex-1">
                <div class="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                  溢出模型（可选）
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <HelpCircle class="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>上下文超过默认模型限制时自动切换到此模型</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <CascadingModelSelect
                  :providers="overflowGroupsFor('default')"
                  :model-value="form.default.overflow_provider_id && form.default.overflow_model ? { provider_id: form.default.overflow_provider_id, model: form.default.overflow_model } : undefined"
                  placeholder="点击选择模型..."
                  @update:model-value="(v: SelectedValue | undefined) => onOverflowSelect('default', v)"
                />
              </div>
            </div>
            <div v-if="overflowHintFor('default')" class="text-xs text-primary">
              {{ overflowHintFor('default') }}
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
                  <div class="text-xs text-muted-foreground mb-1">窗口模型</div>
                  <CascadingModelSelect
                    :providers="providerGroups"
                    :model-value="{ provider_id: w.target.provider_id, model: w.target.backend_model }"
                    placeholder="选择模型..."
                    @update:model-value="(v: SelectedValue) => { w.target.provider_id = v.provider_id; w.target.backend_model = v.model }"
                  />
                  <p v-if="errors[`window.${idx}.provider_id`] || errors[`window.${idx}.backend_model`]" class="text-sm text-destructive mt-1">
                    {{ errors[`window.${idx}.provider_id`] || errors[`window.${idx}.backend_model`] }}
                  </p>
                </div>
                <div class="flex-1">
                  <div class="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                    溢出模型（可选）
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger as-child>
                          <HelpCircle class="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent>上下文超过窗口模型限制时自动切换到此模型</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <CascadingModelSelect
                    :providers="overflowGroupsFor(`window.${idx}`)"
                    :model-value="w.target.overflow_provider_id && w.target.overflow_model ? { provider_id: w.target.overflow_provider_id, model: w.target.overflow_model } : undefined"
                    placeholder="点击选择模型..."
                    @update:model-value="(v: SelectedValue | undefined) => onOverflowSelect(`window.${idx}`, v)"
                  />
                </div>
              </div>
              <div v-if="overflowHintFor(`window.${idx}`)" class="text-xs text-primary">
                {{ overflowHintFor(`window.${idx}`) }}
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
                <div class="text-xs text-muted-foreground mb-1">模型</div>
                <CascadingModelSelect
                  :providers="providerGroups"
                  :model-value="{ provider_id: t.provider_id, model: t.backend_model }"
                  placeholder="选择模型..."
                  @update:model-value="(v: SelectedValue) => { t.provider_id = v.provider_id; t.backend_model = v.model }"
                />
                <p v-if="errors[`target.${idx}.provider_id`] || errors[`target.${idx}.backend_model`]" class="text-sm text-destructive mt-1">
                  {{ errors[`target.${idx}.provider_id`] || errors[`target.${idx}.backend_model`] }}
                </p>
              </div>
              <div class="flex-1">
                <div class="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                  溢出模型（可选）
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <HelpCircle class="w-3.5 h-3.5 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent>上下文超过目标模型限制时自动切换到此模型</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
                <CascadingModelSelect
                  :providers="overflowGroupsFor(`target.${idx}`)"
                  :model-value="t.overflow_provider_id && t.overflow_model ? { provider_id: t.overflow_provider_id, model: t.overflow_model } : undefined"
                  placeholder="点击选择模型..."
                  @update:model-value="(v: SelectedValue | undefined) => onOverflowSelect(`target.${idx}`, v)"
                />
              </div>
            </div>
            <div v-if="overflowHintFor(`target.${idx}`)" class="text-xs text-primary">
              {{ overflowHintFor(`target.${idx}`) }}
            </div>
            <div class="flex justify-end gap-1">
              <Button v-if="form.strategy === 'failover'" type="button" variant="ghost" size="sm" :disabled="idx === 0" @click="emit('moveTargetUp', idx)">
                <ArrowUp class="w-4 h-4" />
              </Button>
              <Button v-if="form.strategy === 'failover'" type="button" variant="ghost" size="sm" :disabled="idx === form.targets.length - 1" @click="emit('moveTargetDown', idx)">
                <ArrowDown class="w-4 h-4" />
              </Button>
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
import { ref, watch } from 'vue'
import { ArrowUp, ArrowDown, HelpCircle } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import CascadingModelSelect from '@/components/mappings/CascadingModelSelect.vue'
import type { SelectedValue, ProviderGroup } from '@/components/mappings/cascading-types'
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
  providerGroups: ProviderGroup[]
  contextWindowMap: Map<string, number>
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

function getTargetByKey(key: string): MappingTarget | undefined {
  if (key === 'default') return props.form.default
  if (key.startsWith('window.')) {
    const idx = Number(key.split('.')[1])
    return props.form.windows[idx]?.target
  }
  if (key.startsWith('target.')) {
    const idx = Number(key.split('.')[1])
    return props.form.targets[idx]
  }
  return undefined
}

function getContextWindow(target: MappingTarget): number {
  const key = `${target.provider_id}:${target.backend_model}`
  return props.contextWindowMap.get(key) ?? 200000
}

function overflowGroupsFor(targetKey: string): ProviderGroup[] {
  const target = getTargetByKey(targetKey)
  if (!target?.backend_model) return props.providerGroups
  const cw = getContextWindow(target)
  return props.providerGroups
    .map(g => ({ ...g, models: g.models.filter(m => m.contextWindow >= cw) }))
    .filter(g => g.models.length > 0)
}

function overflowHintFor(targetKey: string): string {
  const target = getTargetByKey(targetKey)
  if (!target?.overflow_provider_id || !target?.overflow_model) return ''
  const cw = getContextWindow(target)
  if (cw >= 1000000) return '当前模型上下文 >= 1M，无需配置溢出模型'
  const cwStr = cw >= 1000 ? `${cw / 1000}K` : `${cw}`
  return `上下文超过 ${target.backend_model} 限制 (${cwStr}) 时自动切换到 ${target.overflow_model}`
}

function onOverflowSelect(targetKey: string, val: SelectedValue | undefined) {
  const target = getTargetByKey(targetKey)
  if (!target) return
  if (val) {
    target.overflow_provider_id = val.provider_id
    target.overflow_model = val.model
  } else {
    target.overflow_provider_id = undefined
    target.overflow_model = undefined
  }
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
    if (!props.form.default.provider_id) errs['default.provider_id'] = '请选择模型'
    if (!props.form.default.backend_model) errs['default.backend_model'] = '请选择模型'
    props.form.windows.forEach((w, i) => {
      if (!TIME_REGEX.test(w.start)) errs[`window.${i}.start`] = '格式：HH:MM'
      if (!TIME_REGEX.test(w.end)) errs[`window.${i}.end`] = '格式：HH:MM'
      if (!w.target.provider_id) errs[`window.${i}.provider_id`] = '请选择模型'
      if (!w.target.backend_model) errs[`window.${i}.backend_model`] = '请选择模型'
    })
  } else {
    if (props.form.targets.length === 0) errs.targets = '至少添加一个目标'
    props.form.targets.forEach((t, i) => {
      if (!t.provider_id) errs[`target.${i}.provider_id`] = '请选择模型'
      if (!t.backend_model) errs[`target.${i}.backend_model`] = '请选择模型'
    })
  }

  errors.value = errs
  return Object.keys(errs).length === 0
}

watch(() => props.open, (v) => { if (v) errors.value = {} })
</script>
