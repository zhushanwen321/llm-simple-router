<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="border rounded-md p-3 space-y-3">
    <div class="flex items-center gap-3">
      <span class="text-xs font-medium text-muted-foreground whitespace-nowrap">{{ t('providers.fields.proxyTitle') }}</span>
      <Select :model-value="proxyType || 'none'" class="w-32" @update:model-value="onTypeChange">
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">{{ t('providers.fields.proxyNoProxy') }}</SelectItem>
          <SelectItem value="http">{{ t('providers.fields.proxyHttp') }}</SelectItem>
          <SelectItem value="socks5">{{ t('providers.fields.proxySocks5') }}</SelectItem>
        </SelectContent>
      </Select>
    </div>
    <div v-if="proxyType" class="grid grid-cols-4 gap-3">
      <div class="col-span-2">
        <Label class="text-xs text-muted-foreground">{{ t('providers.fields.proxyUrl') }}</Label>
        <Input :model-value="proxyUrl" type="text" class="mt-1 font-mono text-xs" :placeholder="proxyType === 'socks5' ? t('providers.fields.proxyUrlPlaceholderSocks5') : t('providers.fields.proxyUrlPlaceholderHttp')" @update:model-value="emit('update:proxyUrl', $event)" />
      </div>
      <div>
        <Label class="text-xs text-muted-foreground">{{ t('providers.fields.proxyUsername') }}</Label>
        <Input :model-value="proxyUsername" type="text" class="mt-1" :placeholder="t('providers.fields.proxyAuthOptional')" @update:model-value="emit('update:proxyUsername', $event)" />
      </div>
      <div>
        <Label class="text-xs text-muted-foreground">{{ t('providers.fields.proxyPassword') }}</Label>
        <Input :model-value="proxyPassword" type="password" class="mt-1" :placeholder="t('providers.fields.proxyAuthOptional')" @update:model-value="emit('update:proxyPassword', $event)" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'

defineProps({
  proxyType: { type: String, default: '' },
  proxyUrl: { type: String, default: '' },
  proxyUsername: { type: String, default: '' },
  proxyPassword: { type: String, default: '' },
})

const emit = defineEmits(['update:proxyType', 'update:proxyUrl', 'update:proxyUsername', 'update:proxyPassword', 'clear'])

const { t } = useI18n()

function onTypeChange(val: unknown) {
  const strVal = typeof val === 'string' ? val : val != null ? JSON.stringify(val) : ''
  const value = strVal === 'none' ? '' : strVal
  emit('update:proxyType', value)
  if (!value) {
    emit('clear')
  }
}
</script>
