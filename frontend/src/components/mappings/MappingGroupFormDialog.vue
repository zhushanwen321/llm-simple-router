<!-- eslint-disable vue/no-mutating-props -- form is a reactive object managed by parent component -->
<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-4xl max-h-[85vh] overflow-y-auto">
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

        <div class="border rounded-lg p-3 space-y-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium text-foreground">故障转移链</span>
              <span v-if="form.targets.length > 1" class="inline-flex items-center rounded-full bg-orange-100 dark:bg-orange-900/30 px-2 py-0.5 text-xs font-medium text-orange-700 dark:text-orange-300">
                已启用
              </span>
              <span v-else class="text-xs text-muted-foreground">添加多个目标启用故障转移</span>
            </div>
            <Button type="button" variant="outline" size="sm" @click="emit('addTarget')">添加备选</Button>
          </div>
          <p v-if="errors.targets" class="text-sm text-destructive">{{ errors.targets }}</p>
          <p class="text-xs text-muted-foreground">请求按顺序依次尝试，当前一个目标失败时自动切换到下一个</p>
          <div v-for="(t, idx) in form.targets" :key="idx" class="border rounded-md p-2 space-y-2">
            <div class="text-xs font-medium" :class="idx === 0 ? 'text-primary' : 'text-muted-foreground'">{{ idx === 0 ? '首选' : `备选 ${idx}` }}</div>
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
                  :providers="overflowGroupsFor(idx)"
                  :model-value="t.overflow_provider_id && t.overflow_model ? { provider_id: t.overflow_provider_id, model: t.overflow_model } : undefined"
                  placeholder="点击选择模型..."
                  @update:model-value="(v: SelectedValue | undefined) => onOverflowSelect(idx, v)"
                />
              </div>
            </div>
            <div v-if="overflowHintFor(idx)" class="text-xs text-primary">
              {{ overflowHintFor(idx) }}
            </div>
            <div class="flex justify-end gap-1">
              <Button type="button" variant="ghost" size="sm" :disabled="idx === 0" @click="emit('moveTargetUp', idx)">
                <ArrowUp class="w-4 h-4" />
              </Button>
              <Button type="button" variant="ghost" size="sm" :disabled="idx === form.targets.length - 1" @click="emit('moveTargetDown', idx)">
                <ArrowDown class="w-4 h-4" />
              </Button>
              <Button type="button" variant="ghost" size="sm" class="text-destructive shrink-0" @click="emit('removeTarget', idx)">删除</Button>
            </div>
            <div v-if="idx < form.targets.length - 1" class="flex justify-center pt-1">
              <div class="flex items-center gap-1 text-xs text-muted-foreground">
                <ChevronDown class="w-3.5 h-3.5" />
                <span>失败时自动切换</span>
                <ChevronDown class="w-3.5 h-3.5" />
              </div>
            </div>
          </div>
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
import { ArrowUp, ArrowDown, ChevronDown, HelpCircle } from 'lucide-vue-next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import CascadingModelSelect from '@/components/mappings/CascadingModelSelect.vue'
import type { SelectedValue, ProviderGroup } from '@/components/mappings/cascading-types'
import type { ProviderSummary, MappingTarget } from '@/types/mapping'
import { DEFAULT_CONTEXT_WINDOW, LARGE_CONTEXT_THRESHOLD } from '@/constants'

interface FormData {
  client_model: string
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
  (e: 'addTarget'): void
  (e: 'removeTarget', idx: number): void
  (e: 'moveTargetUp', idx: number): void
  (e: 'moveTargetDown', idx: number): void
}>()

function getTargetByKey(idx: number): MappingTarget | undefined {
  return props.form.targets[idx]
}

function getContextWindow(target: MappingTarget): number {
  const key = `${target.provider_id}:${target.backend_model}`
  return props.contextWindowMap.get(key) ?? DEFAULT_CONTEXT_WINDOW
}

function overflowGroupsFor(idx: number): ProviderGroup[] {
  const target = getTargetByKey(idx)
  if (!target?.backend_model) return props.providerGroups
  const cw = getContextWindow(target)
  return props.providerGroups
    .map(g => ({ ...g, models: g.models.filter(m => m.contextWindow >= cw) }))
    .filter(g => g.models.length > 0)
}

function overflowHintFor(idx: number): string {
  const target = getTargetByKey(idx)
  if (!target?.overflow_provider_id || !target?.overflow_model) return ''
  const cw = getContextWindow(target)
  if (cw >= LARGE_CONTEXT_THRESHOLD) return '当前模型上下文 >= 1M，无需配置溢出模型'
  const cwStr = cw >= 1000 ? `${cw / 1000}K` : `${cw}`
  return `上下文超过 ${target.backend_model} 限制 (${cwStr}) 时自动切换到 ${target.overflow_model}`
}

function onOverflowSelect(idx: number, val: SelectedValue | undefined) {
  const target = getTargetByKey(idx)
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

const errors = ref<Record<string, string>>({})

function validate(): boolean {
  const errs: Record<string, string> = {}
  if (!props.form.client_model.trim()) errs.client_model = '请输入客户端模型名称'

  if (props.form.targets.length === 0) errs.targets = '至少添加一个目标'
  props.form.targets.forEach((t, i) => {
    if (!t.provider_id) errs[`target.${i}.provider_id`] = '请选择模型'
    if (!t.backend_model) errs[`target.${i}.backend_model`] = '请选择模型'
  })

  errors.value = errs
  return Object.keys(errs).length === 0
}

watch(() => props.open, (v) => { if (v) errors.value = {} })
</script>
