<template>
  <div class="p-6">
    <h2 class="text-lg font-semibold text-foreground mb-4">{{ t('proxyEnhancement.title') }}</h2>

    <Card>
      <CardHeader>
        <CardTitle>{{ t('proxyEnhancement.loopDetection.toolRoundLimit.title') }}</CardTitle>
        <CardDescription>
          {{ t('proxyEnhancement.loopDetection.toolRoundLimit.description') }}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="flex items-center gap-3">
          <Switch
            id="tool-round-limit-toggle"
            v-model="toolRoundLimitEnabled"
          />
          <Label for="tool-round-limit-toggle">
            {{ toolRoundLimitEnabled ? t('proxyEnhancement.dynamicModel.enabled') : t('proxyEnhancement.dynamicModel.disabled') }}
          </Label>
        </div>
      </CardContent>
    </Card>

    <Card class="mt-4">
      <CardHeader>
        <CardTitle>{{ t('proxyEnhancement.loopDetection.toolCallLoop.title') }}</CardTitle>
        <CardDescription>
          {{ t('proxyEnhancement.loopDetection.toolCallLoop.description') }}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="flex items-center gap-3">
          <Switch
            id="tool-call-loop-toggle"
            v-model="toolCallLoopEnabled"
          />
          <Label for="tool-call-loop-toggle">
            {{ toolCallLoopEnabled ? t('proxyEnhancement.dynamicModel.enabled') : t('proxyEnhancement.dynamicModel.disabled') }}
          </Label>
        </div>
      </CardContent>
    </Card>

    <Card class="mt-4">
      <CardHeader>
        <CardTitle>{{ t('proxyEnhancement.loopDetection.streamLoop.title') }}</CardTitle>
        <CardDescription>
          {{ t('proxyEnhancement.loopDetection.streamLoop.description') }}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="flex items-center gap-3">
          <Switch
            id="stream-loop-toggle"
            v-model="streamLoopEnabled"
          />
          <Label for="stream-loop-toggle">
            {{ streamLoopEnabled ? t('proxyEnhancement.dynamicModel.enabled') : t('proxyEnhancement.dynamicModel.disabled') }}
          </Label>
        </div>
      </CardContent>
    </Card>

    <div class="flex justify-end mt-4">
      <Button :disabled="saving" @click="handleSave">
        <span v-if="saving" class="flex items-center gap-1">
          <Loader2 class="w-4 h-4 animate-spin" />
          {{ t('proxyEnhancement.dynamicModel.saving') }}
        </span>
        <span v-else>{{ t('common.save') }}</span>
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { api, getApiMessage } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Loader2 } from 'lucide-vue-next'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'

const { t } = useI18n()
const toolRoundLimitEnabled = ref(true)
const toolCallLoopEnabled = ref(false)
const streamLoopEnabled = ref(false)
const saving = ref(false)

async function loadConfig() {
  try {
    const data = await api.getProxyEnhancement()
    toolRoundLimitEnabled.value = data.tool_round_limit_enabled
    toolCallLoopEnabled.value = data.tool_call_loop_enabled
    streamLoopEnabled.value = data.stream_loop_enabled
  } catch (e: unknown) {
    console.error('Failed to load proxy enhancement config:', e)
    toast.error(getApiMessage(e, t('proxyEnhancement.loadFailed')))
  }
}

async function handleSave() {
  saving.value = true
  try {
    await api.updateProxyEnhancement({
      tool_call_loop_enabled: toolCallLoopEnabled.value,
      stream_loop_enabled: streamLoopEnabled.value,
      tool_round_limit_enabled: toolRoundLimitEnabled.value,
    })
    toast.success(t('common.saveSuccess'))
  } catch (e: unknown) {
    console.error('Failed to save proxy enhancement config:', e)
    toast.error(getApiMessage(e, t('proxyEnhancement.saveFailed')))
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  loadConfig()
})
</script>
