<template>
  <div class="page pb-16 max-w-[1000px]">
    <!-- 页面头部 -->
    <div class="mb-6">
      <h2 class="text-base font-semibold text-foreground">
        {{ t("proxyEnhancement.title") }}
      </h2>
      <p class="text-sm text-muted-foreground mt-1">
        {{ t("proxyEnhancement.subtitle") }}
      </p>
    </div>

    <!-- 加载态 -->
    <div v-if="loading" class="space-y-4">
      <div class="space-y-2">
        <Skeleton class="h-4 w-24" />
        <Skeleton class="h-28 w-full rounded-lg" />
      </div>
      <Skeleton class="h-20 w-full rounded-lg" />
      <div class="space-y-2">
        <Skeleton class="h-4 w-20" />
        <Skeleton class="h-28 w-full rounded-lg" />
      </div>
      <div class="space-y-2">
        <Skeleton class="h-4 w-20" />
        <Skeleton class="h-36 w-full rounded-lg" />
      </div>
    </div>

    <!-- 错误态 -->
    <Card v-else-if="loadError">
      <CardContent class="py-8 text-center text-sm text-muted-foreground">
        {{ loadError }}
      </CardContent>
    </Card>

    <!-- 主内容 -->
    <div v-else class="space-y-6">
      <!-- Section 1: 循环检测 -->
      <section>
        <h3 class="text-sm font-medium text-muted-foreground mb-3">
          {{ t("proxyEnhancement.sections.loopDetection") }}
        </h3>
        <Card>
          <CardContent class="divide-y divide-border">
            <ToggleRow
              :title="t('proxyEnhancement.loopDetection.toolRoundLimit.title')"
              :description="
                t('proxyEnhancement.loopDetection.toolRoundLimit.description')
              "
              v-model="toolRoundLimitEnabled"
            />
            <ToggleRow
              :title="t('proxyEnhancement.loopDetection.toolCallLoop.title')"
              :description="
                t('proxyEnhancement.loopDetection.toolCallLoop.description')
              "
              v-model="toolCallLoopEnabled"
            />
            <ToggleRow
              :title="t('proxyEnhancement.loopDetection.streamLoop.title')"
              :description="
                t('proxyEnhancement.loopDetection.streamLoop.description')
              "
              v-model="streamLoopEnabled"
            />
          </CardContent>
        </Card>
      </section>

      <!-- Section 2: 错误处理 -->
      <section>
        <h3 class="text-sm font-medium text-muted-foreground mb-3">
          {{ t("proxyEnhancement.sections.errorHandling") }}
        </h3>
        <Card>
          <CardContent>
            <ToggleRow
              :title="t('proxyEnhancement.toolErrorLogging.title')"
              :description="t('proxyEnhancement.toolErrorLogging.description')"
              v-model="toolErrorLoggingEnabled"
            />
          </CardContent>
        </Card>
      </section>

      <!-- Section 3: 客户端识别 -->
      <section>
        <h3 class="text-sm font-medium text-muted-foreground mb-3">
          {{ t("proxyEnhancement.sections.clientIdentification") }}
        </h3>
        <Card>
          <CardContent class="divide-y divide-border">
            <div
              v-for="(entry, index) in clientSessionHeaders"
              :key="index"
              class="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div class="w-40 shrink-0">
                <Input
                  v-if="entry.persisted"
                  :model-value="entry.client_type"
                  disabled
                  class="h-8 text-xs font-mono"
                />
                <Input
                  v-else
                  v-model="entry.client_type"
                  :placeholder="
                    t('proxyEnhancement.clientIdentification.placeholder.type')
                  "
                  class="h-8 text-xs"
                />
              </div>
              <Input
                v-model="entry.session_header_key"
                :placeholder="
                  t('proxyEnhancement.clientIdentification.placeholder.header')
                "
                class="h-8 text-xs flex-1"
              />
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8 shrink-0"
                :disabled="clientSessionHeaders.length <= 1"
                @click="removeSessionHeaderEntry(index)"
              >
                <Trash2 class="w-4 h-4" />
              </Button>
            </div>
            <div class="pt-3">
              <Button
                variant="outline"
                class="w-full h-8 border-dashed border-muted-foreground/30 hover:border-primary/50 hover:bg-primary/5 text-xs"
                @click="addSessionHeaderEntry"
              >
                <Plus class="w-3.5 h-3.5 mr-1.5" />
                {{ t("proxyEnhancement.clientIdentification.addEntry") }}
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      <!-- Section 4: Token 管理 -->
      <section>
        <h3 class="text-sm font-medium text-muted-foreground mb-3">
          {{ t("proxyEnhancement.sections.tokenManagement") }}
        </h3>
        <div class="space-y-4">
          <!-- Token 预估 -->
          <Card>
            <CardContent>
              <div class="flex items-center justify-between py-1">
                <div class="flex-1 mr-4">
                  <div class="text-sm font-medium">
                    {{ t("proxyEnhancement.tokenEstimation.title") }}
                  </div>
                  <div class="text-xs text-muted-foreground mt-0.5">
                    {{ t("proxyEnhancement.tokenEstimation.shortDescription") }}
                  </div>
                </div>
                <Switch v-model="tokenEstimationEnabled" />
              </div>
              <div class="mt-2">
                <Collapsible v-model:open="tokenEstimationExpanded">
                  <CollapsibleTrigger
                    class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ChevronRight
                      class="w-3 h-3 transition-transform"
                      :class="tokenEstimationExpanded ? 'rotate-90' : ''"
                    />
                    {{ t("proxyEnhancement.tokenEstimation.setupTitle") }}
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div
                      class="mt-2 space-y-1 text-xs text-muted-foreground pl-4"
                    >
                      <p>
                        {{ t("proxyEnhancement.tokenEstimation.claudeCode") }}
                      </p>
                      <p class="whitespace-pre-line">
                        {{ t("proxyEnhancement.tokenEstimation.piExtension") }}
                      </p>
                      <p class="whitespace-pre-line">
                        {{ t("proxyEnhancement.tokenEstimation.piModelsJson") }}
                      </p>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            </CardContent>
          </Card>

          <!-- 上下文溢出重定向（信息卡片，always-on） -->
          <Card>
            <CardContent class="flex items-start gap-3 py-4">
              <Badge variant="secondary" class="shrink-0 mt-0.5">
                {{ t("proxyEnhancement.alwaysOn") }}
              </Badge>
              <div>
                <div class="text-sm font-medium">
                  {{ t("proxyEnhancement.contextOverflow.title") }}
                </div>
                <div class="text-xs text-muted-foreground mt-0.5">
                  {{ t("proxyEnhancement.contextOverflow.description") }}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <!-- Section 5: AI 功能 -->
      <section>
        <h3 class="text-sm font-medium text-muted-foreground mb-3">
          {{ t("proxyEnhancement.sections.aiFeatures") }}
        </h3>
        <div class="space-y-4">
          <!-- AI 重试规则生成 -->
          <Card>
            <CardContent class="py-4">
              <div class="flex items-start gap-3 mb-3">
                <Bot class="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
                <div>
                  <div class="text-sm font-medium">
                    {{ t("proxyEnhancement.aiRetryRuleGen") }}
                  </div>
                  <div class="text-xs text-muted-foreground mt-0.5">
                    {{ t("proxyEnhancement.aiRetryRuleGenDesc") }}
                  </div>
                </div>
              </div>
              <CascadingModelSelect
                :providers="providerGroups"
                :model-value="aiRetryConfig"
                @update:model-value="onAiConfigChange"
              />
            </CardContent>
          </Card>

          <!-- 会话模型状态跟踪（信息卡片，always-on） -->
          <Card>
            <CardContent class="flex items-start gap-3 py-4">
              <Badge variant="secondary" class="shrink-0 mt-0.5">
                {{ t("proxyEnhancement.alwaysOn") }}
              </Badge>
              <div>
                <div class="text-sm font-medium">
                  {{ t("proxyEnhancement.sessionState.title") }}
                </div>
                <div class="text-xs text-muted-foreground mt-0.5">
                  {{ t("proxyEnhancement.sessionState.description") }}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </div>

    <!-- 保存栏：fixed 定位，覆盖 sidebar 右侧全部宽度 -->
    <div
      v-if="!loading && !loadError"
      class="fixed bottom-0 right-0 left-56 border-t bg-card/95 backdrop-blur px-6 py-2.5 flex items-center justify-between z-10"
    >
      <span v-if="isDirty" class="text-sm text-warning">
        {{ t("proxyEnhancement.unsavedChanges") }}
      </span>
      <span v-else />
      <div class="flex gap-3">
        <Button v-if="isDirty" variant="outline" @click="handleCancel">
          {{ t("common.cancel") }}
        </Button>
        <Button :disabled="saving || !isDirty" @click="handleSave">
          <Loader2 v-if="saving" class="w-4 h-4 animate-spin mr-1" />
          {{ saving ? t("common.saving") : t("common.save") }}
        </Button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
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
import { Loader2, Plus, Trash2, Bot, ChevronRight } from "lucide-vue-next";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import CascadingModelSelect from "@/components/mappings/CascadingModelSelect.vue";
import ToggleRow from "@/components/shared/ToggleRow.vue";
import type { ProviderGroup } from "@/components/mappings/cascading-types";
import { toProviderGroups } from "@/composables/useProviderGroups";

