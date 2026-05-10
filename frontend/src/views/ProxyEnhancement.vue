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
            {{ toolRoundLimitEnabled ? t('proxyEnhancement.status.enabled') : t('proxyEnhancement.status.disabled') }}
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
            {{ toolCallLoopEnabled ? t('proxyEnhancement.status.enabled') : t('proxyEnhancement.status.disabled') }}
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
            {{ streamLoopEnabled ? t('proxyEnhancement.status.enabled') : t('proxyEnhancement.status.disabled') }}
          </Label>
        </div>
      </CardContent>
    </Card>

    <Card class="mt-4">
      <CardHeader>
        <CardTitle>{{ t('proxyEnhancement.toolErrorLogging.title') }}</CardTitle>
        <CardDescription>
          {{ t('proxyEnhancement.toolErrorLogging.description') }}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="flex items-center gap-3">
          <Switch
            id="tool-error-logging-toggle"
            v-model="toolErrorLoggingEnabled"
          />
          <Label for="tool-error-logging-toggle">
            {{ toolErrorLoggingEnabled ? t('proxyEnhancement.status.enabled') : t('proxyEnhancement.status.disabled') }}
          </Label>
        </div>
      </CardContent>
    </Card>

    <Card class="mt-4">
      <CardHeader>
        <CardTitle>客户端识别</CardTitle>
        <CardDescription>
          配置客户端 session header 映射，用于识别请求来源。携带对应 header 的请求将被识别为该客户端类型。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="space-y-3">
          <div
            v-for="(entry, index) in clientSessionHeaders"
            :key="index"
            class="flex items-center gap-3"
          >
            <div class="w-40 shrink-0">
              <Badge v-if="entry.persisted" variant="secondary">
                {{ entry.client_type }}
              </Badge>
              <Input
                v-else
                v-model="entry.client_type"
                placeholder="client_type"
                class="h-8"
              />
            </div>
            <Input
              v-model="entry.session_header_key"
              placeholder="session header key"
              class="flex-1"
            />
            <Button
              variant="ghost"
              size="icon"
              :disabled="clientSessionHeaders.length <= 1"
              @click="removeSessionHeaderEntry(index)"
            >
              <Trash2 class="w-4 h-4" />
            </Button>
          </div>
          <Button variant="outline" size="sm" @click="addSessionHeaderEntry">
            <Plus class="w-4 h-4 mr-1" />
            新增条目
          </Button>
        </div>
      </CardContent>
    </Card>

    <Card class="mt-4">
      <CardHeader>
        <CardTitle>Token 预估</CardTitle>
        <CardDescription>
          上游 API 不返回 token 统计数据时，通过 gpt-tokenizer 估算输入 token 数和缓存命中量。仅对携带 session_id 的请求生效。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="flex items-center gap-3">
          <Switch
            id="token-estimation-toggle"
            :model-value="tokenEstimationEnabled"
            @update:model-value="tokenEstimationEnabled = $event"
          />
          <Label for="token-estimation-toggle">
            {{ tokenEstimationEnabled ? t('proxyEnhancement.status.enabled') : t('proxyEnhancement.status.disabled') }}
          </Label>
        </div>
        <p class="text-xs text-muted-foreground mt-2">
          {{ t('proxyEnhancement.tokenEstimation.desc') }}
        </p>
        <p class="text-xs text-muted-foreground mt-1">
          修改后点击「保存」按钮生效
        </p>
        <!-- 配置说明 -->
        <details class="mt-3 text-xs text-muted-foreground">
          <summary class="cursor-pointer hover:text-foreground transition-colors">
            {{ t('proxyEnhancement.tokenEstimation.setupTitle') }} ▸
          </summary>
          <div class="mt-2 space-y-1 pl-2 border-l-2 border-muted">
            <p>{{ t('proxyEnhancement.tokenEstimation.claudeCode') }}</p>
            <p class="whitespace-pre-line">{{ t('proxyEnhancement.tokenEstimation.piExtension') }}</p>
            <p class="whitespace-pre-line">{{ t('proxyEnhancement.tokenEstimation.piModelsJson') }}</p>
          </div>
        </details>
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
import { getTokenEstimation, updateTokenEstimation, getClientSessionHeaders, updateClientSessionHeaders } from '@/api/settings-api'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Loader2, Plus, Trash2 } from 'lucide-vue-next'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

const { t } = useI18n()
const toolRoundLimitEnabled = ref(true)
const toolCallLoopEnabled = ref(false)
const streamLoopEnabled = ref(false)
const toolErrorLoggingEnabled = ref(false)
const tokenEstimationEnabled = ref(false)
const saving = ref(false)

interface ClientSessionHeaderEntry {
  client_type: string
  session_header_key: string
  persisted: boolean
}
const clientSessionHeaders = ref<ClientSessionHeaderEntry[]>([])

async function loadConfig() {
  try {
    const data = await api.getProxyEnhancement()
    toolRoundLimitEnabled.value = data.tool_round_limit_enabled
    toolCallLoopEnabled.value = data.tool_call_loop_enabled
    streamLoopEnabled.value = data.stream_loop_enabled
    toolErrorLoggingEnabled.value = data.tool_error_logging_enabled
    const tokenEstData = await getTokenEstimation()
    tokenEstimationEnabled.value = tokenEstData.enabled
    const [sessionHeadersData] = await Promise.allSettled([
      getClientSessionHeaders(),
    ])
    if (sessionHeadersData.status === 'fulfilled') {
      clientSessionHeaders.value = sessionHeadersData.value.entries.map(e => ({
        ...e,
        persisted: true,
      }))
    }
  } catch (e: unknown) {
    console.error('Failed to load proxy enhancement config:', e)
    toast.error(getApiMessage(e, t('proxyEnhancement.loadFailed')))
  }
}

async function handleSave() {
  saving.value = true
  try {
    const entriesToSave = clientSessionHeaders.value
      .filter(e => e.client_type.trim() && e.session_header_key.trim())
      .map(e => ({ client_type: e.client_type.trim(), session_header_key: e.session_header_key.trim() }))

    // eslint-disable-next-line taste/prefer-allsettled
    await Promise.all([
      api.updateProxyEnhancement({
        tool_call_loop_enabled: toolCallLoopEnabled.value,
        stream_loop_enabled: streamLoopEnabled.value,
        tool_round_limit_enabled: toolRoundLimitEnabled.value,
        tool_error_logging_enabled: toolErrorLoggingEnabled.value,
      }),
      updateTokenEstimation(tokenEstimationEnabled.value),
      updateClientSessionHeaders(entriesToSave),
    ])
    toast.success(t('common.saveSuccess'))
  } catch (e: unknown) {
    console.error('Failed to save config:', e)
    toast.error(getApiMessage(e, t('proxyEnhancement.saveFailed')))
  } finally {
    saving.value = false
  }
}

function addSessionHeaderEntry() {
  clientSessionHeaders.value.push({
    client_type: '',
    session_header_key: '',
    persisted: false,
  })
}

function removeSessionHeaderEntry(index: number) {
  clientSessionHeaders.value.splice(index, 1)
}

onMounted(() => {
  loadConfig()
})
</script>
