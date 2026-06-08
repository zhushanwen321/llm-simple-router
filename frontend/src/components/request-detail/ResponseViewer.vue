<template>
  <div class="flex flex-col gap-2 min-h-0 flex-1">
    <div class="flex items-center justify-between flex-shrink-0">
      <span class="text-xs font-medium text-muted-foreground">{{
        t("requestDetail.responseTitle")
      }}</span>
      <Button
        size="sm"
        variant="outline"
        class="h-6 gap-1 text-xs"
        @click="showRaw = !showRaw"
      >
        <component :is="showRaw ? FileText : FileJson" class="h-3 w-3" />
        {{
          showRaw
            ? t("requestDetail.structured")
            : props.isStream
              ? t("requestDetail.rawSse")
              : t("requestDetail.rawJson")
        }}
      </Button>
    </div>

    <!-- Structured view -->
    <div v-if="!showRaw" class="relative flex-1 min-h-0">
      <div
        ref="structuredRef"
        class="flex-1 min-h-0 overflow-y-auto"
        @scroll="onStructuredScroll"
      >
        <template v-if="blocks.length > 0">
          <div class="flex flex-col gap-2">
            <ContentBlockRenderer
              v-for="(block, i) in blocks"
              :key="i"
              :type="block.type"
              :content="block.content"
              :name="block.name"
              :show-cursor="
                props.status === 'pending' && i === blocks.length - 1
              "
              :auto-scroll="
                props.status === 'pending' && i === blocks.length - 1
              "
            />
            <!-- Usage -->
            <div v-if="responseMeta?.usage" class="rounded-md border mt-2">
              <div
                class="flex items-center gap-1.5 px-2.5 py-1.5 border-b bg-muted/20"
              >
                <span class="text-xs font-medium">Usage</span>
              </div>
              <div class="grid grid-cols-2 gap-0">
                <template
                  v-for="key in [
                    'prompt_tokens',
                    'completion_tokens',
                    'total_tokens',
                    'input_tokens',
                    'output_tokens',
                  ]"
                  :key="key"
                >
                  <div
                    v-if="responseMeta.usage[key] != null"
                    class="px-2.5 py-1.5 text-xs"
                  >
                    <span class="text-muted-foreground">{{ key }}</span>
                    <span class="font-mono font-semibold block">{{
                      Number(responseMeta.usage[key]).toLocaleString()
                    }}</span>
                  </div>
                </template>
              </div>
            </div>
            <!-- Stop reason -->
            <div
              v-if="responseMeta?.stopReason"
              class="flex items-center gap-1.5 mt-2 text-xs"
            >
              <span class="text-muted-foreground">Stop reason</span>
              <Badge variant="default" class="text-[10px] px-1.5 py-0">{{
                responseMeta.stopReason
              }}</Badge>
            </div>
          </div>
        </template>
        <template v-if="blocks.length === 0">
          <p
            v-if="props.status === 'pending' && !props.streamContent?.rawChunks"
            class="text-xs text-muted-foreground"
          >
            {{ t("requestDetail.waitingResponse") }}
          </p>
          <p
            v-else-if="
              props.source === 'history' &&
              props.isStream &&
              !hasAnyResponseData
            "
            class="text-xs text-muted-foreground"
          >
            {{ t("requestDetail.streamNotPersisted") }}
          </p>
          <p v-else class="text-xs text-muted-foreground">
            {{ t("requestDetail.noResponseContent") }}
          </p>
        </template>
      </div>
      <!-- Scroll to bottom button -->
      <Button
        v-if="isUserScrolling"
        variant="outline"
        size="icon"
        class="absolute bottom-2 right-2 h-7 w-7 rounded-full shadow-md opacity-80 hover:opacity-100"
        @click="scrollToBottom"
      >
        <ArrowDown class="h-3.5 w-3.5" />
      </Button>
    </div>

    <!-- Raw view -->
    <ScrollArea v-else class="flex-1 min-h-0 rounded-md border">
      <pre class="p-3 text-[11px] whitespace-pre-wrap break-words">{{
        rawContent
      }}</pre>
    </ScrollArea>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileJson, FileText, ArrowDown } from "@lucide/vue";
import ContentBlockRenderer from "./ContentBlockRenderer.vue";
import { tryDirectParse } from "./response-parser";
import type { DataSource } from "./types";
import type { ContentBlock, StreamContentSnapshot } from "@/types/monitor";
import { useSSEParsing } from "@/components/log-viewer/useSSEParsing";
import { mergeUpstreamData } from "./upstream-merge";

