<template>
  <div class="p-6 space-y-4 pb-20">
    <!-- Row 1: Client Selection -->
    <Card class="ring-0">
      <CardHeader class="pb-3">
        <div class="flex items-center justify-between">
          <CardTitle class="text-sm font-medium">{{
            t("quickSetup.client.selectClient")
          }}</CardTitle>
          <Badge
            v-if="clientType"
            variant="outline"
            class="text-[10px] px-1.5 py-0 leading-none border-green-500/30 bg-green-500/10 text-green-500"
          >
            <Check class="size-2.5 mr-0.5 stroke-[3]" />
            {{ t("common.selected") }}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div class="flex gap-2 flex-wrap">
          <Button
            v-for="c in CLIENTS"
            :key="c.id"
            variant="outline"
            class="flex h-auto items-center gap-2.5 px-4 py-2.5 text-sm transition-all cursor-pointer"
            :class="
              clientType === c.id
                ? 'border-primary bg-primary/12 text-primary ring-1 ring-primary/30'
                : 'border-border hover:border-muted-foreground/30 text-muted-foreground hover:text-foreground'
            "
            @click="selectClient(c.id)"
          >
            <div
              class="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold text-white"
              :class="c.brandBg"
            >
              {{ c.icon }}
            </div>
            <div class="text-left">
              <div
                class="font-medium text-sm leading-tight flex items-center gap-1.5"
              >
                {{ c.name }}
                <Badge
                  v-if="c.popular"
                  class="text-[9px] px-1 py-0 leading-none bg-primary/15 text-primary font-medium"
                >
                  {{ t("quickSetup.client.popular") }}
                </Badge>
              </div>
              <div class="text-[10px] opacity-60 leading-tight">
                {{ c.format }} · {{ t(c.descriptionKey) }}
              </div>
            </div>
          </Button>
        </div>
        <!-- Info bar: auto-map description -->
        <div
          v-if="clientType"
          class="mt-2.5 px-3 py-2 rounded-r-md bg-primary/8 border-l-[3px] border-l-primary text-[11px] text-muted-foreground flex items-start gap-1.5"
        >
          <Info class="size-3.5 shrink-0 text-primary mt-px" />
          <span>{{
            t("quickSetup.client.infoBar", {
              client: currentClient?.name ?? clientType,
              format:
                currentClient?.format === "anthropic"
                  ? "Anthropic Messages API"
                  : currentClient?.format === "openai-responses"
                    ? "OpenAI Responses API"
                    : "OpenAI Chat API",
              models: defaultModelsLabel,
            })
          }}</span>
        </div>
      </CardContent>
    </Card>

    <!-- Row 2a: Provider Connection -->
    <Card class="ring-0">
      <CardHeader class="pb-3">
        <div class="flex items-center justify-between">
          <CardTitle class="text-sm font-medium">Provider Connection</CardTitle>
          <span
            v-if="selectedGroup"
            class="text-[10px] text-muted-foreground/50 flex items-center gap-1"
          >
            <Sparkles class="size-3 text-muted-foreground/50" />
            {{ t("quickSetup.provider.autoConfigured") }}
          </span>
        </div>
      </CardHeader>
      <CardContent class="space-y-3">
        <!-- Group: Provider -->
        <div
          class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-1.5"
        >
          {{ t("quickSetup.provider.groupLabel") }}
        </div>
        <div class="flex items-end gap-2">
          <div class="w-40 space-y-1">
            <Label class="text-xs text-muted-foreground">{{
              t("quickSetup.provider.label")
            }}</Label>
            <Select
              :model-value="selectedGroup"
              @update:model-value="
                (v: unknown) => onProviderChange(v as string)
              "
            >
              <SelectTrigger class="w-full text-xs data-[size=default]:h-7"
                ><SelectValue :placeholder="t('quickSetup.provider.select')"
              /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__custom__">{{
                  t("quickSetup.provider.custom")
                }}</SelectItem>
                <SelectItem
                  v-for="g in providerGroups"
                  :key="g.group"
                  :value="g.group"
                  >{{ g.group }}</SelectItem
                >
              </SelectContent>
            </Select>
          </div>
          <!-- Custom mode: no extra fields here, Format/BaseURL are in Endpoint group -->
          <template v-if="isCustomProvider"> </template>
          <!-- Preset mode: plan selector -->
          <template v-else>
            <div class="w-28 space-y-1">
              <Label class="text-xs text-muted-foreground">{{
                t("quickSetup.provider.plan")
              }}</Label>
              <Select
                :model-value="selectedPlan"
                @update:model-value="(v: unknown) => onPlanChange(v as string)"
              >
                <SelectTrigger class="w-full text-xs data-[size=default]:h-7"
                  ><SelectValue :placeholder="t('quickSetup.provider.select')"
                /></SelectTrigger>
                <SelectContent>
                  <SelectItem
                    v-for="p in availablePlans"
                    :key="p.plan"
                    :value="p.plan"
                    >{{ p.plan }}</SelectItem
                  >
                </SelectContent>
              </Select>
            </div>
          </template>
        </div>

        <!-- Group: Endpoint -->
        <div
          class="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-1.5 mt-1"
        >
          {{ t("quickSetup.provider.endpoint") }}
        </div>
        <div class="flex items-end gap-2">
          <div class="w-48 space-y-1">
            <Label class="text-xs text-muted-foreground">{{
              t("quickSetup.provider.format")
            }}</Label>
            <Select v-model="apiType">
              <SelectTrigger class="w-full text-xs data-[size=default]:h-7"
                ><SelectValue
              /></SelectTrigger>
              <SelectContent>
                <SelectItem value="anthropic">Anthropic Messages</SelectItem>
                <SelectItem value="openai">OpenAI Chat Completions</SelectItem>
                <SelectItem value="openai-responses"
                  >OpenAI Responses</SelectItem
                >
              </SelectContent>
            </Select>
          </div>
          <template v-if="isCustomProvider">
            <div class="w-80 space-y-1">
              <Label class="text-xs text-muted-foreground">{{
                t("quickSetup.provider.baseUrl")
              }}</Label>
              <Input
                v-model="customBaseUrl"
                placeholder="https://api.example.com/v1"
                class="font-mono md:text-xs h-7"
              />
            </div>
            <div class="w-48 space-y-1">
              <Label class="text-xs text-muted-foreground">{{
                t("quickSetup.provider.upstreamPath")
              }}</Label>
              <Input
                v-model="customUpstreamPath"
                placeholder="/v1/chat/completions"
                class="font-mono md:text-xs h-7"
              />
            </div>
          </template>
          <template v-else>
            <div class="w-72 space-y-1">
              <Label class="text-xs text-muted-foreground">{{
                t("quickSetup.provider.baseUrl")
              }}</Label>
              <Input
                v-model="presetBaseUrl"
                placeholder="https://api.example.com/v1"
                class="font-mono md:text-xs h-7"
              />
            </div>
            <div class="w-48 space-y-1">
              <Label class="text-xs text-muted-foreground">{{
                t("quickSetup.provider.upstreamPath")
              }}</Label>
              <Input
                v-model="presetUpstreamPath"
                placeholder="/v1/chat/completions"
                class="font-mono md:text-xs h-7"
              />
            </div>
          </template>
          <div class="w-64 space-y-1">
            <Label class="text-xs text-muted-foreground">{{
              t("quickSetup.provider.apiKey")
            }}</Label>
            <Input
              v-model="apiKey"
              type="password"
              :placeholder="t('quickSetup.provider.apiKeyPlaceholder')"
              class="md:text-xs h-7"
            />
          </div>
          <div class="shrink-0 space-y-1">
            <Label class="text-xs text-muted-foreground invisible">{{
              t("quickSetup.provider.connect")
            }}</Label>
            <Button
              variant="outline"
              size="sm"
              :disabled="connectionStatus === 'testing'"
              :class="
                connectionStatus === 'ok'
                  ? 'border-green-500/50 text-green-500'
                  : ''
              "
              @click="testConnection"
            >
              <template v-if="connectionStatus === 'testing'">
                <svg
                  class="w-3.5 h-3.5 mr-1 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    class="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    stroke-width="4"
                  />
                  <path
                    class="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                {{ t("quickSetup.provider.testing") }}
              </template>
              <template v-else-if="connectionStatus === 'ok'">
                <CheckCircle2 class="size-3.5 mr-1" />
                {{ t("quickSetup.provider.connected") }}
              </template>
              <template v-else>{{ t("quickSetup.provider.test") }}</template>
            </Button>
          </div>
        </div>

        <!-- Concurrency Control -->
        <div class="border-t border-border pt-3">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-medium text-muted-foreground">{{
              t("quickSetup.concurrency.control")
            }}</span>
            <Badge
              variant="outline"
              class="text-[9px] px-1 py-0 leading-none text-muted-foreground/50"
            >
              {{ t("quickSetup.concurrency.optional") }}
            </Badge>
          </div>
          <ConcurrencyControl
            :mode="concurrencyMode"
            :max-concurrency="maxConcurrency"
            :queue-timeout-ms="queueTimeoutMs"
            :max-queue-size="maxQueueSize"
            @update:mode="onConcurrencyModeChange"
            @update:max-concurrency="maxConcurrency = $event"
            @update:queue-timeout-ms="queueTimeoutMs = $event"
            @update:max-queue-size="maxQueueSize = $event"
          />
        </div>
      </CardContent>
    </Card>

    <!-- Row 2b: Model Configuration -->
    <Card class="ring-0">
      <CardHeader class="pb-3">
        <div class="flex items-center justify-between">
          <CardTitle class="text-sm font-medium">{{
            t("quickSetup.model.config")
          }}</CardTitle>
          <Badge variant="secondary" class="text-[10px]"
            >{{ enabledModelCount }}/{{ modelConfigs.length }}</Badge
          >
        </div>
      </CardHeader>
      <CardContent>
        <p
          v-if="modelConfigs.length === 0"
          class="py-4 text-center text-xs text-muted-foreground"
        >
          {{ t("quickSetup.model.selectProviderFirst") }}
        </p>
        <div
          v-else
          class="flex flex-col gap-px bg-border rounded-lg overflow-hidden"
        >
          <ModelCard
            v-for="(model, index) in modelConfigs"
            :key="model.name"
            :model="model"
            :api-type="apiType"
            :is-deep-seek="model.name.toLowerCase().includes('deepseek')"
            :is-non-openai-endpoint="isNonOpenaiEndpoint"
            :capabilities="model.capabilities ?? ['text']"
            :stream-timeout-ms="model.stream_timeout_ms ?? undefined"
            @update:model="updateModel(index, $event)"
            @remove="removeModel(index)"
            @update:stream-timeout-ms="updateModelTimeout(index, $event)"
            @toggle-capability="
              (cap: string) => toggleModelCapability(index, cap)
            "
          />
        </div>
        <!-- Custom mode: add model input -->
        <div v-if="isCustomProvider" class="flex gap-2 mt-2">
          <Input
            v-model="customModelInput"
            :placeholder="t('quickSetup.model.namePlaceholder')"
            @keydown.enter.prevent="handleAddCustomModel"
            class="flex-1 md:text-xs h-7"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            @click="handleAddCustomModel"
            :disabled="!customModelInput.trim()"
            >{{ t("common.add") }}</Button
          >
        </div>

        <!-- Transform Rules (collapsible) -->
        <div class="border-t border-border pt-3 mt-3">
          <button
            type="button"
            class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground w-full text-left hover:text-foreground transition-colors"
            @click="showTransformRules = !showTransformRules"
          >
            <ChevronRight
              class="size-3 transition-transform"
              :class="showTransformRules ? 'rotate-90' : ''"
            />
            {{ t("quickSetup.transform.title") }}
            <Badge
              variant="outline"
              class="text-[9px] px-1 py-0 leading-none text-muted-foreground/50"
            >
              {{ t("quickSetup.transform.optional") }}
            </Badge>
          </button>
          <div v-if="showTransformRules" class="mt-2">
            <TransformRulesForm
              :inject-headers="transformInjectHeaders"
              :drop-fields="transformDropFields"
              :request-defaults="transformRequestDefaults"
              @update:inject-headers="transformInjectHeaders = $event"
              @update:drop-fields="transformDropFields = $event"
              @update:request-defaults="transformRequestDefaults = $event"
            />
          </div>
        </div>
      </CardContent>
    </Card>

    <!-- Row 3: Mappings + Retry rules -->
    <div class="grid grid-cols-5 gap-4">
      <!-- Left: Mappings -->
      <Card class="col-span-3 ring-0">
        <CardHeader class="pb-3">
          <div class="flex items-center justify-between">
            <CardTitle class="text-sm font-medium">{{
              t("quickSetup.mapping.title")
            }}</CardTitle>
            <Badge variant="secondary" class="text-[10px]">{{
              t("quickSetup.mapping.count", { count: mappingEntries.length })
            }}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <QuickSetupMappingList
            :entries="mappingEntries"
            :provider-groups="allProviderGroups"
            @update:targets="updateMappingTargets"
            @update:multimodal-fallback="updateMappingMultimodalFallback"
            @update:client-model="updateMappingClientModel"
            @toggle-active="toggleMappingActive"
            @add="addMappingEntry"
            @remove="removeMappingEntry"
          />
        </CardContent>
      </Card>

      <!-- Right: Retry Rules + Transform Rules -->
      <div class="col-span-2 space-y-4">
        <Card class="ring-0">
          <CardHeader class="pb-3">
            <div class="flex items-center justify-between">
              <CardTitle class="text-sm font-medium">{{
                t("quickSetup.retry.title")
              }}</CardTitle>
              <Badge variant="secondary" class="text-[10px]">{{
                t("quickSetup.retry.selectedCount", {
                  count:
                    recommendedRules.filter((r) => r.exists).length +
                    selectedRetryRules.size,
                })
              }}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div
              v-if="recommendedRules.length === 0"
              class="py-6 text-center text-xs text-muted-foreground"
            >
              <template v-if="allRecommendedRules.length === 0">
                {{ t("quickSetup.retry.allCreated") }}
              </template>
              <template v-else>
                {{ t("quickSetup.retry.selectProviderFirst") }}
              </template>
            </div>
            <div v-else class="space-y-1.5 max-h-[320px] overflow-y-auto">
              <!-- Select all -->
              <div
                v-if="recommendedRules.some((r) => !r.exists)"
                class="flex items-center gap-2.5 pb-1 border-b border-border"
              >
                <Checkbox
                  :model-value="
                    recommendedRules
                      .filter((r) => !r.exists)
                      .every((r) => selectedRetryRules.has(r.name))
                      ? true
                      : recommendedRules.some(
                            (r) => !r.exists && selectedRetryRules.has(r.name),
                          )
                        ? 'indeterminate'
                        : false
                  "
                  class="mt-0.5"
                  @update:model-value="
                    (val: boolean | 'indeterminate') => {
                      const checked = val === true;
                      setAllRetryRules(
                        recommendedRules
                          .filter((r) => !r.exists)
                          .map((r) => r.name),
                        checked,
                      );
                    }
                  "
                />
                <span class="text-xs font-medium text-muted-foreground">{{
                  t("common.selectAll")
                }}</span>
              </div>
              <div
                v-for="rule in recommendedRules"
                :key="rule.name"
                class="flex items-start gap-2.5 rounded-md transition-colors"
                :class="
                  rule.exists
                    ? 'opacity-60 cursor-default p-2'
                    : 'hover:bg-muted/50 cursor-pointer p-2'
                "
                @click="
                  !rule.exists &&
                  toggleRetryRule(rule.name, !selectedRetryRules.has(rule.name))
                "
              >
                <Checkbox
                  :model-value="
                    rule.exists ? true : selectedRetryRules.has(rule.name)
                  "
                  :disabled="rule.exists"
                  class="mt-0.5"
                  @update:model-value="
                    (val: boolean | 'indeterminate') =>
                      toggleRetryRule(rule.name, val === true)
                  "
                  @click.stop
                />
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-1.5">
                    <span class="text-xs font-medium">{{ rule.name }}</span>
                    <Badge
                      v-if="rule.exists"
                      variant="secondary"
                      class="text-[9px] px-1.5 py-0 leading-none bg-muted text-muted-foreground"
                      >{{ t("quickSetup.retry.configured") }}</Badge
                    >
                  </div>
                  <div class="text-[10px] text-muted-foreground mt-0.5">
                    {{ rule.status_code }} ·
                    {{
                      rule.retry_strategy === "fixed"
                        ? t("quickSetup.retry.fixed")
                        : t("quickSetup.retry.exponential")
                    }}
                    · {{ rule.retry_delay_ms / 1000 }}s · {{ rule.max_retries
                    }}{{ t("quickSetup.retry.times") }}
                  </div>
                </div>
                <!-- Provider dropdown for rules with provider binding -->
                <div
                  v-if="
                    !rule.exists && rule.providers && rule.providers.length > 0
                  "
                  class="shrink-0"
                  @click.stop
                >
                  <Select
                    :model-value="retryProviderMap.get(rule.name) ?? 'general'"
                    @update:model-value="
                      (v: unknown) => setRetryProvider(rule.name, v as string)
                    "
                  >
                    <SelectTrigger class="h-6 text-[10px] px-2 py-0 gap-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="general">{{
                        t("quickSetup.retry.general")
                      }}</SelectItem>
                      <SelectItem
                        v-for="p in rule.providers"
                        :key="p"
                        :value="p"
                        >{{ p }}</SelectItem
                      >
                    </SelectContent>
                  </Select>
                </div>
                <Badge
                  v-else-if="!rule.exists"
                  variant="secondary"
                  class="text-[9px] px-1 py-0 leading-none shrink-0 mt-0.5"
                  >{{ t("quickSetup.retry.general") }}</Badge
                >
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  </div>

  <!-- Submit bar -->
  <div
    class="fixed bottom-0 right-0 left-56 border-t bg-card/95 backdrop-blur px-6 py-2.5 flex items-center justify-between z-10"
  >
    <div
      class="text-xs text-muted-foreground flex items-center gap-1.5 font-mono"
    >
      <template v-if="clientType">
        <span class="text-foreground/80">{{ clientTypeLabel }}</span>
      </template>
      <template v-if="selectedGroup">
        <span class="text-muted-foreground/40">→</span>
        <span
          class="text-[11px] px-2 py-0.5 rounded bg-primary/8 text-primary font-medium"
          >{{
            isCustomProvider ? t("quickSetup.provider.custom") : selectedGroup
          }}</span
        >
        <template v-if="selectedPlan">
          <span class="text-muted-foreground/40">/</span>
          <span class="text-foreground/80">{{ selectedPlan }}</span>
        </template>
      </template>
      <span class="text-muted-foreground/40">·</span>
      <span>{{
        t("quickSetup.footer.models", { count: enabledModelCount })
      }}</span>
      <span class="text-muted-foreground/40">·</span>
      <span>{{
        t("quickSetup.footer.mappings", { count: mappingEntries.length })
      }}</span>
      <span class="text-muted-foreground/40">·</span>
      <span>{{
        t("quickSetup.footer.rules", {
          count:
            selectedRetryRules.size +
            recommendedRules.filter((r) => r.exists).length,
        })
      }}</span>
    </div>
    <div class="flex items-center gap-2">
      <!-- Validation status indicator -->
      <div
        v-if="validationState === 'valid'"
        class="flex items-center gap-1 text-[11px] text-primary"
      >
        <CheckCircle2 class="size-3.5" />
        <span class="font-medium">{{ t("quickSetup.footer.validated") }}</span>
      </div>
      <div
        v-else-if="validationState === 'invalid'"
        class="flex items-center gap-1 text-[11px] text-destructive/70"
      >
        <AlertCircle class="size-3.5" />
        <span>{{ t("quickSetup.footer.invalid") }}</span>
      </div>
      <Button size="sm" variant="outline" @click="validateConfig">{{
        t("quickSetup.footer.validate")
      }}</Button>
      <Button size="sm" :disabled="saving" @click="submit">
        <template v-if="saving">
          <svg
            class="w-3.5 h-3.5 mr-1 animate-spin"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              class="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              stroke-width="4"
            />
            <path
              class="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          {{ t("quickSetup.footer.saving") }}
        </template>
        <template v-else>{{ t("quickSetup.footer.saveConfig") }}</template>
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { useQuickSetup } from "@/composables/useQuickSetup";
import ModelCard from "@/components/quick-setup/ModelCard.vue";
import QuickSetupMappingList from "@/components/shared/QuickSetupMappingList.vue";
import ConcurrencyControl from "@/components/shared/ConcurrencyControl.vue";
import TransformRulesForm from "@/components/shared/TransformRulesForm.vue";
import type { ModelConfig } from "@/components/quick-setup/types";
import {
  CLIENTS,
  DEFAULT_CLIENT_MAPPINGS,
} from "@/components/quick-setup/types";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Info,
  Sparkles,
  ChevronRight,
  Check,
  CheckCircle2,
  AlertCircle,
} from "lucide-vue-next";

