<!-- eslint-disable vue/multi-word-component-names -->
<template>
  <div class="space-y-4">
    <!-- 摘要条 -->
    <div class="flex flex-wrap items-center gap-2 pb-3 border-b">
      <Badge v-if="clientParsed?.method" variant="secondary" class="font-mono">{{ clientParsed.method }}</Badge>
      <span v-if="clientParsed?.url" class="text-xs font-mono text-muted-foreground truncate max-w-[200px]" :title="clientParsed.url">{{ clientParsed.url }}</span>
      <Badge v-if="respParsed?.statusCode" :variant="(respParsed.statusCode ?? 0) < 400 ? 'default' : 'destructive'">{{ respParsed.statusCode }}</Badge>
      <span v-if="log.latency_ms" class="text-xs tabular-nums text-muted-foreground">{{ log.latency_ms }}ms</span>
      <Badge v-if="log.is_stream" variant="outline" class="border-dashed">SSE</Badge>
      <Badge variant="outline">{{ log.api_type }}</Badge>
      <div class="ml-auto flex gap-1">
        <Button variant="ghost" :class="mode === 'structured' ? 'bg-secondary' : ''" size="xs" class="h-auto py-1" @click="emit('update:mode', 'structured')">结构化</Button>
        <Button variant="ghost" :class="mode === 'raw' ? 'bg-secondary' : ''" size="xs" class="h-auto py-1" @click="emit('update:mode', 'raw')">原始</Button>
      </div>
    </div>

    <!-- 垂直时间线 -->
    <div class="space-y-0">
      <div v-for="(stage, idx) in stages" :key="stage.key" class="flex items-start gap-3 group">
        <!-- 左侧：圆点 + 连线 -->
        <div class="flex flex-col items-center">
          <span :class="['w-3 h-3 rounded-full shrink-0 mt-1', STAGE_COLORS[stage.key].dot]"></span>
          <span v-if="idx < stages.length - 1" class="w-px h-8 bg-border"></span>
        </div>
        <!-- 右侧：阶段卡片 -->
        <div class="flex-1 flex items-center justify-between py-1 cursor-pointer rounded px-2 -mx-2 hover:bg-muted/50 transition-colors" @click="emit('selectStage', stage.key)">
          <div class="flex items-center gap-2">
            <span :class="['text-sm font-medium', STAGE_COLORS[stage.key].text]">{{ STAGE_COLORS[stage.key].label }}</span>
            <!-- 阶段关键参数 Badge -->
            <Badge v-if="stage.meta.model" variant="outline" class="text-xs">{{ stage.meta.model }}</Badge>
            <Badge v-if="stage.meta.stream != null" variant="outline" class="text-xs">stream: {{ stage.meta.stream }}</Badge>
            <Badge v-if="stage.meta.statusCode" :variant="stage.meta.statusCode < 400 ? 'default' : 'destructive'" class="text-xs">{{ stage.meta.statusCode }}</Badge>
          </div>
          <Button variant="ghost" size="xs" class="h-auto px-1 py-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
            查看详情 →
          </Button>
        </div>
      </div>
    </div>

    <!-- 错误卡片 -->
    <Card v-if="log.error_message" class="bg-danger-light ring-danger/20">
      <CardContent class="py-3 text-sm text-danger-dark">{{ log.error_message }}</CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { StageKey } from './logColors'
import { STAGE_COLORS } from './logColors'

const props = defineProps<{
  log: {
    client_request: string | null
    upstream_request: string | null
    upstream_response: string | null
    client_response: string | null
    api_type: string
    is_stream: number
    status_code: number | null
    latency_ms: number | null
    error_message: string | null
  }
  mode: 'structured' | 'raw'
}>()

const emit = defineEmits<{
  selectStage: [stage: StageKey]
  'update:mode': [mode: 'structured' | 'raw']
}>()

const clientParsed = computed(() => {
  try { return props.log.client_request ? JSON.parse(props.log.client_request) as Record<string, unknown> : null } catch { return null }
})
const respParsed = computed(() => {
  try { return props.log.client_response ? JSON.parse(props.log.client_response) as { statusCode?: number; headers?: Record<string, string>; body?: string } : null } catch { return null }
})

const stages = computed(() => {
  const entries: Array<{ key: StageKey; data: string | null }> = [
    { key: 'client_req', data: props.log.client_request },
    { key: 'upstream_req', data: props.log.upstream_request },
    { key: 'upstream_resp', data: props.log.upstream_response },
    { key: 'client_resp', data: props.log.client_response },
  ]
  return entries.filter(s => s.data).map(s => ({ ...s, meta: extractStageMeta(s.key, s.data!) }))
})

// 从各阶段原始 JSON 中提取关键参数用于 Badge 展示（仅在 stages computed 中调用一次）
function extractStageMeta(key: StageKey, data: string) {
  try {
    const p = JSON.parse(data) as Record<string, unknown>
    const body = (p.body || {}) as Record<string, unknown>
    const isResp = key === 'upstream_resp' || key === 'client_resp'
    return {
      model: isResp ? '' : String(body.model || ''),
      stream: isResp ? undefined : body.stream,
      statusCode: isResp ? (p.statusCode as number | undefined) : undefined,
    }
  } catch {
    return { model: '', stream: undefined, statusCode: undefined } as { model: string; stream?: unknown; statusCode?: number }
  }
}
</script>