const { t } = useI18n();
const structuredRef = ref<HTMLElement | null>(null);

const props = withDefaults(
  defineProps<{
    source: DataSource;
    apiType: "openai" | "openai-responses" | "anthropic";
    isStream: boolean;
    streamContent?: StreamContentSnapshot | null;
    nonStreamBody?: string | null;
    responseBody?: string | null;
    upstreamResponse?: string | null;
    status: "pending" | "completed" | "failed";
  }>(),
  {
    streamContent: null,
    nonStreamBody: null,
    responseBody: null,
    upstreamResponse: null,
  },
);

const showRaw = ref(false);

const hasAnyResponseData = computed(
  () => !!(props.responseBody || props.upstreamResponse),
);

// SSE composable must be called unconditionally; pass empty for realtime mode
const sseBodyForParsing = computed(() => {
  if (props.source !== "history") return "";
  const raw = props.responseBody || props.upstreamResponse || "";
  try {
    const parsed = JSON.parse(raw);
    return parsed.body || raw;
  } catch {
    /* not JSON */ return raw;
  }
});

const { assembledBlocks } = useSSEParsing(
  sseBodyForParsing,
  props.isStream,
  props.apiType,
);

// Unified blocks computed
const blocks = computed<ContentBlock[]>(() => {
  if (props.source === "realtime") {
    const streamBlocks = props.streamContent?.blocks;
    if (streamBlocks && streamBlocks.length > 0) return streamBlocks;
    if (props.responseBody) {
      const direct = tryDirectParse(props.responseBody, null, props.apiType);
      if (direct.length > 0) return direct;
    }
    // blocks 为空时回退到 rawChunks：至少让用户看到流式内容
    const raw = props.streamContent?.rawChunks;
    if (raw && raw.trim().length > 0) {
      return [{ type: "text" as const, content: raw }];
    }
    return [];
  }

  const direct = tryDirectParse(
    props.responseBody ?? null,
    props.upstreamResponse ?? null,
    props.apiType,
  );
  if (direct.length > 0) return direct;

  // 流式请求的纯文本回退：responseBody 不是 JSON 时，直接作为 text block 展示
  if (props.responseBody && props.responseBody.trim().length > 0) {
    return [{ type: "text" as const, content: props.responseBody }];
  }

  const validTypes = ["thinking", "text", "tool_use", "tool_result"] as const;
  return assembledBlocks.value.map((b) => ({
    type: validTypes.includes(b.type as (typeof validTypes)[number])
      ? (b.type as ContentBlock["type"])
      : ("text" as const),
    content: b.content,
    ...(b.toolName ? { name: b.toolName } : {}),
  }));
});

// Extract usage and stop_reason from response body
const responseMeta = computed(() => {
  const raw = props.responseBody || props.upstreamResponse || "";
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    const parsed = data.body ? JSON.parse(data.body) : data;
    return {
      usage: parsed.usage as Record<string, unknown> | undefined,
      stopReason:
        ((parsed.choices?.[0] as Record<string, unknown> | undefined)
          ?.finish_reason as string | undefined) ||
        (parsed.stop_reason as string | undefined),
      model: parsed.model as string | undefined,
    };
  } catch {
    /* JSON 解析失败，使用默认值 */ return null;
  }
});

// Raw content for raw view: merge upstreamResponse (headers) with responseBody (stream_text_content)
const rawContent = computed(() => {
  if (props.source === "realtime") {
    return props.streamContent?.rawChunks || props.responseBody || "";
  }
  return mergeUpstreamData(
    props.upstreamResponse ?? null,
    props.responseBody ?? null,
  );
});

// --- Auto-scroll logic ---
const isUserScrolling = ref(false);
const SCROLL_THRESHOLD = 50;

function onStructuredScroll() {
  const el = structuredRef.value;
  if (!el) return;
  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
  isUserScrolling.value = distanceFromBottom > SCROLL_THRESHOLD;
}

function scrollToBottom() {
  const el = structuredRef.value;
  if (el) el.scrollTop = el.scrollHeight;
}

watch(
  blocks,
  () => {
    if (isUserScrolling.value) return;
    nextTick(() => scrollToBottom());
  },
  { deep: true },
);
</script>
