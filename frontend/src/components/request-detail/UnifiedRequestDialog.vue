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
          请求详情
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
            <CheckIcon v-if="copied" class="size-3 text-green-500" />
            <CopyIcon v-else class="size-3" />
          </Button>
        </DialogTitle>
        <DialogDescription class="sr-only"
          >查看请求的响应内容和请求内容</DialogDescription
        >
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
                <TabsTrigger value="response">响应内容</TabsTrigger>
                <TabsTrigger value="request">请求内容</TabsTrigger>
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

            <!-- Pipeline Snapshot -->
            <div
              v-if="overview.pipelineSnapshot"
              class="mt-3 border-t pt-3 flex-shrink-0"
            >
              <div class="text-sm font-medium text-foreground mb-2">
                处理管线
              </div>
              <div class="space-y-1">
                <div
                  v-for="(stage, i) in parsePipelineSnapshot(overview.pipelineSnapshot)"
                  :key="i"
                  class="flex items-start gap-2 text-sm"
                >
                  <Badge
                    :variant="stageBadgeVariant(stage.stage)"
                    class="shrink-0 text-xs"
                  >
                    {{ stageLabel(stage.stage) }}
                  </Badge>
                  <span class="text-muted-foreground">{{
                    stageDescription(stage)
                  }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- Empty state -->
      <template v-else>
        <div class="flex items-center justify-center h-[calc(85vh-80px)]">
          <p class="text-sm text-muted-foreground">
            {{ props.source === "realtime" ? "加载中..." : "无选中请求" }}
          </p>
        </div>
      </template>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckIcon, CopyIcon } from "lucide-vue-next";
import { useClipboard } from "@/composables/useClipboard";
import RequestOverviewPanel from "./RequestOverviewPanel.vue";
import ResponseViewer from "./ResponseViewer.vue";
import RequestDiffViewer from "./RequestDiffViewer.vue";
import type { DataSource, UnifiedRequestOverview } from "./types";
import { fromActiveRequest, fromLogEntry } from "./types";
import type { ActiveRequest, StreamContentSnapshot } from "@/types/monitor";
import type { LogEntry } from "@/components/logs/types";

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

// --- Pipeline Snapshot helpers ---

interface PipelineStage {
  stage: string;
  [key: string]: unknown;
}

const STAGE_LABELS: Record<string, string> = {
  enhancement: "增强处理",
  tool_guard: "循环防护",
  routing: "路由",
  overflow: "溢出转移",
  provider_patch: "供应商补丁",
  response_transform: "响应变换",
};

const STAGE_VARIANTS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  enhancement: "secondary",
  tool_guard: "destructive",
  routing: "default",
  overflow: "outline",
  provider_patch: "secondary",
  response_transform: "secondary",
};

function parsePipelineSnapshot(json: string): PipelineStage[] {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

function stageBadgeVariant(stage: string): "default" | "secondary" | "outline" | "destructive" {
  return STAGE_VARIANTS[stage] ?? "outline";
}

function stageDescription(s: PipelineStage): string {
  switch (s.stage) {
    case "enhancement": {
      const parts: string[] = [];
      if (s.router_tags_stripped) parts.push(`剥离 ${s.router_tags_stripped} 个路由标签`);
      if (s.directive) parts.push(`指令: ${(s.directive as { type: string }).type} → ${(s.directive as { value: string }).value}`);
      return parts.join("，") || "无变更";
    }
    case "tool_guard":
      return `${s.action} (${s.tool})`;
    case "routing":
      return `${s.client_model} → ${s.backend_model} (${s.provider_id}, ${s.strategy})`;
    case "overflow":
      return s.triggered
        ? `已转移至 ${s.redirect_to ?? "未知"}${s.redirect_provider ? ` (${s.redirect_provider})` : ""}`
        : "未触发";
    case "provider_patch":
      return `应用 ${(s.types as string[])?.length ?? 0} 个补丁`;
    case "response_transform":
      return s.model_info_tag_injected ? "已注入模型信息标签" : "无变换";
    default:
      return JSON.stringify(s);
  }
}

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