const { t } = useI18n();

const {
  clientType,
  currentClient,
  providerGroups,
  selectedGroup,
  selectedPlan,
  apiType,
  apiKey,
  modelConfigs,
  mappingEntries,
  allRecommendedRules,
  recommendedRules,
  selectedRetryRules,
  retryProviderMap,
  saving,
  connectionStatus,
  availablePlans,
  isNonOpenaiEndpoint,
  isCustomProvider,
  customBaseUrl,
  presetBaseUrl,
  customUpstreamPath,
  presetUpstreamPath,
  concurrencyMode,
  maxConcurrency,
  queueTimeoutMs,
  maxQueueSize,
  allProviderGroups,
  transformInjectHeaders,
  transformDropFields,
  transformRequestDefaults,
  selectClient,
  onProviderChange,
  onPlanChange,
  updateMappingTargets,
  updateMappingMultimodalFallback,
  updateMappingClientModel,
  toggleMappingActive,
  addMappingEntry,
  removeMappingEntry,
  toggleRetryRule,
  setAllRetryRules,
  setRetryProvider,
  onConcurrencyModeChange,
  testConnection,
  submit,
  addCustomModel,
} = useQuickSetup();

const customModelInput = ref("");
const showTransformRules = ref(false);
const validationState = ref<"idle" | "valid" | "invalid">("idle");

