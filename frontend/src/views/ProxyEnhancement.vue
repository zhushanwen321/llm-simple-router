<template>
  <div class="p-6">
    <h2 class="text-lg font-semibold text-foreground mb-4">
      {{ t("proxyEnhancement.title") }}
    </h2>
    <Card>
      <CardHeader>
        <CardTitle>{{
          t("proxyEnhancement.loopDetection.toolRoundLimit.title")
        }}</CardTitle>
        <CardDescription>
          {{ t("proxyEnhancement.loopDetection.toolRoundLimit.description") }}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="flex items-center gap-3">
          <Switch
            id="tool-round-limit-toggle"
            v-model="toolRoundLimitEnabled"
          />
          <Label for="tool-round-limit-toggle">
            {{
              toolRoundLimitEnabled
                ? t("proxyEnhancement.status.enabled")
                : t("proxyEnhancement.status.disabled")
            }}
          </Label>
        </div>
      </CardContent>
    </Card>
    <Card class="mt-4">
      <CardHeader>
        <CardTitle>{{
          t("proxyEnhancement.loopDetection.toolCallLoop.title")
        }}</CardTitle>
        <CardDescription>
          {{ t("proxyEnhancement.loopDetection.toolCallLoop.description") }}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="flex items-center gap-3">
          <Switch id="tool-call-loop-toggle" v-model="toolCallLoopEnabled" />
          <Label for="tool-call-loop-toggle">
            {{
              toolCallLoopEnabled
                ? t("proxyEnhancement.status.enabled")
                : t("proxyEnhancement.status.disabled")
            }}
          </Label>
        </div>
      </CardContent>
    </Card>
    <Card class="mt-4">
      <CardHeader>
        <CardTitle>{{
          t("proxyEnhancement.loopDetection.streamLoop.title")
        }}</CardTitle>
        <CardDescription>
          {{ t("proxyEnhancement.loopDetection.streamLoop.description") }}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="flex items-center gap-3">
          <Switch id="stream-loop-toggle" v-model="streamLoopEnabled" />
          <Label for="stream-loop-toggle">
            {{
              streamLoopEnabled
                ? t("proxyEnhancement.status.enabled")
                : t("proxyEnhancement.status.disabled")
            }}
          </Label>
        </div>
      </CardContent>
    </Card>

    <Card class="mt-4">
      <CardHeader>
        <CardTitle>{{
          t("proxyEnhancement.toolErrorLogging.title")
        }}</CardTitle>
        <CardDescription>
          {{ t("proxyEnhancement.toolErrorLogging.description") }}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div class="flex items-center gap-3">
          <Switch
            id="tool-error-logging-toggle"
            v-model="toolErrorLoggingEnabled"
          />
          <Label for="tool-error-logging-toggle">
            {{
              toolErrorLoggingEnabled
                ? t("proxyEnhancement.status.enabled")
                : t("proxyEnhancement.status.disabled")
            }}
          </Label>
        </div>
      </CardContent>
    </Card>

    <Card class="mt-4">
      <CardHeader>
        <CardTitle>{{
          t("proxyEnhancement.clientIdentification.title")
        }}</CardTitle>
        <CardDescription>
          {{ t("proxyEnhancement.clientIdentification.description") }}
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
            {{ t("proxyEnhancement.clientIdentification.addEntry") }}
          </Button>
        </div>
      </CardContent>
    </Card>
    <Card class="mt-4">
      <CardHeader>
        <CardTitle>{{ t("proxyEnhancement.tokenEstimation.title") }}</CardTitle>
        <CardDescription>
          {{ t("proxyEnhancement.tokenEstimation.shortDescription") }}
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
            {{
              tokenEstimationEnabled
                ? t("proxyEnhancement.status.enabled")
                : t("proxyEnhancement.status.disabled")
            }}
          </Label>
        </div>
        <p class="text-xs text-muted-foreground mt-2">
          {{ t("proxyEnhancement.tokenEstimation.desc") }}
        </p>
        <p class="text-xs text-muted-foreground mt-1">
          {{ t("proxyEnhancement.saveHint") }}
        </p>
        <!-- 配置说明 -->
        <details class="mt-3 text-xs text-muted-foreground">
          <summary
            class="cursor-pointer hover:text-foreground transition-colors"
          >
            {{ t("proxyEnhancement.tokenEstimation.setupTitle") }} ▸
          </summary>
          <div class="mt-2 space-y-1 pl-2 border-l-2 border-muted">
            <p>{{ t("proxyEnhancement.tokenEstimation.claudeCode") }}</p>
            <p class="whitespace-pre-line">
              {{ t("proxyEnhancement.tokenEstimation.piExtension") }}
            </p>
            <p class="whitespace-pre-line">
              {{ t("proxyEnhancement.tokenEstimation.piModelsJson") }}
            </p>
          </div>
        </details>
      </CardContent>
    </Card>
    <Card class="mt-4">
      <CardHeader>
        <CardTitle class="flex items-center gap-2">
          <Sparkles class="h-4 w-4" />
          {{ t("proxyEnhancement.aiRetryRuleGen") }}
        </CardTitle>
        <CardDescription>{{
          t("proxyEnhancement.aiRetryRuleGenDesc")
        }}</CardDescription>
      </CardHeader>
      <CardContent>
        <CascadingModelSelect
          :providers="providerGroups"
          :model-value="aiRetryConfig"
          @update:model-value="onAiConfigChange"
        />
      </CardContent>
    </Card>
    <div class="flex justify-end mt-4">
      <Button :disabled="saving" @click="handleSave">
        <span v-if="saving" class="flex items-center gap-1">
          <Loader2 class="w-4 h-4 animate-spin" />
          {{ t("proxyEnhancement.dynamicModel.saving") }}
        </span>
        <span v-else>{{ t("common.save") }}</span>
      </Button>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { api, getApiMessage } from "@/api/client";
