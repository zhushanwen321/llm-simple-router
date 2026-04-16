<template>
  <div>
    <!-- 1. 面包屑 -->
    <div class="flex items-center gap-2 mb-3">
      <Button variant="ghost" size="xs" class="px-0 h-auto" @click="emit('back')">
        ← 返回请求链路
      </Button>
      <span class="text-muted-foreground">/</span>
      <span class="text-sm font-medium">{{ STAGE_COLORS[stage].label }}</span>
    </div>

    <!-- 2. 阶段快速切换 tabs + 模式切换（sticky） -->
    <div class="flex items-center justify-between mb-3 border-b pb-2 sticky top-0 z-10 bg-background">
      <div class="flex gap-1">
        <Button v-for="(_, key) in stageList" :key="key" variant="ghost" size="xs"
          :class="[STAGE_COLORS[key as StageKey].text, stage === key ? 'ring-1 ring-ring' : 'opacity-50']"
          @click="emit('selectStage', key as StageKey)">
          {{ STAGE_COLORS[key as StageKey].label }}
        </Button>
      </div>
      <div class="flex gap-1">
        <Button variant="ghost" :class="mode === 'structured' ? 'bg-secondary' : ''" size="xs" class="h-auto py-1" @click="emit('update:mode', 'structured')">结构化</Button>
        <Button variant="ghost" :class="mode === 'raw' ? 'bg-secondary' : ''" size="xs" class="h-auto py-1" @click="emit('update:mode', 'raw')">原始</Button>
      </div>
    </div>

    <!-- 3. 阶段头部卡片 -->
    <Card :class="['mb-3', STAGE_COLORS[stage].bg]">
      <CardContent class="py-2 px-3">
        <div class="flex items-center gap-2">
          <span :class="['w-2 h-2 rounded-full', STAGE_COLORS[stage].dot]"></span>
          <span class="text-sm font-medium" :class="STAGE_COLORS[stage].text">{{ STAGE_COLORS[stage].label }}</span>
        </div>
        <template v-if="isRequest && stageParsed">
          <div class="mt-1 text-xs font-mono text-muted-foreground">{{ stageParsed.method }} {{ stageParsed.url }}</div>
        </template>
        <template v-else-if="stageParsed">
          <div class="mt-1 flex gap-2 text-xs">
            <Badge :variant="(stageParsed.statusCode ?? 0) < 400 ? 'default' : 'destructive'">{{ stageParsed.statusCode }}</Badge>
            <Badge v-if="log.is_stream" variant="outline" class="border-dashed">SSE</Badge>
          </div>
        </template>
      </CardContent>
    </Card>

    <!-- 4. 差异提示条（仅 upstream_req 阶段） -->
    <Card v-if="stage === 'upstream_req' && diffFields.length" class="mb-3 bg-warning-light ring-warning/20">
      <CardContent class="py-2 px-3 text-xs flex flex-wrap gap-1 text-warning-dark">
        <Badge v-for="d in diffFields" :key="d.field" variant="outline" class="text-warning-dark">{{ d.field }}: {{ String(d.old ?? '-') }} → {{ String(d.new ?? '-') }}</Badge>
      </CardContent>
    </Card>

    <!-- 5. 响应间格式转换提示（仅 client_resp 流式） -->
    <Card v-if="stage === 'client_resp' && log.is_stream && hasFormatConversion" class="mb-3 bg-muted ring-muted-foreground/10">
      <CardContent class="py-2 px-3 text-xs text-muted-foreground">
        代理可能对 SSE 格式进行了转换（如 Anthropic → OpenAI），原始事件流与上游响应可能不完全一致。
      </CardContent>
    </Card>

    <!-- 6. 内容区 -->
    <LogRequestViewer v-if="isRequest" :raw="stageData ?? ''" :api-type="asApiType(log.api_type)" :show-url="stage === 'upstream_req'" :mode="mode" />
    <LogResponseViewer v-else :raw="stageData ?? ''" :api-type="asApiType(log.api_type)" :is-stream="!!log.is_stream" :mode="mode" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { StageKey } from './logColors'
import { STAGE_COLORS, getStageData } from './logColors'
import LogRequestViewer from './LogRequestViewer.vue'
import LogResponseViewer from './LogResponseViewer.vue'

interface LogData {
  api_type: string
  is_stream: number
  status_code: number | null
  latency_ms: number | null
  error_message: string | null
  client_request: string | null
  upstream_request: string | null
  upstream_response: string | null
  client_response: string | null
}

const props = defineProps<{
  log: LogData
  stage: StageKey
  mode: 'structured' | 'raw'
}>()

const emit = defineEmits<{
  back: []
  selectStage: [stage: StageKey]
  'update:mode': [mode: 'structured' | 'raw']
}>()

const asApiType = (t: string): 'openai' | 'anthropic' => t === 'openai' ? 'openai' : 'anthropic'

const isRequest = computed(() => props.stage === 'client_req' || props.stage === 'upstream_req')

const stageData = computed(() => getStageData(props.log, props.stage))

const stageParsed = computed(() => {
  if (!stageData.value) return null
  try { return JSON.parse(stageData.value) as { method?: string; url?: string; statusCode?: number; [k: string]: unknown } } catch { return null }
})

// 有数据的阶段（用于 tab 渲染）
const stageList = computed(() => {
  const map: Record<StageKey, string | null> = {
    client_req: props.log.client_request,
    upstream_req: props.log.upstream_request,
    upstream_resp: props.log.upstream_response,
    client_resp: props.log.client_response,
  }
  return Object.fromEntries(Object.entries(map).filter(([, v]) => v)) as Partial<Record<StageKey, string>>
})

// 请求间差异对比（upstream_req 阶段）
const diffFields = computed(() => {
  if (props.stage !== 'upstream_req' || !props.log.client_request || !props.log.upstream_request) return []
  const fields = ['model', 'stream', 'max_tokens', 'thinking', 'temperature', 'top_p']
  try {
    const clientBody = JSON.parse((JSON.parse(props.log.client_request) as { body?: string }).body || '{}') as Record<string, unknown>
    const upstreamBody = JSON.parse((JSON.parse(props.log.upstream_request) as { body?: string }).body || '{}') as Record<string, unknown>
    return fields
      .filter(f => JSON.stringify(clientBody[f]) !== JSON.stringify(upstreamBody[f]))
      .map(f => ({ field: f, old: clientBody[f], new: upstreamBody[f] }))
  } catch { return [] }
})

// 响应间格式转换检测
const hasFormatConversion = computed(() => {
  if (!props.log.upstream_response || !props.log.client_response) return false
  try {
    const up = (JSON.parse(props.log.upstream_response) as { body?: string }).body || ''
    const cli = (JSON.parse(props.log.client_response) as { body?: string }).body || ''
    return up.includes('content_block_delta') !== cli.includes('content_block_delta')
  } catch { return false }
})
</script>
