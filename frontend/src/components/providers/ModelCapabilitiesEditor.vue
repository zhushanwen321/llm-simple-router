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
import { DEFAULT_CONTEXT_WINDOW, DEFAULT_STREAM_TIMEOUT_MS } from "@/constants";
import type { ProviderFormData } from "./types";
import type { ConcurrencyMode } from "@/types/concurrency";
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

const props = defineProps<{
  modelValue: ProviderFormData;
  editingId: string | null;
  errors: Record<string, string>;
  fetchingModels: boolean;
  hasModelsEndpoint: boolean;
  presetGroup: string;
  hasApiKey: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: ProviderFormData];
  "clear-errors": [field: string];
  "fetch-upstream-models": [];
}>();

function emitUpdate(patch: Partial<ProviderFormData>) {
  emit("update:modelValue", { ...props.modelValue, ...patch });
}

// --- Model mutation functions ---

function handleAddModel() {
  const input = props.modelValue.modelInput.trim();
  if (!input) return;
  const names = input
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const models = [...props.modelValue.models];
  for (const name of names) {
    if (!models.some((m) => m.name === name)) {
      models.push({
        name,
        context_window:
          Number(props.modelValue.contextWindowSelect) ||
          DEFAULT_CONTEXT_WINDOW,
        patches: [],
        stream_timeout_ms: DEFAULT_STREAM_TIMEOUT_MS,
        capabilities: [...newCapabilities.value],
      });
    }
  }
  emitUpdate({
    models,
    modelInput: "",
    contextWindowSelect: `${DEFAULT_CONTEXT_WINDOW}`,
  });
  newCapabilities.value = ["text"];
}

function removeModel(index: number) {
  const models = [...props.modelValue.models];
  models.splice(index, 1);
  emitUpdate({ models });
}

function updateModel(index: number, updated: ModelConfig) {
  const models = [...props.modelValue.models];
  models[index] = {
    ...models[index],
    context_window: updated.contextWindow,
    patches: updated.patches,
  };
  emitUpdate({ models });
}

function updateModelStreamTimeout(index: number, ms: number | undefined) {
  const models = [...props.modelValue.models];
  models[index] = {
    ...models[index],
    stream_timeout_ms: ms && ms > 0 ? ms : null,
  };
  emitUpdate({ models });
}

function toggleModelCapability(index: number, capability: string) {
  if (capability === "text") return;
  const models = [...props.modelValue.models];
  const model = models[index];
  const caps = model.capabilities ?? ["text"];
  models[index] = {
    ...model,
    capabilities: caps.includes(capability)
      ? caps.filter((c) => c !== capability)
      : [...caps, capability],
  };
  emitUpdate({ models });
}