const { t } = useI18n();

// --- 状态 ---
const loading = ref(true);
const loadError = ref("");
const saving = ref(false);

const toolRoundLimitEnabled = ref(false);
const toolCallLoopEnabled = ref(false);
const streamLoopEnabled = ref(false);
const toolErrorLoggingEnabled = ref(false);
const tokenEstimationEnabled = ref(false);
const tokenEstimationExpanded = ref(false);

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

// --- 脏状态追踪 ---
interface ConfigSnapshot {
  toolRoundLimit: boolean;
  toolCallLoop: boolean;
  streamLoop: boolean;
  toolErrorLogging: boolean;
  tokenEstimation: boolean;
  aiRetryConfig: { provider_id: string; model: string } | undefined;
  headers: ClientSessionHeaderEntry[];
}

let initialConfig: ConfigSnapshot | null = null;

function snapshot(): ConfigSnapshot {
  return {
    toolRoundLimit: toolRoundLimitEnabled.value,
    toolCallLoop: toolCallLoopEnabled.value,
    streamLoop: streamLoopEnabled.value,
    toolErrorLogging: toolErrorLoggingEnabled.value,
    tokenEstimation: tokenEstimationEnabled.value,
    aiRetryConfig: aiRetryConfig.value ? { ...aiRetryConfig.value } : undefined,
    headers: clientSessionHeaders.value.map((h) => ({
      client_type: h.client_type,
      session_header_key: h.session_header_key,
      persisted: h.persisted,
    })),
  };
}

