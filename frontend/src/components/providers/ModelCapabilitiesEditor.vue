<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { ChevronRight, RotateCw } from "lucide-vue-next";
import ModelCard from "@/components/quick-setup/ModelCard.vue";
import TransformRulesForm from "@/components/shared/TransformRulesForm.vue";
import ProxyConfigForm from "@/components/shared/ProxyConfigForm.vue";
import { CONTEXT_WINDOW_OPTIONS } from "@/composables/useProviderForm";
import type { ConcurrencyMode } from "@/types/concurrency";
import type { ModelInfo } from "@/types/mapping";
import type { ModelConfig } from "@/components/quick-setup/types";

const { t } = useI18n();

const advancedOpen = ref(false);

// new model presets
const newCapabilities = ref<string[]>(["text"]);

const capabilityIcons = [
  { key: "text", icon: "T", label: "text" },
  { key: "image", icon: "IMG", label: "image" },
  { key: "audio", icon: "AUD", label: "audio" },
  { key: "video", icon: "VID", label: "video" },
] as const;

function toggleNewCapability(key: string) {
  if (key === "text") return;
  const caps = newCapabilities.value;
  newCapabilities.value = caps.includes(key)
    ? caps.filter((c) => c !== key)
    : [...caps, key];
}

function handleAddModel() {
  emit("add-model", [...newCapabilities.value]);
  newCapabilities.value = ["text"];
}

const props = defineProps<{
  // Form fields
  name: string;
  apiType: string;
  baseUrl: string;
  apiKey: string;
  upstreamPath: string;
  proxyType: string;
  proxyUrl: string;
  proxyUsername: string;
  proxyPassword: string;
  errorsName: string;
  errorsBaseUrl: string;
  errorsApiKey: string;
  editingId: string | null;
  // Model capabilities
  models: ModelInfo[];
  fetchingModels: boolean;
  modelInput: string;
  contextWindowSelect: string;
  hasModelsEndpoint: boolean;
  presetGroup: string;
  hasApiKey: boolean;
  // Concurrency
  concurrencyMode: ConcurrencyMode;
  maxConcurrency: number;
  queueTimeoutMs: number;
  maxQueueSize: number;
  // Transform
  transformInjectHeaders: string;
  transformDropFields: string;
  transformRequestDefaults: string;
}>();

const emit = defineEmits<{
  // Form fields
  "update:name": [value: string];
  "update:api-type": [value: string];
  "update:base-url": [value: string];
  "update:api-key": [value: string];
  "update:upstream-path": [value: string];
  "update:proxy-type": [value: string];
  "update:proxy-url": [value: string];
  "update:proxy-username": [value: string];
  "update:proxy-password": [value: string];
  "clear-errors": [field: string];
  // Model capabilities
  "update:model": [index: number, event: ModelConfig];
  "remove-model": [index: number];
  "update:model-timeout": [index: number, value: string | number];
  "toggle-model-capability": [index: number, capability: string];
  "fetch-upstream-models": [];
  "add-model": [caps: string[]];
  "update:model-input": [value: string];
  "update:context-window-select": [value: string];
  // Concurrency
  "update:concurrency-mode": [value: ConcurrencyMode];
  "update:max-concurrency": [value: number];
  "update:queue-timeout-ms": [value: number];
  "update:max-queue-size": [value: number];
  // Transform
  "update:inject-headers": [value: string];
  "update:drop-fields": [value: string];
  "update:request-defaults": [value: string];
  // Proxy clear
  "clear-proxy": [];
}>();

function modelCapabilities(m: { capabilities?: string[] }): string[] {
  return m.capabilities ?? ["text"];
}

function isOfficialOpenai(url: string): boolean {
  return url.includes("api.openai.com");
}
</script>