function onConcurrencyModeChange(mode: ConcurrencyMode) {
  const patch: Partial<ProviderFormData> = { concurrencyMode: mode };
  if (mode === "auto") {
    if (
      !props.modelValue.maxConcurrency ||
      props.modelValue.maxConcurrency < 1
    ) {
      patch.maxConcurrency = 10;
    }
  } else if (mode === "manual") {
    if (
      !props.modelValue.maxConcurrency ||
      props.modelValue.maxConcurrency < 1
    ) {
      patch.maxConcurrency = 3;
    }
  }
  emitUpdate(patch);
}

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
          :model-value="props.modelValue.name"
          type="text"
          required
          class="mt-1"
          @update:model-value="emitUpdate({ name: String($event) })"
          @input="emit('clear-errors', 'name')"
        />
        <p v-if="props.errors.name" class="text-xs text-destructive mt-0.5">
          {{ props.errors.name }}
        </p>
      </div>
      <div>
        <Label class="text-xs text-muted-foreground">{{
          t("providers.fields.apiType")
        }}</Label>
        <Select
          :model-value="props.modelValue.apiType"
          @update:model-value="emitUpdate({ apiType: String($event) })"
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
          :model-value="props.modelValue.baseUrl"
          type="url"
          required
          class="mt-1 font-mono text-xs"
          @update:model-value="emitUpdate({ baseUrl: String($event) })"
          @input="emit('clear-errors', 'base_url')"
        />
        <p v-if="props.errors.base_url" class="text-xs text-destructive mt-0.5">
          {{ props.errors.base_url }}
        </p>
      </div>
      <div>
        <Label class="text-xs text-muted-foreground">{{
          t("providers.fields.apiKey")
        }}</Label>
        <Input
          :model-value="props.modelValue.apiKey"
          type="text"
          :required="!props.editingId"
          :placeholder="
            props.editingId ? t('providers.fields.apiKeyPlaceholder') : ''
          "
          class="mt-1"
          @update:model-value="emitUpdate({ apiKey: String($event) })"
          @input="emit('clear-errors', 'api_key')"
        />
        <p v-if="props.errors.api_key" class="text-xs text-destructive mt-0.5">
          {{ props.errors.api_key }}
        </p>
      </div>
    </div>
    <div class="mt-3">
      <Label class="text-xs">{{ t("providers.fields.upstreamPath") }}</Label>
      <Input
        :model-value="props.modelValue.upstreamPath"
        :placeholder="t('providers.fields.upstreamPathPlaceholder')"
        class="mt-1 font-mono text-xs"
        @update:model-value="emitUpdate({ upstreamPath: String($event) })"
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
        <div v-for="(m, i) in props.modelValue.models" :key="i">
          <ModelCard
            :model="{
              name: m.name,
              contextWindow: m.context_window ?? 200000,
              enabled: true,
              patches: m.patches ?? [],
            }"
            :api-type="props.modelValue.apiType"
            :is-deep-seek="m.name.toLowerCase().includes('deepseek')"
            :is-non-openai-endpoint="
              !isOfficialOpenai(props.modelValue.baseUrl)
            "
            :stream-timeout-ms="m.stream_timeout_ms ?? undefined"
            :capabilities="modelCapabilities(m)"
            @update:model="updateModel(i, $event)"
            @remove="removeModel(i)"
            @update:stream-timeout-ms="updateModelStreamTimeout(i, $event)"
            @toggle-capability="(cap: string) => toggleModelCapability(i, cap)"
          />
        </div>
      </div>
      <div class="flex gap-2 items-center">
        <Input
          :model-value="props.modelValue.modelInput"
          @update:model-value="emitUpdate({ modelInput: String($event) })"
          :placeholder="t('providers.fields.modelInputPlaceholder')"
          @keydown.enter.prevent="handleAddModel"
          class="flex-1"
        />
        <Select
          :model-value="props.modelValue.contextWindowSelect"
          @update:model-value="
            emitUpdate({ contextWindowSelect: String($event) })
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
          :disabled="!props.modelValue.modelInput.trim()"
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
              :model-value="props.modelValue.concurrencyMode"
              @update:model-value="
                onConcurrencyModeChange($event as ConcurrencyMode)
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
          <template v-if="props.modelValue.concurrencyMode !== 'none'">
            <div>
              <Label class="text-xs text-muted-foreground">{{
                t("providers.concurrency.maxConcurrency")
              }}</Label>
              <Input
                :model-value="String(props.modelValue.maxConcurrency)"
                type="number"
                class="mt-1"
                @update:model-value="
                  emitUpdate({ maxConcurrency: Number($event) })
                "
              />
            </div>
            <div>
              <Label class="text-xs text-muted-foreground">{{
                t("providers.concurrency.queueTimeout")
              }}</Label>
              <Input
                :model-value="String(props.modelValue.queueTimeoutMs)"
                type="number"
                class="mt-1"
                @update:model-value="
                  emitUpdate({ queueTimeoutMs: Number($event) })
                "
              />
            </div>
            <div>
              <Label class="text-xs text-muted-foreground">{{
                t("providers.concurrency.maxQueueSize")
              }}</Label>
              <Input
                :model-value="String(props.modelValue.maxQueueSize)"
                type="number"
                class="mt-1"
                @update:model-value="
                  emitUpdate({ maxQueueSize: Number($event) })
                "
              />
            </div>
          </template>
        </div>
        <!-- Proxy -->
        <ProxyConfigForm
          :model-value="props.modelValue.proxyConfig"
          @update:model-value="emitUpdate({ proxyConfig: $event })"
        />
        <!-- Transform Rules -->
        <div class="border border-input rounded-md p-3 space-y-3">
          <div class="text-xs font-medium text-muted-foreground">
            {{ t("providers.transform.title") }}
          </div>
          <TransformRulesForm
            :model-value="props.modelValue.transformConfig"
            @update:model-value="emitUpdate({ transformConfig: $event })"
          />
        </div>
      </div>
    </div>
  </div>
</template>
