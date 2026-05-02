<template>
  <Dialog :open="props.open" @update:open="emit('update:open', $event)">
    <DialogContent
      class="sm:max-w-6xl max-h-[85vh] p-0 overflow-hidden flex flex-col"
    >
      <!-- Progress bar -->
      <div class="h-[3px] w-full overflow-hidden">
        <div
          v-if="progressStatus === 'pending'"
          class="h-full w-[40%] progress-active"
          :style="{ animation: 'shimmer 1.5s infinite' }"
        />
        <div
          v-else-if="progressStatus === 'failed'"
          class="h-full w-full progress-failed"
        />
        <div v-else class="h-full w-full progress-active" />
      </div>

      <DialogHeader class="px-4 pt-2 pb-0">
        <DialogTitle class="text-sm flex items-center gap-2">
          {{ t('requestDetail.dialogTitle') }}
          <span
            v-if="overview"
            class="font-mono text-[11px] text-muted-foreground"
            >{{ overview.id }}</span
          >
          <Button
            v-if="overview"
            variant="ghost"
            size="icon-xs"
            class="shrink-0"
            @click="handleCopyId"
          >
            <CheckIcon v-if="copied" class="size-3 text-success" />
            <CopyIcon v-else class="size-3" />
          </Button>
        </DialogTitle>
        <DialogDescription class="sr-only">{{ t('requestDetail.dialogDescription') }}</DialogDescription>
      </DialogHeader>

      <!-- Main content area -->
      <template v-if="overview">
        <div class="flex gap-0 px-4 pb-4 min-h-0 h-[calc(85vh-80px)]">
          <!-- Left: Overview Panel -->
          <div
            class="w-[280px] border-r pr-3 flex-shrink-0 overflow-y-auto min-h-0"
          >
            <RequestOverviewPanel :overview="overview" />
          </div>

          <!-- Right: Tabs -->
          <div class="flex-1 flex flex-col min-w-0 min-h-0 pl-3">
            <!-- Error message banner (inside right panel, above tabs) -->
            <div
              v-if="overview.errorMessage"
              class="rounded-md bg-destructive/10 px-3 py-1.5 text-xs text-destructive mb-2 flex-shrink-0"
            >
              {{ overview.errorMessage }}
            </div>
            <Tabs v-model="activeTab" class="flex-1 flex flex-col min-h-0">
              <TabsList class="flex-shrink-0">
                <TabsTrigger value="response">{{ t('requestDetail.responseTab') }}</TabsTrigger>
                <TabsTrigger value="request">{{ t('requestDetail.requestTab') }}</TabsTrigger>
              </TabsList>

              <!-- Response tab -->
              <div
                v-if="activeTab === 'response'"
                class="flex-1 min-h-0 overflow-y-auto mt-2"
              >
                <ResponseViewer
                  :source="props.source"
                  :api-type="overview.apiType"
                  :is-stream="overview.isStream"
                  :stream-content="props.streamContent"
                  :non-stream-body="logDetailData?.responseBody"
                  :response-body="overview.responseBody"
                  :upstream-response="overview.upstreamResponse"
                  :status="overview.status"
                />
              </div>

              <!-- Request diff tab -->
              <div v-if="activeTab === 'request'" class="flex-1 min-h-0 mt-2">
                <RequestDiffViewer :overview="overview" />
              </div>
            </Tabs>
          </div>
        </div>
      </template>

      <!-- Empty state -->
      <template v-else>
        <div class="flex items-center justify-center h-[calc(85vh-80px)]">
          <p class="text-sm text-muted-foreground">
            {{ props.source === "realtime" ? t('requestDetail.loading') : t('requestDetail.noSelectedRequest') }}
          </p>
        </div>
      </template>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useI18n } from 'vue-i18n';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { CheckIcon, CopyIcon } from "lucide-vue-next";
import { useClipboard } from "@/composables/useClipboard";
import RequestOverviewPanel from "./RequestOverviewPanel.vue";
import ResponseViewer from "./ResponseViewer.vue";
import RequestDiffViewer from "./RequestDiffViewer.vue";
import type { DataSource, UnifiedRequestOverview } from "./types";
import { fromActiveRequest, fromLogEntry } from "./types";
import type { ActiveRequest, StreamContentSnapshot } from "@/types/monitor";
import type { LogEntry } from "@/components/logs/types";

const { t } = useI18n();
const { copied, copy } = useClipboard();

function handleCopyId() {
  if (overview.value) copy(overview.value.id);
}

const props = defineProps<{
  open: boolean;
  source: DataSource;
  // Realtime mode
  request?: ActiveRequest | null;
  streamContent?: StreamContentSnapshot | null;
  logDetailData?: {
    responseBody?: string;
    clientRequest?: string;
    upstreamRequest?: string;
  } | null;
  // History mode
  logEntry?: LogEntry | null;
}>();

const emit = defineEmits<{
  "update:open": [value: boolean];
}>();

const activeTab = ref<"response" | "request">("response");
const loadedOverview = ref<UnifiedRequestOverview | null>(null);

const overview = computed<UnifiedRequestOverview | null>(() => {
  if (props.source === "realtime") {
    if (!props.request) return null;
    const base = fromActiveRequest(
      props.request,
      props.logDetailData?.responseBody,
    );
    // 将日志详情中的 clientRequest/upstreamRequest 合并进 overview
    if (props.logDetailData) {
      if (props.logDetailData.clientRequest)
        base.clientRequest = props.logDetailData.clientRequest;
      if (props.logDetailData.upstreamRequest)
        base.upstreamRequest = props.logDetailData.upstreamRequest;
    }
    return base;
  }
  return loadedOverview.value;
});

const progressStatus = computed(() => {
  if (!overview.value) return "pending";
  return overview.value.status;
});

watch([() => props.open, () => props.logEntry], ([isOpen, logEntry]) => {
  if (!isOpen) return;
  activeTab.value = "response";
  if (props.source === "history" && logEntry) {
    loadedOverview.value = fromLogEntry(logEntry);
  }
});
</script>

<style scoped>
@keyframes shimmer {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(350%);
  }
}
</style>
