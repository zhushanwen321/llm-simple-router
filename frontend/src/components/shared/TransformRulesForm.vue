<script setup lang="ts">
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

defineProps<{
  injectHeaders: string
  dropFields: string
  requestDefaults: string
  compact?: boolean
}>()

const emit = defineEmits<{
  'update:injectHeaders': [value: string]
  'update:dropFields': [value: string]
  'update:requestDefaults': [value: string]
}>()
</script>

<template>
  <div :class="compact ? 'space-y-2' : 'space-y-3'">
    <div>
      <Label class="text-[11px] text-muted-foreground">注入 Headers (JSON)</Label>
      <Input
        :model-value="injectHeaders"
        placeholder='{"x-custom": "value"}'
        class="mt-0.5 text-xs font-mono"
        @update:model-value="emit('update:injectHeaders', $event as string)"
      />
    </div>
    <div>
      <Label class="text-[11px] text-muted-foreground">丢弃字段（逗号分隔）</Label>
      <Input
        :model-value="dropFields"
        placeholder="logprobs, frequency_penalty"
        class="mt-0.5 text-xs font-mono"
        @update:model-value="emit('update:dropFields', $event as string)"
      />
    </div>
    <div>
      <Label class="text-[11px] text-muted-foreground">请求默认值 (JSON)</Label>
      <Input
        :model-value="requestDefaults"
        placeholder='{"max_tokens": 4096}'
        class="mt-0.5 text-xs font-mono"
        @update:model-value="emit('update:requestDefaults', $event as string)"
      />
    </div>
  </div>
</template>
