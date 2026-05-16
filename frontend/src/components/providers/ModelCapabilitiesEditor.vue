<script setup lang="ts">
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
import { RotateCw } from "lucide-vue-next";
import ModelCard from "@/components/quick-setup/ModelCard.vue";
import ConcurrencyControl from "@/components/shared/ConcurrencyControl.vue";
import TransformRulesForm from "@/components/shared/TransformRulesForm.vue";
import ProxyConfigForm from "@/components/shared/ProxyConfigForm.vue";
import { CONTEXT_WINDOW_OPTIONS } from "@/composables/useProviderForm";
import type { ConcurrencyMode } from "@/composables/useProviderForm";
import type { ModelInfo } from "@/types/mapping";
import type { ModelConfig } from "@/components/quick-setup/types";

const { t } = useI18n();

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
  "toggle-model-image-capability": [index: number];
  "fetch-upstream-models": [];
  "add-model": [];
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
  <!-- Form fields grid -->
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
  <div>
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
  <!-- Available models -->
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
    <div class="grid grid-cols-3 gap-2 mb-3">
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
          @toggle-image-capability="emit('toggle-model-image-capability', i)"
        />
      </div>
    </div>
    <div class="flex gap-2">
      <Input
        :model-value="props.modelInput"
        @update:model-value="emit('update:model-input', String($event))"
        :placeholder="t('providers.fields.modelInputPlaceholder')"
        @keydown.enter.prevent="emit('add-model')"
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
      <Button
        type="button"
        variant="outline"
        size="sm"
        @click="emit('add-model')"
        :disabled="!props.modelInput.trim()"
        >{{ t("providers.fields.addModel") }}</Button
      >
    </div>
  </div>
  <!-- Concurrency + Transform -->
  <div class="grid grid-cols-2 gap-4">
    <div class="border rounded-md p-3 space-y-3">
      <div class="text-xs font-medium text-muted-foreground">
        {{ t("providers.concurrency.title") }}
      </div>
      <ConcurrencyControl
        :mode="props.concurrencyMode"
        :max-concurrency="props.maxConcurrency"
        :queue-timeout-ms="props.queueTimeoutMs"
        :max-queue-size="props.maxQueueSize"
        compact
        @update:mode="
          emit('update:concurrency-mode', $event as ConcurrencyMode)
        "
        @update:max-concurrency="emit('update:max-concurrency', $event)"
        @update:queue-timeout-ms="emit('update:queue-timeout-ms', $event)"
        @update:max-queue-size="emit('update:max-queue-size', $event)"
      />
    </div>
    <div class="border rounded-md p-3 space-y-3">
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
</template>
