<template>
  <Dialog :open="props.open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-w-6xl max-h-[85vh] p-0 overflow-hidden">
      <!-- Progress bar -->
      <div class="h-[3px] w-full overflow-hidden">
        <div
          v-if="progressStatus === 'pending'"
          class="h-full w-[40%] bg-green-500"
          :style="{ animation: 'shimmer 1.5s infinite' }"
        />
        <div
          v-else-if="progressStatus === 'failed'"
          class="h-full w-full bg-red-500"
        />
        <div
          v-else
          class="h-full w-full bg-green-500"
        />
      </div>

      <DialogHeader class="px-4 pt-2 pb-0">
        <DialogTitle class="text-sm">请求详情</DialogTitle>
      </DialogHeader>

      <!-- Main content area -->
      <template v-if="overview">
        <div class="flex gap-0 px-4 pb-4" style="height: calc(85vh - 80px)">
          <!-- Left: Overview Panel -->
          <RequestOverviewPanel :overview="overview" />

          <!-- Right: Tabs -->
          <div class="flex-1 flex flex-col min-w-0 pl-3">
            <Tabs v-model="activeTab">
              <TabsList>
                <TabsTrigger value="response">响应内容</TabsTrigger>
                <TabsTrigger value="request">请求详情</TabsTrigger>
              </TabsList>

              <!-- Response tab -->
              <div v-if="activeTab === 'response'" class="flex-1 overflow-y-auto mt-2">
                <ResponseViewer
                  :source="props.source"
                  :api-type="overview.apiType"
                  :is-stream="overview.isStream"
                  :stream-content="props.streamContent"
                  :non-stream-body="props.nonStreamBody"
                  :response-body="overview.responseBody"
                  :upstream-response="overview.upstreamResponse"
                  :status="overview.status"
                />
              </div>

              <!-- Request diff tab -->
              <div v-if="activeTab === 'request'" class="flex-1 overflow-y-auto mt-2">
                <RequestDiffViewer :overview="overview" />
              </div>
            </Tabs>
          </div>
        </div>
      </template>

      <!-- Empty state -->
      <template v-else>
        <div class="flex items-center justify-center" style="height: calc(85vh - 80px)">
          <p class="text-sm text-muted-foreground">
            {{ props.source === 'realtime' ? '加载中...' : '无选中请求' }}
          </p>
        </div>
      </template>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import RequestOverviewPanel from './RequestOverviewPanel.vue'
import ResponseViewer from './ResponseViewer.vue'
import RequestDiffViewer from './RequestDiffViewer.vue'
import type { DataSource, UnifiedRequestOverview } from './types'
import { fromActiveRequest, fromLogEntry } from './types'
import type { ActiveRequest, StreamContentSnapshot } from '@/types/monitor'
import type { LogEntry } from '@/components/logs/types'

const props = defineProps<{
  open: boolean
  source: DataSource
  // Realtime mode
  request?: ActiveRequest | null
  streamContent?: StreamContentSnapshot | null
  nonStreamBody?: string | null
  // History mode
  logEntry?: LogEntry | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
}>()

const activeTab = ref<'response' | 'request'>('response')
const loadedOverview = ref<UnifiedRequestOverview | null>(null)

const overview = computed<UnifiedRequestOverview | null>(() => {
  if (props.source === 'realtime') {
    if (!props.request) return null
    return fromActiveRequest(props.request, props.nonStreamBody)
  }
  return loadedOverview.value
})

const progressStatus = computed(() => {
  if (!overview.value) return 'pending'
  return overview.value.status
})

watch(() => props.open, (isOpen) => {
  if (!isOpen) return
  activeTab.value = 'response'
  if (props.source === 'history' && props.logEntry) {
    loadedOverview.value = fromLogEntry(props.logEntry)
  }
})
</script>

<style scoped>
@keyframes shimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(350%); }
}
</style>
