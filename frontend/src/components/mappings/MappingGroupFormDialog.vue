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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import CascadingModelSelect from '@/components/mappings/CascadingModelSelect.vue'
import type { SelectedValue, ProviderGroup } from '@/components/mappings/cascading-types'
import type { ProviderSummary, MappingTarget } from '@/types/mapping'

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
  return props.contextWindowMap.get(key) ?? 200000
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
  if (cw >= 1000000) return '当前模型上下文 >= 1M，无需配置溢出模型'
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