function isSnapshotEqual(a: ConfigSnapshot, b: ConfigSnapshot): boolean {
  if (
    a.toolRoundLimit !== b.toolRoundLimit ||
    a.toolCallLoop !== b.toolCallLoop ||
    a.streamLoop !== b.streamLoop ||
    a.toolErrorLogging !== b.toolErrorLogging ||
    a.tokenEstimation !== b.tokenEstimation
  )
    return false;
  if (a.aiRetryConfig || b.aiRetryConfig) {
    if (!a.aiRetryConfig || !b.aiRetryConfig) return false;
    if (
      a.aiRetryConfig.provider_id !== b.aiRetryConfig.provider_id ||
      a.aiRetryConfig.model !== b.aiRetryConfig.model
    )
      return false;
  }
  if (a.headers.length !== b.headers.length) return false;
  return a.headers.every(
    (h, i) =>
      h.client_type === b.headers[i].client_type &&
      h.session_header_key === b.headers[i].session_header_key,
  );
}

const isDirty = computed(() => {
  if (!initialConfig) return false;
  return !isSnapshotEqual(initialConfig, snapshot());
});

// --- 数据加载 ---
async function loadProviders() {
  try {
    const providers = await api.getProviders();
    providerGroups.value = toProviderGroups(providers, {
      activeOnly: true,
      defaultContextWindow: 128000,
    });
  } catch (e: unknown) {
    console.error("proxyEnhancement.loadProviders:", e);
    toast.error(t("proxyEnhancement.loadProvidersFailed"));
  }
}

async function loadConfig() {
  try {
    const data = await api.getProxyEnhancement();
    toolRoundLimitEnabled.value = data.tool_round_limit_enabled;
    toolCallLoopEnabled.value = data.tool_call_loop_enabled;
    streamLoopEnabled.value = data.stream_loop_enabled;
    toolErrorLoggingEnabled.value = data.tool_error_logging_enabled;
    aiRetryConfig.value = data.ai_retry_config ?? undefined;

    const [tokenResult, headersResult] = await Promise.allSettled([
      getTokenEstimation(),
      getClientSessionHeaders(),
    ]);
    if (tokenResult.status === "fulfilled") {
      tokenEstimationEnabled.value = tokenResult.value.enabled;
    }
    if (headersResult.status === "fulfilled") {
      clientSessionHeaders.value = headersResult.value.entries.map((e) => ({
        ...e,
        persisted: true,
      }));
    }

    initialConfig = snapshot();
  } catch (e: unknown) {
    console.error("proxyEnhancement.loadConfig:", e);
    loadError.value = getApiMessage(e, t("proxyEnhancement.loadFailed"));
  } finally {
    loading.value = false;
  }
}

// --- 操作 ---
function onAiConfigChange(value: { provider_id: string; model: string }) {
  aiRetryConfig.value = value;
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

function handleCancel() {
  if (!initialConfig) return;
  toolRoundLimitEnabled.value = initialConfig.toolRoundLimit;
  toolCallLoopEnabled.value = initialConfig.toolCallLoop;
  streamLoopEnabled.value = initialConfig.streamLoop;
  toolErrorLoggingEnabled.value = initialConfig.toolErrorLogging;
  tokenEstimationEnabled.value = initialConfig.tokenEstimation;
  aiRetryConfig.value = initialConfig.aiRetryConfig
    ? { ...initialConfig.aiRetryConfig }
    : undefined;
  clientSessionHeaders.value = initialConfig.headers.map((h) => ({ ...h }));
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
    // 保存成功后，将有效条目标记为已持久化（client_type 输入框变为只读）
    for (const entry of clientSessionHeaders.value) {
      if (entry.client_type.trim() && entry.session_header_key.trim()) {
        entry.persisted = true;
      }
    }
    toast.success(t("common.saveSuccess"));
    initialConfig = snapshot();
  } catch (e: unknown) {
    console.error("proxyEnhancement.handleSave:", e);
    toast.error(getApiMessage(e, t("proxyEnhancement.saveFailed")));
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  loadConfig();
  loadProviders();
});
</script>