function handleAddCustomModel() {
  if (!customModelInput.value.trim()) return;
  addCustomModel(customModelInput.value.trim());
  customModelInput.value = "";
}

const enabledModelCount = computed(
  () => modelConfigs.value.filter((m) => m.enabled).length,
);
const clientTypeLabel = computed(
  () =>
    CLIENTS.find((c) => c.id === clientType.value)?.name ?? clientType.value,
);

const defaultModelsLabel = computed(() => {
  const models = clientType.value
    ? DEFAULT_CLIENT_MAPPINGS[clientType.value]
    : undefined;
  return models ? models.join(", ") : "";
});

function updateModel(index: number, updated: ModelConfig) {
  const next = [...modelConfigs.value];
  next[index] = updated;
  modelConfigs.value = next;
}

function removeModel(index: number) {
  modelConfigs.value = modelConfigs.value.filter((_, i) => i !== index);
}

function updateModelTimeout(index: number, ms: number | undefined) {
  const next = [...modelConfigs.value];
  next[index] = { ...next[index], stream_timeout_ms: ms || undefined };
  modelConfigs.value = next;
}

function toggleModelCapability(index: number, capability: string) {
  const next = [...modelConfigs.value];
  const model = { ...next[index] };
  const caps = model.capabilities ?? ["text"];
  if (caps.includes(capability)) {
    model.capabilities = caps.filter((c) => c !== capability);
  } else {
    model.capabilities = [...caps, capability];
  }
  next[index] = model;
  modelConfigs.value = next;
}

function validateConfig() {
  if (!selectedGroup.value) {
    validationState.value = "invalid";
    toast.error(t("quickSetup.messages.selectProvider"));
    return;
  }
  if (!apiKey.value.trim()) {
    validationState.value = "invalid";
    toast.error(t("quickSetup.messages.fillApiKey"));
    return;
  }
  if (enabledModelCount.value === 0) {
    validationState.value = "invalid";
    toast.error(t("quickSetup.messages.enableOneModel"));
    return;
  }
  validationState.value = "valid";
  toast.success(t("quickSetup.messages.validationPassed"));
}
</script>
