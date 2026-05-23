<template>
  <div class="flex flex-col h-full">
    <!-- Structured view -->
    <div v-if="!showRaw" class="flex-1 overflow-y-auto">
      <!-- Layer 1 - Identity (highest visual weight) -->
      <div class="mb-4">
        <div
          class="font-mono text-[15px] font-semibold leading-tight tracking-tight"
        >
          {{ overview.model }}
        </div>
        <div class="flex items-center gap-1 mt-0.5 text-[11px]">
          <template
            v-if="
              overview.backendModel && overview.backendModel !== overview.model
            "
          >
            <span class="font-mono text-muted-foreground">{{
              overview.backendModel
            }}</span>
            <span class="text-muted-foreground">@</span>
          </template>
          <span class="text-muted-foreground">{{
            overview.providerName || t("requestDetail.unknownProvider")
          }}</span>
        </div>
      </div>

      <!-- Mapping reason badge -->
      <div v-if="overview.mappingReason" class="flex items-center gap-1.5 mb-3">
        <Badge variant="secondary" class="text-[10px]">
          {{
            MAPPING_LABELS[overview.mappingReason] ||
            overview.mappingReason
          }}
        </Badge>
      </div>

      <!-- Layer 2 - Attributes + Session (combined row) -->
      <div class="flex items-center gap-1.5 flex-wrap mb-3">
        <Badge
          v-if="statusColor === 'pending'"
          variant="outline"
          class="border-warning/30 bg-warning-light text-warning-dark"
        >
          <span class="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" />
          {{ t("requestDetail.pending") }}
        </Badge>
        <Badge
          v-else-if="statusColor === 'error'"
          variant="outline"
          class="border-danger/30 bg-danger-light text-danger-dark"
        >
          {{ overview.statusCode ?? t("requestDetail.failed") }}
        </Badge>
        <Badge
          v-else
          variant="outline"
          class="border-success/30 bg-success-light text-success-dark"
        >
          <span class="w-1.5 h-1.5 rounded-full bg-success" />
          {{ t("requestDetail.completed") }}
        </Badge>

        <Badge variant="outline">{{
          overview.isStream ? "SSE" : t("requestDetail.nonStream")
        }}</Badge>
        <Badge variant="outline">{{ overview.apiType }}</Badge>

        <template v-if="overview.sessionId">
          <Badge variant="secondary" class="text-[10px]">Session</Badge>
          <span
            class="font-mono text-[11px] text-muted-foreground truncate"
            >{{ overview.sessionId.slice(0, 8) }}</span
          >
        </template>
      </div>

      <!-- Layer 2.5 - Error banner (only when error exists) -->
      <div
        v-if="overview.errorMessage"
        class="rounded-md border px-3 py-2 mb-3"
        style="
          background: oklch(0.3 0.08 25 / 15%);
          border-color: oklch(0.58 0.22 25 / 30%);
        "
      >
        <p class="font-mono text-xs font-semibold text-destructive break-all">
          {{ overview.errorMessage }}
        </p>
        <p class="text-[10px] text-muted-foreground mt-0.5">
          {{ overview.statusCode }} · upstream_error
        </p>
      </div>

      <!-- Layer 3 - Retry history -->
      <div v-if="overview.attempts.length === 0" class="mb-3">
        <span class="text-[11px] text-muted-foreground">{{
          t("requestDetail.noRetry")
        }}</span>
      </div>
      <div
        v-else
        class="rounded-md p-2 mb-3"
        style="background: oklch(0.18 0 0)"
      >
        <p
          class="text-[9px] uppercase tracking-wider mb-1"
          style="color: oklch(0.5 0 0)"
        >
          {{ t("requestDetail.attemptHistory") }}
        </p>
        <div
          v-for="(attempt, i) in overview.attempts"
          :key="i"
          class="flex items-center gap-1 text-[11px]"
        >
          <span class="text-muted-foreground">#{{ i + 1 }}</span>
          <span
            :class="
              isAttemptError(attempt.statusCode)
                ? 'diff-removed'
                : 'diff-added'
            "
          >
            {{ attempt.statusCode ?? "--" }}
          </span>
          <span class="text-muted-foreground"
            >{{ (attempt.latencyMs / MS_PER_SECOND).toFixed(1) }}s</span
          >
        </div>
      </div>

      <!-- Layer 5 - Metrics grid (border container) -->
      <div
        class="grid grid-cols-2 gap-0 p-0 border rounded-md overflow-hidden mb-3"
      >
        <div class="px-2.5 py-1.5 min-w-0 border-b border-r">
          <div
            class="text-[9px] uppercase tracking-wider text-muted-foreground"
          >
            {{ t("requestDetail.latency") }}
          </div>
          <div class="text-sm font-semibold truncate">{{ latencyText }}</div>
        </div>
        <div class="px-2.5 py-1.5 min-w-0 border-b">
          <div
            class="text-[9px] uppercase tracking-wider text-muted-foreground"
          >
            {{ t("requestDetail.ttft") }}
          </div>
          <div class="text-sm font-semibold truncate">
            {{ overview.ttftMs != null ? `${overview.ttftMs}ms` : "--" }}
          </div>
        </div>
        <div class="px-2.5 py-1.5 min-w-0 border-b border-r">
          <div
            class="text-[9px] uppercase tracking-wider text-muted-foreground"
          >
            {{
              overview.inputTokensEstimated
                ? t("requestDetail.estInputTokens")
                : t("requestDetail.inputTokens")
            }}
          </div>
          <div class="text-sm font-semibold truncate">
            {{ overview.inputTokens != null ? overview.inputTokens : "--" }}
          </div>
        </div>
        <div class="px-2.5 py-1.5 min-w-0 border-b">
          <div
            class="text-[9px] uppercase tracking-wider text-muted-foreground"
          >
            {{ t("requestDetail.outputTokens") }}
          </div>
          <div
            class="text-sm font-semibold truncate"
            :class="isOutputPending ? 'diff-added' : ''"
          >
            {{ outputTokenText }}
          </div>
        </div>
        <div class="px-2.5 py-1.5 min-w-0 border-r">
          <div
            class="text-[9px] uppercase tracking-wider text-muted-foreground"
          >
            {{ t("requestDetail.speed") }}
          </div>
          <div class="text-sm font-semibold truncate">{{ speedText }}</div>
        </div>
        <div class="px-2.5 py-1.5 min-w-0">
          <div
            class="text-[9px] uppercase tracking-wider text-muted-foreground"
          >
            {{ t("requestDetail.cacheRead") }}
          </div>
          <div class="text-sm font-semibold truncate">
            {{
              overview.cacheReadTokens != null
                ? overview.cacheReadTokens
                : "--"
            }}
          </div>
        </div>
      </div>

      <!-- Cache source -->
      <div
        v-if="
          overview.cacheReadTokens != null && overview.cacheReadTokens > 0
        "
        class="rounded-md px-2 py-1.5 bg-muted/30 mb-3"
      >
        <div class="text-[10px] text-muted-foreground">
          {{ t("requestDetail.cacheSource") }}
        </div>
        <div
          v-if="overview.cacheReadTokensEstimated === 0"
          class="text-[11px] font-semibold text-success-dark"
        >
          {{ t("requestDetail.cacheSourceApi") }}
        </div>
        <div v-else class="text-[11px] font-semibold text-warning-dark">
          {{ t("requestDetail.cacheSourceEstimated") }}
        </div>
      </div>

      <!-- Layer 6 - Metadata (compact key-value) -->
      <div class="space-y-0.5 text-[11px] mb-3">
        <div
          v-if="overview.clientType != null"
          class="flex justify-between"
        >
          <span class="text-muted-foreground">{{
            t("requestDetail.clientType")
          }}</span>
          <span class="font-mono">{{ clientTypeLabel }}</span>
        </div>
        <div
          v-if="overview.statusCode != null"
          class="flex justify-between"
        >
          <span class="text-muted-foreground">{{
            t("requestDetail.statusCodeLabel")
          }}</span>
          <span class="font-mono">{{ overview.statusCode }}</span>
        </div>
        <div v-if="overview.clientIp" class="flex justify-between">
          <span class="text-muted-foreground">{{
            t("requestDetail.clientIp")
          }}</span>
          <span class="font-mono truncate max-w-[160px]">{{
            overview.clientIp
          }}</span>
        </div>
      </div>
    </div>

    <!-- Raw JSON view -->
    <ScrollArea v-else class="flex-1 rounded-md border">
      <pre class="p-3 text-[11px] whitespace-pre-wrap break-words">{{
        responseMetadataJson
      }}</pre>
    </ScrollArea>

    <!-- Toggle at bottom -->
    <div class="pt-3 mt-auto border-t">
      <Button
        size="sm"
        variant="outline"
        class="h-6 gap-1 text-xs w-full justify-center"
        @click="showRaw = !showRaw"
      >
        <component :is="showRaw ? FileText : FileJson" class="h-3 w-3" />
        {{
          showRaw ? t("requestDetail.structured") : t("requestDetail.rawData")
        }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import type { UnifiedRequestOverview } from "./types";
import { MS_PER_SECOND, HTTP_ERROR_THRESHOLD } from "./types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileJson, FileText } from "lucide-vue-next";
import { extractResponseMetadata } from "./upstream-merge";

const { t } = useI18n();

const JSON_INDENT = 2;

const MAPPING_LABELS: Record<string, string> = {
  direct_format: "直连",
  group_base_rule: "基础规则",
  group_schedule: "定时调度",
  fallback_provider: "回退",
  overflow_redirect: "溢出重定向",
  failover_retry: "故障转移",
};

const props = defineProps<{ overview: UnifiedRequestOverview }>();

const showRaw = ref(false);

const clientTypeLabel = computed(() => {
  const ct = props.overview.clientType;
  if (ct === "claude-code") return "Claude Code";
  if (ct === "codex") return "Codex CLI";
  if (ct === "pi") return "Pi";
  if (ct === "openai-sdk") return "OpenAI SDK";
  if (ct === "anthropic-sdk") return "Anthropic SDK";
  return ct ?? "Unknown";
});

const responseMetadataJson = computed(() => {
  const result = extractResponseMetadata(
    props.overview.upstreamResponse,
    props.overview.responseBody,
  );
  return (
    result ||
    JSON.stringify(
      {
        latencyMs: props.overview.latencyMs,
        ttftMs: props.overview.ttftMs,
        inputTokens: props.overview.inputTokens,
        outputTokens: props.overview.outputTokens,
        tokensPerSecond: props.overview.tokensPerSecond,
        cacheReadTokens: props.overview.cacheReadTokens,
        cacheWriteTokens: props.overview.cacheWriteTokens,
        stopReason: props.overview.stopReason,
        statusCode: props.overview.statusCode,
      },
      null,
      JSON_INDENT,
    )
  );
});

const statusColor = computed(() => {
  if (props.overview.status === "pending") return "pending";
  const code = props.overview.statusCode;
  if (
    props.overview.status === "failed" ||
    (code != null && code >= HTTP_ERROR_THRESHOLD)
  )
    return "error";
  return "success";
});

const isOutputPending = computed(
  () =>
    props.overview.status === "pending" && props.overview.outputTokens != null,
);

const outputTokenText = computed(() => {
  const val = props.overview.outputTokens;
  if (val == null) return "--";
  return isOutputPending.value ? `+${val}` : `${val}`;
});

const latencyText = computed(() => {
  if (props.overview.status === "pending" && props.overview.latencyMs == null)
    return "...";
  if (props.overview.latencyMs == null) return "--";
  return `${(props.overview.latencyMs / MS_PER_SECOND).toFixed(1)}s`;
});

const speedText = computed(() => {
  if (props.overview.tokensPerSecond != null) {
    return `${props.overview.tokensPerSecond.toFixed(1)}`;
  }
  const { outputTokens, latencyMs } = props.overview;
  if (outputTokens && latencyMs) {
    return `${((outputTokens / latencyMs) * MS_PER_SECOND).toFixed(1)}`;
  }
  return "--";
});

function isAttemptError(statusCode: number | null): boolean {
  return statusCode != null && statusCode >= HTTP_ERROR_THRESHOLD;
}
</script>