<template>
  <!-- Section 1: Connection -->
  <div class="bg-card border-input border rounded-lg p-5 mb-4">
    <div
      class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-4 pb-2.5 border-b border-input"
    >
      {{ t("providers.fields.connectionSection") }}
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div>
        <Label class="text-xs text-muted-foreground">{{
          t("providers.fields.name")
        }}</Label>
        <Input
          :model-value="props.name"
          type="text"
          required
          class="mt-1"
          @update:model-value="emit('update:name', String($event))"
          @input="emit('clear-errors', 'name')"
        />
        <p v-if="props.errorsName" class="text-xs text-destructive mt-0.5">
          {{ props.errorsName }}
        </p>
      </div>
      <div>
        <Label class="text-xs text-muted-foreground">{{
          t("providers.fields.apiType")
        }}</Label>
        <Select
          :model-value="props.apiType"
          @update:model-value="emit('update:api-type', String($event))"
          class="mt-1"
        >
          <SelectTrigger
            ><SelectValue :placeholder="t('common.pleaseSelect')"
          /></SelectTrigger>
          <SelectContent>
            <SelectItem value="openai">OpenAI Chat Completions</SelectItem>
            <SelectItem value="openai-responses">OpenAI Responses</SelectItem>
            <SelectItem value="anthropic">Anthropic Messages</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label class="text-xs text-muted-foreground">{{
          t("providers.fields.baseUrl")
        }}</Label>
        <Input
          :model-value="props.baseUrl"
          type="url"
          required
          class="mt-1 font-mono text-xs"
          @update:model-value="emit('update:base-url', String($event))"
          @input="emit('clear-errors', 'base_url')"
        />
        <p v-if="props.errorsBaseUrl" class="text-xs text-destructive mt-0.5">
          {{ props.errorsBaseUrl }}
        </p>
      </div>
      <div>
        <Label class="text-xs text-muted-foreground">{{
          t("providers.fields.apiKey")
        }}</Label>
        <Input
          :model-value="props.apiKey"
          type="text"
          :required="!props.editingId"
          :placeholder="
            props.editingId ? t('providers.fields.apiKeyPlaceholder') : ''
          "
          class="mt-1"
          @update:model-value="emit('update:api-key', String($event))"
          @input="emit('clear-errors', 'api_key')"
        />
        <p v-if="props.errorsApiKey" class="text-xs text-destructive mt-0.5">
          {{ props.errorsApiKey }}
        </p>
      </div>
    </div>
    <div class="mt-3">
      <Label class="text-xs">{{ t("providers.fields.upstreamPath") }}</Label>
      <Input
        :model-value="props.upstreamPath"
        :placeholder="t('providers.fields.upstreamPathPlaceholder')"
        class="mt-1 font-mono text-xs"
        @update:model-value="emit('update:upstream-path', String($event))"
      />
      <p class="text-xs text-muted-foreground mt-0.5">
        {{ t("providers.fields.upstreamPathHint") }}
      </p>
    </div>
  </div>

  <!-- Section 2: Models -->
  <div class="bg-card border-input border rounded-lg p-5 mb-4">
    <div
      class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-4 pb-2.5 border-b border-input"
    >
      {{ t("providers.fields.modelsSection") }}
    </div>
    <div>
      <div class="flex items-center justify-between mb-2">
        <Label class="text-xs text-muted-foreground">{{
          t("providers.fields.availableModels")
        }}</Label>
        <Button
          v-if="
            !props.editingId &&
            props.presetGroup &&
            props.presetGroup !== '__custom__' &&
            (props.hasApiKey || !props.hasModelsEndpoint)
          "
          type="button"
          variant="outline"
          size="sm"
          class="text-xs"
          :disabled="props.fetchingModels"
          @click="emit('fetch-upstream-models')"
        >
          <RotateCw
            class="w-3 h-3 mr-1"
            :class="{ 'animate-spin': props.fetchingModels }"
          />
          {{
            props.fetchingModels
              ? t("providers.fetchModels.loading")
              : props.hasModelsEndpoint
                ? t("providers.fetchModels.button")
                : t("providers.fetchModels.buttonPreset")
          }}
        </Button>
      </div>
      <div class="grid grid-cols-1 gap-2 mb-3">
        <div v-for="(m, i) in props.models" :key="i">
          <ModelCard
            :model="{
              name: m.name,
              contextWindow: m.context_window ?? 200000,
              enabled: true,
              patches: m.patches ?? [],
            }"
            :api-type="props.apiType"
            :is-deep-seek="m.name.toLowerCase().includes('deepseek')"
            :is-non-openai-endpoint="!isOfficialOpenai(props.baseUrl)"
            :stream-timeout-ms="m.stream_timeout_ms ?? undefined"
            :capabilities="modelCapabilities(m)"
            @update:model="emit('update:model', i, $event)"
            @remove="emit('remove-model', i)"
            @update:stream-timeout-ms="
              emit(
                'update:model-timeout',
                i,
                String($event ? Math.round($event / 1000) : ''),
              )
            "
            @toggle-capability="
              (cap: string) => emit('toggle-model-capability', i, cap)
            "
          />
        </div>
      </div>
      <div class="flex gap-2 items-center">
        <Input
          :model-value="props.modelInput"
          @update:model-value="emit('update:model-input', String($event))"
          :placeholder="t('providers.fields.modelInputPlaceholder')"
          @keydown.enter.prevent="handleAddModel"
          class="flex-1"
        />
        <Select
          :model-value="props.contextWindowSelect"
          @update:model-value="
            emit('update:context-window-select', String($event))
          "
        >
          <SelectTrigger class="w-28"
            ><SelectValue :placeholder="t('providers.fields.context')"
          /></SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="opt in CONTEXT_WINDOW_OPTIONS"
              :key="opt.value"
              :value="opt.value"
              >{{ opt.label }}</SelectItem
            >
          </SelectContent>
        </Select>
        <!-- Capabilities -->
        <div class="flex items-center gap-0.5 shrink-0">
          <Button
            v-for="cap in capabilityIcons"
            :key="cap.key"
            type="button"
            variant="outline"
            size="icon"
            class="w-6 h-6 text-[11px] font-medium"
            :class="
              newCapabilities.includes(cap.key)
                ? 'border-primary/30 text-primary bg-primary/10'
                : 'text-muted-foreground/40 hover:text-muted-foreground border-input'
            "
            :title="cap.label"
            @click="toggleNewCapability(cap.key)"
          >
            {{ cap.icon }}
          </Button>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          @click="handleAddModel"
          :disabled="!props.modelInput.trim()"
          >{{ t("providers.fields.addModel") }}</Button
        >
      </div>
    </div>
  </div>

  <!-- Section 3: Advanced (collapsible, default closed) -->
  <div class="bg-card border-input border rounded-lg overflow-hidden mb-4">
    <Button
      type="button"
      variant="ghost"
      class="w-full flex items-center gap-2 px-5 py-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground"
      @click="advancedOpen = !advancedOpen"
    >
      <ChevronRight
        class="w-3 h-3 transition-transform duration-150"
        :class="advancedOpen ? 'rotate-90' : ''"
      />
      {{ t("providers.fields.advancedSection") }}
    </Button>
    <div v-if="advancedOpen" class="px-5 pb-5">
      <div class="border-t border-input pt-4 space-y-4">
        <!-- Concurrency -->
        <div class="grid grid-cols-3 gap-3">
          <div>
            <Label class="text-xs text-muted-foreground">{{
              t("providers.concurrency.mode")
            }}</Label>
            <Select
              :model-value="props.concurrencyMode"
              @update:model-value="
                emit('update:concurrency-mode', $event as ConcurrencyMode)
              "
              class="mt-1"
            >
              <SelectTrigger class="h-8 text-[13px]">
                <SelectValue
                  :placeholder="t('providers.concurrency.selectMode')"
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{{
                  t("providers.concurrency.autoAdaptive")
                }}</SelectItem>
                <SelectItem value="manual">{{
                  t("providers.concurrency.manual")
                }}</SelectItem>
                <SelectItem value="none">{{
                  t("providers.concurrency.none")
                }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label class="text-xs text-muted-foreground">{{
              t("providers.concurrency.maxConcurrency")
            }}</Label>
            <Input
              :model-value="String(props.maxConcurrency)"
              type="number"
              class="mt-1"
              @update:model-value="
                emit('update:max-concurrency', Number($event))
              "
            />
          </div>
          <div>
            <Label class="text-xs text-muted-foreground">{{
              t("providers.concurrency.queueTimeout")
            }}</Label>
            <Input
              :model-value="String(props.queueTimeoutMs)"
              type="number"
              class="mt-1"
              @update:model-value="
                emit('update:queue-timeout-ms', Number($event))
              "
            />
          </div>
        </div>
        <!-- Proxy -->
        <ProxyConfigForm
          :proxy-type="props.proxyType"
          :proxy-url="props.proxyUrl"
          :proxy-username="props.proxyUsername"
          :proxy-password="props.proxyPassword"
          @update:proxy-type="emit('update:proxy-type', $event)"
          @update:proxy-url="emit('update:proxy-url', $event)"
          @update:proxy-username="emit('update:proxy-username', $event)"
          @update:proxy-password="emit('update:proxy-password', $event)"
          @clear="emit('clear-proxy')"
        />
        <!-- Transform Rules -->
        <div class="border border-input rounded-md p-3 space-y-3">
          <div class="text-xs font-medium text-muted-foreground">
            {{ t("providers.transform.title") }}
          </div>
          <TransformRulesForm
            :inject-headers="props.transformInjectHeaders"
            :drop-fields="props.transformDropFields"
            :request-defaults="props.transformRequestDefaults"
            @update:inject-headers="emit('update:inject-headers', $event)"
            @update:drop-fields="emit('update:drop-fields', $event)"
            @update:request-defaults="emit('update:request-defaults', $event)"
          />
        </div>
      </div>
    </div>
  </div>
</template>
