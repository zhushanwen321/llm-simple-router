<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

const { t } = useI18n()

export type ConcurrencyMode = 'auto' | 'manual' | 'none'

withDefaults(defineProps<{
  mode: ConcurrencyMode
  maxConcurrency?: number
  queueTimeoutMs?: number
  maxQueueSize?: number
  compact?: boolean
}>(), {
  maxConcurrency: 10,
  queueTimeoutMs: 120000,
  maxQueueSize: 100,
  compact: false,
})

const emit = defineEmits<{
  'update:mode': [value: ConcurrencyMode]
  'update:maxConcurrency': [value: number]
  'update:queueTimeoutMs': [value: number]
  'update:maxQueueSize': [value: number]
}>()
</script>

<template>
  <div :class="compact ? 'space-y-2' : 'flex items-end gap-3 flex-wrap'">
    <div :class="compact ? '' : 'w-36'" class="space-y-1">
      <Label class="text-xs text-muted-foreground">{{ t('providers.concurrency.mode') }}</Label>
      <Select
        :model-value="mode"
        @update:model-value="(v: unknown) => emit('update:mode', v as ConcurrencyMode)"
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="auto">{{ t('providers.concurrency.autoAdaptive') }}</SelectItem>
          <SelectItem value="manual">{{ t('providers.concurrency.manual') }}</SelectItem>
          <SelectItem value="none">{{ t('providers.concurrency.none') }}</SelectItem>
        </SelectContent>
      </Select>
    </div>
    <template v-if="mode !== 'none'">
      <div :class="compact ? '' : 'w-28'" class="space-y-1">
        <Label class="text-xs text-muted-foreground">{{ t('providers.concurrency.maxConcurrency') }}</Label>
        <Input
          :model-value="maxConcurrency"
          type="number" min="1" max="100"
          @update:model-value="emit('update:maxConcurrency', Number($event))"
        />
      </div>
      <div :class="compact ? '' : 'w-32'" class="space-y-1">
        <Label class="text-xs text-muted-foreground">{{ t('providers.concurrency.queueTimeout') }}</Label>
        <Input
          :model-value="queueTimeoutMs"
          type="number" min="0"
          :placeholder="t('providers.shared.queueTimeoutPlaceholder')"
          @update:model-value="emit('update:queueTimeoutMs', Number($event))"
        />
      </div>
      <div :class="compact ? '' : 'w-32'" class="space-y-1">
        <Label class="text-xs text-muted-foreground">{{ t('providers.concurrency.maxQueueSize') }}</Label>
        <Input
          :model-value="maxQueueSize"
          type="number" min="1" max="1000"
          @update:model-value="emit('update:maxQueueSize', Number($event))"
        />
      </div>
    </template>
    <div v-if="mode === 'auto' && !compact" class="text-[10px] text-muted-foreground leading-snug">
      {{ t('providers.shared.autoHint') }}
    </div>
  </div>
</template>
