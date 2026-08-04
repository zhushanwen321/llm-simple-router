<template>
  <div class="flex flex-col h-full">
    <!-- Structured view -->
    <div v-if="!showRaw" class="flex-1 overflow-y-auto">
      <!-- Execution Chain -->
      <div class="rounded-md border overflow-hidden mb-3">
        <!-- Header -->
        <div class="flex items-center gap-2 px-2.5 py-2 border-b bg-muted/20">
          <span
            class="text-[10px] uppercase tracking-wider text-muted-foreground font-medium"
          >
            {{ t("requestDetail.executionChain") }}
          </span>
          <span class="flex-1" />
          <span class="text-[13px] font-medium">{{ overview.model }}</span>
          <Badge variant="secondary" class="text-[10px] px-1 py-0">{{
            overview.apiType
          }}</Badge>
          <Badge
            v-if="overview.mappingReason"
            class="text-[10px] px-2 py-0 rounded-full bg-primary/20 text-primary border-0"
          >
            {{
              MAPPING_LABELS[overview.mappingReason] || overview.mappingReason
            }}
          </Badge>
        </div>
        <!-- Steps -->
        <div class="px-2.5 py-1">
          <div
            v-for="(attempt, idx) in overview.attempts"
            :key="idx"
            class="py-1.5"
            :class="{ 'border-t border-border/50': idx > 0 }"
          >
            <!-- Line 1: #N model @ provider (scrollable) -->
            <div class="flex items-center gap-0 text-[11px]">
              <span
                class="text-muted-foreground/60 font-mono text-[10px] w-5 shrink-0"
                >#{{ idx + 1 }}</span
              >
              <span
                class="flex-1 min-w-0 overflow-x-auto whitespace-nowrap scrollbar-none"
              >
                <span class="font-mono">{{
                  attempt.model || overview.backendModel || "-"
                }}</span>
                <span class="text-muted-foreground">
                  @ {{ getProviderName(attempt.providerId) }}</span
                >
              </span>
            </div>
            <!-- Line 2: status + latency + apiType + retry/final -->
            <div class="flex items-center gap-1.5 pl-5 mt-0.5 flex-wrap">
              <Badge
                :variant="
                  (attempt.statusCode ?? 0) < HTTP_ERROR_THRESHOLD
                    ? 'default'
                    : 'destructive'
                "
                class="text-[9px] px-1 py-0"
              >
                {{ attempt.statusCode || "-" }}
              </Badge>
              <span class="text-muted-foreground/60 font-mono text-[11px]">
                {{ formatLatency(attempt.latencyMs) }}
              </span>
              <Badge variant="secondary" class="text-[9px] px-1 py-0">
                {{ attempt.apiType || overview.apiType }}
              </Badge>
              <Badge
                v-if="idx === 0 && overview.attempts.length > 1"
                class="text-[9px] px-1 py-0 rounded bg-warning/15 text-warning border-0"
              >
                {{ t("requestDetail.executionRetry") }}
              </Badge>
              <Badge
                v-if="
                  idx === overview.attempts.length - 1 &&
                  overview.attempts.length > 1
                "
                class="text-[9px] px-1 py-0 rounded bg-success/15 text-success border-0"
              >
                {{ t("requestDetail.executionFinal") }}
              </Badge>
            </div>
          </div>
        </div>
      </div>

      <!-- Badges + Session -->
      <div class="flex items-center gap-1.5 mb-3">
        <Badge
          :variant="overview.status === 'completed' ? 'default' : 'destructive'"
          class="text-[10px] px-1.5 py-0"
        >
          <span
            class="inline-block w-1.5 h-1.5 rounded-full mr-1"
            :class="
              overview.status === 'completed' ? 'bg-success' : 'bg-destructive'
            "
          />
          {{
            overview.status === "completed"
              ? t("requestDetail.completed")
              : t("requestDetail.failed")
          }}
        </Badge>
        <Badge
          v-if="overview.isStream"
          variant="outline"
          class="text-[10px] px-1.5 py-0"
          >SSE</Badge
        >
        <Badge variant="secondary" class="text-[10px] px-1.5 py-0">{{
          overview.apiType
        }}</Badge>
        <span
          v-if="overview.sessionId"
          class="font-mono text-[10px] text-muted-foreground ml-1"
        >
          {{ overview.sessionId.slice(0, 8) }}
        </span>
        <Badge
          v-if="overview.thinkingLevel"
          variant="outline"
          class="text-[10px]"
        >
          {{ overview.thinkingLevel }}
        </Badge>
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

      <!-- Metrics grid -->
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
              overview.cacheReadTokens != null ? overview.cacheReadTokens : "--"
            }}
          </div>
        </div>
      </div>

      <!-- Cache source -->
      <div
        v-if="overview.cacheReadTokens != null && overview.cacheReadTokens > 0"
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
        <div v-if="overview.clientType != null" class="flex justify-between">
          <span class="text-muted-foreground">{{
            t("requestDetail.clientType")
          }}</span>
          <span class="font-mono">{{ clientTypeLabel }}</span>
        </div>
        <div v-if="overview.statusCode != null" class="flex justify-between">
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
        <div
          v-if="
            overview.upstreamApiType &&
            overview.upstreamApiType !== overview.apiType
          "
          class="flex items-center justify-between text-[11px]"
        >
          <span class="text-muted-foreground">{{
            t("requestDetail.upstreamApiType")
          }}</span>
          <span class="font-mono text-warning-dark"
            >{{ overview.apiType }} → {{ overview.upstreamApiType }}</span
          >
        </div>
        <div
          v-if="overview.upstreamBaseUrl"
          class="flex items-center justify-between text-[11px]"
        >
          <span class="text-muted-foreground">{{
            t("requestDetail.upstreamBaseUrl")
          }}</span>
          <span class="font-mono truncate max-w-[160px]">{{
            overview.upstreamBaseUrl
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
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { UnifiedRequestOverview } from "./types";
import { MS_PER_SECOND, HTTP_ERROR_THRESHOLD } from "./types";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  circuit_breaker_skip: "熔断跳过",
  session_affinity: "会话亲和",
};

const props = defineProps<{
  overview: UnifiedRequestOverview;
  showRaw: boolean;
}>();

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

function getProviderName(providerId: string): string {
  // 如果尝试的 provider 与最终结果相同，使用 overview 上的 providerName
  const lastAttempt =
    props.overview.attempts[props.overview.attempts.length - 1];
  return lastAttempt && providerId === lastAttempt.providerId
    ? props.overview.providerName || providerId
    : providerId;
}

function formatLatency(ms: number): string {
  if (ms <= 0) return "-";
  return (ms / MS_PER_SECOND).toFixed(1) + "s";
}
</script>