import {
  getTokenEstimation,
  updateTokenEstimation,
  getClientSessionHeaders,
  updateClientSessionHeaders,
} from "@/api/settings-api";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, Sparkles, Trash2 } from "lucide-vue-next";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import CascadingModelSelect from "@/components/mappings/CascadingModelSelect.vue";
import type { ProviderGroup } from "@/components/mappings/cascading-types";
const { t } = useI18n();
const toolRoundLimitEnabled = ref(true);
const toolCallLoopEnabled = ref(false);
const streamLoopEnabled = ref(false);
const toolErrorLoggingEnabled = ref(false);
const tokenEstimationEnabled = ref(false);
const saving = ref(false);
interface ClientSessionHeaderEntry {
  client_type: string;
  session_header_key: string;
  persisted: boolean;
}
const clientSessionHeaders = ref<ClientSessionHeaderEntry[]>([]);
const aiRetryConfig = ref<{ provider_id: string; model: string } | undefined>(
  undefined,
);
const providerGroups = ref<ProviderGroup[]>([]);
const FALLBACK_CONTEXT_WINDOW = 128000;

async function loadProviders() {
  try {
    const p = await api.getProviders();
    providerGroups.value = p
      .filter((a) => a.is_active)
      .map((a) => ({
        provider: { id: a.id, name: a.name },
        models: (a.models ?? []).map((m) => ({
          name: m.name,
          contextWindow: m.context_window ?? FALLBACK_CONTEXT_WINDOW,
          streamTimeoutMs: m.stream_timeout_ms ?? null,
        })),
      }));
  } catch (e: unknown) {
    console.error("proxyEnhancement.loadProviders:", e);
    toast.error(t("proxyEnhancement.loadProvidersFailed"));
  }
}
function onAiConfigChange(value: { provider_id: string; model: string }) {
  aiRetryConfig.value = value;
}
async function loadConfig() {
  try {
    const data = await api.getProxyEnhancement();
    toolRoundLimitEnabled.value = data.tool_round_limit_enabled;
    toolCallLoopEnabled.value = data.tool_call_loop_enabled;
    streamLoopEnabled.value = data.stream_loop_enabled;
    toolErrorLoggingEnabled.value = data.tool_error_logging_enabled;
    aiRetryConfig.value = data.ai_retry_config ?? undefined;
    const tokenEstData = await getTokenEstimation();
    tokenEstimationEnabled.value = tokenEstData.enabled;
    const [sessionHeadersData] = await Promise.allSettled([
      getClientSessionHeaders(),
    ]);
    if (sessionHeadersData.status === "fulfilled") {
      clientSessionHeaders.value = sessionHeadersData.value.entries.map(
        (e) => ({
          ...e,
          persisted: true,
        }),
      );
    }
  } catch (e: unknown) {
    console.error("Failed to load proxy enhancement config:", e);
    toast.error(getApiMessage(e, t("proxyEnhancement.loadFailed")));
  }
}

async function handleSave() {
  saving.value = true;
  try {
    const entriesToSave = clientSessionHeaders.value
      .filter((e) => e.client_type.trim() && e.session_header_key.trim())
      .map((e) => ({
        client_type: e.client_type.trim(),
        session_header_key: e.session_header_key.trim(),
      }));

    const results = await Promise.allSettled([
      api.updateProxyEnhancement({
        tool_call_loop_enabled: toolCallLoopEnabled.value,
        stream_loop_enabled: streamLoopEnabled.value,
        tool_round_limit_enabled: toolRoundLimitEnabled.value,
        tool_error_logging_enabled: toolErrorLoggingEnabled.value,
        ai_retry_config: aiRetryConfig.value ?? null,
      }),
      updateTokenEstimation(tokenEstimationEnabled.value),
      updateClientSessionHeaders(entriesToSave),
    ]);
    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length > 0) {
      const failedReasons = failures
        .map((f) =>
          f.status === "rejected"
            ? f.reason instanceof Error
              ? f.reason.message
              : typeof f.reason === "string"
                ? f.reason
                : JSON.stringify(f.reason)
            : "",
        )
        .filter(Boolean)
        .join("; ");
      toast.error(t("proxyEnhancement.saveFailed") + ": " + failedReasons);
      return;
    }
    toast.success(t("common.saveSuccess"));
  } catch (e: unknown) {
    console.error("Failed to save config:", e);
    toast.error(getApiMessage(e, t("proxyEnhancement.saveFailed")));
  } finally {
    saving.value = false;
  }
}
function addSessionHeaderEntry() {
  clientSessionHeaders.value.push({
    client_type: "",
    session_header_key: "",
    persisted: false,
  });
}
function removeSessionHeaderEntry(index: number) {
  clientSessionHeaders.value.splice(index, 1);
}
onMounted(() => {
  loadConfig();
  loadProviders();
});
</script>
