<template>
  <Dialog v-model:open="open">
    <DialogScrollContent class="max-w-4xl max-h-[85vh]">
      <DialogHeader>
        <DialogTitle>请求详情 <span v-if="data" class="font-mono text-xs text-muted-foreground font-normal select-all">{{ data.id.slice(0, 8) }}</span></DialogTitle>
        <DialogDescription class="sr-only">请求日志详情</DialogDescription>
      </DialogHeader>
      <template v-if="loading">
        <div class="space-y-3 py-4">
          <Skeleton class="h-6 w-48" />
          <Skeleton v-for="n in 4" :key="n" class="h-12 w-full" />
        </div>
      </template>
      <template v-else-if="data">
        <!-- 客户端原始请求 -->
        <Collapsible v-model:open="sections[0]" class="border rounded-md mb-2">
          <CollapsibleTrigger as-child>
            <Button variant="ghost" class="w-full px-4 py-3 text-left text-sm font-medium text-foreground bg-muted/50 hover:bg-muted rounded-md flex items-center gap-2">
              <span class="text-xs transition-transform" :class="sections[0] ? '' : '-rotate-90'">&#9660;</span>
              客户端原始请求
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div class="p-4">
              <LogRequestViewer :raw="clientReqRaw" :api-type="apiType" :mode="modes.client_request" />
            </div>
          </CollapsibleContent>
        </Collapsible>

        <!-- Router → LLM API 请求 -->
        <Collapsible v-if="data.upstream_request" v-model:open="sections[1]" class="border rounded-md mb-2">
          <CollapsibleTrigger as-child>
            <Button variant="ghost" class="w-full px-4 py-3 text-left text-sm font-medium text-foreground bg-muted/50 hover:bg-muted rounded-md flex items-center gap-2">
              <span class="text-xs transition-transform" :class="sections[1] ? '' : '-rotate-90'">&#9660;</span>
              Router → LLM API 请求
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div class="p-4">
              <LogRequestViewer :raw="data.upstream_request" :api-type="apiType" :show-url="true" :mode="modes.upstream_request" />
            </div>
          </CollapsibleContent>
        </Collapsible>

        <!-- LLM API 返回的原始响应 -->
        <Collapsible v-if="data.upstream_response || data.response_body" v-model:open="sections[2]" class="border rounded-md mb-2">
          <CollapsibleTrigger as-child>
            <Button variant="ghost" class="w-full px-4 py-3 text-left text-sm font-medium text-foreground bg-muted/50 hover:bg-muted rounded-md flex items-center gap-2">
              <span class="text-xs transition-transform" :class="sections[2] ? '' : '-rotate-90'">&#9660;</span>
              LLM API 返回的原始响应
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div class="p-4">
              <LogResponseViewer :raw="data.upstream_response || data.response_body || '{}'" :api-type="apiType" :is-stream="!!data.is_stream" :mode="modes.upstream_response" />
            </div>
          </CollapsibleContent>
        </Collapsible>

        <!-- Router → 客户端响应 -->
        <Collapsible v-if="clientRespRaw" v-model:open="sections[3]" class="border rounded-md">
          <CollapsibleTrigger as-child>
            <Button variant="ghost" class="w-full px-4 py-3 text-left text-sm font-medium text-foreground bg-muted/50 hover:bg-muted rounded-md flex items-center gap-2">
              <span class="text-xs transition-transform" :class="sections[3] ? '' : '-rotate-90'">&#9660;</span>
              Router → 客户端响应
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div class="p-4">
              <LogResponseViewer :raw="clientRespRaw" :api-type="apiType" :is-stream="!!data.is_stream" :mode="modes.client_response" />
            </div>
          </CollapsibleContent>
        </Collapsible>

        <Card v-if="data.error_message" class="bg-destructive/10 ring-destructive/20 mt-2">
          <CardContent class="py-3 text-sm text-destructive">{{ data.error_message }}</CardContent>
        </Card>
      </template>
      <div v-else class="py-8 text-center text-muted-foreground">未找到日志</div>
    </DialogScrollContent>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { toast } from 'vue-sonner'
import { api } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogScrollContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Skeleton } from '@/components/ui/skeleton'
import LogRequestViewer from '@/components/log-viewer/LogRequestViewer.vue'
import LogResponseViewer from '@/components/log-viewer/LogResponseViewer.vue'

const open = defineModel<boolean>('open', { required: true })

const loading = ref(false)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const data = ref<any>(null)
const sections = ref([true, false, false, false])

type SectionKey = 'client_request' | 'upstream_request' | 'upstream_response' | 'client_response'
const modes = reactive<Record<SectionKey, 'structured' | 'raw'>>({
  client_request: 'structured',
  upstream_request: 'structured',
  upstream_response: 'structured',
  client_response: 'structured',
})

const apiType = computed<'openai' | 'anthropic'>(() =>
  data.value?.api_type === 'openai' ? 'openai' : 'anthropic',
)

const clientReqRaw = computed(() => {
  const d = data.value
  if (!d) return '{}'
  if (!d.client_request) return d.request_body || '{}'
  try {
    const cr = JSON.parse(d.client_request)
    if (cr.body != null) return d.client_request
    if (d.request_body) {
      try { cr.body = JSON.parse(d.request_body) } catch { /* 非 JSON，直接赋值 */ cr.body = d.request_body }
      return JSON.stringify(cr)
    }
  } catch { return d.client_request }
  return d.client_request
})

const clientRespRaw = computed(() => {
  const d = data.value
  if (!d) return ''
  if (d.client_response) return d.client_response
  if (d.response_body) return JSON.stringify({ statusCode: d.status_code, body: d.response_body })
  return ''
})

async function load(id: string) {
  loading.value = true
  data.value = null
  sections.value = [true, false, false, false]
  Object.assign(modes, { client_request: 'structured', upstream_request: 'structured', upstream_response: 'structured', client_response: 'structured' })
  try {
    const res = await api.getLogDetail(id)
    data.value = res.data
  } catch (e) {
    console.error('Failed to load log detail:', e)
    toast.error('加载日志详情失败')
  } finally {
    loading.value = false
  }
}

defineExpose({ load })
</script>
